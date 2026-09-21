export const VerdictMethods = {
    findRecentMuteForReasons(muteHistoryBlock, reasonNames) {
        if (!muteHistoryBlock) return null;

        const acceptedReasons = reasonNames.map(reason => this.normalizeReason(reason)).filter(Boolean);
        const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
        let latestMute = null;

        muteHistoryBlock.querySelectorAll('tbody tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) return;

            const rowDate = this.parseDateCell(cells[1]);
            const reason = this.normalizeReason(cells[3]?.innerText);
            if (!rowDate || rowDate < thirtyDaysAgo || !acceptedReasons.includes(reason)) return;

            const duration = this.utils.parseDurationToMinutes(cells[5]?.innerText?.trim());
            if (duration <= 0) return;

            if (!latestMute || rowDate > latestMute.date) {
                latestMute = {date: rowDate, duration};
            }
        });

        return latestMute;
    },

    findMostSeverePunishment(ruleCounters) {
        let bestRule = null;
        let bestScore = -1;

        if (!Array.isArray(this.rules) || this.rules.length === 0) {
            return null;
        }
        this.rules.forEach(rule => {
            const count = ruleCounters[rule.name] || 0;
            if (count > 0) {
                let score = this.getRuleSeverity(rule);
                if (rule.name === "Оскорбление" && count > 4) {
                    score = 720;
                }
                if (score > bestScore) {
                    bestScore = score;
                    bestRule = {rule, count};
                }
            }
        });

        return bestRule;
    },

    calculateFinalPunishment(rule, count, ruleCounters = {}) {
        let finalName = rule.name;
        let finalDuration = rule.duration;
        let finalDurationStr = this.utils.formatDuration(rule.duration);

        const toxicityCount = ruleCounters["Токсичность"] || 0;
        const insultCount = ruleCounters["Оскорбление"] || 0;
        const trollingCount = ruleCounters["Троллинг/провокация"] || 0;

        if (toxicityCount > 0 || rule.name === "Токсичность") {
            const toxicityRule = this.rules.find(r => r.name === "Токсичность");
            finalName = "Токсичность";
            finalDuration = toxicityRule?.duration ?? 720;
            finalDurationStr = this.utils.formatDuration(finalDuration);
            return {finalName, finalDuration, finalDurationStr};
        }

        if (insultCount > 2 && trollingCount > 2) {
            finalName = "Токсичность";
            finalDuration = this.rules.find(r => r.name === "Токсичность")?.duration ?? 720;
            finalDurationStr = this.utils.formatDuration(finalDuration);
            return {finalName, finalDuration, finalDurationStr};
        }

        if (insultCount > 1 && trollingCount > 1) {
            finalName = "Оскорбление";
            finalDuration = this.rules.find(r => r.name === "Оскорбление")?.duration ?? 360;
            finalDurationStr = this.utils.formatDuration(finalDuration);
            return {finalName, finalDuration, finalDurationStr};
        }

        if (insultCount > 0 && trollingCount > 2) {
            finalName = "Троллинг/провокация";
            finalDuration = this.rules.find(r => r.name === "Троллинг/провокация")?.duration ?? 360;
            finalDurationStr = this.utils.formatDuration(finalDuration);
            return {finalName, finalDuration, finalDurationStr};
        }

        if (rule.name === "Оскорбление") {
            if (count > 4) {
                finalName = "Токсичность (Многократные оскорбления)";
                finalDuration = 720;
                finalDurationStr = "12 часов";
            } else if (count === 1) {
                finalDuration = 0;
                finalDurationStr = "Предупреждение";
            }
        } else if (rule.name === "Троллинг/провокация") {
            if (count === 2) {
                finalDuration = 0;
                finalDurationStr = "Предупреждение";
            }
        } else if (rule.name === "Спам в микрофон/чат") {
            if (count < 4) {
                finalDuration = 0;
                finalDurationStr = "Предупреждение";
            }
        } else if (rule.name === "Расизм / дискриминация" && count < 2) {
            finalDuration = 0;
            finalDurationStr = "Предупреждение";
        }

        return {finalName, finalDuration, finalDurationStr};
    },

    getWarningHistoryBlockScoped(scope) {
        return this.getBlockByHeaderScoped('История предупреждений', scope)
            || this.getBlockByHeaderScoped('История Предупреждений', scope);
    },

    parseWarningHistoryRows(warningHistoryBlock) {
        if (!warningHistoryBlock) {
            return [];
        }

        const warnings = [];
        warningHistoryBlock.querySelectorAll('tbody tr, tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) {
                return;
            }

            const dateIndex = this.getColumnIndex(row, ['дата'], 1);
            const textIndex = this.getColumnIndex(row, ['текст'], Math.min(3, cells.length - 1));
            const warningDate = this.parseDateCell(cells[dateIndex]);
            const warningText = (cells[textIndex]?.innerText || '').replace(/\s+/g, ' ').trim();

            if (!warningDate || !warningText) {
                return;
            }

            warnings.push({date: warningDate, text: warningText});
        });

        return warnings;
    },

    warningTextMatchesRule(text, ruleName) {
        const lowered = String(text || '').toLowerCase();
        const matchers = {
            'Оскорбление': [/оскорбл/i, /insult/i],
            'Троллинг/провокация': [/провоц/i, /provok/i],
            'Спам в микрофон/чат': [/спам/i, /spam/i],
            'Расизм / дискриминация': [/расист/i, /racist/i, /racism/i, /discriminat/i],
            'Токсичность': [/токсич/i, /оскорбл/i, /toxic/i],
            'Мониторинг': [/монитор/i, /monitor/i],
            'Препятствие': [/препятств/i]
        };

        const patterns = matchers[ruleName];
        if (!patterns) {
            return false;
        }

        return patterns.some(pattern => pattern.test(lowered));
    },

    getWarningHistorySignaturePart(warningHistoryBlock) {
        if (!warningHistoryBlock) {
            return 'warn:0|';
        }

        const warnRows = Array.from(warningHistoryBlock.querySelectorAll('tbody tr, tr'))
            .filter(row => row.querySelector('td'));
        const lastWarn = warnRows[warnRows.length - 1];
        const warnTail = (lastWarn?.innerText || '').trim().slice(0, 220);
        return `warn:${warnRows.length}|${warnTail}`;
    },

    getCoveringWarningWithoutNewTriggers(warningHistoryBlock, allViolations) {
        const warnings = this.parseWarningHistoryRows(warningHistoryBlock);
        if (!warnings.length || !allViolations?.length) {
            return null;
        }

        let latestCoveringWarning = null;

        for (const warning of warnings) {
            const warningMs = warning.date.getTime();
            const coversSome = allViolations.some(violation =>
                violation?.timeMs &&
                violation.ruleName &&
                warningMs > violation.timeMs &&
                this.warningTextMatchesRule(warning.text, violation.ruleName)
            );

            if (coversSome && (!latestCoveringWarning || warningMs > latestCoveringWarning.date.getTime())) {
                latestCoveringWarning = warning;
            }
        }

        if (!latestCoveringWarning) {
            return null;
        }

        const latestCoveringWarningMs = latestCoveringWarning.date.getTime();
        const hasNewTriggersAfterWarning = allViolations.some(violation =>
            violation?.timeMs && violation.timeMs > latestCoveringWarningMs
        );

        return hasNewTriggersAfterWarning ? null : latestCoveringWarning;
    },
};
