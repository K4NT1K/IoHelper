import test from 'node:test';
import assert from 'node:assert/strict';
import {BadgeService} from '../modules/BadgeService.js';
import {AnalysisBadgeMethods} from '../modules/ticket/AnalysisBadge.js';

function fixture() {
    const listeners = new Map(), events = new Map(), panels = [];
    const view = {innerWidth: 400, innerHeight: 300,
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: name => listeners.delete(name)};
    const document = {defaultView: view, body: {appendChild: panel => panels.push(panel)},
        createElement: () => ({nodeType: 1, style: {}, attributes: {},
            setAttribute(name, value) {this.attributes[name] = value;},
            getBoundingClientRect() {return {width: 280, height: 60};},
            remove() {panels.splice(panels.indexOf(this), 1);}})};
    const root = {contains: () => true, addEventListener: (name, fn) => events.set(name, fn)};
    const service = new BadgeService({document});
    let rect = {left: 5, top: 100, bottom: 120, width: 30};
    const host = {dataset: {fullMsg: '<img src=x onerror=alert(1)>'},
        contains: target => target === host, closest: () => host, getBoundingClientRect: () => rect};
    service.wireTriggerTooltips(root);
    return {service, root, panels, listeners, host, rect: value => {rect = value;},
        emit: name => events.get(name)({target: host, relatedTarget: null})};
}

test('Trigger tooltip uses safe body text and stays inside both viewport edges', () => {
    const f = fixture();
    f.emit('mouseover');
    assert.equal(f.panels.length, 1);
    assert.equal(f.panels[0].textContent, f.host.dataset.fullMsg);
    assert.equal(f.panels[0].innerHTML, undefined);
    assert.equal(f.panels[0].attributes['data-ioh'], '1');
    assert.equal(f.panels[0].style.left, '8px');
    assert.equal(f.panels[0].style.top, '30px');
    f.rect({left: 390, top: 5, bottom: 25, width: 10});
    f.emit('mouseover');
    assert.equal(f.panels.length, 1);
    assert.equal(f.panels[0].style.left, '112px');
    assert.equal(f.panels[0].style.top, '35px');
    f.service.hideTriggerTooltip();
});

for (const event of ['mouseout', 'focusout', 'scroll', 'resize', 'navigation']) {
    test(`Trigger tooltip removes its portal and window listeners after ${event}`, () => {
        const f = fixture(); f.emit('focusin');
        if (event === 'navigation') AnalysisBadgeMethods.cancelTriggerNavigation.call({badgeService: f.service});
        else if (f.listeners.has(event)) f.listeners.get(event)();
        else f.emit(event);
        assert.equal(f.panels.length, 0);
        assert.equal(f.listeners.size, 0);
        f.service.hideTriggerTooltip();
    });
}

test('Delegated hover supports triggers added by More without rebinding listeners', () => {
    const f = fixture();
    f.service.wireTriggerTooltips(f.root);
    f.host.dataset.fullMsg = 'Later trigger';
    f.emit('mouseover');
    assert.equal(f.panels[0].textContent, 'Later trigger');
    f.service.hideTriggerTooltip();
});
