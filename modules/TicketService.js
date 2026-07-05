class TicketService {
    constructor({document, utils, badgeService, settings, rules}) {
        this.document = document;
        this.utils = utils;
        this.badgeService = badgeService;
        this.settings = settings;
        this.rules = rules;

        this.triggerRows = new Map();
        this.handleTriggerClick = this.handleTriggerClick.bind(this);
    }

    handleTriggerClick(e) {
        const trigger = e.target.closest(".moderhlpr-trigger-link");
        if (!trigger) return;

        const target = this.triggerRows.get(trigger.dataset.triggerId);
        if (!target) return;

        const rows = Array.isArray(target) ? target : [target];

        rows[0].scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

        rows.forEach(row => row.classList.add("moderhlpr-chat-highlight"));

        setTimeout(() => {
            rows.forEach(row => row.classList.remove("moderhlpr-chat-highlight"));
        }, 1000);
    }

    getRuleSeverity(rule) {
        return rule?.severity ?? rule?.duration ?? 0;
    }

    getMuteHistoryBlock() {
        return this.getBlockByHeader('История Мутов');
    }

    normalizeReason(reason) {
        return String(reason || '')
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    parseDateCell(dateCell) {
        const spans = dateCell?.querySelectorAll('span');
        const dateText = spans && spans[0] ? spans[0].innerText?.trim() : null;
        const timeText = spans && spans[1] ? spans[1].innerText?.trim() : '00:00';
        if (!dateText) return null;

        const [d, m, y] = dateText.split('.').map(Number);
        const [hh = 0, mm = 0, ss = 0] = timeText.split(':').map(Number);
        if ([d, m, y, hh, mm, ss].some(Number.isNaN)) return null;

        return new Date(y, m - 1, d, hh, mm, ss);
    }

    getColumnIndex(row, names, fallbackIndex) {
        const table = row.closest('table');
        const headers = Array.from(table?.querySelectorAll('thead th') || [])
            .map(th => th.innerText.trim().toLowerCase());
        const index = headers.findIndex(header => names.some(name => header.includes(name)));
        return index >= 0 ? index : fallbackIndex;
    }

    getChatRowData(row) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) return null;

        const timeIndex = this.getColumnIndex(row, ['дата', 'время'], 0);
        const messageIndex = this.getColumnIndex(row, ['сообщение', 'текст'], cells.length - 1);
        const authorIndex = this.getColumnIndex(row, ['игрок', 'ник', 'пользователь', 'автор'], -1);
        const chatTypeIndex = this.getColumnIndex(row, ['чат', 'тип'], Math.min(2, cells.length - 1));
        const messageCell = cells[messageIndex] || cells[cells.length - 1];

        return {
            timeText: cells[timeIndex]?.innerText?.trim() || '',
            authorText: authorIndex >= 0
                ? cells[authorIndex]?.innerText?.trim()
                : cells[chatTypeIndex]?.innerText?.trim() || 'Player',
            messageText: this.utils.extractMessageText(messageCell)
        };
    }

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
                        durationText: dateCells[5]?.innerText?.trim() || 'Неизвестно',
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
                    card.dataset.moderhlprManagedHidden = 'true';
                } else {
                    card.style.display = 'block';
                    delete card.dataset.moderhlprManagedHidden;
                }
            }

            if (cardText.includes('История Банов')) {
                if (cardText.includes('Банов нет') || cardText.includes('Не найдено')) {
                    card.style.display = 'none';
                    card.dataset.moderhlprManagedHidden = 'true';
                } else {
                    card.style.display = 'block';
                    delete card.dataset.moderhlprManagedHidden;
                }
            }

            if (cardText.includes('История Мутов')) {
                if (cardText.includes('Мутов нет') || cardText.includes('Не найдено')) {
                    card.style.display = 'none';
                    card.dataset.moderhlprManagedHidden = 'true';
                } else {
                    card.style.display = 'block';
                    delete card.dataset.moderhlprManagedHidden;
                }
            }

            if (cardText.includes('История Чата')) {
                const hasNoMessages = cardText.includes('Чат пуст');

                const hasRows = card.querySelectorAll('tbody tr, tr td').length > 0;

                if (hasNoMessages && !hasRows) {
                    card.style.display = 'none';
                    card.dataset.moderhlprManagedHidden = 'true';
                } else {
                    if (card.style.display === 'none') {
                        card.style.display = 'block';
                    }
                    delete card.dataset.moderhlprManagedHidden;
                }
            }
        });
    }

    restoreManagedEmptyBlocks() {
        this.document.querySelectorAll('[data-moderhlpr-managed-hidden="true"]').forEach(card => {
            card.style.display = 'block';
            delete card.dataset.moderhlprManagedHidden;
        });
    }

    setCurrentServerRefreshInterval(seconds) {
        clearInterval(this.currentServerRefreshInterval);

        if (!seconds || seconds <= 0) {
            this.currentServerRefreshInterval = null;
            return;
        }

        this.currentServerRefreshInterval = setInterval(() => {
            const headers = [...this.document.querySelectorAll("h3")];

            const header = headers.find(h =>
                h.textContent.trim() === "Текущий сервер"
            );

            if (!header) return;

            const container = header.closest("div");
            if (!container) return;

            const refreshButton = [...container.querySelectorAll("button")]
                .find(btn => btn.textContent.includes("Обновить"));

            if (!refreshButton || refreshButton.disabled) return;

            refreshButton.click();

        }, seconds * 1000);
    }

    clearTicketRuleBadge() {
        this.document.getElementById('helper-suggest-badge')?.remove();
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
            if (count < 3) {
                finalDuration = 0;
                finalDurationStr = "Предупреждение";
            }
        } else if (rule.name === "Спам в микрофон/чат") {
            if (count < 3) {
                finalDuration = 0;
                finalDurationStr = "Предупреждение";
            }
        } else if (rule.name === "Расизм / дискриминация" && count < 2) {
            finalDuration = 0;
            finalDurationStr = "Предупреждение";
        }

        return {finalName, finalDuration, finalDurationStr};
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
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'muted', `<div class="moderhlpr-row">${SVG_CHAT_ERROR}<span><b>Проверка:</b> Чат пуст.</span></div>`, textarea);
            return;
        }

        let lastMuteDate = null;

        if (muteHistoryBlock) {
            const now = Date.now();

            muteHistoryBlock.querySelectorAll('tbody tr').forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 6) return;

                const muteDate = this.parseDateCell(cells[1]);
                if (!muteDate) return;

                const hoursDiff = (now - muteDate.getTime()) / (1000 * 60 * 60);

                if (hoursDiff <= 24) {
                    if (!lastMuteDate || muteDate > lastMuteDate) {
                        lastMuteDate = muteDate;
                    }
                }
            });
        }

        const rows = Array.from(chatHistoryBlock.querySelectorAll('tbody tr, tr')).filter(row => row.querySelector('td'));
        if (rows.length === 0) {
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'muted', `<div class="moderhlpr-row">${SVG_CHAT_ERROR}<span><b>Проверка:</b> Чат пуст.</span></div>`, textarea);
            return;
        }

        const allViolations = [];
        const ruleCounters = {};
        this.rules.forEach(rule => {
            ruleCounters[rule.name] = 0;
        });
        const playerChatLog = {};

        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) continue;

            const chatRow = this.getChatRowData(row);
            if (!chatRow || !chatRow.messageText) continue;

            if (!this.utils.isMessageWithin24Hours(chatRow.timeText)) {
                continue;
            }

            if (lastMuteDate) {
                const messageDate = this.utils.parseTimeToMs(chatRow.timeText);

                if (messageDate && messageDate <= lastMuteDate.getTime()) {
                    continue;
                }
            }

            const {authorText, messageText} = chatRow;
            const textLower = messageText.toLowerCase().trim();
            const msgTimeMs = this.utils.parseTimeToMs(chatRow.timeText);

            if (msgTimeMs && textLower.length > 0) {
                if (!playerChatLog[authorText]) playerChatLog[authorText] = [];
                playerChatLog[authorText].push({time: msgTimeMs, text: textLower, raw: messageText, row});
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

            const triggerId = crypto.randomUUID();
            this.triggerRows.set(triggerId, row);
            allViolations.push({
                id: triggerId,
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
                    const spamRows = [];

                    for (let k = i; k < msgs.length; k++) {
                        if ((msgs[k].time - msgs[i].time) / 1000 > 5) break;

                        if (msgs[k].text === msgs[i].text) {
                            spamRows.push(msgs[k].row);
                        }
                    }
                    const triggerId = crypto.randomUUID();
                    this.triggerRows.set(triggerId, spamRows);
                    allViolations.push({
                        id: triggerId,
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
            .filter(([_, count]) => count > 0);

        const activeStatsSummary = activeStats
            .map(([name, count]) => `${name}: ${count}`)
            .join(' | ');

        const activityHTML = activeStatsSummary ? ` <span class="moderhlpr-activity-text">(${this.utils.escapeHtml(activeStatsSummary)})</span>` : '';
        const activityChipsHTML = activeStats.length > 1
            ? activeStats
                .map(([name, count]) =>
                    `<span class="moderhlpr-analysis-chip">${this.utils.escapeHtml(name)}<b>${count}</b></span>`
                )
                .join('')
            : '';

        if (allViolations.length === 0) {
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'success', `<div class="moderhlpr-row">${SVG_SHIELD}<span><b>Проверка:</b> Нарушений не обнаружено.${activityHTML}</span></div>`, textarea);
            return;
        }

        const mostSevere = this.findMostSeverePunishment(ruleCounters);
        if (!mostSevere) return;

        const {
            finalName,
            finalDuration,
            finalDurationStr
        } = this.calculateFinalPunishment(mostSevere.rule, mostSevere.count, ruleCounters);

        const sortedTriggers = allViolations
            .sort((a, b) => b.severity - a.severity || b.duration - a.duration || a.keyword.localeCompare(b.keyword));

        const topTriggers = sortedTriggers.map(t => `
    <span
        class="moderhlpr-trigger-tooltip moderhlpr-trigger-link"
        data-trigger-id="${t.id}"
        data-full-msg="${this.utils.escapeHtml(t.fullMessage)}">
        ${this.utils.escapeHtml(t.keyword)}
    </span>`);
        const topTriggersHTML = topTriggers.join('<span class="moderhlpr-trigger-separator">,</span> ');

        let finalDurationForDisplay = finalDurationStr;

        if (finalDuration > 0) {
            const recentSameReasonMute = this.findRecentMuteForReasons(muteHistoryBlock, [finalName, mostSevere.rule.name]);

            if (recentSameReasonMute) {
                finalDurationForDisplay = this.utils.formatDuration(recentSameReasonMute.duration * 2);
            }
        }

        const isWarning = finalDurationStr === "Предупреждение";
        const punishmentText = isWarning ? finalDurationStr : `мут на ${finalDurationForDisplay}`;

        const htmlResponse = `
                <div class="moderhlpr-analysis-grid">
                    <div class="moderhlpr-analysis-row">
                        <div class="moderhlpr-analysis-label">${SVG_TRIGGERS}<span>Триггеры</span></div>
                        <div class="moderhlpr-analysis-value moderhlpr-analysis-triggers">${topTriggersHTML}</div>
                    </div>
                    <div class="moderhlpr-analysis-row">
                        <div class="moderhlpr-analysis-label">${SVG_REASON}<span>Причина</span></div>
                        <div class="moderhlpr-analysis-value">
                            <strong>${this.utils.escapeHtml(finalName)}</strong>
                            ${activityChipsHTML ? `<div class="moderhlpr-analysis-chips">${activityChipsHTML}</div>` : ''}
                        </div>
                    </div>
                    <div class="moderhlpr-analysis-row moderhlpr-analysis-row--verdict">
                        <div class="moderhlpr-analysis-label">${SVG_PUNISHMENT}<span>Вердикт</span></div>
                        <div class="moderhlpr-analysis-value"><strong>${this.utils.escapeHtml(punishmentText)}</strong></div>
                    </div>
                </div>
            </div>
        `;

        const badgeVariant = isWarning ? 'warning' : 'accent';
        this.badgeService.updateInfoBadge('helper-suggest-badge', badgeVariant, htmlResponse, textarea);

        const badge = this.document.getElementById("helper-suggest-badge");
        if (badge) {
            badge.removeEventListener("click", this.handleTriggerClick);
            badge.addEventListener("click", this.handleTriggerClick);
        }
    }
}

window.TicketService = TicketService;

