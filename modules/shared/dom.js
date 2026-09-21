export function markIoh(el) {
    if (el && el.nodeType === 1) {
        el.setAttribute('data-ioh', '1');
    }
    return el;
}

export function isIohNode(node) {
    if (!node) {
        return false;
    }
    if (node.nodeType === 1) {
        return Boolean(node.closest?.('[data-ioh]'));
    }
    return Boolean(node.parentElement?.closest?.('[data-ioh]'));
}

export function scheduleIdle(fn) {
    if (typeof requestIdleCallback === 'function') {
        return requestIdleCallback(() => fn(), {timeout: 200});
    }
    return setTimeout(fn, 0);
}
