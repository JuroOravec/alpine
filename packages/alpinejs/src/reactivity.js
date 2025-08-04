
import { scheduler } from './scheduler'

let reactive, effect, release, raw

let shouldSchedule = true

/** @param {() => void} callback */
export function disableEffectScheduling(callback) {
    shouldSchedule = false

    callback()

    shouldSchedule = true
}

export function setReactivityEngine(engine) {
    reactive = engine.reactive
    release = engine.release
    effect = (callback) => engine.effect(callback, { scheduler: task => {
        if (shouldSchedule) {
            scheduler(task)
        } else {
            task()
        }
    } })
    raw = engine.raw
}

export function overrideEffect(override) { effect = override }

// TODO - elementBoundEffect is called 3x for each element!!! - Once for magics, and once for each directive
/**
 * @param {HTMLElement} el
 * @returns { [(callback: any) => any, () => void] }
 */
export function elementBoundEffect(el) {
    const cleanups = []

    // TODO 
    // TODO - CHECK IF THIS WORKS!!
    // TODO - THECHANGES TO THIS FN ALLOW TO CALL `effect()` inside handlers more than once
    let wrappedEffect = (callback) => {
        let effectReference = effect(callback)

        // QUESTION - IS `_x_effects` used also on HTML elements without Alpine directives?
        //            If NOT, then we can optimize `walk()` with `querySelectorAll`
        //            NOTE: see `onElRemoved` for context
        if (! el._x_effects) {
            el._x_effects = new Set

            // Livewire depends on el._x_runEffects.
            el._x_runEffects = () => { el._x_effects.forEach(i => i()) }
        }

        el._x_effects.add(effectReference)

        const effectCleanup = () => {
            if (effectReference === undefined) return

            el._x_effects.delete(effectReference)

            release(effectReference)
        }
        cleanups.push(effectCleanup);

        return effectReference
    }

    const cleanup = () => cleanups.forEach((fn) => fn())

    return [wrappedEffect, cleanup]
}

export function watch(getter, callback) {
    let firstTime = true

    let oldValue

    let effectReference = effect(() => {
        let value = getter()

        // JSON.stringify touches every single property at any level enabling deep watching
        JSON.stringify(value)

        if (! firstTime) {
            // We have to queue this watcher as a microtask so that
            // the watcher doesn't pick up its own dependencies.
            queueMicrotask(() => {
                callback(value, oldValue)

                oldValue = value
            })
        } else {
            oldValue = value
        }

        firstTime = false
    })

    return () => release(effectReference)
}

export {
    release,
    reactive,
    effect,
    raw,
}
