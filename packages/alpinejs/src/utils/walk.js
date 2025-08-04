import { prefix } from '../directives';
import { queryXPathAll, queryXPathIterator } from './xpath'

/** @typedef { { lazy?: boolean }} WalkOptions */

function getXPathSelector() {
    const alpinePrefix = prefix();
    // Selector to match any attribute that starts with `x-` or `@`
    // E.g. `[@*[starts-with(name(), "x-") or starts-with(name(), "@")]]`
    const alpineAttrSel = `[@*[starts-with(name(), "${alpinePrefix}") or starts-with(name(), "@")]]`;

    // Check for Alpine attributes on both current element and its descendants.
    // E.g. `self::*[@*[starts-with(name(), "x-")]] | .//*[@*[starts-with(name(), "x-")]]`
    const xpathSelector = `self::*${alpineAttrSel} | .//*${alpineAttrSel}`;
    return xpathSelector;
}

/**
 * @param {HTMLElement} el
 * @param { (el: HTMLElement, skip: () => void) => void } callback
 * @param {WalkOptions} options
 */
export function walk(el, callback, options) {
    const xpathSelector = getXPathSelector();

    /** @type {HTMLElement[]} */
    const skippedEls = [];
    
    /** @param {HTMLElement} elWithAlpine */
    const onNode = (elWithAlpine) => {
        const isInsideSkipped = skippedEls.some((el) => el.contains(elWithAlpine));
        if (isInsideSkipped) {
            return;
        }

        let skip = false;

        callback(elWithAlpine, () => (skip = true));

        if (skip) {
            skippedEls.push(el);
        }
    };

    walkImpl(el, xpathSelector, onNode, options);
}

/**
 * @param {HTMLElement | Document} el
 * @param {string} xpathSelector
 * @param { (el: HTMLElement) => void } callback
 * @param {WalkOptions} options
 */
function walkImpl(el, xpathSelector, callback, options) {
    const { lazy = true } = options;

    if (lazy) {
        queryXPathIterator(el, xpathSelector, callback);
    } else {
        const matchedEls = queryXPathAll(el, xpathSelector);
        matchedEls.forEach(callback);
    }
}
