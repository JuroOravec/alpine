import { effectScope, getCurrentScope, watchEffect, computed } from '@vue/reactivity';

import { effect, release } from './reactivity';

/** @typedef {import('@vue/reactivity').ReactiveEffect} ReactiveEffect */

// TODO - PART OF LAZY_SCOPE_FETCH
/** @param {HTMLElement} el */
export function scope(el) {
    return mergeProxies2(el, null)
}

// TODO - Allow directives to register which CSS selectors mean that a component has data stack
//        (similarly to how "root" is defined)
//      - Add `x-data`
//      - And `x-teleport`'s data-teleport-target
//      - In `x-if` set `data-xif-target` on the inserted root node
//        And add that
//      - In `x-for` set `data-xfor-target` on the inserted root node(s)
//        And add that to selectors
//      - Then, we could run `closestDataStack` by running `findClosestByCss`
// TODO - ADDED ISOLATION FOR x-data -> `x-data.isolated`.
// NOTE - SET_SCOPE
// TODO - PART OF LAZY_SCOPE_FETCH
export function addScopeToNode(node, data, referenceNode, isolated = false) {
    // TODO: FOR LAZY_SCOPE_FETCH, `closestDataStack` should be called when `referenceNode` is set!!!
    // const outerScopes = isolated ? [] : closestDataStack(referenceNode || node);
    const outerScopes = (isolated || !referenceNode) ? [] : closestDataStack(referenceNode);
    node._x_dataStack = [data, ...outerScopes]

    return () => {
        node._x_dataStack = node._x_dataStack.filter(i => i !== data)
    }
}

// NOTE - HAS_SCOPE
export function hasScope(node) {
    return !! node._x_dataStack
}

// TODO - Use `findClosest()` instead of while loop??
// TODO - Use `findClosest()` instead of while loop??
// NOTE - GET_SCOPE
export function closestDataStack(node) {
    let currEl = node;
    while (true) {
        // We've reached data stack
        if (currEl._x_dataStack) return currEl._x_dataStack

        if (typeof ShadowRoot === 'function' && currEl instanceof ShadowRoot) {
            currEl = currEl.host;
        }

        // We've reached the top
        if (!currEl.parentNode) {
            return []
        }

        // Keep walking up
        currEl = currEl.parentNode;
    }
}


// TODO - THIS COULD BE OPTIMIZED BY pre-computing and invalidating / updating
// when one of the objects changes.
//
// STEPS TOWARDS CACHING FIELDS
// 0. Problem - With reactivity, we track access/setters to properties. And for
//    that we need to know the properties in advance. If we don't know the prop names,
//    we can't track access to it.
// 1. So for each property, we need to run `objects.some((obj) => ...` at least once.
// 2. On first access we create an effect and wrap `objects.some(...)` inside it.
//    That way, we will have an effect that re-triggers when:
//    a) We write to the same property; and
//    b) On any layers between the latest and the one where the prop was found (both incl)
//    So if a prop was written on a layer higher up, this would be ignored.
// 3. We save the effect under property name {propName -> {effect, layer}}
//    - NOTE: When the effect runs, it saves the layer where obj is saved.
//      We store that instead of the value directly, because we still want to track reactivity
//      access when the merge proxy is being accessed.
//    - When any of the layers are updated from inside the data obj, this should re-trigger
//      the effect, which should update which layer now has the value.
//      - This should handle both deletion and reassignment.
// 4. We can also use the prop-effect mapping to speed up `has`.
//    - If there is non-null entry in mapping, return True
//    - If null entry, return False (no obj has the prop)
//    - if entry not present, trigger `thisProxy.get` to populate the cache if one of above.
// 5. Same for `get` as for `has`.
// 6. On `set`, first check `get`, aka check if we have entry in mapping.
//    - If yes, select that layer. and assign to that layer directly.
//    - If no, select latest layer. Set to that layer. And then run again `get`
//      to save that prop in the mapping.
// 5. Same for `delete` as for `set`.

/** @typedef { { effect: ReactiveEffect; layer: Record | null } } ProxyAccessEntry */

// Tracks which proxies are there, and for each one, a map of which properties were accessed.
/** @type {Map<Symbol, Map<any, ProxyAccessEntry>>} */
let proxyPropAccessCache = new Map();

// NOTE: We create reactivity effects to track and cache the access to objects in merged proxies.
//       But the lifetime of these effects is bound to the Proxy itself - when the Proxy is
//       garbage collected, we want to unregister the effects.
/** @type {FinalizationRegistry<Symbol>} */
let effectFinalizerRegistry = new FinalizationRegistry((cacheKey) => {
    const watchedProps = proxyPropAccessCache.get(cacheKey);
    if (!watchedProps) return;

    for (const [key, { effect }] of watchedProps.entries()) {
        release(effect);
    }
    proxyPropAccessCache.delete(cacheKey);
});

export function mergeProxies (objects) {
    // A dedicated cache key (strong ref) for data related to the Proxy.
    // Needed because:
    // - Normally we'd store any data related to the Proxy on WeakMap with the Proxy itself as the key.
    // - But MDN says that, by the time the finalizers run, any WeakRefs are cleared. So the WeakMap
    //   would NOT have the Proxy anymore.
    // - Thus, instead, we use a normal Map with strong reference key. Proxy being garbage collected serves
    //   only as a trigger, but related data is actually retrieved via this cache key.
    const cacheKey = Symbol('MergedProxy')

    const proxy = new Proxy({ objects, cacheKey }, mergeProxyTrap);

    // Clean up effects when the proxy is garbage collected
    effectFinalizerRegistry(proxy, cacheKey);
};

/** @type {ProxyHandler<{ objects: Record[]; cacheKey: Symbol }>} */
let mergeProxyTrap = {
    ownKeys({ objects }) {
        return Array.from(
            new Set(objects.flatMap((i) => Object.keys(i)))
        )
    },

    has({ objects, cacheKey }, name) {
        if (name == Symbol.unscopables) return false;

        // TODO - Going low-level with Vue Reactivity:
        //        1. Update to latest Vue reactivity (v3.5.18; but minimum v3.2)
        //        2. Inside here, detect if we're inside an effect scope or not with getCurrentScope()
        //        3. Either way, we have to call `accessProxyProp()` to prepare the effect / layer
        //        4. If NO currentScope, simply return `Reflect.has(layer, name)` - no need to track
        //        5. If YES currentScope, run original `objects.find(has...)` to track all accesses.
        //        
        //        https://github.com/vuejs/core/blob/c875019d49b4c36a88d929ccadc31ad414747c7b/packages/reactivity/src/dep.ts#L262

        const layer = accessProxyProp(cacheKey, objects, name);
        if (layer === null) {
            // Prop wasn't found
            return false;
        } else {
            // Prop was found.
            // In order to keep reactivity tracking, trigger `has` on the layer that has the prop.
            return Reflect.has(layer, name);
        }
    },

    get({ objects, cacheKey }, name, receiver) {
        if (name == Symbol.unscopables) return false;
        if (name == "toJSON") return collapseProxiesp

        const layer = accessProxyProp(cacheKey, objects, name);
        if (layer === null) {
            // Prop wasn't found
            return undefined;
        } else {
            // Prop was found.
            // In order to keep reactivity tracking, trigger `get` on the layer that has the prop.
            return Reflect.get(layer, name, receiver);
        }
    },

    set({ objects }, name, value, receiver) {
        const target =
            objects.find((obj) =>
                Object.prototype.hasOwnProperty.call(obj, name)
            ) || objects[objects.length - 1];
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        if (descriptor?.set && descriptor?.get)
            // Can't use Reflect.set here due to [upstream bug](https://github.com/vuejs/core/blob/31abdc8adad569d83b476c340e678c4daa901545/packages/reactivity/src/baseHandlers.ts#L148) in @vue/reactivity
            return descriptor.set.call(receiver, value) || true;
        return Reflect.set(target, name, value);
    },

    // TODO
    // TODO
    // /**
    //  * A trap for `Object.defineProperty()`.
    //  * @param target The original object which is being proxied.
    //  * @returns A `Boolean` indicating whether or not the property has been defined.
    //  */
    // defineProperty?(target: T, property: string | symbol, attributes: PropertyDescriptor): boolean;

    // /**
    //  * A trap for the `delete` operator.
    //  * @param target The original object which is being proxied.
    //  * @param p The name or `Symbol` of the property to delete.
    //  * @returns A `Boolean` indicating whether or not the property was deleted.
    //  */
    // deleteProperty?(target: T, p: string | symbol): boolean;
};

/**
 * @param {Symbol} cacheKey
 * @param {Record[]} objects
 * @param {string} propName
 * @returns {Record | null}
 */
function accessProxyProp(cacheKey, objects, propName) {
    let proxyData = proxyPropAccessCache.get(cacheKey);
    if (!proxyData) {
        proxyData = new Map();
        proxyPropAccessCache.set(cacheKey, proxyData);
    }

    let propData = proxyData.get(propName);
    if (!propData) {
        propData = { effect: null, layer: null };
        proxyPropAccessCache.set(cacheKey, propData);

        // Search for the prop by walking up the objects.
        // We do it inside an effect, so if any of the in-between layers change/set/delete
        // the searched property, the effect will re-run.
        // NOTE: If the access to the proxy's prop happens in an effect, this access below
        //       will NOT be detected for the outer effect scope.
        propData.effect = effect(() => {
            // TODO: I removed `Object.prototype.hasOwnProperty.call(obj, propName)` here.
            //       Doesn't seem to be needed?
            const objIndex = objects.findIndex((obj) => Reflect.has(obj, propName));
            propData.layer = objIndex !== -1 ? objects[objIndex] : null;
        });
    }

    return propData.layer;
}


// TODO - PART OF LAZY_SCOPE_FETCH
/**
 * @param {HTMLElement} el 
 * @param {Record[]|undefined|null} extraStack 
 * @param {(el: HTMLElement) => HTMLElement | null} finder
 */
export function mergeProxies2 (el, extraStacks, finder = closestDataStackEl) {
    const objects = extraStacks ? [...extraStacks] : [];

    const proxy = new Proxy({ objects, nextAncestor: el, finder }, mergeProxyTrap2);
    return proxy;
};

// TODO - PART OF LAZY_SCOPE_FETCH
/** @type {ProxyHandler<{ objects: any[]; nextAncestor: HTMLElement|null; finder: (parentEl: HTMLElement) => HTMLElement | null }>} */
let mergeProxyTrap2 = {
    // TODO - IS THIS EVER USED?
    //        WE SHOULD RAISE ERROR WHEN THIS IS ACCESSED.
    //        WE CAN'T KNOW ALL KEYS UNTIL WE'VE FETCHED ALL ANCESTORS!
    //        TODO - DEPRECATE support for `toJSON`
    //             - ALSO, DOES IT MEAN THAT I CAN JUST CALL `toJSON` in an expression
    //               just like that? THAT'S SILLLY!
    ownKeys({ objects }) {
        return Array.from(
            new Set(objects.flatMap((i) => Object.keys(i)))
        )
    },

    has(proxyData, name) {
        if (name == Symbol.unscopables) return false;
        // NOTE: This is our private property - user should avoid defining `__self` on their objects!!
        // When evaluating expression insside the async func, we do it inside a scope.
        // Inside the scope, JS checks each variable name it comes across, whether it's defined
        // on the scope.
        // - One approach is to put the results object `__self` among the `objects`.
        //   but then we have to move the assignment to the `__self.finished` inside
        //   the scope too, which increased the amount of operations, because it leads to more
        //   checks on whether all seen variables belong to the scope.
        // - Alternatively, the `__self` is kept outside of `objects`, but then we must explicitly
        //   say here that NO `__self` is NOT in among the objects, otherwise we would walk up the
        //   data objects needlessly.
        if (name === "__self") return false;

        return walkProxyStack(proxyData, (obj, index, stop) => {
            if (Reflect.has(obj, name)) {
                return stop(true);
            };
        });
    },

    get(proxyData, name, thisProxy) {
        if (name == "toJSON") return collapseProxies

        return walkProxyStack(proxyData, (obj, index, stop) => {
            if (Reflect.has(obj, name)) {
                const value = Reflect.get(obj, name, thisProxy);
                return stop(value);
            };
        });
    },

    set(proxyData, name, value, thisProxy) {
        // First find if there is object in the stack that already has this property
        let obj = walkProxyStack(proxyData, (obj, index, stop) => {
            if (Reflect.has(obj, name)) {
                return stop(obj);
            };
        });

        // If not found, use the latest layer to assign the variable
        if (obj) obj = objects[objects.length - 1];

        const descriptor = Object.getOwnPropertyDescriptor(obj, name);
        if (descriptor?.set && descriptor?.get)
            // Can't use Reflect.set here due to [upstream bug](https://github.com/vuejs/core/blob/31abdc8adad569d83b476c340e678c4daa901545/packages/reactivity/src/baseHandlers.ts#L148) in @vue/reactivity
            return descriptor.set.call(thisProxy, value) || true;
        return Reflect.set(obj, name, value);
    },
}

// TODO - PART OF LAZY_SCOPE_FETCH
/**
 * @template T
 * @param {{ objects: any[]; nextAncestor: HTMLElement|null; finder: (parentEl: HTMLElement) => HTMLElement | null }} proxyHandlerData
 * @param {(obj: any, index: number, stop: (result: T) => void) => void} cb
 * @returns {T}
 */
const walkProxyStack = (proxyHandlerData, cb) => {
    const { objects, finder } = proxyHandlerData;
    
    let willStop = false;
    /** @type {T} */
    let result = undefined;
    const stop = (res) => {
        willStop = true;
        result = res;
    };
    
    let currObjIndex = 0;
    while (objects.length > currObjIndex || proxyHandlerData.nextAncestor) {
        // There are entries in `objects` that we haven't went over yet.
        if (currObjIndex < objects.length) {
            const obj = objects[currObjIndex];

            cb(obj, currObjIndex, stop);

            // GIVE THE CALLBACK SOME WAY TO CALL STOP()
            if (willStop) return result;

            // IF STOP() NOT CALLED, WE CONTINUE FURTHER.
            currObjIndex++;
            continue;
        }
        
        // In this case we've depleted all objects in `objects`, but we can fetch
        // more from ancestors. So add next layer(s).
        // NOTE: A single HTML element may have multiple objects in its stack.
        //
        // Imagine for example:
        // ```html
        // <template x-for="item in items">
        //   <div x-data={ open: true }>
        // </template>
        // ```
        // In which case the `<div>` will have one object from x-data, and one from x-for
        // TODO: DIDN'T VERIFY THIS!!!!
        const currEl = proxyHandlerData.nextAncestor;
        // NOTE: It may be that the expression is evaluated at an element that has some x-...
        // directive, but not `x-data`, in which case it may not `_x_dataStack`.
        if (currEl._x_dataStack) {
            objects.push(...currEl._x_dataStack);

        }

        // And fetch the next layer
        proxyHandlerData.nextAncestor = null;
        if (currEl.parentElement) {
            // NOTE: finder() considers also self
            proxyHandlerData.nextAncestor = finder(currEl.parentElement)
        }
    }
}

// TODO - PART OF LAZY_SCOPE_FETCH
/** @param {HTMLElement} node */
export function closestDataStackEl(node) {
    let currEl = node;
    while (true) {
        // We've reached data stack
        if (currEl._x_dataStack) return currEl

        if (typeof ShadowRoot === 'function' && currEl instanceof ShadowRoot) {
            currEl = currEl.host;
        }

        // We've reached the top
        if (!currEl.parentNode) {
            return null;
        }

        // Keep walking up
        currEl = currEl.parentNode;
    }
}

function collapseProxies() {
    let keys = Reflect.ownKeys(this)

    return keys.reduce((acc, key) => {
        acc[key] = Reflect.get(this, key)

        return acc;
    }, {})
}
