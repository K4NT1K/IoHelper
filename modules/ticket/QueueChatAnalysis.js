import {detectSpamLinear} from '../shared/RuleMatcher.js';

// Shared text scanner. Only the detail adapter supplies a trigger map for its UI.
export function scanChatMessages(service, messages, {triggerRows = null} = {}) {
    const allViolations = [];
    const ruleCounters = {};
    for (const rule of service.rules || []) ruleCounters[rule.name] = 0;
    const playerChatLog = Object.create(null);
    const getSeverity = rule => service.getRuleSeverity(rule);
    const bindTrigger = row => {
        if (!triggerRows) return null;
        const id = crypto.randomUUID();
        triggerRows.set(id, row);
        return id;
    };

    for (const {messageText, authorText, timeMs, row} of messages) {
        if (!messageText) continue;
        const textLower = messageText.toLowerCase().trim();
        if (timeMs && textLower.length > 0) {
            (playerChatLog[authorText] ||= []).push({time: timeMs, text: textLower, raw: messageText, row});
        }
        const strongest = service._ruleMatcher.matchStrongest(textLower, messageText, getSeverity);
        if (!strongest) continue;
        ruleCounters[strongest.rule.name] += 1;
        allViolations.push({
            id: bindTrigger(row), ruleName: strongest.rule.name, keyword: strongest.displayKeyword,
            fullMessage: messageText, severity: getSeverity(strongest.rule),
            duration: strongest.rule.duration, timeMs: timeMs || null
        });
    }

    const spamRule = (service.rules || []).find(rule => rule.name === 'Спам в микрофон/чат');
    for (const spam of detectSpamLinear(playerChatLog, spamRule, getSeverity, service.spamRules)) {
        allViolations.push({
            id: bindTrigger(spam.rows), ruleName: 'Спам в микрофон/чат',
            keyword: `${spam.raw} (x${spam.dupes})`, fullMessage: spam.raw,
            severity: spam.severity, duration: spam.duration, timeMs: spam.timeMs || null
        });
        ruleCounters['Спам в микрофон/чат'] = (ruleCounters['Спам в микрофон/чат'] || 0) + spam.dupes;
    }
    return {allViolations, ruleCounters};
}

// Queue verdicts intentionally use fresh text only, without previous mutes/notices.
// Active punishment precedence belongs to the queue renderer, outside this helper.
export function analyzeQueueChatMessages(service, messages, {now = Date.now()} = {}) {
    const recent = (Array.isArray(messages) ? messages : []).filter(message =>
        typeof message?.text === 'string' && Number.isFinite(message.timeMs)
        && message.timeMs >= now - 86400000 && message.timeMs <= now
    ).map(message => ({messageText: message.text, timeMs: message.timeMs,
        authorText: message.channel === 'team' ? 'Команда' : 'Все'}));
    const analysis = scanChatMessages(service, recent);
    const {allViolations, ruleCounters} = service.dropSoloTrollingViolation(analysis.allViolations, analysis.ruleCounters);
    if (!allViolations.length) return {kind: 'none', reason: null, allViolations, ruleCounters};
    const mostSevere = service.findMostSeverePunishment(ruleCounters);
    if (!mostSevere) return {kind: 'skip', reason: null, allViolations, ruleCounters};
    const {finalName, finalDurationStr} = service.calculateFinalPunishment(mostSevere.rule, mostSevere.count, ruleCounters);
    return {kind: finalDurationStr === 'Предупреждение' ? 'warning' : 'mute',
        reason: finalName, allViolations, ruleCounters};
}
