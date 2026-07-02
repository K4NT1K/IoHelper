class TicketService {
    constructor({ document, utils, badgeService, rules }) {
        this.document = document;
        this.utils = utils;
        this.badgeService = badgeService;
        this.rules = rules;
    }

    getRuleSeverity(rule) {
        return rule?.severity ?? rule?.duration ?? 0;
    }

    getMuteHistoryBlock() {
        return this.getBlockByHeader('История Мутов');
    }

    hasActiveMute(muteHistoryBlock) {
        if (!muteHistoryBlock) return false;

        const muteRows = muteHistoryBlock.querySelectorAll('tbody tr');

        for (const mRow of muteRows) {
            const cells = mRow.querySelectorAll('td');
            if (cells.length < 6) continue;

            const spans = cells[1].querySelectorAll('span');
            const dateText = spans[0]?.innerText?.trim();
            const timeText = spans[1]?.innerText?.trim();
            const durationText = cells[5]?.innerText?.trim();

            if (dateText && timeText && durationText) {
                const [d, m, y] = dateText.split('.').map(Number);
                const [hh, mm] = timeText.split(':').map(Number);

                if (!isNaN(d) && !isNaN(m) && !isNaN(y) && !isNaN(hh) && !isNaN(mm)) {
                    const muteStart = new Date(y, m - 1, d, hh, mm, 0);
                    const durationMins = this.utils.parseDurationToMinutes(durationText);

                    if (durationMins > 0) {
                        const muteEnd = new Date(muteStart.getTime() + durationMins * 60 * 1000);
                        if (new Date() < muteEnd) {
                            return true;
                        }
                    }
                }
            }

            const statusIndicator = cells[0].querySelector('span') || cells[0];
            if (statusIndicator) {
                const computedBg = window.getComputedStyle(statusIndicator).backgroundColor;
                const hasActiveVar = mRow.innerHTML.includes('--color-status-active') || statusIndicator.outerHTML.includes('active');
                const isYellowBg = computedBg.includes('234, 179, 8') ||
                    computedBg.includes('250, 204, 21') ||
                    computedBg.includes('255, 193, 7');

                if (hasActiveVar || isYellowBg) {
                    return true;
                }
            }
        }

        return false;
    }

    getMuteHistoryForPlayer(steamId) {
        const muteHeader = Array.from(this.document.querySelectorAll('h3')).find(h3 => h3.textContent.includes('История Мутов'));
        let rows = [];

        if (muteHeader) {
            let parent = muteHeader.parentElement;
            while (parent && parent !== this.document.body) {
                if (parent.children.length >= 2 && parent.tagName === 'DIV') {
                    rows = parent.querySelectorAll('tbody tr');
                    break;
                }
                parent = parent.parentElement;
            }
        }

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        let muteHistory = [];

        rows.forEach(row => {
            const dateCells = row.querySelectorAll('td');
            if (dateCells.length < 6) return;

            const dateSpans = dateCells[1]?.querySelectorAll('span');
            const dateText = dateSpans && dateSpans[0] ? dateSpans[0].innerText : null;

            const playerLink = dateCells[4]?.querySelector('a[href*="cybershoke.net/"]');
            const playerSteamId = playerLink?.href?.match(/cybershoke\.net\/(\d+)/)?.[1];
            const reason = dateCells[3]?.innerText?.trim();

            if (dateText && playerSteamId === steamId && reason) {
                const [d, m, y] = dateText.split('.').map(Number);
                const rowDate = new Date(y, m - 1, d);

                if (rowDate >= thirtyDaysAgo) {
                    muteHistory.push({
                        date: rowDate,
                        reason: reason,
                        durationText: dateCells[5]?.innerText?.trim() || 'Неизвестно'
                    });
                }
            }
        });

        return muteHistory;
    }

    manageEmptyBlocks() {
        const headers = Array.from(this.document.querySelectorAll('h3'));
        const cards = headers.map(h3 => {
            let parent = h3.parentElement;
            while (parent && parent !== this.document.body) {
                if (parent.children.length >= 2 && parent.tagName === 'DIV') return parent;
                parent = parent.parentElement;
            }
            return null;
        }).filter(Boolean);

        cards.forEach(card => {
            if (card.id?.includes('mod-')) return;

            const cardText = card.innerText;
            if (!cardText) return;

            if (cardText.includes('История Тикетов')) {
                if (cardText.includes('Тикетов нет') || cardText.includes('Не найдено')) {
                    card.style.display = 'none';
                } else {
                    card.style.display = 'block';
                }
            }

            if (cardText.includes('История Банов')) {
                if (cardText.includes('Банов нет') || cardText.includes('Не найдено')) {
                    card.style.display = 'none';
                } else {
                    card.style.display = 'block';
                }
            }

            if (cardText.includes('История Мутов')) {
                if (cardText.includes('Мутов нет') || cardText.includes('Не найдено')) {
                    card.style.display = 'none';
                } else {
                    card.style.display = 'block';
                }
            }

            if (cardText.includes('История Чата')) {
                const hasNoMessages = cardText.includes('Чат пуст');

                const hasRows = card.querySelectorAll('tbody tr, tr td').length > 0;

                if (hasNoMessages && !hasRows) {
                    card.style.display = 'none';
                } else {
                    if (card.style.display === 'none') {
                        card.style.display = 'block';
                    }
                }
            }
        });
    }

    getBlockByHeader(textMatch) {
        const headers = Array.from(this.document.querySelectorAll('h3'));
        const targetHeader = headers.find(h3 => h3.textContent.includes(textMatch));
        if (!targetHeader) return null;

        let parent = targetHeader.parentElement;
        while (parent && parent !== this.document.body) {
            if (parent.querySelector('table')) {
                return parent;
            }
            parent = parent.parentElement;
        }
        return null;
    }

    findMostSeverePunishment(ruleCounters) {
        let bestRule = null;
        let bestScore = -1;

        if (typeof CYBERSHOKE_MUT_RULES === 'undefined') return null;

        this.rules.forEach(rule => {
            const count = ruleCounters[rule.name] || 0;
            if (count > 0) {
                let score = this.getRuleSeverity(rule);
                if (rule.name === "Оскорбление" && count > 4) {
                    score = 720;
                }
                if (score > bestScore) {
                    bestScore = score;
                    bestRule = { rule, count };
                }
            }
        });

        return bestRule;
    }

    calculateFinalPunishment(rule, count, ruleCounters = {}) {
        let finalName = rule.name;
        let finalDuration = rule.duration;
        let finalDurationStr = this.utils.formatDuration(rule.duration);

        const insultCount = ruleCounters["Оскорбление"] || 0;
        const trollingCount = ruleCounters["Троллинг/провокация"] || 0;

        if (insultCount > 2 && trollingCount > 2) {
            finalName = "Токсичность";
            finalDuration = this.rules.find(r => r.name === "Токсичность")?.duration ?? 720;
            finalDurationStr = this.utils.formatDuration(finalDuration);
            return { finalName, finalDuration, finalDurationStr };
        }

        if (insultCount > 1 && trollingCount > 1) {
            finalName = "Оскорбление";
            finalDuration = this.rules.find(r => r.name === "Оскорбление")?.duration ?? 360;
            finalDurationStr = this.utils.formatDuration(finalDuration);
            return { finalName, finalDuration, finalDurationStr };
        }

        if (insultCount > 0 && trollingCount > 2) {
            finalName = "Троллинг/провокация";
            finalDuration = this.rules.find(r => r.name === "Троллинг/провокация")?.duration ?? 360;
            finalDurationStr = this.utils.formatDuration(finalDuration);
            return { finalName, finalDuration, finalDurationStr };
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
            if (count < 3) {
                finalDuration = 0;
                finalDurationStr = "Предупреждение";
            }
        } else if (rule.name === "Спам в микрофон/чат") {
            if (count < 3) {
                finalDuration = 0;
                finalDurationStr = "Предупреждение";
            }
        }

        return { finalName, finalDuration, finalDurationStr };
    }

    async processTicketRules(textarea) {
        const icons = typeof TicketRuleIcons !== 'undefined' ? TicketRuleIcons : {};
        const SVG_TRIGGERS = icons.TRIGGERS || '';
        const SVG_REASON = icons.REASON || '';
        const SVG_PUNISHMENT = icons.PUNISHMENT || '';
        const SVG_CHAT_ERROR = icons.CHAT_ERROR || '';
        const SVG_SHIELD = icons.SHIELD || '';

        const muteHistoryBlock = this.getMuteHistoryBlock();
        const chatHistoryBlock = this.getBlockByHeader('История Чата');

        if (muteHistoryBlock && this.hasActiveMute(muteHistoryBlock)) {
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'warning', `<div class="moderhlpr-row">${SVG_CHAT_ERROR}<span><b>Внимание:</b> У игрока уже есть активный мут! Проверка триггеров приостановлена.</span></div>`, textarea);
            return;
        }

        if (!chatHistoryBlock || chatHistoryBlock.style.display === 'none' || chatHistoryBlock.innerText.includes('Чат пуст') || chatHistoryBlock.innerText.includes('Не найдено')) {
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'muted', `<div class="moderhlpr-row">${SVG_CHAT_ERROR}<span><b>Проверка:</b> Чат пуст или недоступен.</span></div>`, textarea);
            return;
        }

        const rows = Array.from(chatHistoryBlock.querySelectorAll('tbody tr, tr')).filter(row => row.querySelector('td'));
        if (rows.length === 0) {
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'muted', `<div class="moderhlpr-row">${SVG_CHAT_ERROR}<span><b>Проверка:</b> Чат пуст или недоступен.</span></div>`, textarea);
            return;
        }

        const allViolations = [];
        const ruleCounters = {};
        this.rules.forEach(rule => { ruleCounters[rule.name] = 0; });
        const playerChatLog = {};

        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) continue;

            const timeText = cells[0].innerText.trim();
            if (!this.utils.isMessageWithin24Hours(timeText)) continue;

            const authorText = cells[2] ? cells[2].innerText.trim() : 'Player';
            const messageText = this.utils.extractMessageText(cells[3]);
            const textLower = messageText.toLowerCase().trim();
            const msgTimeMs = this.utils.parseTimeToMs(timeText);

            if (msgTimeMs && textLower.length > 0) {
                if (!playerChatLog[authorText]) playerChatLog[authorText] = [];
                playerChatLog[authorText].push({ time: msgTimeMs, text: textLower, raw: messageText });
            }

            const matchedRules = [];

            for (const rule of this.rules) {
                if (!Array.isArray(rule.keywords) || rule.keywords.length === 0) continue;

                const matchedKeywords = rule.keywords.filter(kw => textLower.includes(String(kw).toLowerCase()));
                if (matchedKeywords.length > 0) {
                    matchedRules.push({
                        rule,
                        keyword: matchedKeywords[0]
                    });
                }
            }

            if (matchedRules.length === 0) continue;

            matchedRules.sort((a, b) => this.getRuleSeverity(b.rule) - this.getRuleSeverity(a.rule) || b.rule.duration - a.rule.duration);
            const strongestMatch = matchedRules[0];

            ruleCounters[strongestMatch.rule.name] += 1;
            allViolations.push({
                ruleName: strongestMatch.rule.name,
                keyword: strongestMatch.keyword,
                fullMessage: messageText,
                severity: this.getRuleSeverity(strongestMatch.rule),
                duration: strongestMatch.rule.duration
            });
        }

        Object.keys(playerChatLog).forEach(author => {
            const msgs = playerChatLog[author].sort((a, b) => a.time - b.time);

            for (let i = 0; i < msgs.length; i++) {
                let dupes = 1;
                for (let j = i + 1; j < msgs.length; j++) {
                    if ((msgs[j].time - msgs[i].time) / 1000 > 5) break;

                    if (msgs[j].text === msgs[i].text) {
                        dupes++;
                    }
                }

                if (dupes > 4) {
                    const spamRule = this.rules.find(r => r.name === "Спам в микрофон/чат");
                    allViolations.push({
                        ruleName: "Спам в микрофон/чат",
                        keyword: `${msgs[i].raw} (x${dupes})`,
                        fullMessage: msgs[i].raw,
                        severity: this.getRuleSeverity(spamRule),
                        duration: spamRule?.duration ?? 0
                    });
                    ruleCounters["Спам в микрофон/чат"] += dupes;
                    break;
                }
            }
        });

        const activeStats = Object.entries(ruleCounters)
            .filter(([_, count]) => count > 0)
            .map(([name, count]) => `${name}: ${count}`)
            .join(' | ');

        const activityHTML = activeStats ? ` <span class="moderhlpr-activity-text">(${activeStats})</span>` : '';

        if (allViolations.length === 0) {
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'success', `<div class="moderhlpr-row">${SVG_SHIELD}<span><b>Проверка:</b> Нарушений не обнаружено.${activityHTML}</span></div>`, textarea);
            return;
        }

        const mostSevere = this.findMostSeverePunishment(ruleCounters);
        if (!mostSevere) return;

        const { finalName, finalDuration, finalDurationStr } = this.calculateFinalPunishment(mostSevere.rule, mostSevere.count, ruleCounters);

        const sortedTriggers = allViolations
            .sort((a, b) => b.severity - a.severity || b.duration - a.duration || a.keyword.localeCompare(b.keyword));

        const topTriggers = sortedTriggers.map(t => `<span class="moderhlpr-trigger-tooltip" data-full-msg="${this.utils.escapeHtml(t.fullMessage)}">${this.utils.escapeHtml(t.keyword)}</span>`);

        let finalDurationForDisplay = finalDurationStr;

        if (finalDuration > 0) {
            let sameReasonCount = 0;

            if (muteHistoryBlock) {
                const muteRows = muteHistoryBlock.querySelectorAll('tbody tr');
                const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));

                muteRows.forEach(mRow => {
                    const dateCells = mRow.querySelectorAll('td');
                    if (dateCells.length < 6) return;

                    const dateSpans = dateCells[1].querySelectorAll('span');
                    const dateText = dateSpans && dateSpans[0] ? dateSpans[0].innerText : null;
                    const reason = dateCells[3]?.innerText?.trim();

                    if (dateText && reason) {
                        const [d, m, y] = dateText.split('.').map(Number);
                        const rowDate = new Date(y, m - 1, d);

                        if (rowDate >= thirtyDaysAgo && (reason === finalName || reason === mostSevere.rule.name)) {
                            sameReasonCount++;
                        }
                    }
                });
            }

            if (sameReasonCount > 0) {
                const escalatedDuration = finalDuration * 2;
                finalDurationForDisplay = this.utils.formatDuration(escalatedDuration);
            }
        }

        const isWarning = finalDurationStr === "Предупреждение";
        const punishmentText = isWarning ? finalDurationStr : `мут на ${finalDurationForDisplay}`;

        const htmlResponse = `
            <div class="moderhlpr-row">${SVG_TRIGGERS}<span><b>Триггеры:</b> ${topTriggers.join(', ')}</span></div>
            <div class="moderhlpr-row">${SVG_REASON}<span><b>Причина:</b> ${finalName}${activityHTML}</span></div>
            <div class="moderhlpr-row">${SVG_PUNISHMENT}<span><b>Наказание:</b> ${punishmentText}</span></div>
        `;

        const badgeVariant = isWarning ? 'warning' : 'accent';
        this.badgeService.updateInfoBadge('helper-suggest-badge', badgeVariant, htmlResponse, textarea);
    }
}

window.TicketService = TicketService;
window.ModerHLPRTicketService = TicketService;


