import { startObservingMutations, onAttributesAdded, onElAdded, onElRemoved, cleanupAttributes, cleanupElement } from "./mutation"
import { deferHandlingDirectives, directiveExists, directives } from "./directives"
import { dispatch } from './utils/dispatch'
import { findClosestByCss } from './utils/findClosest'
import { walk } from "./utils/walk"
import { warn } from './utils/warn'

let started = false

export function start() {
    if (started) warn('Alpine has already been initialized on this page. Calling Alpine.start() more than once can cause problems.')

    started = true

    if (! document.body) warn('Unable to initialize. Trying to load Alpine before `<body>` is available. Did you forget to add `defer` in Alpine\'s `<script>` tag?')

    dispatch(document, 'alpine:init')
    dispatch(document, 'alpine:initializing')

    startObservingMutations()

    onElAdded(el => initTree(el, walk))
    onElRemoved(el => destroyTree(el))

    onAttributesAdded((el, attrs) => {
        directives(el, attrs).forEach(handle => handle())
    })

    initTree(document)

    dispatch(document, 'alpine:initialized')

    setTimeout(() => {
        warnAboutMissingPlugins()
    })
}

let rootSelectorCallbacks = []

// TODO[better-upward-search] - Remove. Instead set metadata on `Alpine.diretive()`
export function getRootSelectors() {
    return rootSelectorCallbacks.map(fn => fn());
}

// TODO[better-upward-search]
// Does `addRootSelector` NEED to be part of public API?
//
// Instead, for next major release, add a `settings` argument to `directive()`.
// So one could define directly on `Alpine.directive()` whether the directive should be handled
// as root or not. That way, the creation of the selector would remain internal, which would mean:
// 1. We could have the confidence that the root selectors are all valid.
// 2. Freedom to define the selectors as XPath selectors instead of CSS selectors.
export function addRootSelector(selectorCallback) {
    rootSelectorCallbacks.push(selectorCallback)
}

// TODO[better-upward-search]
// TODO - In next major release, add a `settings` argument to `directive()`,
// and add a fields that says whether the directive supports:
// 1. values - AKA string after `:`, e.g. `x-on:click`
// 2. modifiers - AKA string after `.`, e.g. `x-on:click.prevent`
// These could be set to explicit list of strings, or simply `true` for more dynamic needs.
// (defaults to `true` for 3rd-party diretives for backwards compatibility?)
//
// ```js
// directive(
//   'my-directive',
//   (el) => { ... },
//   { values: true, modifiers: ['prevent', 'once'] },
// )
// ```
//
// Thus, if directive does NOT support neither (`false` or empty list),
// then we could we could look that up here. And then we could search attributes
// upwards by doing `el.closest("[x-diretive]")`
//
// Because, if a directive DOES support values or modifiers, we might want to instead use
// xPath selector with `document.evaluate()` (which might be slower).
export function closestRoot(el) {
    const rootSelectors = getRootSelectors()
    return findClosestByCss(el, rootSelectors);
}

// TODO[better-upward-search]
// Construct the selectors based on whether directives allow values (`:`)
// and/or modifiers (`.`).
// But `cloneTree()` where this is used is deprecated, so maybe just delete it in the future?
export function isRoot(el) {
    return getRootSelectors().some(selector => el.matches(selector))
}

let initInterceptors = []

export function interceptInit(callback) { initInterceptors.push(callback) }

let markerDispenser = 1

/** @param {HTMLElement | Document} el */
export function initTree(el, walker = walk, intercept = null) {
    // Don't init a tree within a parent that is being ignored...
    const isInsideIgnored = !(el instanceof Document) && findClosestByCss(el, ['[x-ignore],[x-ignore\\.self]']);
    if (isInsideIgnored) return;

    deferHandlingDirectives(() => {
        walker(el, (el, skip) => {
            // If the element has a marker, it's already been initialized...
            // TOOD
            // if (el._x_marker) return
            if (el._x_marker) return skip();

            // TODO
            if (intercept) intercept(el, skip);

            initInterceptors.forEach(i => i(el, skip))

            directives(el, el.attributes).forEach(handle => handle())

            // Add a marker to the element so we can tell if it's been initialized...
            // This is important so that we can prevent double-initialization of
            // elements that are moved around on the page.
            if (!el._x_ignore) el._x_marker = markerDispenser++

            // TODO - WHY DON'T WE CHECK FOR `_x_ignoreSelf?
            el._x_ignore && skip()
        }, { lazy: true })
    })
}

/** @param {HTMLElement | Document} el */
export function destroyTree(root, walker = walk) {
    walker(root, el => {
        cleanupElement(el)
        cleanupAttributes(el)
        delete el._x_marker
    }, { lazy: false })
}

function warnAboutMissingPlugins() {
    let pluginDirectives = [
        [ 'ui', 'dialog', ['[x-dialog], [x-popover]'] ],
        [ 'anchor', 'anchor', ['[x-anchor]'] ],
        [ 'sort', 'sort', ['[x-sort]'] ],
    ]

    pluginDirectives.forEach(([ plugin, directive, selectors ]) => {
        if (directiveExists(directive)) return

        selectors.some(selector => {
            if (document.querySelector(selector)) {
                warn(`found "${selector}", but missing ${plugin} plugin`)

                return true
            }
        })
    })
}
