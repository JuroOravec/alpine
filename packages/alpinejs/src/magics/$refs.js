import { findClosest } from '../utils/findClosest'
import { mergeProxies, mergeProxies2 } from '../scope'
import { magic } from '../magics'

// TODO - PART OF LAZY_SCOPE_FETCH
magic('refs', el => {
    if (el._x_refs_proxy) return el._x_refs_proxy
    
    // NOTE: PROXY IMMUTABLE HERE
    // el._x_refs_proxy = mergeProxies(getArrayOfRefObject(el))

    // TODO - PART OF LAZY_SCOPE_FETCH
    el._x_refs_proxy = mergeProxies2(el, null, xrefsFinder)

    return el._x_refs_proxy
})

// TODO - PART OF LAZY_SCOPE_FETCH
function xrefsFinder(el) {
    const elWithXRefs = findClosest(el, (i) => i._x_refs)
    return elWithXRefs._x_refs;
}


function getArrayOfRefObject(el) {
    let refObjects = []

    // TODO
    // TODO - ACTUALLY, don't use `_x_refs_proxy`, because the ancestor may be destroyed.
    //        However, that means that if current element was ever to move, `_x_refs_proxy`
    //        would no longer be correct. What's the proper / expected behavior here???
    //
    //        We should probably also add cleanup to the component is being removed and has `_x_refs_proxy`?
    //        
    // TODO
    findClosest(el, (currEl) => {
        // Stop walk and reuse _x_refs_proxy created by one of ancestors,
        // as it already captures all further x-refs.
        if (currEl._x_refs_proxy) {
            refObjects.push(currEl._x_refs_proxy);
            return true;
        }
        // Otherwise keep collecting `x-refs` until we reach the root.
        if (currEl._x_refs) refObjects.push(currEl._x_refs)
    })

    return refObjects
}
