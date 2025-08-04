import { onAttributeRemoved } from './mutation'
import { evaluate, evaluateLater } from './evaluator'
import { elementBoundEffect } from './reactivity'
import Alpine from './alpine'

// NOTE: An attribute without a value (e.g. `<div x-data>`) still
// has empty string as value.
/** @typedef { {name: string; value: string} } Attribute */
/** @typedef { NamedNodeMap | Attribute[] } AttributeList */
/** @typedef { (attr: Attribute) => Attribute } AttributeTransformer */
/** @typedef { { type: string; value: string | null; modifiers: string[]; expression: string; original: unknown } } Directive */

let prefixAsString = 'x-'
let alpineAttributeRegex = new RegExp(`^${prefixAsString}([^:^.]+)\\b`)

export function prefix(subject = '') {
    return prefixAsString + subject
}

export function setPrefix(newPrefix) {
    prefixAsString = newPrefix
    // NOTE: The attribut regex is accessed more times than written,
    // so we pre-compute it on write.
    alpineAttributeRegex = new RegExp(`^${prefixAsString}([^:^.]+)\\b`);
}

let directiveHandlers = {}

/**
 * @param {string} name
 * @param {(el: HTMLElement, directive: Directive, { effect, cleanup }) => void } callback
 */
export function directive(name, callback) {
    directiveHandlers[name] = callback

    return {
        before(directive) {
            if (!directiveHandlers[directive]) {
                console.warn(String.raw`Cannot find directive \`${directive}\`. \`${name}\` will use the default order of execution`);
                return;
            }
            const pos = directiveOrder.indexOf(directive);
            directiveOrder.splice(pos >= 0 ? pos : directiveOrder.indexOf('DEFAULT'), 0, name);
        }
    }
}

/**
 * @param {string} name
 */
export function directiveExists(name) {
    return Object.keys(directiveHandlers).includes(name)
}

/**
 * @param {HTMLElement} el 
 * @param {AttributeList} attributes
 * @param {object} originalAttributeOverride
 */
export function directives(el, attributes, originalAttributeOverride) {
    let attributesArr = Array.from(attributes)

    if (el._x_virtualDirectives) {
        let vAttributes = Object.entries(el._x_virtualDirectives).map(([name, value]) => ({ name, value }))

        let staticAttributes = attributesOnly(vAttributes)

        // Handle binding normal HTML attributes (non-Alpine directives).
        vAttributes = vAttributes.map(attribute => {
            if (staticAttributes.find(attr => attr.name === attribute.name)) {
                return {
                    name: `x-bind:${attribute.name}`,
                    value: `"${attribute.value}"`,
                }
            }

            return attribute
        })

        attributesArr = attributesArr.concat(vAttributes)
    }

    let transformedAttributeMap = {}

    const onChangedName = (newName, oldName) => {
        transformedAttributeMap[newName] = oldName;
    }

    // NOTE: Use a single loop to avoid intermediate arrays.
    /** @type {Directive[]} */
    const directivesData = [];
    for (const attribute of attributesArr) {
      const transformedAttr = toTransformedAttributes(attribute, onChangedName);
      
      if (transformedAttr.name.match(alpineAttributeRegex)) {
        const directive = toParsedDirectives(transformedAttr, transformedAttributeMap, originalAttributeOverride);
        directivesData.push(directive);
      }
    }
    directivesData.sort(byPriority);

    const handlers = []
    for (const directive of directivesData) {
        const handler = getDirectiveHandler(el, directive);
        if (handler) handlers.push(handler);
    }
    return handlers;
}

/**
 * @param {AttributeList} attributes 
 */
export function attributesOnly(attributes) {
    return Array.from(attributes)
        .map(attr => toTransformedAttributes(attr))
        .filter(attr => ! attr.name.match(alpineAttributeRegex))
}

let isDeferringHandlers = false
let directiveHandlerStacks = new Map
let currentHandlerStackKey = Symbol()

export function deferHandlingDirectives(callback) {
    isDeferringHandlers = true

    let key = Symbol()

    currentHandlerStackKey = key

    directiveHandlerStacks.set(key, [])

    // NOTE: `flushHandlers()` is a performance hotspot (observed in Alpine 3.14.9),
    //       with about ~35% of the time spent here when Alpine is starting (`Alpine.start()`).
    const flushHandlers = () => {
      const stack = directiveHandlerStacks.get(key);
      directiveHandlerStacks.delete(key);
    
      if (!stack) return;
    
      for (let i = 0; i < stack.length; i++) {
        stack[i]();
      }
    };

    let stopDeferring = () => { isDeferringHandlers = false; flushHandlers() }

    callback(flushHandlers)

    stopDeferring()
}


/** @type {Map<HTMLElement, [(cb: () => void) => void, () => void]> } */
let elBoundEffectsCache = new Map()
const cached = elBoundEffectsCache.get(el);
if (cached) return cached;
elBoundEffectsCache.set(el, result)


// AAAAh, so `getElementBoundUtilities()` adds `_x_effects`
// Ah, so this also creates the `effect()` helper.
// NOTE: this fn is used in 2 places:
//       1. `getDirectiveHandler`, which is used ONLY with elements with `x-` alpine directives
//       2. `getUtilities` / `injectMagics`
/**
 * @param {HTMLElement} el
 */
export function getElementBoundUtilities(el) {
    let cleanups = []

    let cleanup = callback => cleanups.push(callback)

    let [effect, cleanupEffect] = elementBoundEffect(el)

    cleanups.push(cleanupEffect)

    let utilities = {
        Alpine,
        effect,
        cleanup,
        evaluateLater: evaluateLater.bind(evaluateLater, el),
        evaluate: evaluate.bind(evaluate, el),
    }

    let doCleanup = () => cleanups.forEach(i => i())

    return [utilities, doCleanup]
}

/**
 * @param {HTMLElement} el
 * @param {Directive} directive
 */
export function getDirectiveHandler(el, directive) {
    let handler = directiveHandlers[directive.type];

    if (!handler) return null;

    let [utilities, cleanup] = getElementBoundUtilities(el)

    onAttributeRemoved(el, directive.original, cleanup)

    let fullHandler = () => {
        if (el._x_ignore || el._x_ignoreSelf) return

        // TODO - WHAT IS THE POINT OF THIS `.inline`? Why can't we just move
        // the logic with the rest of the `handler` fn?
        handler.inline && handler.inline(el, directive, utilities)

        handler = handler.bind(handler, el, directive, utilities)

        isDeferringHandlers ? directiveHandlerStacks.get(currentHandlerStackKey).push(handler) : handler()
    }

    fullHandler.runCleanups = cleanup

    return fullHandler
}

export let startingWith = (subject, replacement) => ({ name, value }) => {
    if (name.startsWith(subject)) name = name.replace(subject, replacement)

    return { name, value }
}

export let into = i => i

/**
 * @param {Attribute}
 * @param { (newName: string, oldName: string) => void } onChangedName 
 * @returns {Attribute}
 */
function toTransformedAttributes({ name, value }, onChangedName = () => {}) {
    let { name: newName, value: newValue } = attributeTransformers.reduce((carry, transform) => {
        return transform(carry)
    }, { name, value })

    if (newName !== name) onChangedName(newName, name)

    return { name: newName, value: newValue }
}

/** @type {AttributeTransformer[]} */
let attributeTransformers = []

/**
 * @param {AttributeTransformer} callback
 */
export function mapAttributes(callback) {
    attributeTransformers.push(callback)
}

let directiveValueRegex = /:([a-zA-Z0-9\-_:]+)/;
let modifierValueRegex = /\.[^.\]]+(?=[^\]]*$)/g;

/**
 * @param {Attribute}
 * @param {Record<string, string>} transformedAttributeMap
 * @param {unknown} originalAttributeOverride
 * @returns {Directive}
 */
function toParsedDirectives({ name, value }, transformedAttributeMap, originalAttributeOverride) {
    // AKA the directive name, e.g. `<div x-data>` has type `data`
    let typeMatch = name.match(alpineAttributeRegex)
    // Value is the part of the directive after of `:`, e.g. `<div x-on:click>` has value `click`
    let valueMatch = name.match(directiveValueRegex)
    // Value is the part of the directive after of `.`, e.g. `<div x-on:click.prevent.once>`
    // has modifiers `prevent` and `once`
    let modifiers = name.match(modifierValueRegex) || []
    let original = originalAttributeOverride || transformedAttributeMap[name] || name

    return {
        // TODO - How can a directive NOT be matched? This should raise error.
        type: typeMatch ? typeMatch[1] : null,
        value: valueMatch ? valueMatch[1] : null,
        modifiers: modifiers.map(i => i.replace('.', '')),
        expression: value,
        original,
    }
}

const DEFAULT = 'DEFAULT'

let directiveOrder = [
    'ignore',
    'ref',
    'data',
    'id',
    'anchor',
    'bind',
    'init',
    'for',
    'model',
    'modelable',
    'transition',
    'show',
    'if',
    DEFAULT,
    'teleport',
]

/**
 * @param {Directive} a
 * @param {Directive} b
 */
function byPriority(a, b) {
    let typeA = directiveOrder.indexOf(a.type) === -1 ? DEFAULT : a.type
    let typeB = directiveOrder.indexOf(b.type) === -1 ? DEFAULT : b.type

    return directiveOrder.indexOf(typeA) - directiveOrder.indexOf(typeB)
}
