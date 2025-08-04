import { queryXPath } from './xpath'

// TODO
/**
 * @param {HTMLElement} el 
 * @param {(el: HTMLElement) => unknown} callback 
 */
export function findClosest(el, callback) {
    while (true) {
        if (! el) return

        // TODO - Add the support for ShadowRoot here?

        if (callback(el)) return el

        // Support crawling up teleports.
        if (el._x_teleportBack) el = el._x_teleportBack

        if (! el.parentElement) return

        el = el.parentElement
    }
}

// TODO[better-upward-search] - Currently selectors are CSS selectors.
// 
/**
 * @param {HTMLElement} el
 * @param {string[]} selectors
 */
export function findClosestByCss(el, selectors) {
    // Search for all selectors at once
    //   E.g. `[x-data],[x-init]`
    // But we also check for `data-teleport-target` attribute
    // to be able to walk up the teleport.
    //   E.g. `[x-data],[x-init],[data-teleport-target]`
    const allSelectors = [...selectors, '[data-teleport-target]'];
    const selector = allSelectors.join(',');

    let currEl = el;
    while (true) {
        const newEl = currEl.closest(selector);

        if (!newEl) return null;

        // Check if matched element is teleport target.
        if (newEl.hasAttribute('data-teleport-target')) {
            currEl = newEl._x_teleportBack;
            continue;
        }

        // We found the ancestor with the attribute.
        return newEl;
    }
}

// TODO[better-upward-search] - This will be used once `Alpine.addRootSelector()`
// removed and replaced with settings object on `Alpine.directive()`.
/**
 * @param {HTMLElement} el
 * @param {string[]} directives
 */
export function findClosestByDirectives(el, directives) {
    // Find first ancestor with given directives(s).
    //   E.g. `ancestor::*[@x-ignore][1]`
    // Or if there is multiple attributes to search for:
    //   E.g. `ancestor::*[@x-data or @x-init][1]`
    // We also search for data-teleport-target to be able to walk up the teleport.
    //   E.g. `ancestor::*[@x-data or @x-init or @data-teleport-target][1]`
    //
    // Next, we expand the definition of attributes. Directives may be:
    // - plain (`x-data`),
    // - or have values (`x-on:click`),
    // - or modifiers (`x-on:click.prevent`).
    //
    // We can't simply search for "any attribute starting with `x-on`",
    // because then we would match also unrelated directives like `x-one`.
    //
    // So we define an xPath selector that can detect all these:
    // ```xpath
    // @*[
    //   starts-with(name(), "x-on") and (
    //     name() = "x-on" or
    //     starts-with(name(), "x-on:") or
    //     starts-with(name(), "x-on.")
    //   )
    // ]
    // ```
    // - This checks each attribute
    // - And first checks that it starts with the name of our directive
    // - Second check then ensures that we're filtering out directives
    //   with overlapping names, e.g. `x-on` vs `x-one`.
    //
    // TODO 1: These could be created at the time of registering the directives.
    // TODO 2: Depending on whether directive supports values and modifiers,
    //         a subset of the extra checks below could be selected.
    // TODO 3: If all directives plain versions (no values, no modifiers),
    //         this function could instead call `findClosestByCss(el, '[x-directive]')`
    //         for performance boost (xPath checks all nodes, `el.closest()` checks only ancestors).
    const attrsSel = directives.map((directive) => `
        @*[
            starts-with(name(), "x-${directive}") and (
                name() = "x-${directive}" or
                starts-with(name(), "x-${directive}:") or
                starts-with(name(), "x-${directive}.")
            )
        ]
    `).join(' or ');
    const xpathSelector = `ancestor::*[${attrsSel} or @data-teleport-target][1]`;

    let currEl = el;
    while (true) {
        let newEl = queryXPath(currEl, xpathSelector);
        if (!newEl) return null;

        // Check if matched element is teleport target.
        if (newEl.hasAttribute('data-teleport-target')) {
            currEl = newEl._x_teleportBack;
            continue;
        }

        // We found the ancestor with the attribute.
        return newEl;
    }
}
