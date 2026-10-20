import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DOMCoordinator} from '../modules/DOMCoordinator.js';
import {TicketService} from '../modules/TicketService.js';
import {App} from '../modules/App.js';

function animationFrames(t) {
    let id = 0;
    const frames = new Map();
    globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
    globalThis.cancelAnimationFrame = key => frames.delete(key);
    t.after(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
    return {frames, tick() {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(fn => fn());
    }};
}

test('D1: rAF combines overlapping batches and ignores detached rows', t => {
    const raf = animationFrames(t);
    const applied = [];
    const coordinator = new DOMCoordinator({document: {}, _applyRowHighlights: row => applied.push(row)});
    const a = {isConnected: true}, b = {isConnected: true}, detached = {isConnected: false};
    coordinator.scheduleRowHighlights(new Set([a, detached]));
    coordinator.scheduleRowHighlights(new Set([b, a]));
    assert.equal(raf.frames.size, 1);
    raf.tick();
    assert.deepEqual(applied, [a, b]);
    assert.equal(coordinator.pendingHighlightRows.size, 0);
});

test('D1: work added during rendering belongs to the next frame; teardown discards it', t => {
    const raf = animationFrames(t);
    const a = {isConnected: true}, b = {isConnected: true};
    const applied = [];
    const coordinator = new DOMCoordinator({document: {}, _applyRowHighlights(row) {
        applied.push(row);
        if (row === a) coordinator.scheduleRowHighlights(new Set([b]));
    }});
    coordinator.scheduleRowHighlights(new Set([a]));
    raf.tick();
    assert.deepEqual(applied, [a]);
    assert.equal(raf.frames.size, 1);
    coordinator.teardownAll();
    raf.tick();
    assert.deepEqual(applied, [a]);
    assert.equal(coordinator.pendingHighlightRows.size, 0);
});

function background() {
    let now = 1000;
    const timers = [];
    const context = vm.createContext({
        Date: {now: () => now}, Map, Promise, console,
        chrome: {runtime: {onMessage: {addListener() {}}}},
        setTimeout(fn, ms) { timers.push({fn, at: now + ms}); return timers.length; }
    });
    vm.runInContext(readFileSync(new URL('../background.js', import.meta.url), 'utf8'), context);
    return {context, timers, fire(timer) { now = timer.at; timer.fn(); }};
}

test('N1: parallel translations reserve different Google start slots', async () => {
    const s = background();
    await vm.runInContext('waitForGoogleSlot()', s.context);
    const pending = vm.runInContext('Promise.all([waitForGoogleSlot(), waitForGoogleSlot(), waitForGoogleSlot()])', s.context);
    assert.deepEqual(s.timers.map(timer => timer.at), [2200, 3400, 4600]);
    s.timers.forEach(s.fire);
    await pending;
});

test('N1: a queued translation respects cooldown from an earlier HTTP 429', async () => {
    const s = background();
    let requests = 0;
    s.context.fetch = async () => { requests++; return {status: 429}; };
    await vm.runInContext('translateTextViaGoogle("first").catch(() => null)', s.context);
    const pending = vm.runInContext('translateTextViaGoogle("second")', s.context);
    await assert.rejects(pending, /Google cooldown/);
    assert.equal(requests, 1);
});

test('N1: cooldown that begins while a slot waits suppresses its fetch', async () => {
    const s = background();
    await vm.runInContext('waitForGoogleSlot()', s.context);
    let requests = 0;
    s.context.fetch = async () => { requests++; return {}; };
    const queued = vm.runInContext('translateTextViaGoogle("queued")', s.context);
    vm.runInContext('googleCooldownUntil = 100000', s.context);
    const rejected = assert.rejects(queued, /Google cooldown/);
    s.fire(s.timers[0]);
    await rejected;
    assert.equal(requests, 0);
});

test('M1: settings-only updates preserve the matcher; new rule inputs compile together once', () => {
    const rules = [];
    const exceptions = {};
    const ticket = new TicketService({document: {}, utils: {}, badgeService: {}, settings: {}, rules, muteExceptions: exceptions});
    let compilations = 0;
    const recompile = ticket.recompileRuleMatcher.bind(ticket);
    ticket.recompileRuleMatcher = () => { compilations++; recompile(); };
    ticket.teardownTicketPunishmentButtons = () => {};
    const app = {
        settings: {features: {}}, rules, muteExceptions: exceptions,
        messageService: {}, ticketService: ticket,
        cleanupChangedSettings() {}, teardownTicketChatHistoryObservers() {},
        punishmentService: {setEnabled() {}}, initPunishmentFormObserver() {},
        runDOMUpdates() {}, domCoordinator: {init() {}}, handleTrackOffenderLoop() {}
    };
    const matcher = ticket._ruleMatcher;
    App.prototype.updateSettings.call(app, {features: {}});
    assert.equal(ticket._ruleMatcher, matcher);
    assert.equal(compilations, 0);
    app.rules = [];
    app.muteExceptions = {example: []};
    App.prototype.updateSettings.call(app, {features: {}});
    assert.equal(compilations, 1);
    assert.equal(ticket.rules, app.rules);
    assert.equal(ticket.muteExceptions, app.muteExceptions);
});
