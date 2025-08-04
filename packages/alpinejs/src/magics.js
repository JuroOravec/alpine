import { getElementBoundUtilities } from './directives'
import { interceptor } from './interceptor'
import { onElRemoved } from './mutation'

/** @typedef {Record<string, any>} MagicUtils */
/** @typedef {(el: HTMLElement, utilities: MagicUtils) => any} Magic */
/** @typedef { {callback: Magic, propDescriptor: Record<string, any> | null} } MagicMetadata */

/** @type {Record<string, MagicMetadata>} */
let magics = {};

/** @type {string[]} */
let magicsKeys = [];

/**
 * @param {string} name 
 * @param {Magic} callback 
 */
export function magic(name, callback) {
    // Magics are stored by their property name.
    // So registering `magic('el')` will store it under `$el`.
    const magicPropName = `$${name}`;

    // Magics are accessed more times than written, and we have to
    // return a prop descriptor object every time the `getOwnPropertyDescriptor`
    // on the proxy is triggered. So we want to store that object and reuse it.
    // However, we do so lazily, creating the object only once needed at least once.
    magics[magicPropName] = { callback, propDescriptor: null };
    magicsKeys = Object.keys(magics);
}

// Cache so that different calls to injectMagics that use the same
// HTMLElement will return the same instance of utilities.
/** @type {Map<HTMLElement, MagicUtils} */
let cachedUtils = new Map()

/**
 * @template T
 * @param {T} obj
 * @param {HTMLElement} el 
 * @returns {T}
 */
export function injectMagics(obj, el) {
    let utils = cachedUtils.get(el);
    if (!utils) {
        utils = getUtilities(el)
        cachedUtils.set(el, utils);
    }

    // Pros of Proxy:
    // 1. Magics can be dynamically added even later in lifecycle.
    // 2. Faster - creation (speeds up start up time) as it defines only get/has,
    //    not all individual Alpine magics
    // Cons:
    // 1. Magics do not show up in Dev tools when you inspect a magics-injected object.
    const magicProxy = new Proxy(obj, {
        get(target, prop) {
            const magic = magics[prop];
            if (magic) {
                return magic.callback(el, {...utils});
            }
            return target[prop];
        },
        has(target, prop) {
            const magic = magics[prop];
            return !!magic || Reflect.has(target, prop);
        },

        // ownKeys and getOwnPropertyDescriptor help to make the Alpine magics
        // visible e.g. in the interceptors logic.
        ownKeys(target) {
            return Reflect.ownKeys(target).concat(magicsKeys);
        },

        getOwnPropertyDescriptor(target, prop) {
            const magic = magics[prop];
            if (magic) {
                if (!magic.propDescriptor) {
                    magic.propDescriptor = {
                        configurable: true,
                        enumerable: false,
                        value: magic.callback,
                    };
                }
                return magic.propDescriptor;
            }
            return Reflect.getOwnPropertyDescriptor(target, prop);
        },
    });

    return magicProxy
}

// NOTE: Stored globally and reused for lower memory impact
const magicsProxyHandler = {
    get(target, prop) {
        const magic = magics[prop];
        if (magic) {
            return magic.callback(el, utils);
        }
        return target[prop];
    },
    has(target, prop) {
        const magic = magics[prop];
        return !!magic || Reflect.has(target, prop);
    },

    // ownKeys and getOwnPropertyDescriptor help to make the Alpine magics
    // visible e.g. in the interceptors logic.
    ownKeys(target) {
        return Reflect.ownKeys(target).concat(magicsKeys);
    },

    getOwnPropertyDescriptor(target, prop) {
        const magic = magics[prop];
        if (magic) {
            if (!magic.propDescriptor) {
                magic.propDescriptor = {
                    configurable: true,
                    enumerable: false,
                    value: magic.callback,
                };
            }
            return magic.propDescriptor;
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
    },
};


/**
 * @param {HTMLElement} el 
 * @returns {MagicUtils}
 */
export function getUtilities(el) {
    let [utilities, cleanup] = getElementBoundUtilities(el)

    let utils = { interceptor, ...utilities }

    onElRemoved(el, cleanup)

    return utils;
}
