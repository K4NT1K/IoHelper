import test from 'node:test';
import assert from 'node:assert/strict';
import {PunishmentService} from '../modules/PunishmentService.js';
import {SitePunishmentBridge} from '../modules/SitePunishmentBridge.js';
import {PunishmentPanelMethods} from '../modules/ticket/PunishmentPanel.js';
import {clock, deferred} from './clock.mjs';

function fixture(t, {type = 'ban', enabled = true, beforeBind = null, results = [{isBanned: true, isMuted: false}]} = {}) {
    const time = clock(t);
    const textarea = {readOnly: false, disabled: false};
    const scope = {steamId: '76561198000000001', ticketId: '123', connected: true, inProgress: true,
        querySelector() { return textarea; }};
    const form = new EventTarget();
    const input = {value: scope.steamId};
    const dialog = {
        isConnected: true,
        getAttribute() { return 'open'; },
        querySelector(selector) {
            if (selector === 'form') return form;
            if (selector === `#${type}-steamid64`) return input;
            return null;
        }
    };
    const reads = [], confirmations = [];
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
        syncCloseReasonSelection() { syncs++; }
    };
    const document = {
        contains(candidate) { return candidate.connected; },
        querySelectorAll() { return dialog.isConnected ? [dialog] : []; }
    };
    const service = new PunishmentService({document, ticketService: ticket});
    beforeBind?.({ticket, scope, dialog, input, textarea});
    service.scanDialogs();
    const submit = () => form.dispatchEvent(new Event('submit', {cancelable: true}));
    const close = () => { dialog.isConnected = false; service.scanDialogs(); };
    t.after(() => service.teardown());
    return {time, scope, textarea, form, input, dialog, ticket, service, reads, confirmations, submit, close,
        get syncs() { return syncs; }};
}

for (const type of ['ban', 'mute']) {
    test(`${type}: submitting alone does not mark punished; closed form requires fresh matching evidence`, async t => {
        const data = {isBanned: type === 'ban', isMuted: type === 'mute'};
        const f = fixture(t, {type, results: [data]});
        f.submit();
        f.service.scanDialogs(); // Repeated scan must keep the captured submission.
        await f.time.advance(5000);
        assert.equal(f.reads.length, 0);
        assert.equal(f.confirmations.length, 0);
        f.close();
        await f.time.advance(349);
        assert.equal(f.reads.length, 0);
        await f.time.advance(1);
        assert.equal(f.reads.length, 1);
        assert.equal(f.confirmations.length, 1);
        assert.equal(f.confirmations[0].data[type === 'ban' ? 'isBanned' : 'isMuted'], true);
        assert.equal(f.confirmations[0].data.issuedType, undefined, 'An active record does not prove this submission created it');
        assert.equal(f.confirmations[0].data.scope, f.scope);
        assert.equal(f.confirmations[0].data.ticketId, '123');
        assert.equal(f.syncs, 1);
        assert.equal(f.service.punishmentConfirmations.size, 0);
    });
}

test('opening and cancelling a form never requests confirmation', async t => {
    const f = fixture(t);
    f.close();
    await f.time.advance(5000);
    assert.equal(f.reads.length, 0);
    assert.equal(f.confirmations.length, 0);
});

test('wrong punishment type and failed reads are bounded and do not count as success', async t => {
    const f = fixture(t, {results: [new Error('network'), {isMuted: true}, {isBanned: false}]});
    f.submit(); f.close();
    await f.time.advance(10000);
    assert.equal(f.reads.length, 3);
    assert.equal(f.confirmations.length, 0);
    assert.equal(f.service.punishmentConfirmations.size, 0);
    assert.equal(f.time.timers.size, 0);
});

test('eventually visible punishment is confirmed on a later read', async t => {
    const f = fixture(t, {results: [{isBanned: false}, {isBanned: true}]});
    f.submit(); f.close();
    await f.time.advance(350);
    assert.equal(f.confirmations.length, 0);
    await f.time.advance(1000);
    assert.equal(f.confirmations.length, 1);
    assert.equal(f.reads.length, 2);
});

test('global cooldown is respected before network access and rechecked after scheduling', async t => {
    const f = fixture(t);
    f.submit(); f.close();
    f.ticket.globalServerCooldown = Date.now() + 1200;
    await f.time.advance(350);
    assert.equal(f.reads.length, 0);
    await f.time.advance(849);
    assert.equal(f.reads.length, 0);
    await f.time.advance(1);
    assert.equal(f.reads.length, 1);
});

for (const invalidate of ['steamId', 'ticketId', 'closed', 'disconnected', 'disabled', 'readonly', 'teardown']) {
    test(`late confirmation is suppressed when origin becomes ${invalidate}`, async t => {
        const pending = deferred();
        const f = fixture(t, {results: [() => pending.promise]});
        f.submit(); f.close();
        await f.time.advance(350);
        assert.equal(f.reads.length, 1);
        if (invalidate === 'steamId') f.scope.steamId = '76561198000000002';
        if (invalidate === 'ticketId') f.scope.ticketId = '124';
        if (invalidate === 'closed') f.scope.inProgress = false;
        if (invalidate === 'disconnected') f.scope.connected = false;
        if (invalidate === 'readonly') f.textarea.readOnly = true;
        if (invalidate === 'disabled') {
            f.ticket.settings.features.autoSelectCloseReason = false;
            f.service.scanDialogs();
            f.ticket.settings.features.autoSelectCloseReason = true;
        }
        if (invalidate === 'teardown') f.service.teardown();
        pending.resolve({isBanned: true});
        await f.time.flush();
        assert.equal(f.confirmations.length, 0);
        assert.equal(f.service.punishmentConfirmations.size, 0);
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
    assert.equal(f.confirmations.length, 1);
    assert.equal(f.confirmations[0].data.scope, f.scope);
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
        assert.equal(f.confirmations.length, 1);
        assert.equal(f.confirmations[0].data.scope, f.scope);
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
        assert.equal(f.confirmations.length, 1);
        assert.equal(f.confirmations[0].data.scope, f.scope);
        assert.equal(f.confirmations[0].data[type === 'ban' ? 'isBanned' : 'isMuted'], true);
        assert.equal(f.confirmations[0].data.issuedType, undefined);
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
