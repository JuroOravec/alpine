import { directive } from "../directives"
import { initTree, destroyTree } from "../lifecycle"
import { onAttributesAdded, onAttributesRemoved } from '../mutation'

let handler = () => {}

handler.inline = (el, { modifiers }, { cleanup }) => {
    // TODO - WHY IS THERE BOTH IGNORE AND IGNORE SELF?
    modifiers.includes('self')
        ? el._x_ignoreSelf = true
        : el._x_ignore = true

    cleanup(() => {
        modifiers.includes('self')
            ? delete el._x_ignoreSelf
            : delete el._x_ignore
    })
}

directive('ignore', handler)

// Manage lifecycle - Make tree interactive after x-ignore was removed
// and vice versa.
const ignoreAttrs = ["x-ignore", "x-ignore.self"];
onAttributesRemoved((el, attrs) => {
    const wasIgnored = ignoreAttrs.some(ignoreAttr => attrs.includes(ignoreAttr));
    if (wasIgnored) initTree(el);
});

onAttributesAdded((el, attrs) => {
    const willBeIgnored = ignoreAttrs.some(ignoreAttr => {
        return attrs.some(({ name }) => name === ignoreAttr);
    });
    debugger; // TODO
    if (willBeIgnored) destroyTree(el);
});
