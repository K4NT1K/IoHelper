import test from 'node:test';
import assert from 'node:assert/strict';
import {TicketService} from '../modules/TicketService.js';
import {Utils} from '../modules/Utils.js';
import {analyzeQueueChatMessages} from '../modules/ticket/QueueChatAnalysis.js';

const now = Date.parse('2026-11-07T12:00:00Z');
const day = 86400000;
const rules = [
    {name: 'Расизм / дискриминация', keywords: ['racism'], duration: 4320, severity: 9},
    {name: 'Токсичность', keywords: ['toxic'], duration: 720, severity: 7},
    {name: 'Оскорбление', keywords: ['insult'], duration: 360, severity: 5},
    {name: 'Троллинг/провокация', keywords: ['troll'], duration: 360, severity: 4},
    {name: 'Спам в микрофон/чат', keywords: [], duration: 360, severity: 2}
];
const message = (text, timeMs = now - 1000, channel = 'all') => ({text, timeMs, channel});
function fixture() {
    return new TicketService({document: {}, utils: new Utils({document: {}}), badgeService: {},
        settings: {}, rules, spamRules: {interval: 3, warningCount: 3, muteCount: 4},
        muteExceptions: {toxic: ['nontoxic']}});
}
const analyze = (service, messages, at = now) => analyzeQueueChatMessages(service, messages, {now: at});

test('Queue chat: inclusive rolling 24h rejects older, future and unknown timestamps', () => {
    const service = fixture();
    assert.equal(analyze(service, [message('toxic', now - day)]).kind, 'mute');
    assert.equal(analyze(service, [message('toxic', now)]).kind, 'mute');
    const invalid = [now - day - 1, now + 1, NaN, Infinity, undefined, null, String(now)];
    for (const timeMs of invalid) assert.equal(analyze(service, [{text: 'toxic', timeMs}]).kind, 'none');
    assert.equal(analyze(service, [{text: null, timeMs: now}, null]).kind, 'none');
    const messages = [message('toxic', now - day)];
    assert.equal(analyze(service, messages, now + 1).kind, 'none', 'Cached messages must age out when analyzed again');
});

test('Queue chat: warning stays distinct from mute and a mute wins over a heavier warning', () => {
    const service = fixture();
    assert.equal(analyze(service, [message('insult')]).kind, 'warning');
    assert.equal(analyze(service, [message('troll')]).kind, 'none');
    assert.equal(analyze(service, [message('troll'), message('troll')]).kind, 'warning');
    assert.equal(analyze(service, [message('insult'), message('insult')]).kind, 'mute');
    const mixed = analyze(service, [message('racism'), message('toxic')]);
    assert.equal(mixed.kind, 'mute');
    assert.equal(mixed.reason, 'Токсичность');
    assert.equal(analyze(service, [message('racism'), message('racism')]).reason, 'Расизм / дискриминация');
});

test('Queue chat: configured exceptions and strongest match share the existing compiled matcher', () => {
    const service = fixture(), matcher = service._ruleMatcher;
    service.recompileRuleMatcher = () => {throw Error('Queue must reuse compiled rules');};
    assert.equal(analyze(service, [message('nontoxic')]).kind, 'none');
    const verdict = analyze(service, [message('toxic insult')]);
    assert.equal(verdict.kind, 'mute');
    assert.equal(verdict.ruleCounters['Токсичность'], 1);
    assert.equal(verdict.ruleCounters['Оскорбление'], 0);
    assert.equal(service._ruleMatcher, matcher);
});

test('Queue chat: spam honors order, channel, interval and warning/mute thresholds', () => {
    const service = fixture();
    const run = count => Array.from({length: count}, (_, i) => message('repeat', now - i * 1000));
    assert.equal(analyze(service, run(2)).kind, 'none');
    assert.equal(analyze(service, run(3)).kind, 'warning');
    const spam = analyze(service, run(4));
    assert.equal(spam.kind, 'mute');
    assert.equal(spam.reason, 'Спам в микрофон/чат');
    assert.equal(spam.ruleCounters['Спам в микрофон/чат'], 4);
    assert.equal(analyze(service, [message('repeat', now - 6000), message('repeat', now - 3000), message('repeat', now)]).kind, 'none');
    const split = run(4).map((value, index) => ({...value, channel: index % 2 ? 'team' : 'all'}));
    assert.equal(analyze(service, split).kind, 'none');
    assert.equal(analyze(service, [message('a', now - 4000), message('a', now - 3000), message('other', now - 2000), message('a', now - 1000), message('a', now)]).kind, 'none');
});

test('Queue chat: text-only verdict ignores prior punishment and never changes detail UI state', () => {
    const service = fixture(), row = {};
    service.triggerRows.set('detail-trigger', row);
    service.suggestedMuteReason = {steamId: '76561198000000001', reason: 'Оскорбление'};
    service.chatSignatureByKey.set('detail', 'signature');
    service._sortedTriggers = [{id: 'detail-trigger'}];
    const suggestion = service.suggestedMuteReason, sorted = service._sortedTriggers;
    for (const method of ['findLastMuteWithin24h', 'getCoveringWarningWithoutNewTriggers', 'setSuggestedMuteReason']) {
        service[method] = () => {throw Error('Queue must not read or mutate detail analysis');};
    }
    const messages = [Object.freeze(message('toxic'))];
    Object.freeze(messages);
    assert.equal(analyze(service, messages).kind, 'mute');
    assert.deepEqual([...service.triggerRows], [['detail-trigger', row]]);
    assert.equal(service.suggestedMuteReason, suggestion);
    assert.equal(service._sortedTriggers, sorted);
    assert.deepEqual([...service.chatSignatureByKey], [['detail', 'signature']]);
});

test('Shared scanner: detail retains previous mute cutoff and trigger-to-row navigation', () => {
    const service = fixture();
    service.nativeData = {};
    const previous = message('toxic', now - 3000), current = message('insult', now - 1000);
    service.triggerRows.set('old', {});
    const detail = service.analyzeChatRows([previous, current], new Date(now - 2000));
    assert.equal(detail.allViolations.length, 1);
    assert.equal(detail.ruleCounters['Токсичность'], 0);
    assert.equal(detail.ruleCounters['Оскорбление'], 1);
    assert.equal(service.triggerRows.size, 1);
    assert.equal(service.triggerRows.get(detail.allViolations[0].id), current);
    assert.equal(analyze(service, [previous]).kind, 'mute', 'Queue text does not inherit the detail mute cutoff');
});

test('Shared scanner: DOM detail adapter keeps its timestamp parsing and age filtering', () => {
    const service = fixture();
    service.getChatRowData = row => row;
    service.utils.isMessageWithin24Hours = time => time !== 'old';
    service.utils.parseTimeToMs = time => time === 'recent' ? now - 1000 : now - day - 1;
    const old = {messageText: 'toxic', authorText: 'Все', timeText: 'old'};
    const recent = {messageText: 'insult', authorText: 'Все', timeText: 'recent'};
    const verdict = service.analyzeChatRows([old, recent], null);
    assert.equal(verdict.allViolations.length, 1);
    assert.equal(service.triggerRows.get(verdict.allViolations[0].id), recent);
});
