class TicketService {
    constructor({document, utils, badgeService, panelService, settings, rules, muteExceptions = {}}) {
        this.document = document;
        this.utils = utils;
        this.badgeService = badgeService;
        this.panelService = panelService;
        this.settings = settings;
        this.rules = rules;
        this.muteExceptions = muteExceptions;

        this.triggerRows = new Map();
        this.handleTriggerClick = this.handleTriggerClick.bind(this);
        this.isCheckingServer = false;
        this.steamAccountCreationCache = new Map();
        this.chatSignatureByKey = new Map();
        this.globalServerCooldown = 0;
        this.recentlyLeftOffenders = new Map();
        this._currentServerRefreshTicketKey = null;
        this._currentServerRefreshSeconds = null;
        this.LEFT_OFFENDER_TTL_MS = 5 * 60 * 1000;
    }

    getChatCacheKey(textarea) {
        const path = window.location.pathname || window.location.href;
        const marker = textarea?.placeholder || 'ticket';
        return `${path}|${marker}`;
    }

    resetChatAnalysisCache(textarea) {
        if (textarea) {
            this.chatSignatureByKey.delete(this.getChatCacheKey(textarea));
            return;
        }
        this.chatSignatureByKey.clear();
    }

    handleTriggerClick(e) {
        const trigger = e.target.closest(".ioh-trigger-link");
        if (!trigger) return;

        const target = this.triggerRows.get(trigger.dataset.triggerId);
        if (!target) return;

        const rows = Array.isArray(target) ? target : [target];

        rows[0].scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

        rows.forEach(row => row.classList.add("ioh-chat-highlight"));

        setTimeout(() => {
            rows.forEach(row => row.classList.remove("ioh-chat-highlight"));
        }, 1000);
    }

    getRuleSeverity(rule) {
        return rule?.severity ?? rule?.duration ?? 0;
    }

    getMuteHistoryBlock() {
        return this.getBlockByHeader('История Мутов');
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

    normalizeReason(reason) {
        return String(reason || '')
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
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

            [
                ['История Тикетов', ['Тикетов нет', 'Не найдено']],
                ['История Банов', ['Банов нет', 'Не найдено']],
                ['История Мутов', ['Мутов нет', 'Не найдено']]
            ].forEach(([title, emptyMarkers]) => {
                if (!cardText.includes(title)) {
                    return;
                }

                if (emptyMarkers.some(marker => cardText.includes(marker))) {
                    card.style.display = 'none';
                    card.dataset.iohManagedHidden = 'true';
                } else {
                    card.style.display = 'block';
                    delete card.dataset.iohManagedHidden;
                }
            });
        });
    }

    restoreManagedEmptyBlocks() {
        this.document.querySelectorAll('[data-ioh-managed-hidden="true"]').forEach(card => {
            const prev = card.dataset.iohManagedPrevDisplay;
            card.style.display = typeof prev === 'string' ? (prev || 'block') : 'block';
            delete card.dataset.iohManagedHidden;
            delete card.dataset.iohManagedPrevDisplay;
        });
    }

    markOffenderLeft(steamId) {
        if (!steamId) return;
        this.recentlyLeftOffenders.set(steamId, Date.now() + this.LEFT_OFFENDER_TTL_MS);
    }

    clearOffenderLeft(steamId) {
        if (!steamId) return;
        this.recentlyLeftOffenders.delete(steamId);
    }

    isOffenderRecentlyLeft(steamId) {
        if (!steamId) return false;

        const expiresAt = this.recentlyLeftOffenders.get(steamId);
        if (!expiresAt) return false;

        if (Date.now() >= expiresAt) {
            this.recentlyLeftOffenders.delete(steamId);
            return false;
        }

        return true;
    }

    getTicketComplaintParts() {
        const field = this.findInfoField('Причина');
        const valueBlock = this.findFieldValueBlock(field);
        return this.utils.parseComplaintCell(valueBlock || field);
    }

    getTicketComplaintCategory() {
        return this.getTicketComplaintParts().category;
    }

    getPlayerComplaintText() {
        return this.getTicketComplaintParts().playerText;
    }

    complaintTextMatchesAutoconnectTrigger(text) {
        const haystack = String(text || '').toLowerCase();
        if (!haystack) return false;

        return (this.settings.reasonTriggersAutoconnect || []).some(trigger => {
            if (!trigger) return false;
            return haystack.includes(String(trigger).toLowerCase());
        });
    }

    shouldAutoConnectToServer() {
        if (!this.settings?.features?.autoConnectServer) {
            return {allowed: false, reason: 'функция отключена'};
        }

        const statusSpan = Array.from(this.document.querySelectorAll('span')).find(
            span => span.textContent.trim() === 'В работе'
        );

        if (!statusSpan) {
            return {allowed: false, reason: "статус 'В работе' не найден"};
        }

        const offenderField = this.findInfoField('Нарушитель');
        const offenderSteamId = this.extractSteamIdFromField(offenderField);

        if (offenderSteamId && this.isOffenderRecentlyLeft(offenderSteamId)) {
            return {allowed: false, reason: 'нарушитель недавно вышел с сервера'};
        }

        const category = this.getTicketComplaintCategory();
        const playerText = this.getPlayerComplaintText();
        const allowedReasons = this.settings.autoConnectReasons || ['Читерство', 'Багоюз'];
        const reasonAllowed = allowedReasons.some(reason =>
            category.toLowerCase().includes(String(reason).toLowerCase())
        );
        const triggerAllowed = this.complaintTextMatchesAutoconnectTrigger(playerText);

        if (!reasonAllowed && !triggerAllowed) {
            return {allowed: false, reason: `причина «${category || 'неизвестна'}» не в списке и триггеры автоподключения не найдены`};
        }

        return {allowed: true, reason: reasonAllowed ? 'причина в списке' : 'найден триггер в тексте жалобы игрока'};
    }

    connectToCurrentServer() {
        const decision = this.shouldAutoConnectToServer();
        if (!decision.allowed) {
            console.log(`[Helper] Авто-подключение отменено: ${decision.reason}.`);
            return;
        }

        const ticketKey = window.location.pathname || window.location.href;
        if (this.document.body.dataset.autoConnectedFor === ticketKey) {
            console.log('[Helper] Авто-подключение уже выполнялось для этого тикета.');
            return;
        }

        const connectLink = this.document.querySelector('a[href^="steam://connect/"]');
        if (connectLink) {
            console.log('[Helper] Ссылка на коннект найдена:', connectLink.href, 'Выполняю клик...');
            this.document.body.dataset.autoConnectedFor = ticketKey;
            connectLink.click();
        } else {
            console.log('[Helper] Ссылка на коннект steam:// не найдена в структуре тикета.');
        }
    }

    findCurrentServerHeader() {
        return Array.from(this.document.querySelectorAll('h3'))
            .find(h => h.textContent?.includes('Текущий сервер'));
    }

    hasCurrentServerSection() {
        return Boolean(this.findCurrentServerHeader());
    }

    findCurrentServerRefreshButton(header = this.findCurrentServerHeader()) {
        if (!header) return null;

        let container = header.parentElement;
        for (let depth = 0; depth < 8 && container; depth++) {
            const refreshButton = Array.from(container.querySelectorAll('button'))
                .find(btn => btn.textContent?.includes('Обновить'));
            if (refreshButton) return refreshButton;
            container = container.parentElement;
        }

        return null;
    }

    stopCurrentServerRefresh() {
        if (this.currentServerRefreshInterval) {
            clearInterval(this.currentServerRefreshInterval);
            this.currentServerRefreshInterval = null;
        }
        this._currentServerRefreshTicketKey = null;
        this._currentServerRefreshSeconds = null;
    }

    ensureCurrentServerRefresh(ticketKey, seconds) {
        if (!seconds || seconds <= 0) {
            this.stopCurrentServerRefresh();
            return;
        }

        if (
            this._currentServerRefreshTicketKey === ticketKey &&
            this._currentServerRefreshSeconds === seconds &&
            this.currentServerRefreshInterval
        ) {
            return;
        }

        this.stopCurrentServerRefresh();
        this._currentServerRefreshTicketKey = ticketKey;
        this._currentServerRefreshSeconds = seconds;
        this.currentServerRefreshInterval = setInterval(() => {
            this.refreshCurrentServerNowIfAvailable();
        }, seconds * 1000);
    }

    refreshCurrentServerNowIfAvailable() {
        const header = this.findCurrentServerHeader();
        if (!header) return false;

        const refreshButton = this.findCurrentServerRefreshButton(header);
        if (!refreshButton || refreshButton.disabled) return false;

        refreshButton.click();
        return true;
    }

    clearTicketRuleBadge() {
        this.document.getElementById('helper-suggest-badge')?.remove();
    }

    clearSteamAccountCreationDate() {
        this.document.querySelectorAll('.ioh-account-created').forEach(node => node.remove());
    }

    findTicketTablesForCards() {
        const tables = Array.from(this.document.querySelectorAll('table'));

        // Demo + real tickets tables share the same Russian columns.
        return tables.filter(table => {
            const thTexts = Array.from(table.querySelectorAll('thead th'))
                .map(th => (th.textContent || '').trim());

            if (thTexts.length < 6) return false;

            const hasTime = thTexts.some(t => t.includes('Время'));
            const hasServer = thTexts.some(t => t.includes('Сервер'));
            const hasSender = thTexts.some(t => t.includes('Отправитель'));
            const hasOffender = thTexts.some(t => t.includes('Нарушитель'));
            const hasReason = thTexts.some(t => t.includes('Причина'));

            return hasTime && hasServer && hasSender && hasOffender && hasReason;
        });
    }
    renderSquareTicketCards() {
        const tables = this.findTicketTablesForCards();

        tables.forEach(table => {
            const headerCells = Array.from(table.querySelectorAll('thead th'));
            const headerLabels = headerCells.map(th => (th.textContent || '').trim());

            table.querySelectorAll('tbody tr').forEach(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                cells.forEach((cell, idx) => {
                    const label = headerLabels[idx] || '';
                    if (!label) return;
                    if (cell.dataset.iohLabel === label) return;
                    cell.dataset.iohLabel = label;
                });
            });

            table.classList.add('ioh-ticket-cards-enabled');
        });
    }
    clearSquareTicketCards() {
        this.document.querySelectorAll('table.ioh-ticket-cards-enabled').forEach(table => {
            table.classList.remove('ioh-ticket-cards-enabled');
            table.querySelectorAll('td[data-ioh-label]').forEach(td => {
                td.removeAttribute('data-ioh-label');
            });
        });
    }

    findInfoField(labelText) {
        const label = Array.from(this.document.querySelectorAll('span'))
            .find(span => span.textContent.trim() === labelText);

        return label?.parentElement || null;
    }
    findFieldValueBlock(field) {
        if (!field) {
            return null;
        }

        return Array.from(field.children).find(child => child.tagName === 'DIV') || null;
    }

    extractSteamIdFromField(field) {
        const valueBlock = this.findFieldValueBlock(field);
        const profileLink = valueBlock?.querySelector('a[href*="cybershoke.net/"], a[href*="/moderator/profile/"]');
        const sourceText = `${profileLink?.href || ''} ${profileLink?.textContent || ''}`;
        const steamIdMatch = sourceText.match(/\d{17,18}/);

        return steamIdMatch ? steamIdMatch[0] : null;
    }
    ensureSteamAccountCreationNode(field) {
        let node = field.parentNode.querySelector('.ioh-account-created');
        if (node) {
            return node.querySelector('.ioh-account-value');
        }

        node = this.document.createElement('div');
        node.className = field.className + ' ioh-account-created';

        const labelSpan = this.document.createElement('span');
        const originalSpan = field.querySelector('span');
        labelSpan.className = originalSpan ? originalSpan.className : '';
        labelSpan.textContent = 'Создан';

        const valueDiv = this.document.createElement('div');
        const originalDiv = field.querySelector('div');
        valueDiv.className = (originalDiv ? originalDiv.className : '') + ' ioh-account-value';

        node.appendChild(labelSpan);
        node.appendChild(valueDiv);

        field.insertAdjacentElement('afterend', node);

        return valueDiv;
    }
    extractCreationDateFromHtml(html) {
        const parser = new DOMParser();
        const parsedDocument = parser.parseFromString(html, 'text/html');
        const rowLikeNodes = parsedDocument.querySelectorAll('tr, li, p, div');
        const labelPattern = /(created|member since|account created|registered)/i;
        const datePatterns = [
            /([A-Z][a-z]{2,9}\s+\d{1,2},\s+\d{4})/,
            /(\d{1,2}\s+[A-Z][a-z]{2,9}\s+\d{4})/,
            /(\d{4}-\d{2}-\d{2})/,
            /(\d{2}\.\d{2}\.\d{4})/
        ];

        for (const row of rowLikeNodes) {
            const cells = row.querySelectorAll('th, td');
            if (cells.length >= 2 && labelPattern.test(cells[0].textContent || '')) {
                const valueText = cells[1].textContent.replace(/\s+/g, ' ').trim();
                if (valueText) {
                    return valueText;
                }
            }

            const rowText = row.textContent.replace(/\s+/g, ' ').trim();
            if (!labelPattern.test(rowText)) {
                continue;
            }

            for (const pattern of datePatterns) {
                const match = rowText.match(pattern);
                if (match) {
                    return match[1];
                }
            }
        }

        const fullText = parsedDocument.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (!fullText) {
            return null;
        }

        const labelIndex = fullText.search(labelPattern);
        if (labelIndex === -1) {
            return null;
        }

        const snippet = fullText.slice(labelIndex, labelIndex + 120);
        for (const pattern of datePatterns) {
            const match = snippet.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    }
    fetchSteamAccountCreationDate(steamId) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {action: "fetchSteamDate", steamId: steamId},
                (response) => {
                    if (chrome.runtime.lastError) {
                        return reject(chrome.runtime.lastError);
                    }
                    if (response && response.success) {
                        resolve(response.data); // This is your HTML string payload to parse
                    } else {
                        reject(response ? response.error : "Unknown error");
                    }
                }
            );
        });
    }
    async loadSteamAccountCreationDate(containerNode, steamId, {force = false} = {}) {
        const valueNode = containerNode.querySelector('.ioh-account-value');
        if (!valueNode) return;

        if (!force && containerNode.dataset.steamId === steamId && containerNode.dataset.loaded === 'true') {
            return;
        }

        containerNode.dataset.steamId = steamId;
        containerNode.dataset.loaded = 'false';
        valueNode.textContent = 'Загрузка...';

        try {
            const htmlPayload = await this.fetchSteamAccountCreationDate(steamId);
            const creationDate = this.extractCreationDateFromHtml(htmlPayload);
            valueNode.classList.remove('ioh-account-value--error');
            valueNode.textContent = creationDate ? creationDate : 'Профиль скрыт';
            containerNode.dataset.loaded = 'true';
        } catch (error) {
            this.renderSteamAccountCreationError(valueNode, containerNode, steamId);
            containerNode.dataset.loaded = 'true';
        }
    }
    renderSteamAccountCreationError(valueNode, containerNode, steamId) {
        valueNode.textContent = '';
        valueNode.classList.add('ioh-account-value--error');

        const errorSpan = this.document.createElement('span');
        errorSpan.className = 'ioh-account-error';
        errorSpan.textContent = 'Ошибка загрузки';

        const retryBtn = this.document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'ioh-account-retry';
        retryBtn.title = 'Повторить';
        retryBtn.textContent = '⟳';
        retryBtn.addEventListener('click', () => {
            valueNode.classList.remove('ioh-account-value--error');
            containerNode.dataset.loaded = 'false';
            this.loadSteamAccountCreationDate(containerNode, steamId, {force: true});
        });

        valueNode.appendChild(errorSpan);
        valueNode.appendChild(retryBtn);
    }
    async renderSteamAccountCreationDate() {
        const ticketTextarea = this.document.querySelector('textarea[placeholder*="Опишите детали закрытия"]');
        if (!ticketTextarea) {
            this.clearSteamAccountCreationDate();
            return;
        }

        const offenderField = this.findInfoField('Нарушитель');
        const offenderSteamId = this.extractSteamIdFromField(offenderField);

        if (!offenderField || !offenderSteamId) {
            return;
        }

        const valueNode = this.ensureSteamAccountCreationNode(offenderField);
        const containerNode = valueNode.closest('.ioh-account-created');

        await this.loadSteamAccountCreationDate(containerNode, offenderSteamId);
    }

    getKeywordExceptions(keyword) {
        const loweredKeyword = String(keyword || '').toLowerCase();

        return Object.entries(this.muteExceptions || {})
            .filter(([exceptionKey]) => loweredKeyword.includes(exceptionKey.toLowerCase()) || exceptionKey.toLowerCase().includes(loweredKeyword))
            .flatMap(([, exceptions]) => exceptions || []);
    }

    async checkOffendersServers() {
        if (!window.location.href.includes('/support/reports') &&
            !window.location.href.includes('/support/tickets')) {
            return;
        }

        if (this.isCheckingServer) return;

        if (this.globalServerCooldown && Date.now() < this.globalServerCooldown) {
            return;
        }

        this.isCheckingServer = true;
        const CACHE_INTERVAL = 5000;
        const TICKET_AGE_LIMIT = (this.settings.ticketAgeLimit || 0) * 1000;

        try {
            while (this.settings.features.trackOffenderServer) {
                if (this.globalServerCooldown && Date.now() < this.globalServerCooldown) {
                    break;
                }

                const rows = this.document.querySelectorAll('table tbody tr');
                if (!rows.length) break;

                let targetRow = null;
                let targetIp = null;
                let targetSteamId = null;
                let oldestCheck = Infinity;
                const now = Date.now();

                for (let i = rows.length - 1; i >= 0; i--) {
                    const row = rows[i];

                    const timeCell = row.querySelector('.ticket-time, td:nth-child(1), td:nth-child(2)');
                    if (timeCell) {
                        const ticketTimeMs = this.utils.parseTimeToMs(timeCell.innerText) || new Date(timeCell.textContent.trim()).getTime();
                        if (ticketTimeMs && (now - ticketTimeMs) < TICKET_AGE_LIMIT) {
                            continue;
                        }
                    }

                    const offenderLink = row.querySelector('td:nth-child(4) a[href*="cybershoke.net/"]');
                    const serverIpLink = row.querySelector('td:nth-child(2) a[href^="steam://connect/"]');

                    if (!offenderLink || !serverIpLink) continue;

                    const steamIdMatch = offenderLink.href.match(/\d{17,18}/);
                    if (!steamIdMatch) continue;

                    const lastCheck = parseInt(row.dataset.lastIpCheck || '0');

                    if (now - lastCheck < CACHE_INTERVAL) continue;

                    if (lastCheck === 0) {
                        targetRow = row;
                        targetIp = serverIpLink.href.replace('steam://connect/', '').trim().toLowerCase();
                        targetSteamId = steamIdMatch[0];
                        break;
                    }

                    if (lastCheck < oldestCheck) {
                        oldestCheck = lastCheck;
                        targetRow = row;
                        targetIp = serverIpLink.href.replace('steam://connect/', '').trim().toLowerCase();
                        targetSteamId = steamIdMatch[0];
                    }
                }

                if (!targetRow) break;

                targetRow.dataset.lastIpCheck = Date.now().toString();

                await new Promise(resolve => setTimeout(resolve, 350));

                const response = await fetch('https://cybershoke.net/api/user/data', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json, text/plain, */*',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    credentials: 'include',
                    body: new URLSearchParams({steamid64: targetSteamId}).toString()
                });

                if (response.status === 429) {
                    this.globalServerCooldown = Date.now() + 10000;
                    break;
                }

                if (!response.ok) continue;

                const result = await response.json();
                let currentIp = null;

                if (result?.server?.server_ip && result?.server?.server_port) {
                    currentIp = `${result.server.server_ip}:${result.server.server_port}`.toLowerCase();
                }

                const linkToUpdate = targetRow.querySelector('td:nth-child(2) a[href^="steam://connect/"]');
                if (linkToUpdate) {
                    linkToUpdate.classList.remove('ioh-server-online', 'ioh-server-offline', 'ioh-server-other');

                    if (!currentIp) {
                        linkToUpdate.classList.add('ioh-server-offline');
                        this.markOffenderLeft(targetSteamId);
                    } else if (currentIp === targetIp) {
                        linkToUpdate.classList.add('ioh-server-online');
                        this.clearOffenderLeft(targetSteamId);
                    } else {
                        linkToUpdate.classList.add('ioh-server-other');
                        this.markOffenderLeft(targetSteamId);
                    }
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            this.isCheckingServer = false;
        }
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
    }
    getAnalysisIcons() {
        const icons = window.Icons || {};

        return {
            triggers: icons.loupe || '',
            reason: icons.bell || '',
            punishment: icons.clock || '',
            chatError: icons.chat || '',
            shield: icons.shield || ''
        };
    }
    async processTicketRules(textarea) {
        const analysisIcons = this.getAnalysisIcons();
        const triggers = analysisIcons.triggers;
        const reason = analysisIcons.reason;
        const punishment = analysisIcons.punishment;
        const chatError = analysisIcons.chatError;
        const shield = analysisIcons.shield;

        this.connectToCurrentServer();

        const muteHistoryBlock = this.getMuteHistoryBlock();
        const chatHistoryBlock = this.getBlockByHeader('История Чата');

        if (muteHistoryBlock && this.hasActiveMute(muteHistoryBlock)) {
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'warning', `<div class="ioh-badge-row">${chatError}<span>Внимание:<b> У игрока уже есть активный мут!</b></span></div>`, textarea);
            return;
        }

        if (!chatHistoryBlock || chatHistoryBlock.style.display === 'none' || chatHistoryBlock.innerText.includes('Чат пуст') || chatHistoryBlock.innerText.includes('Не найдено')) {
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'muted', `<div class="ioh-badge-row">${chatError}<span><b>Проверка:</b> Чат пуст.</span></div>`, textarea);
            this.chatSignatureByKey.set(this.getChatCacheKey(textarea), `${window.location.pathname}|empty-block`);
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
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'muted', `<div class="ioh-badge-row">${chatError}<span><b>Проверка:</b> Чат пуст.</span></div>`, textarea);
            this.chatSignatureByKey.set(this.getChatCacheKey(textarea), `${window.location.pathname}|0|empty`);
            return;
        }

        const lastRow = rows[rows.length - 1];
        const signature = `${window.location.pathname}|${rows.length}|${(lastRow.innerText || '').trim().slice(0, 220)}`;
        const cacheKey = this.getChatCacheKey(textarea);
        const prevSignature = this.chatSignatureByKey.get(cacheKey);
        if (prevSignature === signature) {
            return;
        }
        this.chatSignatureByKey.set(cacheKey, signature);

        this.triggerRows.clear()

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

                const matchedKeywords = rule.keywords.filter(keyword => {
                    const normalizedKeyword = String(keyword).toLowerCase();
                    return this.utils.containsTrigger(
                        textLower,
                        normalizedKeyword,
                        this.getKeywordExceptions(normalizedKeyword)
                    );
                });
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

        if (ruleCounters['Троллинг/провокация'] === 1 &&
            ruleCounters['Спам в микрофон/чат'] === 0 &&
        ruleCounters['Оскорбление'] === 0 &&
        ruleCounters['Токсичность'] === 0 &&
        ruleCounters['Расизм / дискриминация'] === 0) {
            ruleCounters['Троллинг/провокация'] = 0;
            allViolations.splice(
                0,
                allViolations.length,
                ...allViolations.filter(v => v.ruleName !== 'Троллинг/провокация')
            );
        }

        const activeStats = Object.entries(ruleCounters)
            .filter(([_, count]) => count > 0);

        const activeStatsSummary = activeStats
            .map(([name, count]) => `${name}: ${count}`)
            .join(' | ');

        const activityHTML = activeStatsSummary ? ` <span class="ioh-activity-text">(${this.utils.escapeHtml(activeStatsSummary)})</span>` : '';
        const activityChipsHTML = activeStats.length > 1
            ? activeStats
                .map(([name, count]) =>
                    `<span class="ioh-analysis-chip">${this.utils.escapeHtml(name)}<b>${count}</b></span>`
                )
                .join('')
            : '';

        if (allViolations.length === 0) {
            this.badgeService.updateInfoBadge('helper-suggest-badge', 'success', `<div class="ioh-badge-row">${shield}<span><b>Проверка:</b> Нарушений не обнаружено.${activityHTML}</span></div>`, textarea);
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
        class="ioh-trigger-tooltip ioh-trigger-link"
        data-trigger-id="${t.id}"
        data-full-msg="${this.utils.escapeHtml(t.fullMessage)}">
        ${this.utils.escapeHtml(t.keyword)}
    </span>`);
        const topTriggersHTML = topTriggers.join('<span class="ioh-trigger-separator">,</span> ');

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
                <div class="ioh-analysis-grid">
                    <div class="ioh-analysis-row">
                        <div class="ioh-analysis-label">${triggers}<span>Триггеры</span></div>
                        <div class="ioh-analysis-value ioh-analysis-triggers">${topTriggersHTML}</div>
                    </div>
                    <div class="ioh-analysis-row">
                        <div class="ioh-analysis-label">${reason}<span>Причина</span></div>
                        <div class="ioh-analysis-value">
                            <strong>${this.utils.escapeHtml(finalName)}</strong>
                            ${activityChipsHTML ? `<div class="ioh-analysis-chips">${activityChipsHTML}</div>` : ''}
                        </div>
                    </div>
                    <div class="ioh-analysis-row ioh-analysis-row--verdict">
                        <div class="ioh-analysis-label">${punishment}<span>Вердикт</span></div>
                        <div class="ioh-analysis-value"><strong>${this.utils.escapeHtml(punishmentText)}</strong></div>
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

