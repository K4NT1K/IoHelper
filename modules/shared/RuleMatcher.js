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

export function detectSpamLinear(playerChatLog, spamRule, getSeverity) {
    const violations = [];
    for (const msgs of Object.values(playerChatLog)) {
        const sorted = [...msgs].sort((a, b) => a.time - b.time);
        const windowCounts = new Map();
        let windowStart = 0;

        for (let i = 0; i < sorted.length; i++) {
            const current = sorted[i];
            while (windowStart < i && (current.time - sorted[windowStart].time) / 1000 > 5) {
                const leaving = sorted[windowStart];
                const left = windowCounts.get(leaving.text);
                if (left) {
                    left.count -= 1;
                    if (left.count <= 0) {
                        windowCounts.delete(leaving.text);
                    }
                }
                windowStart += 1;
            }

            let bucket = windowCounts.get(current.text);
            if (!bucket) {
                bucket = {count: 0, firstIndex: i, rows: []};
                windowCounts.set(current.text, bucket);
            }
            bucket.count += 1;
            bucket.rows.push(current.row);

            if (bucket.count > 4) {
                const first = sorted[bucket.firstIndex];
                violations.push({
                    rows: [...bucket.rows],
                    dupes: bucket.count,
                    raw: first.raw,
                    timeMs: first.time,
                    severity: getSeverity(spamRule),
                    duration: spamRule?.duration ?? 0
                });
                break;
            }
        }
    }
    return violations;
}
