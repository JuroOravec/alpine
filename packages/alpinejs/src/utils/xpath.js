/**
 * Query the DOM for with XPath selector. Returns first match or null.
 *
 * @param {HTMLElement | Document} el
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
export function queryXPath(el, selector) {
    /** @type {HTMLElement | null} */
    let result = null;
    queryXPathIterator(el, selector, (newEl, stop) => {
        result = newEl;
        stop(); // Stop after first result
    });
    return result;
}

/**
 * Query the DOM for with XPath selector. Returns all matches.
 * 
 * Faster, but raises when the DOM is mutated mid-search.
 * Use when starting/registering directives.
 *
 * @param {HTMLElement | Document} el
 * @param {string} selector
 * @param {(el: HTMLElement, stop: () => void)} callback
 */
export function queryXPathIterator(el, selector, callback) {
    // NOTE: Works also for ShadowRoot
    const result = document.evaluate(
        selector,
        el,
        null,
        XPathResult.ORDERED_NODE_ITERATOR_TYPE, // Ensure consistent order
        null
    );

    let willStop = false;
    const stop = () => { willStop = true };

    let node = result.iterateNext();
    while (node) {
        callback(node, stop);
        if (willStop) return;

        node = result.iterateNext();
    }
}

/**
 * Query the DOM for with XPath selector. Returns all matches.
 * 
 * Slower, but searches the DOM up-front. Use with deletion/cleanup.
 *
 * @param {HTMLElement | Document} el
 * @param {string} selector
 */
export function queryXPathAll(el, selector) {
    // NOTE: Works also for ShadowRoot
    const result = document.evaluate(
        selector,
        el,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // Ensure consistent order
        null
    );

    /** @type {HTMLElement[]} */
    const matchedEls = [];
    for (let i = 0; i < result.snapshotLength; i++) {
        const node = result.snapshotItem(i);
        if (node) matchedEls.push(node);
    }

    return matchedEls;
}
