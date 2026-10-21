import test from 'node:test';
import assert from 'node:assert/strict';
import {PunishmentService} from '../modules/PunishmentService.js';
import {AnalysisBadgeMethods} from '../modules/ticket/AnalysisBadge.js';
import {App} from '../modules/App.js';
import {DOMCoordinator} from '../modules/DOMCoordinator.js';
import {readFileSync} from 'node:fs';

function fixture(t, {suggestion = 'Токсичность', formId = 'player', suggestionId = 'player', timeTag = 'BUTTON'} = {}) {
    class Select extends EventTarget {
        constructor(id, options, value) {
            super(); Object.assign(this, {id, tagName: 'SELECT', options, isConnected: true}); this.value = value;
        }
        get value() { return this._value; }
        set value(value) { this._value = String(value); }
        get selectedIndex() { return this.options.findIndex(o => o.value === this.value); }
    }
    t.mock.method(globalThis, 'setTimeout', () => { throw new Error('Mute must not schedule duration retries'); });
    const previousWindow = globalThis.window;
    globalThis.window = {HTMLSelectElement: Select, Event};
    const observers = [];
    const previousObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
    };
    t.after(() => { if (previousObserver === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = previousObserver; });
    t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
    const reason = new Select('mute-reason', [
        {value: 'trolling', textContent: 'Троллинг/провокация'},
        {value: 'toxic', textContent: 'Токсичность'},
        {value: 'spam', textContent: 'Спам в микрофон/чат'}
    ], 'trolling');
    const steam = new EventTarget(); steam.value = formId;
    const time = {tagName: timeTag, value: 'site-selected', textContent: '2 ДНЯ', click() { throw new Error('Duration clicked'); }};
    const dialog = {isConnected: true, querySelector(selector) {
        if (selector === '#mute-reason') return reason;
        if (selector === '#mute-steamid64') return steam;
        if (selector === '#mute-time' || selector.startsWith('#ban-')) throw new Error('Punishment duration/ban accessed');
        return null;
    }};
    const ticket = {...AnalysisBadgeMethods, suggestedMuteReason: suggestion ? {steamId: suggestionId, label: suggestion} : null,
        getActivePunishmentScope() { return {}; }, getOffenderSteamIdForScope() { return suggestionId; }};
    const document = {querySelectorAll() { return [dialog]; }};
    const service = new PunishmentService({document, ticketService: ticket});
    // Model the site's own recalculation when reason changes.
    reason.addEventListener('change', () => { time.value = reason.value === 'toxic' ? 'site-x2-toxic' : 'site-other'; });
    return {service, reason, steam, time, dialog, Select, observers};
}

for (const timeTag of ['BUTTON', 'SELECT']) {
    test(`mute ${timeTag}: selects analysis reason; site owns X2 and manual duration`, t => {
        const {service, reason, time} = fixture(t, {timeTag});
        service.scanDialogs();
        assert.equal(reason.value, 'toxic');
        assert.equal(time.value, 'site-x2-toxic');
        time.value = 'manual';
        service.scanDialogs();
        assert.equal(time.value, 'manual');
        reason.value = 'spam'; reason.dispatchEvent(new Event('change'));
        service.scanDialogs();
        assert.equal(reason.value, 'spam');
        assert.equal(time.value, 'site-other');
    });
}

test('mute: absent or mismatched suggestion selects default toxicity', t => {
    for (const options of [{suggestion: null}, {formId: 'other-player'}]) {
        const {service, reason, time} = fixture(t, options);
        service.scanDialogs();
        assert.equal(reason.value, 'toxic');
        assert.equal(time.value, 'site-x2-toxic');
    }
});

test('mute: Steam ID change uses matching analysis, duplicate events preserve manual reason', t => {
    const {service, reason, steam} = fixture(t, {formId: 'other-player'});
    service.scanDialogs();
    steam.value = 'player'; steam.dispatchEvent(new Event('input'));
    assert.equal(reason.value, 'toxic');
    reason.value = 'spam';
    steam.dispatchEvent(new Event('change'));
    service.scanDialogs();
    assert.equal(reason.value, 'spam');
    service.teardown();
    steam.value = ''; steam.dispatchEvent(new Event('input'));
    steam.value = 'player'; steam.dispatchEvent(new Event('input'));
    assert.equal(reason.value, 'spam');
    assert.equal(service.formBindings.size, 0);
});

test('mute: detached form bindings are cleaned up', t => {
    const {service, reason, steam} = fixture(t);
    service.scanDialogs();
    reason.isConnected = false;
    service.document.querySelectorAll = () => [];
    service.scanDialogs();
    assert.equal(service.formBindings.size, 0);
    reason.value = 'spam'; steam.value = ''; steam.dispatchEvent(new Event('input'));
    assert.equal(reason.value, 'spam');
});

test('mute: site history rerender cannot replace default toxicity with previous insult', t => {
    const {service, reason, observers} = fixture(t, {suggestion: null});
    service.scanDialogs();
    reason.value = 'trolling'; // React property update, without a user change event.
    observers[0].callback([{target: {}}]);
    assert.equal(reason.value, 'toxic');
    reason.value = 'spam'; reason.dispatchEvent(new Event('change'));
    observers[0].callback([{target: {}}]);
    service.init(); // Settings refresh must preserve a moderator's selection.
    assert.equal(reason.value, 'spam');
    service.teardown();
    assert.equal(observers[0].disconnected, true);
    reason.value = 'trolling'; observers[0].callback([{target: {}}]);
    assert.equal(reason.value, 'trolling');
});

test('mute: unknown suggested label falls back to toxicity', t => {
    const {service, reason} = fixture(t, {suggestion: 'Unknown reason'});
    service.scanDialogs();
    assert.equal(reason.value, 'toxic');
});

test('ban: service does not read, bind or change ban controls', t => {
    const {service} = fixture(t);
    service.document.querySelectorAll = () => [{querySelector(selector) {
        assert.equal(selector, '#mute-reason');
        return null;
    }}];
    service.scanDialogs();
    assert.equal(service.formBindings.size, 0);
});

test('mute: old disabled setting cannot disable reason initialization', () => {
    let initialized = 0;
    App.prototype.initPunishmentFormObserver.call({
        features: {autoPunishmentDuration: false},
        punishmentService: {init() { initialized++; }, teardown() { assert.fail('Legacy toggle still used'); }}
    });
    assert.equal(initialized, 1);
    const popup = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
    assert.equal(popup.includes('autoPunishmentDuration'), false);
});

test('mute: closing dialog requests cleanup through the existing coordinator observer', t => {
    const {service, reason, observers} = fixture(t);
    service.scanDialogs();
    const coordinator = new DOMCoordinator({document: {body: {}}, punishmentService: service});
    let scheduled = false;
    coordinator.scheduleFlush = () => { scheduled = true; };
    coordinator.initBodyObserver();
    reason.isConnected = false;
    service.document.querySelectorAll = () => [];
    const removedDialog = {nodeType: 1, matches: () => true};
    observers[1].callback([{type: 'childList', target: {}, addedNodes: [], removedNodes: [removedDialog]}]);
    assert.equal(coordinator.pending.has('punishmentDialog'), true);
    assert.equal(scheduled, true);
    coordinator.on('punishmentDialog', () => service.scanDialogs());
    coordinator.flush();
    assert.equal(observers[0].disconnected, true);
    assert.equal(service.formBindings.size, 0);
});
