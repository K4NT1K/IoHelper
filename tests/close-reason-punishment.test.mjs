import test from 'node:test';
import assert from 'node:assert/strict';
import {PunishmentService} from '../modules/PunishmentService.js';
import {SitePunishmentBridge} from '../modules/SitePunishmentBridge.js';
import {PunishmentPanelMethods} from '../modules/ticket/PunishmentPanel.js';
import {clock, deferred} from './clock.mjs';

function fixture(t, {type = 'ban', enabled = true, beforeBind = null, results = [{isBanned: true, isMuted: false}]} = {}) {
    const time = clock(t);
    const observers = [];
    const Observer = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(root, options) { this.root = root; this.options = options; }
        disconnect() { this.disconnected = true; }
    };
    const textarea = {readOnly: false, disabled: false};
    const scope = {steamId: '76561198000000001', ticketId: '123', connected: true, inProgress: true,
        querySelector() { return textarea; }};
    const form = Object.assign(new EventTarget(), {nodeType: 1, tagName: 'FORM', checkValidity() { return true; }});
    const input = {value: scope.steamId, nodeType: 1, disabled: false};
    const submitButton = {nodeType: 1, tagName: 'BUTTON', type: 'submit', disabled: false,
        textContent: type === 'ban' ? 'Заблокировать' : 'Выдать ограничение'};
    const cancelButton = {nodeType: 1, tagName: 'BUTTON', type: 'button', disabled: false, textContent: 'Отмена'};
    const dialog = Object.assign(new EventTarget(), {
        nodeType: 1, invalid: false, alerts: [],
        isConnected: true,
        getAttribute() { return 'open'; },
        closest(selector) { return selector === '[role="dialog"]' ? dialog : null; },
        querySelector(selector) {
            if (selector === 'form') return form;
            if (selector === `#${type}-steamid64`) return input;
            if (selector === '[aria-invalid="true"]') return dialog.invalid ? input : null;
            return null;
        },
        querySelectorAll(selector) { return selector === '[role="alert"]' ? dialog.alerts : []; }
    });
    form.contains = node => [form, input, submitButton, cancelButton].includes(node);
    form.closest = selector => selector === '[role="dialog"]' ? dialog : null;
    for (const button of [submitButton, cancelButton]) {
        button.form = form;
        button.closest = selector => selector === 'button' ? button : selector === '[role="dialog"]' ? dialog : null;
    }
    const reads = [], confirmations = [], intents = [], cancellations = [];
    let syncs = 0;
    const ticket = {
        settings: {features: {autoSelectCloseReason: enabled, trackOffenderServer: false}},
        globalServerCooldown: 0,
        getActivePunishmentScope() { return scope; },
        isOpenComplaintScope() { return true; },
        scopeHasInProgressStatus(candidate, options) {
            assert.deepEqual(options, {includeActivePanel: false});
            return candidate.inProgress;
        },
        getOffenderSteamIdForScope(candidate) { return candidate.steamId; },
        extractTicketIdFromComplaintScope(candidate) { return candidate.ticketId; },
        async fetchParsedUserData(steamId) {
            reads.push({steamId, at: Date.now()});
            const result = results[Math.min(reads.length - 1, results.length - 1)];
            if (result instanceof Error) throw result;
            if (typeof result === 'function') return result();
            return result;
        },
        onCloseReasonPunishmentData(steamId, data) { confirmations.push({steamId, data}); },
        onCloseReasonPunishmentIntent(intent) { intents.push(intent); },
        cancelCloseReasonPunishmentIntent(token) { cancellations.push(token); },
        syncCloseReasonSelection() { syncs++; }
    };
    const document = Object.assign(new EventTarget(), {
        defaultView: {MutationObserver: Observer},
        contains(candidate) { return candidate.connected; },
        querySelectorAll() { return dialog.isConnected ? [dialog] : []; }
    });
    const service = new PunishmentService({document, ticketService: ticket});
    beforeBind?.({ticket, scope, dialog, input, textarea});
    service.scanDialogs();
    const emit = (target, type, extra = {}) => {
        const event = new Event(type, {cancelable: true});
        Object.defineProperty(event, 'target', {value: target});
        for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, {value});
        document.dispatchEvent(event);
        return event;
    };
    const click = (button = submitButton) => emit(button, 'click');
    const submit = () => {
        const event = emit(form, 'submit');
        // Native dispatch also reaches the form listener after the document capture.
        form.dispatchEvent(new Event('submit', {cancelable: true}));
        return event;
    };
    const close = () => { dialog.isConnected = false; service.scanDialogs(); };
    t.after(() => service.teardown());
    return {time, scope, textarea, form, input, dialog, document, ticket, service, reads, confirmations,
        observers, intents, cancellations, emit, submitButton, cancelButton, click, submit, close,
        get syncs() { return syncs; }};
}

for (const type of ['ban', 'mute']) {
    test(type + ': native submit and form removal never request punishment status', async t => {
        const f = fixture(t, {type});
        f.submit();
        assert.equal(f.intents.length, 1);
        assert.deepEqual(f.intents[0], {scope: f.scope, steamId: f.scope.steamId,
            ticketId: f.scope.ticketId, type, attemptToken: f.intents[0].attemptToken});
        assert.equal(f.time.timers.size, 0);
        f.service.scanDialogs();
        await f.time.advance(5000);
        f.close();
        await f.time.advance(60000);
        assert.equal(f.reads.length, 0);
        assert.equal(f.confirmations.length, 0);
        assert.equal(f.cancellations.length, 0);
        assert.equal(f.time.timers.size, 0);
        assert.equal(f.service.punishmentBindings.size, 0);
    });
}

test('opening and cancelling a form never requests confirmation', async t => {
    const f = fixture(t);
    f.close();
    await f.time.advance(5000);
    assert.equal(f.reads.length, 0);
    assert.equal(f.confirmations.length, 0);
});

for (const invalidate of ['steamId', 'ticketId', 'closed', 'disconnected', 'readonly', 'disabled', 'teardown']) {
    test('a form cannot publish intent after origin becomes ' + invalidate, t => {
        const f = fixture(t);
        if (invalidate === 'steamId') f.scope.steamId = '76561198000000002';
        if (invalidate === 'ticketId') f.scope.ticketId = '124';
        if (invalidate === 'closed') f.scope.inProgress = false;
        if (invalidate === 'disconnected') f.scope.connected = false;
        if (invalidate === 'readonly') f.textarea.readOnly = true;
        if (invalidate === 'disabled') {f.ticket.settings.features.autoSelectCloseReason = false; f.service.scanDialogs();}
        if (invalidate === 'teardown') f.service.teardown();
        f.click();
        assert.equal(f.intents.length, 0);
        assert.equal(f.reads.length, 0);
    });
}

test('feature disabled or different form Steam ID does not start any reads', async t => {
    const f = fixture(t, {enabled: false});
    f.submit(); f.close();
    await f.time.advance(5000);
    assert.equal(f.reads.length, 0);
    f.ticket.settings.features.autoSelectCloseReason = true;
    f.dialog.isConnected = true;
    f.service.scanDialogs();
    f.input.value = '76561198000000002';
    f.submit(); f.close();
    await f.time.advance(5000);
    assert.equal(f.reads.length, 0);
});

test('switching active tab retains the captured origin complaint', async t => {
    const f = fixture(t);
    f.ticket.getActivePunishmentScope = () => ({steamId: f.scope.steamId, ticketId: 'other'});
    f.submit(); f.close();
    await f.time.advance(350);
    assert.equal(f.intents.length, 1);
    assert.equal(f.intents[0].scope, f.scope);
});

test('disabling the feature before closing clears the saved submit attempt', async t => {
    const f = fixture(t);
    f.submit();
    f.ticket.settings.features.autoSelectCloseReason = false;
    f.service.scanDialogs();
    f.ticket.settings.features.autoSelectCloseReason = true;
    f.close();
    await f.time.advance(5000);
    assert.equal(f.reads.length, 0);
});

for (const source of ['pending', 'dialog']) {
    test(`management bootstrap preserves the ${source} origin with no active complaint and late prefill`, async t => {
        const f = fixture(t, {beforeBind({ticket, scope, dialog, input}) {
            const token = {scope, type: 'ban', steamId: scope.steamId, ticketId: scope.ticketId};
            if (source === 'pending') ticket._closeReasonPunishmentOrigin = token;
            else ticket._closeReasonPunishmentOrigins = new WeakMap([[dialog, token]]);
            ticket.getActivePunishmentScope = () => null;
            input.value = '';
        }});
        f.ticket._closeReasonPunishmentOrigin = null; // Bridge cleanup after successful opening.
        f.input.value = f.scope.steamId;
        f.submit(); f.close();
        await f.time.advance(350);
        assert.equal(f.intents.length, 1);
        assert.equal(f.intents[0].scope, f.scope);
        assert.equal(f.ticket._closeReasonPunishmentOrigins?.has(f.dialog) || false, false);
    });
}

test('scope reused for another ticket before submit cannot acquire the original form', async t => {
    const f = fixture(t);
    f.scope.ticketId = '124';
    f.submit(); f.close();
    await f.time.advance(5000);
    assert.equal(f.reads.length, 0);
});

for (const invalid of ['ticketId', 'type', 'readonly']) {
    test(`invalid ${invalid} pending origin cannot fall back to another active owner`, async t => {
        const f = fixture(t, {beforeBind({ticket, scope, textarea}) {
            const token = {scope, type: 'ban', steamId: scope.steamId, ticketId: scope.ticketId};
            if (invalid === 'ticketId') token.ticketId = 'other';
            if (invalid === 'type') token.type = 'mute';
            if (invalid === 'readonly') textarea.readOnly = true;
            ticket._closeReasonPunishmentOrigin = token;
        }});
        f.submit(); f.close();
        await f.time.advance(5000);
        assert.equal(f.reads.length, 0);
    });
}

for (const type of ['ban', 'mute']) {
    test(`real ${type} issue handler and bridge preserve origin through asynchronous management bootstrap`, async t => {
        const f = fixture(t, {type, enabled: false,
            results: [{isBanned: type === 'ban', isMuted: type === 'mute'}]});
        f.ticket.settings.features.autoSelectCloseReason = true;
        const pending = deferred();
        const bridgeDocument = {
            querySelector(selector) {
                assert.equal(selector, `[role="dialog"] #${type}-steamid64`);
                return {closest() { return f.dialog; }};
            }
        };
        const bridge = new SitePunishmentBridge({document: bridgeDocument, ticketService: f.ticket});
        const method = type === 'ban' ? 'handleTicketBanButtonClick' : 'handleTicketMuteButtonClick';
        const openMethod = type === 'ban' ? 'openSiteBanForm' : 'openSiteMuteForm';
        f.ticket.punishmentBridge = bridge;
        f.ticket[openMethod] = PunishmentPanelMethods[openMethod];
        bridge._openForm = async (actualType, actualSteamId) => {
            assert.equal(actualType, type);
            assert.equal(actualSteamId, f.scope.steamId);
            assert.deepEqual(f.ticket._closeReasonPunishmentOrigin, {
                type, steamId: f.scope.steamId, scope: f.scope, ticketId: f.scope.ticketId
            });
            f.ticket.getActivePunishmentScope = () => null;
            f.input.value = ''; // Form mounts before delayed prefill.
            f.service.scanDialogs();
            return pending.promise;
        };
        PunishmentPanelMethods[method].call(f.ticket);
        const origin = f.ticket._closeReasonPunishmentOrigin;
        assert.equal(origin.scope, f.scope, 'Handler must capture before management navigation');
        await f.time.flush();
        assert.equal(f.ticket._closeReasonPunishmentOrigin, origin, 'Pending token stays until the inner open flow settles');
        f.input.value = f.scope.steamId;
        pending.resolve(true);
        await f.time.flush();
        assert.equal(f.ticket._closeReasonPunishmentOrigin, null);
        assert.equal(f.ticket._closeReasonPunishmentOrigins.get(f.dialog), origin,
            'Successful bridge opening preserves a token for a late binding');
        f.submit(); f.close();
        assert.equal(f.ticket._closeReasonPunishmentOrigins.has(f.dialog), false,
            'Closing removes a bridge token written after an early binding');
        await f.time.advance(350);
        assert.equal(f.intents.length, 1);
        assert.equal(f.intents[0].scope, f.scope);
    });
}

for (const outcome of ['failure', 'throw']) {
    test(`real bridge clears its pending token after ${outcome} without retaining a dialog origin`, async t => {
        const f = fixture(t, {enabled: false});
        const origin = {type: 'ban', steamId: f.scope.steamId, scope: f.scope, ticketId: f.scope.ticketId};
        f.ticket._closeReasonPunishmentOrigin = origin;
        const pending = deferred();
        const bridge = new SitePunishmentBridge({document: {
            querySelector() { assert.fail('Failed opening must not retain a dialog origin'); }
        }, ticketService: f.ticket});
        bridge._openForm = async () => {
            await pending.promise;
            if (outcome === 'throw') throw new Error('bootstrap failure');
            return false;
        };
        const opening = bridge.openForm('ban', origin.steamId);
        assert.equal(f.ticket._closeReasonPunishmentOrigin, origin);
        pending.resolve();
        if (outcome === 'throw') await assert.rejects(opening, /bootstrap failure/);
        else assert.equal(await opening, false);
        assert.equal(f.ticket._closeReasonPunishmentOrigin, null);
        assert.equal(f.ticket._closeReasonPunishmentOrigins, undefined);
    });
}

test('settling an earlier bridge flow cannot clear the token of a newer opening', async t => {
    const f = fixture(t, {enabled: false});
    const first = {type: 'ban', steamId: f.scope.steamId, scope: f.scope, ticketId: f.scope.ticketId};
    const second = {...first, type: 'mute'};
    f.ticket._closeReasonPunishmentOrigin = first;
    const pending = deferred();
    const bridge = new SitePunishmentBridge({document: {}, ticketService: f.ticket});
    bridge._openForm = () => pending.promise;
    const opening = bridge.openForm('ban', first.steamId);
    f.ticket._closeReasonPunishmentOrigin = second;
    pending.resolve(false);
    assert.equal(await opening, false);
    assert.equal(f.ticket._closeReasonPunishmentOrigin, second);
});

for (const type of ['ban', 'mute']) {
    for (const buttonType of ['submit', 'button']) {
        test(`${type}: first ${buttonType} action click binds before a debounced scan and deduplicates default submit`, t => {
            const f = fixture(t, {type, enabled: false});
            f.ticket.settings.features.autoSelectCloseReason = true;
            // The service is initialized before this asynchronously mounted form exists.
            f.dialog.isConnected = false;
            f.service.init();
            f.dialog.isConnected = true;
            f.submitButton.type = buttonType;
            assert.equal(f.service.punishmentBindings.size, 0);
            const event = f.click();
            assert.equal(event.defaultPrevented, false, 'The helper must leave the native action untouched');
            assert.equal(f.intents.length, 1);
            assert.equal(f.intents[0].type, type);
            assert.equal(f.reads.length, 0);
            assert.equal(f.time.timers.size, 0);
            assert.equal(f.service.punishmentBindings.size, 1);
            f.submit();
            assert.equal(f.intents.length, 1, 'Document capture, dialog capture and submit belong to one attempt');
            assert.equal(f.cancellations.length, 0);
        });
    }
}

for (const transient of ['readonly', 'disabled']) {
    test(`initial ${transient} result card can become editable before the first punishment click`, t => {
        const f = fixture(t, {beforeBind({textarea}) { textarea[transient === 'readonly' ? 'readOnly' : 'disabled'] = true; }});
        f.click();
        assert.equal(f.intents.length, 0, 'An unavailable result is still protected at the actual action');
        f.textarea.readOnly = false;
        f.textarea.disabled = false;
        f.service.scanDialogs();
        f.click();
        assert.equal(f.intents.length, 1, 'An early unavailable state cannot permanently poison the captured origin');
    });
}

for (const invalid of ['steamId', 'nativeValidity', 'ariaInvalid', 'disabledButton', 'disabledInput', 'wrongLabel', 'wrongType']) {
    test(`punishment click excludes ${invalid} without touching the native event`, t => {
        const f = fixture(t);
        if (invalid === 'steamId') f.input.value = 'not-steam-id';
        if (invalid === 'nativeValidity') f.form.checkValidity = () => false;
        if (invalid === 'ariaInvalid') f.dialog.invalid = true;
        if (invalid === 'disabledButton') f.submitButton.disabled = true;
        if (invalid === 'disabledInput') f.input.disabled = true;
        if (invalid === 'wrongLabel') f.submitButton.textContent = 'Выдать предупреждение';
        if (invalid === 'wrongType') f.submitButton.type = 'reset';
        const event = f.click();
        assert.equal(event.defaultPrevented, false);
        assert.equal(f.intents.length, 0);
        assert.equal(f.reads.length, 0);
    });
}

test('unrelated controls and other dialogs cannot acquire punishment intent', t => {
    const f = fixture(t);
    const unrelated = {nodeType: 1, disabled: false, type: 'button', textContent: 'Заблокировать',
        closest(selector) { return selector === 'button' ? unrelated : selector === '[role="dialog"]' ? f.dialog : null; }};
    f.emit(unrelated, 'click'); // Same label, but it is not inside the punishment form.
    assert.equal(f.intents.length, 0);
    f.cancelButton.textContent = '12 ЧАСОВ';
    f.click(f.cancelButton);
    assert.equal(f.intents.length, 0);
});

for (const failure of ['cancel', 'alert', 'ariaInvalid', 'invalidEvent']) {
    test(`explicit native ${failure} rolls back exactly the current attempt and permits retry`, async t => {
        const f = fixture(t);
        f.click();
        const first = f.intents[0].attemptToken;
        if (failure === 'cancel') f.click(f.cancelButton);
        if (failure === 'alert') {
            f.dialog.alerts = [{textContent: 'Ошибка выдачи', closest() { return null; }, getAttribute() { return null; }}];
            f.observers[0].callback([{target: f.dialog}]);
        }
        if (failure === 'ariaInvalid') {
            f.dialog.invalid = true;
            f.observers[0].callback([{target: f.input}]);
        }
        if (failure === 'invalidEvent') f.form.dispatchEvent(new Event('invalid'));
        assert.deepEqual(f.cancellations, [first]);
        assert.equal(f.service.punishmentBindings.get(f.dialog).attemptToken, null);
        f.dialog.alerts = [];
        f.dialog.invalid = false;
        f.click();
        assert.equal(f.intents.length, 2);
        assert.notEqual(f.intents[1].attemptToken, first);
        f.close();
        await f.time.advance(350);
        assert.equal(f.reads.length, 0, 'Retry and closing still use no additional reads');
        assert.equal(f.intents.length, 2);
    });
}

test('ordinary dialog mutations and hidden alerts do not revoke intent', t => {
    const f = fixture(t);
    f.click();
    f.observers[0].callback([{target: f.dialog}]);
    f.dialog.alerts = [{textContent: 'Old hidden error', closest() { return null; }, getAttribute() { return 'true'; }}];
    f.observers[0].callback([{target: f.dialog}]);
    assert.equal(f.cancellations.length, 0);
});

for (const end of ['off', 'teardown']) {
    test(`${end} removes delegated handlers and scoped error observers before reinitialization`, t => {
        const f = fixture(t);
        f.service.init(); f.service.init();
        f.click();
        assert.equal(f.intents.length, 1);
        const observer = f.observers[0];
        if (end === 'off') {
            f.ticket.settings.features.autoSelectCloseReason = false;
            f.service.scanDialogs();
        } else f.service.teardown();
        assert.equal(observer.disconnected, true);
        assert.equal(f.service.punishmentBindings.size, 0);
        assert.equal(f.service.punishmentIntentListeners, null);
        assert.equal(f.cancellations.length, 1);
        f.click(); f.submit();
        assert.equal(f.intents.length, 1);
        f.ticket.settings.features.autoSelectCloseReason = true;
        f.service.init();
        f.click();
        assert.equal(f.intents.length, 2);
    });
}

function remountBridgeFixture(t, {earlyBind = true, mismatch = null} = {}) {
    const f = fixture(t, {enabled: earlyBind});
    f.ticket.settings.features.autoSelectCloseReason = true;
    const replacementTextarea = {readOnly: false, disabled: false};
    const replacement = {steamId: f.scope.steamId, ticketId: f.scope.ticketId,
        connected: true, inProgress: true, querySelector() { return replacementTextarea; }};
    const context = {scope: replacement, textarea: replacementTextarea,
        steamId: replacement.steamId, ticketId: replacement.ticketId, category: 'Читерство'};
    const location = {pathname: '/ticket/123'};
    const transfers = [];
    f.ticket.getCloseReasonContext = textarea => textarea === replacementTextarea ? context : null;
    f.ticket.isCloseReasonContextEditable = candidate => candidate.scope.inProgress
        && !candidate.textarea.readOnly && !candidate.textarea.disabled;
    f.ticket.isCloseReasonTextareaVisible = () => true;
    f.ticket.transferCloseReasonComplaintScope = (oldScope, current) => transfers.push({oldScope, current});
    const duplicateTextarea = {};
    const bridgeDocument = {
        defaultView: {location},
        contains(candidate) { return candidate?.connected === true; },
        querySelector(selector) {
            assert.equal(selector, '[role="dialog"] #ban-steamid64');
            return {closest() { return f.dialog; }};
        },
        querySelectorAll() {
            return mismatch === 'duplicate' ? [replacementTextarea, duplicateTextarea] : [replacementTextarea];
        }
    };
    if (mismatch === 'duplicate') {
        const getContext = f.ticket.getCloseReasonContext;
        f.ticket.getCloseReasonContext = textarea => textarea === duplicateTextarea ? {...context, textarea} : getContext(textarea);
    }
    const bridge = new SitePunishmentBridge({document: bridgeDocument, ticketService: f.ticket});
    f.ticket.punishmentBridge = bridge;
    f.ticket.openSiteBanForm = PunishmentPanelMethods.openSiteBanForm;
    bridge._openForm = async () => {
        f.scope.connected = false;
        f.ticket.getActivePunishmentScope = () => replacement;
        if (mismatch === 'ticketId') context.ticketId = replacement.ticketId = '124';
        if (mismatch === 'steamId') context.steamId = replacement.steamId = '76561198000000002';
        if (mismatch === 'route') location.pathname = '/ticket/124';
        if (mismatch === 'readonly') replacementTextarea.readOnly = true;
        return true;
    };
    return {...f, replacement, replacementTextarea, context, bridge, location, transfers};
}

for (const earlyBind of [true, false]) {
    test(`real bridge safely transfers a standalone remount with ${earlyBind ? 'early' : 'late'} binding`, async t => {
        const f = remountBridgeFixture(t, {earlyBind});
        PunishmentPanelMethods.handleTicketBanButtonClick.call(f.ticket);
        await f.time.flush();
        const token = f.ticket._closeReasonPunishmentOrigins.get(f.dialog);
        assert.equal(token.scope, f.replacement);
        assert.equal(token.ticketId, '123');
        assert.deepEqual(f.transfers, [{oldScope: f.scope, current: f.context}]);
        f.service.init();
        f.click();
        assert.equal(f.intents.length, 1);
        assert.equal(f.intents[0].scope, f.replacement);
        assert.equal(f.intents[0].steamId, f.scope.steamId);
        assert.equal(f.service.punishmentBindings.get(f.dialog).initialOrigin.scope, f.replacement);
        assert.equal(f.ticket._closeReasonPunishmentOrigins.has(f.dialog), false);
    });
}

for (const mismatch of ['ticketId', 'steamId', 'route', 'readonly', 'duplicate']) {
    test(`real bridge rejects a standalone remount with ${mismatch} ambiguity`, async t => {
        const f = remountBridgeFixture(t, {mismatch});
        PunishmentPanelMethods.handleTicketBanButtonClick.call(f.ticket);
        await f.time.flush();
        f.click();
        assert.equal(f.intents.length, 0);
        assert.equal(f.transfers.length, 0);
        assert.equal(f.ticket._closeReasonPunishmentOrigins?.has(f.dialog) || false, false);
    });
}

test('a replacement active scope alone cannot reassign an early binding without a bridge token', t => {
    const f = remountBridgeFixture(t);
    f.scope.connected = false;
    f.ticket.getActivePunishmentScope = () => f.replacement;
    f.click();
    assert.equal(f.intents.length, 0);
});

test('badge feedback uses native action even when automatic close reason is disabled', t => {
    const f = fixture(t, {enabled: false});
    f.ticket.settings.features.processTicketRules = true;
    const badges = [], cancellations = [];
    f.ticket.onTicketPunishmentFeedbackIntent = intent => badges.push(intent);
    f.ticket.cancelTicketPunishmentFeedbackIntent = token => cancellations.push(token);
    f.service.init();
    f.click();
    assert.equal(badges.length, 1);
    assert.equal(badges[0].type, 'ban');
    f.click(f.cancelButton);
    assert.deepEqual(cancellations, [badges[0].attemptToken]);
    assert.equal(f.reads.length, 0);
});
