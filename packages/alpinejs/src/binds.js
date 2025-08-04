import { attributesOnly, directives } from "./directives"

/** @type { {[key: string | HTMLElement]: () => object} } */
let binds = {}

/**
 * @param {HTMLElement | string} nameOrEl
 * @param {*} bindings
 */
export function bind(nameOrEl, bindings) {
    let getBindings = typeof bindings !== 'function' ? () => bindings : bindings

    if (nameOrEl instanceof Element) {
        return applyBindingsObject(nameOrEl, getBindings())
    } else {
        binds[nameOrEl] = getBindings
    }

    return () => {} // Null cleanup...
}

/**
 * @param {object} obj
 */
export function injectBindingProviders(obj) {
    Object.entries(binds).forEach(([name, callback]) => {
        Object.defineProperty(obj, name, {
            get() {
                return (...args) => {
                    return callback(...args)
                }
            }
        })
    })

    return obj
}

export function addVirtualBindings(el, bindings) {
    let getBindings = typeof bindings !== 'function' ? () => bindings : bindings

    el._x_virtualDirectives = getBindings()
}

/**
 * @param {HTMLElement} el
 * @param {object} obj
 * @param {unknown} original
 */
export function applyBindingsObject(el, obj, original) {
    let cleanupRunners = []

    while (cleanupRunners.length) cleanupRunners.pop()()

    let attributes = Object.entries(obj).map(([name, value]) => ({ name, value }))

    let staticAttributes = attributesOnly(attributes)

    // Handle binding normal HTML attributes (non-Alpine directives).
    attributes = attributes.map(attribute => {
        if (staticAttributes.find(attr => attr.name === attribute.name)) {
            return {
                name: `x-bind:${attribute.name}`,
                value: `"${attribute.value}"`,
            }
        }

        return attribute
    })

    directives(el, attributes, original).map(handle => {
        cleanupRunners.push(handle.runCleanups)

        handle()
    })

    return () => {
        while (cleanupRunners.length) cleanupRunners.pop()()
    }
}
