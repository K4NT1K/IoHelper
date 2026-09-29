function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileKeywordEntry(keyword, exceptions) {
    const trigger = String(keyword).toLowerCase();
    return {
        trigger,
        triggerRe: new RegExp(escapeRegExp(trigger), 'iu'),
        exceptionRes: exceptions.map(ex => new RegExp(escapeRegExp(ex), 'giu'))
    };
}

export function compileRuleMatcher(rules = [], muteExceptions = {}) {
    const exceptionMap = new Map();
    for (const [key, values] of Object.entries(muteExceptions || {})) {
        exceptionMap.set(String(key).toLowerCase(), Array.isArray(values) ? values : []);
    }

    const compiledRules = (Array.isArray(rules) ? rules : []).map(rule => {
        const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
        const compiledKeywords = keywords.map(keyword => {
            const trigger = String(keyword).toLowerCase();
            const exceptions = [];
            for (const [exKey, exValues] of exceptionMap) {
                if (trigger.includes(exKey) || exKey.includes(trigger)) {
                    exceptions.push(...exValues);
                }
            }
            return compileKeywordEntry(keyword, exceptions);
        });

        const alternation = compiledKeywords
            .map(entry => escapeRegExp(entry.trigger))
            .filter(Boolean)
            .join('|');

        return {
            rule,
            keywords: compiledKeywords,
            anyKeywordRe: alternation ? new RegExp(alternation, 'iu') : null
        };
    });

    return {
        rules: compiledRules,
        getExceptions(keyword) {
            const trigger = String(keyword).toLowerCase();
            const exceptions = [];
            for (const [exKey, exValues] of exceptionMap) {
                if (trigger.includes(exKey) || exKey.includes(trigger)) {
                    exceptions.push(...exValues);
                }
            }
            return exceptions;
        },
        contains(text, compiledKeyword) {
            let sanitized = text;
            for (const exceptionRe of compiledKeyword.exceptionRes) {
                sanitized = sanitized.replace(exceptionRe, '');
            }
            return compiledKeyword.triggerRe.test(sanitized);
        },
        extractWord(text, compiledKeyword) {
            const words = String(text).match(/\S+/g);
            if (!words) {
                return compiledKeyword.trigger;
            }
            for (const word of words) {
                if (this.contains(word.toLowerCase(), compiledKeyword)) {
                    return word;
                }
            }
            return compiledKeyword.trigger;
        },
        matchStrongest(textLower, messageText, getSeverity) {
            const matched = [];
            for (const compiled of compiledRules) {
                if (!compiled.keywords.length) {
                    continue;
                }
                if (compiled.anyKeywordRe && !compiled.anyKeywordRe.test(textLower)) {
                    continue;
                }
                const hit = compiled.keywords.find(keyword => this.contains(textLower, keyword));
                if (hit) {
                    matched.push({
                        rule: compiled.rule,
                        keyword: hit.trigger,
                        compiledKeyword: hit
                    });
                }
            }
            if (!matched.length) {
                return null;
            }
            matched.sort((a, b) =>
                getSeverity(b.rule) - getSeverity(a.rule) || b.rule.duration - a.rule.duration
            );
            const strongest = matched[0];
            return {
                ...strongest,
                displayKeyword: this.extractWord(messageText, strongest.compiledKeyword)
            };
        }
    };
}

export function detectSpamLinear(playerChatLog, spamRule, getSeverity, spamRules = {}) {
    const intervalSec = Number(spamRules.interval) || 3;
    const warningCount = Number(spamRules.warningCount) || 3;
    const violations = [];

    const flushRun = (run) => {
        if (run.length < warningCount) {
            return;
        }
        const first = run[0];
        violations.push({
            rows: run.map(msg => msg.row),
            dupes: run.length,
            raw: first.raw,
            timeMs: first.time,
            severity: getSeverity(spamRule),
            duration: spamRule?.duration ?? 0
        });
    };

    for (const msgs of Object.values(playerChatLog)) {
        const sorted = [...msgs].sort((a, b) => a.time - b.time);
        let run = [];

        for (const current of sorted) {
            if (run.length === 0) {
                run = [current];
                continue;
            }

            const prev = run[run.length - 1];
            const sameText = current.text === prev.text;
            const gapSec = (current.time - prev.time) / 1000;
            if (sameText && gapSec < intervalSec) {
                run.push(current);
                continue;
            }

            flushRun(run);
            run = [current];
        }

        flushRun(run);
    }

    return violations;
}
