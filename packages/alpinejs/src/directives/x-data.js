import { directive, prefix } from '../directives'
import { initInterceptors } from '../interceptor'
import { injectDataProviders } from '../datas'
import { addRootSelector } from '../lifecycle'
import { interceptClone, isCloning, isCloningLegacy } from '../clone'
import { addScopeToNode } from '../scope'
import { injectMagics } from '../magics'
import { reactive } from '../reactivity'
import { evaluate } from '../evaluator'

addRootSelector(() => `[${prefix('data')}]`)

directive('data', ((el, { modifiers, expression }, { cleanup }) => {
    if (shouldSkipRegisteringDataDuringClone(el)) return

    // TODO - ADDED `x-data.isolated` modifier.
    const isolated = modifiers.includes('isolated');

    // NOTE: HERE magic injected only with el with `x-data`
    const magicContext = injectMagics({}, el)

    let dataProviderContext = {}
    injectDataProviders(dataProviderContext, magicContext)

    // Only run expression if it has something else than nothing / empty dict
    let data;
    if (!expression && expression !== '{}') {
        data = evaluate(el, expression, { scope: dataProviderContext })
    }

    if (data === undefined || data === true) data = {}

    data = injectMagics(data, el)

    let reactiveData = reactive(data)

    initInterceptors(reactiveData)

    let undo = addScopeToNode(el, reactiveData, null, isolated)

    reactiveData['init'] && evaluate(el, reactiveData['init'])

    cleanup(() => {
        reactiveData['destroy'] && evaluate(el, reactiveData['destroy'])

        undo()
    })
}))

interceptClone((from, to) => {
    // Transfer over existing runtime Alpine state from
    // the existing dom tree over to the new one...
    if (from._x_dataStack) {
        to._x_dataStack = from._x_dataStack

        // Set a flag to signify the new tree is using
        // pre-seeded state (used so x-data knows when
        // and when not to initialize state)...
        to.setAttribute('data-has-alpine-state', true)
    }
})

// If we are cloning a tree, we only want to evaluate x-data if another
// x-data context DOESN'T exist on the component.
// The reason a data context WOULD exist is that we graft root x-data state over
// from the live tree before hydrating the clone tree.
function shouldSkipRegisteringDataDuringClone(el) {
    if (! isCloning) return false
    if (isCloningLegacy) return true

    return el.hasAttribute('data-has-alpine-state')
}
