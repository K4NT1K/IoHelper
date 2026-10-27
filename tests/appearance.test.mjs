import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAppearance, AppearanceService} from '../modules/AppearanceService.js';

test('Appearance: default off, malformed settings cannot select an arbitrary CSS value', () => {
    assert.deepEqual(normalizeAppearance(), {enabled: false, intensity: 'balanced'});
    assert.deepEqual(normalizeAppearance({enabled: 'true', intensity: 'evil'}), {enabled: false, intensity: 'balanced'});
});

function element(tag, style = {}, children = []) {
    const attrs = new Map();
    const node = {
        tagName: tag, children, isConnected: true, parentElement: null,
        style: {backgroundColor: 'rgba(0, 0, 0, 0)', borderTopLeftRadius: '0px', ...style},
        setAttribute: (key, value) => attrs.set(key, value),
        removeAttribute: key => attrs.delete(key), hasAttribute: key => attrs.has(key),
        closest: () => null, getBoundingClientRect: () => ({height: 840}),
        contains(target) {return this === target || this.children.some(child => child.contains(target));},
        querySelector(selector) {
            const tags = selector.toUpperCase().split(',').map(v => v.trim());
            for (const child of this.children) {
                if (tags.includes(child.tagName)) return child;
                const nested = child.querySelector(selector); if (nested) return nested;
            }
            return null;
        }
    };
    children.forEach(child => {child.parentElement = node;});
    return node;
}
function queueFixture() {
    const heading = element('H3');
    const title = element('DIV', {}, [heading]);
    const left = element('DIV', {}, [title, element('SPAN')]);
    const row = element('DIV', {}, [left]);
    const headerShell = element('DIV', {backgroundColor: 'rgb(37, 37, 47)'}, [row]);
    const tableRow = element('TR');
    const table = element('TABLE', {}, [element('TBODY', {}, [tableRow])]);
    const card = element('DIV', {backgroundColor: 'rgb(43, 43, 54)', borderTopLeftRadius: '6.72px'}, [headerShell, element('DIV', {}, [table])]);
    const root = element('MAIN', {}, [card]);
    let styleReads = 0;
    const document = {defaultView: {getComputedStyle: node => {styleReads++; return node.style;}},
        documentElement: {dataset: {}, style: {removeProperty() {}}}, querySelectorAll: () => [card, headerShell]};
    return {service: new AppearanceService({document, chrome: {}}), heading, card, headerShell, root, tableRow, get styleReads() {return styleReads;}};
}

test('Appearance: queue glass belongs to the whole card and clears the opaque header shell', () => {
    const s = queueFixture();
    s.service.markSurface(s.heading, s.root);
    assert.equal(s.card.hasAttribute('data-ioh-glass-surface'), true);
    assert.equal(s.headerShell.hasAttribute('data-ioh-glass-header'), true);
    assert.equal(s.tableRow.hasAttribute('data-ioh-glass-surface'), false);
    const reads = s.styleReads;
    s.service.markSurface(s.heading, s.root);
    assert.equal(s.styleReads, reads, 'stable card discovery reuses the heading cache');
});

test('Appearance: long tables use a single dense surface and disabling cleans native attributes', () => {
    const s = queueFixture();
    s.card.getBoundingClientRect = () => ({height: 5000});
    s.service.markSurface(s.heading, s.root);
    assert.equal(s.card.hasAttribute('data-ioh-glass-dense'), true);
    s.service.document.documentElement.dataset.iohGlass = 'clear';
    s.service.apply();
    assert.equal(s.service.document.documentElement.dataset.iohGlass, undefined);
    assert.equal(s.card.hasAttribute('data-ioh-glass-surface'), false);
    assert.equal(s.card.hasAttribute('data-ioh-glass-dense'), false);
    assert.equal(s.headerShell.hasAttribute('data-ioh-glass-header'), false);
});
