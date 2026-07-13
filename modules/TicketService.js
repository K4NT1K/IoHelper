class TicketService {
    constructor({document, utils, badgeService, panelService, settings, rules, muteExceptions = {}, chrome = null}) {
        this.document = document;
        this.utils = utils;
        this.badgeService = badgeService;
        this.panelService = panelService;
        this.settings = settings;
        this.rules = rules;
        this.muteExceptions = muteExceptions;
        this.chrome = chrome;

        this.triggerRows = new Map();
        this.handleTriggerClick = this.handleTriggerClick.bind(this);
        this.isCheckingServer = false;
        this.steamAccountCreationCache = new Map();
        this.chatSignatureByKey = new Map();
        this.globalServerCooldown = 0;
        this.offenderOffline = new Map();
        this.offenderRelocated = new Map();
        this.userDataCache = new Map();
        this._currentServerRefreshTicketKey = null;
        this._currentServerRefreshSeconds = null;
        this.LEFT_OFFENDER_TTL_MS = 8 * 60 * 1000;

        this.MODERATOR_PERMISSIONS_KEY = 'iohModeratorPermissions';
        this.MUTE_MANAGEMENT_ROUTE = '/comms/list';
        this.BAN_MANAGEMENT_ROUTE = '/bans/list';
        this.TICKET_PUNISHMENT_ACTIONS_ID = 'ioh-ticket-punishment-actions';
        this.TICKET_MUTE_BUTTON_ID = 'ioh-ticket-issue-mute';
        this.TICKET_BAN_BUTTON_ID = 'ioh-ticket-issue-ban';
        this.canIssueMute = false;
        this.canIssueBan = false;
        this.mutePanelReady = false;
        this.banPanelReady = false;
        this._cachedOpenMuteHandler = null;
        this._cachedOpenBanHandler = null;
        this._cachedMuteIssueButton = null;
        this._cachedBanIssueButton = null;
        this._punishmentPermissionObserver = null;
        this._punishmentPermissionDebounceId = null;
        this._muteRevokeDebounceId = null;
        this._banRevokeDebounceId = null;
        this._lastPunishmentScope = null;
        this._isUpdatingPunishmentButtons = false;
        this._permissionsHydrated = false;
        this._permissionScanSuppressed = 0;
        this._wasMutePanelActive = false;
        this._wasBanPanelActive = false;
        this.handleTicketMuteButtonClick = this.handleTicketMuteButtonClick.bind(this);
        this.handleTicketBanButtonClick = this.handleTicketBanButtonClick.bind(this);
        this.punishmentBridge = new SitePunishmentBridge({document, ticketService: this});
    }

    getChatCacheKey(textarea) {
        const scope = this.getTicketScopeRoot(textarea);
        const offenderId = this.extractSteamIdFromField(
            this.findInfoFieldScoped('Нарушитель', scope)
        ) || 'unknown';
        const scopeToken = scope?.getAttribute?.('aria-hidden') ?? scope?.className?.slice(0, 40) ?? '';
        const path = window.location.pathname || window.location.href;
        return `${path}|${offenderId}|${scopeToken}`;
    }

    getTicketScopeRoot(textarea) {
        if (!textarea) {
            return this.document.body;
        }

        let element = textarea.parentElement;
        while (element && element !== this.document.body) {
            if (element.hasAttribute?.('aria-hidden') || element.matches?.('section, article, main, [role="main"]')) {
                return element;
            }
            element = element.parentElement;
        }

        return textarea.closest('section, article, main, [role="main"]')
            || textarea.parentElement
            || this.document.body;
    }

    isVisibleTicketTextarea(textarea) {
        if (!textarea || !this.document.contains(textarea)) {
            return false;
        }

        let element = textarea;
        while (element) {
            if (element.getAttribute?.('aria-hidden') === 'true') {
                return false;
            }

            const style = window.getComputedStyle?.(element);
            if (style?.display === 'none' || style?.visibility === 'hidden') {
                return false;
            }

            element = element.parentElement;
        }

        return textarea.getClientRects().length > 0;
    }

    findVisibleTicketResolutionTextarea() {
        const textareas = this.document.querySelectorAll('textarea[placeholder*="Опишите детали закрытия"]');
        for (const textarea of textareas) {
            if (this.isVisibleTicketTextarea(textarea)) {
                return textarea;
            }
        }

        return null;
    }

    isComplaintPage() {
        const path = window.location.pathname || '';
        return /\/support\/(ticket|report)\b|\/ticket\/|\/reports?\//i.test(path);
    }

    isTicketPage() {
        return this.isComplaintPage();
    }

    isOpenComplaintScope(scopeEl) {
        if (!scopeEl) {
            return false;
        }

        const hasOffender = this.findInfoFieldScoped('Нарушитель', scopeEl);
        const hasPlayerInfo = Array.from(scopeEl.querySelectorAll('h3')).some(
            header => header.textContent.includes('Информация об игроках')
        );

        return Boolean(hasOffender || hasPlayerInfo);
    }

    isOpenTicketScope(scopeEl) {
        return this.isOpenComplaintScope(scopeEl);
    }

    isActiveComplaintScope(scopeEl) {
        if (!scopeEl || !this.document.contains(scopeEl) || !this.isOpenComplaintScope(scopeEl)) {
            return false;
        }

        let element = scopeEl;
        while (element && element !== this.document.body) {
            const ariaHidden = element.getAttribute?.('aria-hidden');
            if (ariaHidden === 'true') {
                return false;
            }
            if (ariaHidden === 'false') {
                return true;
            }
            element = element.parentElement;
        }

        return true;
    }

    isActiveTicketScope(scopeEl) {
        return this.isActiveComplaintScope(scopeEl);
    }

    findActiveComplaintScope() {
        const hiddenFalsePanels = this.document.querySelectorAll('[aria-hidden="false"]');
        for (const panel of hiddenFalsePanels) {
            if (this.isOpenComplaintScope(panel)) {
                return panel;
            }
        }

        const structuralScopes = this.document.querySelectorAll('section, article, main, [role="main"]');
        for (const scope of structuralScopes) {
            if (this.isActiveComplaintScope(scope)) {
                return scope;
            }
        }

        return null;
    }

    findActiveTicketScope() {
        return this.findActiveComplaintScope();
    }

    isSitePunishmentDialogOpen() {
        return Boolean(this.document.querySelector('[role="dialog"][data-state="open"]'));
    }

    isTargetPunishmentDialogOpen(type) {
        const inputSelector = type === 'ban' ? '#ban-steamid64' : '#mute-steamid64';
        return Boolean(this.document.querySelector(`[role="dialog"][data-state="open"] ${inputSelector}`));
    }

    getBlockByHeaderScoped(textMatch, scopeEl) {
        const root = scopeEl || this.document.body;
        const headers = Array.from(root.querySelectorAll('h3'));
        const targetHeader = headers.find(h3 => h3.textContent.includes(textMatch));
        if (!targetHeader) {
            return null;
        }

        let parent = targetHeader.parentElement;
        while (parent && parent !== this.document.body) {
            if (parent.querySelector('table')) {
                return parent;
            }
            parent = parent.parentElement;
        }

        return null;
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

    markOffenderOffline(steamId) {
        if (!steamId) return;
        this.offenderOffline.set(steamId, Date.now() + this.LEFT_OFFENDER_TTL_MS);
    }

    clearOffenderOffline(steamId) {
        if (!steamId) return;
        this.offenderOffline.delete(steamId);
    }

    isOffenderOffline(steamId) {
        if (!steamId) return false;

        const expiresAt = this.offenderOffline.get(steamId);
        if (!expiresAt) return false;

        if (Date.now() >= expiresAt) {
            this.offenderOffline.delete(steamId);
            return false;
        }

        return true;
    }

    markOffenderRelocated(steamId, serverIp) {
        if (!steamId || !serverIp) return;
        this.offenderRelocated.set(steamId, {
            serverIp: String(serverIp).trim().toLowerCase(),
            expiresAt: Date.now() + this.LEFT_OFFENDER_TTL_MS
        });
    }

    clearOffenderRelocated(steamId) {
        if (!steamId) return;
        this.offenderRelocated.delete(steamId);
    }

    getOffenderRelocatedServer(steamId) {
        if (!steamId) return null;

        const entry = this.offenderRelocated.get(steamId);
        if (!entry) return null;

        if (Date.now() >= entry.expiresAt) {
            this.offenderRelocated.delete(steamId);
            return null;
        }

        return entry.serverIp;
    }

    getTicketComplaintParts() {
        const categoryField = this.findInfoFieldByLabels(['Причина жалобы', 'Причина']);
        const valueBlock = this.findFieldValueBlock(categoryField);

        let category = valueBlock?.querySelector(':scope > span')?.textContent?.trim() || '';
        if (!category) {
            category = this.utils.parseComplaintCell(valueBlock || categoryField).category;
        }

        let playerText = this.getTicketPlayerMessageText();
        if (!playerText) {
            playerText = this.utils.parseComplaintCell(valueBlock || categoryField).playerText;
        }

        return {category, playerText};
    }

    getTicketPlayerMessageText() {
        const messageField = this.findInfoFieldByLabels(['Сообщение от пользователя']);
        if (!messageField) {
            return '';
        }

        const paragraph = messageField.querySelector(':scope > p');
        if (paragraph) {
            return paragraph.textContent?.trim() || '';
        }

        const valueBlock = this.findFieldValueBlock(messageField);
        if (valueBlock) {
            return valueBlock.textContent?.trim() || '';
        }

        return '';
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
        const allowedPaths = [
            '/reports/4',
            '/reports/5',
            '/ticket/1',
            '/ticket/2'
        ];
        const isAllowedPage = allowedPaths.some(path => window.location.href.includes(path));
        if (!isAllowedPage) {
            return { allowed: false, reason: 'Не на странице тикета/репорта' };
        }

        if (!this.settings?.features?.autoConnectServer) {
            return {allowed: false, reason: 'Функция отключена'};
        }

        const statusSpan = Array.from(this.document.querySelectorAll('span')).find(
            span => span.textContent.trim() === 'В работе'
        );

        if (!statusSpan) {
            return {allowed: false, reason: "статус 'В работе' не найден"};
        }

        const offenderField = this.findInfoField('Нарушитель');
        const offenderSteamId = this.extractSteamIdFromField(offenderField);
        const relocatedIp = offenderSteamId ? this.getOffenderRelocatedServer(offenderSteamId) : null;
        const ticketConnectLink = this.findTicketServerConnectLink();
        const ticketServerIp = this.extractServerIpFromConnectLink(ticketConnectLink);
        const connectTarget = relocatedIp || ticketServerIp || null;
        const connectSource = relocatedIp ? 'relocated-server' : (ticketServerIp ? 'ticket-server' : null);

        if (offenderSteamId && this.isOffenderOffline(offenderSteamId)) {
            return {
                allowed: false,
                reason: 'нарушитель недавно вышел с сервера',
                debug: {connectTarget, connectSource}
            };
        }

        const category = this.getTicketComplaintCategory();
        const playerText = this.getPlayerComplaintText();
        const allowedReasons = this.settings.autoConnectReasons || ['Читерство', 'Багоюз'];
        const reasonAllowed = allowedReasons.some(reason =>
            category.toLowerCase().includes(String(reason).toLowerCase())
        );
        const triggerAllowed = this.complaintTextMatchesAutoconnectTrigger(playerText);

        if (!reasonAllowed && !triggerAllowed) {
            const playerPreview = playerText ? `${playerText.slice(0, 80)}${playerText.length > 80 ? '…' : ''}` : '(пусто)';
            return {
                allowed: false,
                reason: `причина «${category || 'неизвестна'}» не в списке и триггеры автоподключения не найдены`,
                debug: {category, playerPreview, allowedReasons, connectTarget, connectSource}
            };
        }

        return {
            allowed: true,
            reason: reasonAllowed ? 'причина в списке' : 'найден триггер в тексте жалобы игрока',
            debug: {
                category,
                playerText: playerText?.slice(0, 80),
                allowedReasons,
                connectTarget,
                connectSource
            }
        };
    }

    findTicketServerConnectLink() {
        const serverField = this.findInfoField('Сервер');
        const valueBlock = this.findFieldValueBlock(serverField);
        const scopedLink = valueBlock?.querySelector('a[href^="steam://connect/"]');
        if (scopedLink) {
            return scopedLink;
        }

        for (const link of this.document.querySelectorAll('a[href^="steam://connect/"]')) {
            if (link.closest('table')) {
                continue;
            }
            return link;
        }

        return null;
    }

    extractServerIpFromConnectLink(link) {
        if (!link?.href) {
            return null;
        }

        return link.href.replace(/^steam:\/\/connect\//i, '').trim().toLowerCase() || null;
    }

    connectToSteamServer(serverIp) {
        const normalized = String(serverIp || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        const link = this.document.createElement('a');
        link.href = `steam://connect/${normalized}`;
        link.style.display = 'none';
        this.document.body.appendChild(link);
        link.click();
        link.remove();
        return true;
    }

    connectToCurrentServer() {
        const decision = this.shouldAutoConnectToServer();
        if (!decision.allowed) {
            console.log(`[Helper] Авто-подключение отменено: ${decision.reason}.`, decision.debug || '');
            return;
        }

        const ticketKey = window.location.pathname || window.location.href;
        if (this.document.body.dataset.autoConnectedFor === ticketKey) {
            console.log('[Helper] Авто-подключение уже выполнялось для этого тикета.');
            return;
        }

        const offenderField = this.findInfoField('Нарушитель');
        const offenderSteamId = this.extractSteamIdFromField(offenderField);
        const relocatedIp = offenderSteamId ? this.getOffenderRelocatedServer(offenderSteamId) : null;

        if (relocatedIp) {
            console.log('[Helper] Авто-подключение к серверу переезда:', relocatedIp, decision.debug || '');
            this.document.body.dataset.autoConnectedFor = ticketKey;
            this.connectToSteamServer(relocatedIp);
            return;
        }

        const connectLink = this.findTicketServerConnectLink();
        if (connectLink) {
            console.log('[Helper] Авто-подключение к серверу тикета:', connectLink.href, decision.debug || '');
            this.document.body.dataset.autoConnectedFor = ticketKey;
            connectLink.click();
        } else {
            console.log('[Helper] Ссылка на коннект steam:// не найдена в структуре тикета.', decision.debug || '');
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

    isExtensionUiElement(element) {
        return Boolean(
            element?.closest('.ioh-analysis-row, .ioh-analysis-label, .ioh-analysis-value, #mod-ticket-panel, #helper-suggest-badge, #ioh-ticket-punishment-actions, #ioh-ticket-issue-mute, #ioh-ticket-issue-ban, .ioh-badge-row')
        );
    }

    _isExtensionPunishmentButton(button) {
        return button?.id === this.TICKET_MUTE_BUTTON_ID
            || button?.id === this.TICKET_BAN_BUTTON_ID
            || Boolean(button?.closest(`#${this.TICKET_PUNISHMENT_ACTIONS_ID}`));
    }

    async loadModeratorPermissions() {
        let permissions = null;

        if (this.chrome?.storage?.local) {
            try {
                const result = await this.chrome.storage.local.get(this.MODERATOR_PERMISSIONS_KEY);
                if (result[this.MODERATOR_PERMISSIONS_KEY]) {
                    permissions = result[this.MODERATOR_PERMISSIONS_KEY];
                }
            } catch (error) {
                // ignore storage errors
            }
        }

        if (!permissions) {
            try {
                const sessionRaw = sessionStorage.getItem(this.MODERATOR_PERMISSIONS_KEY);
                if (sessionRaw) {
                    permissions = JSON.parse(sessionRaw);
                }
            } catch (error) {
                // ignore session storage errors
            }
        }

        this.canIssueMute = Boolean(permissions?.mute);
        this.canIssueBan = Boolean(permissions?.ban);
        this._permissionsHydrated = true;
    }

    isPanelReadyForType(type) {
        return type === 'ban' ? this.banPanelReady : this.mutePanelReady;
    }

    resetPanelReady(type) {
        if (type === 'ban') {
            this.banPanelReady = false;
            this._cachedOpenBanHandler = null;
            this._cachedBanIssueButton = null;
            return;
        }

        this.mutePanelReady = false;
        this._cachedOpenMuteHandler = null;
        this._cachedMuteIssueButton = null;
    }

    getCachedIssueButton(type) {
        const button = type === 'ban' ? this._cachedBanIssueButton : this._cachedMuteIssueButton;
        return button?.isConnected ? button : null;
    }

    findSiteIssueButtonForType(type, options = {}) {
        return this.findSiteIssueButtonInSection(
            this.getManagementSectionTitleForType(type),
            options
        );
    }

    resolveIssueButtonForType(type) {
        const sectionTitle = this.getManagementSectionTitleForType(type);
        let button = this.getCachedIssueButton(type)
            ?? this.findSiteIssueButtonForType(type, { requireVisible: false });

        if (!button?.isConnected) {
            button = this.findSiteIssueButtonForType(type, { requireVisible: false });
        }

        if (!button || !this._isButtonInSection(button, sectionTitle)) {
            return null;
        }

        this._cacheIssueHandlerFromButton(button, type);
        return button;
    }

    markPanelReady(type) {
        if (type === 'ban') {
            this.banPanelReady = true;
        } else {
            this.mutePanelReady = true;
        }
    }

    suppressPermissionScan() {
        this._permissionScanSuppressed += 1;
    }

    releasePermissionScan() {
        if (this._permissionScanSuppressed > 0) {
            this._permissionScanSuppressed -= 1;
        }
    }

    _handleManagementPanelVisibilityForScan() {
        const muteActive = this.isMuteManagementPanelActive();
        const banActive = this.isBanManagementPanelActive();

        if (this._permissionScanSuppressed > 0) {
            this._wasMutePanelActive = muteActive;
            this._wasBanPanelActive = banActive;
            return;
        }

        const shouldScan = (muteActive && !this._wasMutePanelActive)
            || (banActive && !this._wasBanPanelActive);

        this._wasMutePanelActive = muteActive;
        this._wasBanPanelActive = banActive;

        if (shouldScan) {
            void this.scanModeratorPunishmentPermissions();
        }
    }

    _cancelPermissionRevoke(type) {
        const timerKey = type === 'ban' ? '_banRevokeDebounceId' : '_muteRevokeDebounceId';
        if (this[timerKey]) {
            clearTimeout(this[timerKey]);
            this[timerKey] = null;
        }
    }

    _schedulePermissionRevoke(type) {
        const timerKey = type === 'ban' ? '_banRevokeDebounceId' : '_muteRevokeDebounceId';
        this._cancelPermissionRevoke(type);
        this[timerKey] = setTimeout(() => {
            this[timerKey] = null;
            void this._tryRevokePermission(type);
        }, 500);
    }

    async _tryRevokePermission(type) {
        if (this._isUpdatingPunishmentButtons) {
            return;
        }

        const panelActive = type === 'ban' ? this.isBanManagementPanelActive() : this.isMuteManagementPanelActive();
        const button = type === 'ban' ? this.findSiteIssueBanButton() : this.findSiteIssueMuteButton();

        if (!panelActive || button) {
            return;
        }

        let changed = false;

        if (type === 'ban' && this.canIssueBan) {
            this.canIssueBan = false;
            this.banPanelReady = false;
            this._cachedOpenBanHandler = null;
            this._cachedBanIssueButton = null;
            changed = true;
        } else if (type === 'mute' && this.canIssueMute) {
            this.canIssueMute = false;
            this.mutePanelReady = false;
            this._cachedOpenMuteHandler = null;
            this._cachedMuteIssueButton = null;
            changed = true;
        }

        if (!changed) {
            return;
        }

        await this._persistModeratorPermissions();
        this.refreshComplaintPunishmentButtons();
    }

    async _persistModeratorPermissions() {
        const permissions = {
            mute: this.canIssueMute,
            ban: this.canIssueBan
        };

        try {
            sessionStorage.setItem(this.MODERATOR_PERMISSIONS_KEY, JSON.stringify(permissions));
        } catch (error) {
            // ignore session storage errors
        }

        if (!this.chrome?.storage?.local) {
            return;
        }

        try {
            await this.chrome.storage.local.set({
                [this.MODERATOR_PERMISSIONS_KEY]: permissions
            });
        } catch (error) {
            // ignore storage errors
        }
    }

    isMuteManagementRoute() {
        return /\/comms\/list\b/i.test(window.location.pathname || '');
    }

    isBanManagementRoute() {
        return /\/bans\/list\b/i.test(window.location.pathname || '');
    }

    getManagementRouteForType(type) {
        return type === 'ban' ? this.BAN_MANAGEMENT_ROUTE : this.MUTE_MANAGEMENT_ROUTE;
    }

    isMuteManagementPanelActive() {
        return this._isManagementPanelVisible('Управление мутами');
    }

    isBanManagementPanelActive() {
        return this._isManagementPanelVisible('Управление банами');
    }

    isMuteManagementPage() {
        return this.isMuteManagementPanelActive();
    }

    isBanManagementPage() {
        return this.isBanManagementPanelActive();
    }

    getManagementSectionTitleForType(type) {
        return type === 'ban' ? 'Управление банами' : 'Управление мутами';
    }

    isManagementPanelActiveForType(type) {
        return type === 'ban' ? this.isBanManagementPanelActive() : this.isMuteManagementPanelActive();
    }

    findSpaTabButton(tabLabel) {
        const glassFxTabs = Array.from(this.document.querySelectorAll('nav button.glass-fx, nav button[class*="glass-fx"]'));

        for (const button of glassFxTabs) {
            if (this.isExtensionUiElement(button)) {
                continue;
            }

            const spans = Array.from(button.querySelectorAll('span'));
            if (spans.some(span => span.textContent.trim() === tabLabel)) {
                return button;
            }
        }

        return Array.from(this.document.querySelectorAll('nav button')).find(button => {
            if (this.isExtensionUiElement(button)) {
                return false;
            }

            return Array.from(button.querySelectorAll('span'))
                .some(span => span.textContent.trim() === tabLabel);
        }) || null;
    }

    findActiveSpaTabLabel() {
        const currentTab = Array.from(this.document.querySelectorAll('nav button.glass-fx, nav button[class*="glass-fx"]'))
            .find(button => !this.isExtensionUiElement(button) && button.getAttribute('aria-current') === 'page');

        if (currentTab) {
            const labelSpan = Array.from(currentTab.querySelectorAll('span'))
                .find(span => span.textContent.trim());
            if (labelSpan) {
                return labelSpan.textContent.trim();
            }
        }

        const headerTitle = this.document.querySelector('header span');
        if (headerTitle && !this.isExtensionUiElement(headerTitle)) {
            const text = headerTitle.textContent.trim();
            if (text) {
                return text;
            }
        }

        return null;
    }

    isSpaTabActive(tabLabel) {
        if (!tabLabel) {
            return false;
        }

        const tab = this.findSpaTabButton(tabLabel);
        if (tab?.getAttribute('aria-current') === 'page') {
            return true;
        }

        const headerTitle = this.document.querySelector('header span');
        if (headerTitle && !this.isExtensionUiElement(headerTitle)) {
            return headerTitle.textContent.trim() === tabLabel;
        }

        return false;
    }

    waitForSpaTabActive(tabLabel, timeoutMs = 3000) {
        if (this.isSpaTabActive(tabLabel)) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const observer = new MutationObserver(() => {
                if (this.isSpaTabActive(tabLabel)) {
                    observer.disconnect();
                    resolve(true);
                } else if (Date.now() > deadline) {
                    observer.disconnect();
                    resolve(false);
                }
            });

            observer.observe(this.document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-current', 'aria-hidden', 'class']
            });

            setTimeout(() => {
                observer.disconnect();
                resolve(this.isSpaTabActive(tabLabel));
            }, timeoutMs + 50);
        });
    }

    dispatchElementClick(element) {
        if (!element) {
            return false;
        }

        const handler = this.extractReactClickHandler(element);
        const event = {
            preventDefault() {},
            stopPropagation() {},
            nativeEvent: new MouseEvent('click', {bubbles: true}),
            currentTarget: element,
            target: element
        };

        if (typeof handler === 'function') {
            try {
                handler(event);
                return true;
            } catch (error) {
                // fall through to native click
            }
        }

        try {
            element.click();
            return true;
        } catch (error) {
            return false;
        }
    }

    waitForPanelActive(sectionTitle, timeoutMs = 3000) {
        if (this._isManagementPanelVisible(sectionTitle)) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const observer = new MutationObserver(() => {
                if (this._isManagementPanelVisible(sectionTitle)) {
                    observer.disconnect();
                    resolve(true);
                } else if (Date.now() > deadline) {
                    observer.disconnect();
                    resolve(false);
                }
            });

            observer.observe(this.document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-hidden', 'class', 'style']
            });

            setTimeout(() => {
                observer.disconnect();
                resolve(this._isManagementPanelVisible(sectionTitle));
            }, timeoutMs + 50);
        });
    }

    async activateManagementPanel(type) {
        const sectionTitle = this.getManagementSectionTitleForType(type);

        if (this.isManagementPanelActiveForType(type)) {
            return true;
        }

        const tab = this.findSpaTabButton(sectionTitle);
        if (!tab) {
            return false;
        }

        if (!this.dispatchElementClick(tab)) {
            return false;
        }

        const activated = await this.waitForPanelActive(sectionTitle, 3000);
        if (!activated) {
            return false;
        }

        const route = this.getManagementRouteForType(type);
        const routePattern = route.replace(/^\//, '');
        if (!window.location.pathname.includes(routePattern)) {
            const targetUrl = `${window.location.origin}${route}`;
            window.history.pushState(null, '', targetUrl);
        }

        return true;
    }

    _isManagementPanelVisible(sectionTitle) {
        const headers = Array.from(this.document.querySelectorAll('span, h1, h2, h3'))
            .filter(element => (
                !this.isExtensionUiElement(element)
                && element.textContent.trim() === sectionTitle
            ));

        for (const header of headers) {
            let element = header;
            while (element && element !== this.document.body) {
                const ariaHidden = element.getAttribute?.('aria-hidden');
                if (ariaHidden === 'true') {
                    break;
                }
                if (ariaHidden === 'false') {
                    return true;
                }
                element = element.parentElement;
            }
        }

        return false;
    }

    _getManagementPanelRoot(header) {
        let element = header.parentElement;
        while (element && element !== this.document.body) {
            if (element.hasAttribute?.('aria-hidden')) {
                return element;
            }
            element = element.parentElement;
        }

        return null;
    }

    _isButtonInSection(button, sectionTitle) {
        if (!button) {
            return false;
        }

        const headers = Array.from(this.document.querySelectorAll('span, h1, h2, h3'))
            .filter(element => (
                !this.isExtensionUiElement(element)
                && element.textContent.trim() === sectionTitle
            ));

        for (const header of headers) {
            const panelRoot = this._getManagementPanelRoot(header);
            if (panelRoot?.contains(button)) {
                return true;
            }
        }

        return false;
    }

    _isHeaderInVisiblePanel(header) {
        let element = header;
        while (element && element !== this.document.body) {
            const ariaHidden = element.getAttribute?.('aria-hidden');
            if (ariaHidden === 'true') {
                return false;
            }
            if (ariaHidden === 'false') {
                return true;
            }
            element = element.parentElement;
        }

        return false;
    }

    findSiteIssueButtonInSection(sectionTitle, { requireVisible = true } = {}) {
        const headers = Array.from(this.document.querySelectorAll('span, h1, h2, h3'))
            .filter(element => !this.isExtensionUiElement(element) && element.textContent.trim() === sectionTitle);

        for (const header of headers) {
            if (requireVisible && !this._isHeaderInVisiblePanel(header)) {
                continue;
            }

            const panelRoot = this._getManagementPanelRoot(header);
            if (!panelRoot) {
                continue;
            }

            const button = Array.from(panelRoot.querySelectorAll('button')).find(candidate => (
                !this._isExtensionPunishmentButton(candidate)
                && candidate.textContent.trim() === 'Выдать блокировку'
            ));
            if (button) {
                return button;
            }
        }

        return null;
    }

    findSiteIssueMuteButton() {
        return this.findSiteIssueButtonInSection('Управление мутами');
    }

    findSiteIssueBanButton() {
        return this.findSiteIssueButtonInSection('Управление банами');
    }

    extractReactClickHandler(element) {
        if (!element) {
            return null;
        }

        const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
        if (propsKey && typeof element[propsKey]?.onClick === 'function') {
            return element[propsKey].onClick;
        }

        const fiberKey = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
        let fiber = fiberKey ? element[fiberKey] : null;
        while (fiber) {
            if (typeof fiber.memoizedProps?.onClick === 'function') {
                return fiber.memoizedProps.onClick;
            }
            if (typeof fiber.pendingProps?.onClick === 'function') {
                return fiber.pendingProps.onClick;
            }
            fiber = fiber.return;
        }

        return null;
    }

    _cacheIssueHandlerFromButton(button, type) {
        const sectionTitle = type === 'ban' ? 'Управление банами' : 'Управление мутами';
        if (!this._isButtonInSection(button, sectionTitle)) {
            return;
        }

        const handler = this.extractReactClickHandler(button);
        if (typeof handler !== 'function') {
            return;
        }

        if (type === 'ban') {
            this._cachedOpenBanHandler = handler;
            this._cachedBanIssueButton = button;
            return;
        }

        this._cachedOpenMuteHandler = handler;
        this._cachedMuteIssueButton = button;
    }

    async scanModeratorPunishmentPermissions() {
        if (this._isUpdatingPunishmentButtons || this._permissionScanSuppressed > 0) {
            return;
        }

        const mutePanelActive = this.isMuteManagementPanelActive();
        const banPanelActive = this.isBanManagementPanelActive();

        if (!mutePanelActive && !banPanelActive) {
            return;
        }

        let changed = false;

        if (mutePanelActive) {
            const muteButton = this.findSiteIssueMuteButton();

            if (muteButton) {
                this._cancelPermissionRevoke('mute');
                this._cacheIssueHandlerFromButton(muteButton, 'mute');
                if (!this.canIssueMute) {
                    this.canIssueMute = true;
                    changed = true;
                }
            } else if (this.canIssueMute) {
                this._schedulePermissionRevoke('mute');
            }
        }

        if (banPanelActive) {
            const banButton = this.findSiteIssueBanButton();

            if (banButton) {
                this._cancelPermissionRevoke('ban');
                this._cacheIssueHandlerFromButton(banButton, 'ban');
                if (!this.canIssueBan) {
                    this.canIssueBan = true;
                    changed = true;
                }
            } else if (this.canIssueBan) {
                this._schedulePermissionRevoke('ban');
            }
        }

        if (changed) {
            await this._persistModeratorPermissions();
            this.refreshComplaintPunishmentButtons();
        }
    }

    initMuteIssueFeature() {
        if (this._punishmentPermissionObserver) {
            return;
        }

        this.loadModeratorPermissions().then(() => {
            this.refreshComplaintPunishmentButtons();
            setTimeout(() => this.refreshComplaintPunishmentButtons(), 500);
        });

        this._wasMutePanelActive = this.isMuteManagementPanelActive();
        this._wasBanPanelActive = this.isBanManagementPanelActive();
        this.scanModeratorPunishmentPermissions();

        this._punishmentPermissionObserver = new MutationObserver(() => {
            if (this._punishmentPermissionDebounceId) {
                clearTimeout(this._punishmentPermissionDebounceId);
            }

            this._punishmentPermissionDebounceId = setTimeout(() => {
                this._punishmentPermissionDebounceId = null;
                this._handleManagementPanelVisibilityForScan();
            }, 150);
        });

        this._punishmentPermissionObserver.observe(this.document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-hidden', 'class', 'style']
        });
    }

    teardownMuteIssueFeature() {
        if (this._punishmentPermissionDebounceId) {
            clearTimeout(this._punishmentPermissionDebounceId);
            this._punishmentPermissionDebounceId = null;
        }

        this._cancelPermissionRevoke('mute');
        this._cancelPermissionRevoke('ban');

        this._punishmentPermissionObserver?.disconnect();
        this._punishmentPermissionObserver = null;
    }

    findCloseTicketButton(scopeEl) {
        const root = scopeEl || this.document.body;
        return Array.from(root.querySelectorAll('button')).find(
            button => button.textContent.trim() === 'Закрыть тикет'
        ) || null;
    }

    findPunishmentInsertPoint(scopeEl) {
        const root = scopeEl || this.document.body;
        const closeButton = this.findCloseTicketButton(root);
        if (closeButton?.parentNode) {
            return {parent: closeButton.parentNode, before: closeButton};
        }

        const backButton = Array.from(root.querySelectorAll('button')).find(
            button => button.textContent.trim().includes('Вернуться назад')
        );
        if (backButton?.parentNode) {
            return {parent: backButton.parentNode, before: backButton};
        }

        const actionRow = root.querySelector('.sc-jcEreA');
        if (actionRow) {
            return {parent: actionRow, before: null};
        }

        return {parent: root, before: null};
    }

    createPunishmentActionsContainer() {
        let container = this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
        if (container) {
            return container;
        }

        container = this.document.createElement('div');
        container.id = this.TICKET_PUNISHMENT_ACTIONS_ID;
        container.className = 'ioh-ticket-punishment-actions';

        const muteButton = this.document.createElement('button');
        muteButton.id = this.TICKET_MUTE_BUTTON_ID;
        muteButton.type = 'button';
        muteButton.textContent = 'Выдать мут';
        muteButton.className = 'ioh-ticket-issue-mute';
        muteButton.addEventListener('click', this.handleTicketMuteButtonClick);

        const banButton = this.document.createElement('button');
        banButton.id = this.TICKET_BAN_BUTTON_ID;
        banButton.type = 'button';
        banButton.textContent = 'Выдать бан';
        banButton.className = 'ioh-ticket-issue-ban';
        banButton.addEventListener('click', this.handleTicketBanButtonClick);

        container.append(muteButton, banButton);
        return container;
    }

    _ensurePunishmentActionsPlacement(scope) {
        const insertPoint = this.findPunishmentInsertPoint(scope);
        if (!insertPoint?.parent) {
            return false;
        }

        const container = this.createPunishmentActionsContainer();
        if (insertPoint.before) {
            if (container.parentNode !== insertPoint.parent || container.nextElementSibling !== insertPoint.before) {
                insertPoint.parent.insertBefore(container, insertPoint.before);
            }
        } else if (container.parentNode !== insertPoint.parent) {
            insertPoint.parent.appendChild(container);
        }

        this._lastPunishmentScope = scope;
        return true;
    }

    shouldShowTicketMuteButton(scope) {
        if (!this._permissionsHydrated || !this.canIssueMute) {
            return false;
        }

        if (!scope || !this.isOpenComplaintScope(scope)) {
            return false;
        }

        const muteHistoryBlock = this.getBlockByHeaderScoped('История Мутов', scope);
        if (muteHistoryBlock && this.hasActiveMute(muteHistoryBlock)) {
            return false;
        }

        return true;
    }

    shouldShowTicketBanButton(scope) {
        if (!this._permissionsHydrated || !this.canIssueBan) {
            return false;
        }

        return Boolean(scope && this.isOpenComplaintScope(scope));
    }

    _applyPunishmentButtonsVisibility(scope) {
        const container = this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
        if (!container) {
            return;
        }

        const muteButton = this.document.getElementById(this.TICKET_MUTE_BUTTON_ID);
        const banButton = this.document.getElementById(this.TICKET_BAN_BUTTON_ID);
        const showMute = this.shouldShowTicketMuteButton(scope);
        const showBan = this.shouldShowTicketBanButton(scope);

        if (!showMute && !showBan) {
            container.style.display = 'none';
            return;
        }

        container.style.display = '';
        if (muteButton) {
            muteButton.style.display = showMute ? '' : 'none';
        }
        if (banButton) {
            banButton.style.display = showBan ? '' : 'none';
        }
    }

    updateTicketPunishmentButtons() {
        if (!this.isComplaintPage()) {
            return;
        }

        if (this.isSitePunishmentDialogOpen() && this._lastPunishmentScope?.isConnected) {
            this._applyPunishmentButtonsVisibility(this._lastPunishmentScope);
            return;
        }

        const scope = this.findActiveComplaintScope() || (
            this._lastPunishmentScope?.isConnected ? this._lastPunishmentScope : null
        );
        const hasPermissions = this.canIssueMute || this.canIssueBan;

        if (!scope) {
            if (!hasPermissions && !this.isSitePunishmentDialogOpen()) {
                const container = this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
                if (container) {
                    container.style.display = 'none';
                }
            }
            return;
        }

        this._isUpdatingPunishmentButtons = true;
        try {
            if (!this._ensurePunishmentActionsPlacement(scope)) {
                return;
            }

            this._applyPunishmentButtonsVisibility(scope);
        } finally {
            this._isUpdatingPunishmentButtons = false;
        }
    }

    ensureTicketPunishmentButtons() {
        this.updateTicketPunishmentButtons();
    }

    refreshComplaintPunishmentButtons() {
        if (!this.isComplaintPage()) {
            return;
        }

        this.updateTicketPunishmentButtons();
    }

    refreshTicketPunishmentButtons() {
        this.refreshComplaintPunishmentButtons();
    }

    clearTicketPunishmentButtons() {
        this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID)?.remove();
        this._lastPunishmentScope = null;
    }

    teardownTicketPunishmentButtons() {
        this.clearTicketPunishmentButtons();
    }

    getOffenderSteamIdForScope(scope) {
        const offenderField = this.findInfoFieldScoped('Нарушитель', scope);
        return this.extractSteamIdFromField(offenderField);
    }

    getActivePunishmentScope() {
        return this.findActiveComplaintScope() || this._lastPunishmentScope;
    }

    handleTicketMuteButtonClick() {
        const scope = this.getActivePunishmentScope();
        const steamId = this.getOffenderSteamIdForScope(scope);
        void this.openSiteMuteForm(steamId);
    }

    handleTicketBanButtonClick() {
        const scope = this.getActivePunishmentScope();
        const steamId = this.getOffenderSteamIdForScope(scope);
        void this.openSiteBanForm(steamId);
    }

    _invokeCachedSiteHandler(handler, type) {
        if (typeof handler !== 'function') {
            return false;
        }

        try {
            handler({
                preventDefault() {},
                stopPropagation() {},
                nativeEvent: new MouseEvent('click'),
                currentTarget: null,
                target: null
            });
            return true;
        } catch (error) {
            console.warn(`[IO Helper] Не удалось открыть форму ${type}:`, error);
            if (type === 'ban') {
                this._cachedOpenBanHandler = null;
            } else {
                this._cachedOpenMuteHandler = null;
            }
            return false;
        }
    }

    openSiteMuteForm(steamId) {
        return this.punishmentBridge.openMuteForm(steamId);
    }

    openSiteBanForm(steamId) {
        return this.punishmentBridge.openBanForm(steamId);
    }

    prefillMuteFormSteamId(steamId) {
        this._prefillPunishmentFormSteamId(steamId, '#mute-steamid64');
    }

    prefillBanFormSteamId(steamId) {
        this._prefillPunishmentFormSteamId(steamId, '#ban-steamid64');
    }

    _prefillPunishmentFormSteamId(steamId, inputSelector) {
        if (!steamId) {
            return;
        }

        const applyValue = (input) => {
            if (!input) {
                return false;
            }

            if (input.value !== steamId) {
                input.value = steamId;
                input.dispatchEvent(new Event('input', {bubbles: true}));
                input.dispatchEvent(new Event('change', {bubbles: true}));
            }

            return true;
        };

        const existingInput = this.document.querySelector(`[role="dialog"] ${inputSelector}`);
        if (applyValue(existingInput)) {
            return;
        }

        const deadline = Date.now() + 2000;
        const observer = new MutationObserver(() => {
            const input = this.document.querySelector(`[role="dialog"] ${inputSelector}`);
            if (applyValue(input)) {
                observer.disconnect();
                return;
            }

            if (Date.now() > deadline) {
                observer.disconnect();
            }
        });

        observer.observe(this.document.body, {childList: true, subtree: true});
        setTimeout(() => observer.disconnect(), 2100);
    }

    findInfoFieldScoped(labelText, scopeEl) {
        const root = scopeEl || this.document.body;
        const label = Array.from(root.querySelectorAll('span, div'))
            .find(element => !this.isExtensionUiElement(element) && element.textContent.trim() === labelText);

        return label?.parentElement || null;
    }

    findInfoField(labelText) {
        const label = Array.from(this.document.querySelectorAll('span, div'))
            .find(element => !this.isExtensionUiElement(element) && element.textContent.trim() === labelText);

        return label?.parentElement || null;
    }

    findInfoFieldByLabels(labelTexts) {
        for (const labelText of labelTexts) {
            const field = this.findInfoField(labelText);
            if (field) {
                return field;
            }
        }

        return null;
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

    extractServerLabel(result) {
        const server = result?.server;
        if (!server) {
            return null;
        }

        const parts = [];
        if (server.mode) {
            parts.push(String(server.mode));
        }
        if (server.category) {
            parts.push(String(server.category));
        }
        if (server.num != null && server.num !== '') {
            parts.push(`#${server.num}`);
        }

        return parts.length ? parts.join(' ') : null;
    }

    extractBansList(result) {
        const candidates = [
            result?.basic?.bans_list,
            result?.bans_list,
            result?.cybershoke?.bans_list
        ];

        for (const list of candidates) {
            if (Array.isArray(list) && list.length) {
                return list;
            }
        }

        return [];
    }

    isBanActive(ban) {
        if (Number(ban?.type) !== 4) {
            return false;
        }

        const now = Math.floor(Date.now() / 1000);
        const end = Number(ban?.end);
        const created = Number(ban?.created);
        const length = Number(ban?.length);

        if (Number.isFinite(end) && end > now) {
            return true;
        }

        if (Number.isFinite(created) && Number.isFinite(length) && length > 0 && created + length > now) {
            return true;
        }

        return false;
    }

    extractActiveBan(result) {
        const bans = this.extractBansList(result);
        if (!bans.length) {
            return false;
        }

        return bans.some(ban => this.isBanActive(ban));
    }

    extractServerIpFromUserData(result) {
        if (result?.server?.server_ip && result?.server?.server_port) {
            return `${result.server.server_ip}:${result.server.server_port}`.toLowerCase();
        }

        return null;
    }

    extractLastConnect(result) {
        const raw = result?.cybershoke?.global?.lastconnect;
        if (raw == null || raw === '') {
            return null;
        }

        const seconds = Number(raw);
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    }

    parseUserDataResult(result) {
        return {
            serverIp: this.extractServerIpFromUserData(result),
            lastconnect: this.extractLastConnect(result),
            serverLabel: this.extractServerLabel(result),
            isBanned: this.extractActiveBan(result)
        };
    }

    getCachedUserData(steamId, ttlMs = 5000) {
        const entry = this.userDataCache.get(steamId);
        if (!entry) {
            return null;
        }

        if (Date.now() - entry.fetchedAt >= ttlMs) {
            this.userDataCache.delete(steamId);
            return null;
        }

        return entry;
    }

    setCachedUserData(steamId, data) {
        this.userDataCache.set(steamId, {
            serverIp: data.serverIp ?? null,
            lastconnect: data.lastconnect ?? null,
            serverLabel: data.serverLabel ?? null,
            isBanned: Boolean(data.isBanned),
            fetchedAt: Date.now()
        });
    }

    getServerLinkLabelElement(link) {
        return link.querySelector(':scope > span') || link.querySelector('span');
    }

    ensureServerLinkOriginalIp(link) {
        if (link.dataset.iohOriginalServerIp) {
            return link.dataset.iohOriginalServerIp;
        }

        const ip = link.href.replace(/^steam:\/\/connect\//i, '').trim().toLowerCase();
        link.dataset.iohOriginalServerIp = ip;
        return ip;
    }

    ensureServerLinkOriginalText(link) {
        if (link.dataset.iohOriginalServerText) {
            return link.dataset.iohOriginalServerText;
        }

        const labelEl = this.getServerLinkLabelElement(link);
        const originalText = labelEl?.textContent?.trim() || link.textContent?.trim() || '';
        link.dataset.iohOriginalServerText = originalText;
        return originalText;
    }

    updateServerLinkDisplay(link, {status, lastconnect = null, currentIp = null, serverLabel = null}) {
        if (!link) {
            return;
        }

        link.classList.remove('ioh-server-online', 'ioh-server-offline', 'ioh-server-other');
        const originalText = this.ensureServerLinkOriginalText(link);
        const labelEl = this.getServerLinkLabelElement(link);

        const setLabelText = (text) => {
            if (labelEl) {
                labelEl.textContent = text;
            } else {
                link.textContent = text;
            }
        };

        if (status === 'offline') {
            link.classList.add('ioh-server-offline');
            setLabelText(this.utils.formatLastConnectStatus(lastconnect));
            return;
        }

        if (status === 'online') {
            link.classList.add('ioh-server-online');
            setLabelText(originalText);
            const originalIp = link.dataset.iohOriginalServerIp;
            if (originalIp) {
                link.href = `steam://connect/${originalIp}`;
            }
            return;
        }

        if (status === 'other') {
            link.classList.add('ioh-server-other');
            const displayText = serverLabel || currentIp || originalText;
            setLabelText(displayText);
            if (currentIp) {
                link.href = `steam://connect/${currentIp}`;
            }
        }
    }

    applyOffenderBanHighlight(row, isBanned) {
        if (!row) {
            return;
        }

        row.classList.toggle('ioh-highlighted-banned', Boolean(isBanned));
    }

    async fetchUserData(steamId) {
        const response = await fetch('https://cybershoke.net/api/user/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'include',
            body: new URLSearchParams({steamid64: steamId}).toString()
        });

        return response;
    }

    applyOffenderServerStatus(linkToUpdate, targetSteamId, targetIp, userData) {
        if (!linkToUpdate) {
            return;
        }

        const currentIp = userData.serverIp;
        const lastconnect = userData.lastconnect;

        if (!currentIp) {
            this.updateServerLinkDisplay(linkToUpdate, {status: 'offline', lastconnect});
            this.markOffenderOffline(targetSteamId);
            this.clearOffenderRelocated(targetSteamId);
            return;
        }

        if (currentIp === targetIp) {
            this.updateServerLinkDisplay(linkToUpdate, {status: 'online', currentIp});
            this.clearOffenderOffline(targetSteamId);
            this.clearOffenderRelocated(targetSteamId);
            return;
        }

        this.updateServerLinkDisplay(linkToUpdate, {
            status: 'other',
            currentIp,
            serverLabel: userData.serverLabel
        });
        this.markOffenderRelocated(targetSteamId, currentIp);
        this.clearOffenderOffline(targetSteamId);
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

                    const ticketServerIp = this.ensureServerLinkOriginalIp(serverIpLink);

                    const steamIdMatch = offenderLink.href.match(/\d{17,18}/);
                    if (!steamIdMatch) continue;

                    const lastCheck = parseInt(row.dataset.lastIpCheck || '0');

                    if (now - lastCheck < CACHE_INTERVAL) continue;

                    if (lastCheck === 0) {
                        targetRow = row;
                        targetIp = ticketServerIp;
                        targetSteamId = steamIdMatch[0];
                        break;
                    }

                    if (lastCheck < oldestCheck) {
                        oldestCheck = lastCheck;
                        targetRow = row;
                        targetIp = ticketServerIp;
                        targetSteamId = steamIdMatch[0];
                    }
                }

                if (!targetRow) break;

                targetRow.dataset.lastIpCheck = Date.now().toString();

                let userData = this.getCachedUserData(targetSteamId, CACHE_INTERVAL);
                if (!userData) {
                    await new Promise(resolve => setTimeout(resolve, 334));

                    const response = await this.fetchUserData(targetSteamId);

                    if (response.status === 429) {
                        this.globalServerCooldown = Date.now() + 2000;
                        break;
                    }

                    if (!response.ok) {
                        continue;
                    }

                    const result = await response.json();
                    userData = this.parseUserDataResult(result);
                    this.setCachedUserData(targetSteamId, userData);
                }

                const linkToUpdate = targetRow.querySelector('td:nth-child(2) a[href^="steam://connect/"]');
                this.applyOffenderServerStatus(linkToUpdate, targetSteamId, targetIp, userData);
                this.applyOffenderBanHighlight(targetRow, userData.isBanned);
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
        if (!this.isVisibleTicketTextarea(textarea)) {
            return;
        }

        const scope = this.getTicketScopeRoot(textarea);
        const analysisIcons = this.getAnalysisIcons();
        const triggers = analysisIcons.triggers;
        const reason = analysisIcons.reason;
        const punishment = analysisIcons.punishment;
        const chatError = analysisIcons.chatError;
        const shield = analysisIcons.shield;

        if (this.settings?.features?.autoConnectServer) {
            this.connectToCurrentServer();
        }

        const muteHistoryBlock = this.getBlockByHeaderScoped('История Мутов', scope);
        const chatHistoryBlock = this.getBlockByHeaderScoped('История Чата', scope);

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

