export const AutoConnectMethods = {
    clearAutoConnectedServers() {
        this.autoConnectedServerIps.clear();
        this._autoConnectSkipLoggedIps.clear();
        delete this.document.body.dataset.autoConnected;
        delete this.document.body.dataset.autoConnectedFor;
    },

    getAutoConnectTicketKey() {
        const scope = this.getAutoConnectScope();
        if (!scope || !this.isActiveComplaintScope(scope)) {
            return null;
        }

        const offenderId = this.extractSteamIdFromField(
            this.findInfoFieldScoped('Нарушитель', scope)
        ) || 'unknown';
        const path = window.location.pathname || window.location.href;
        return `${path}|${offenderId}`;
    },

    hasRecentlyAutoConnected(serverIp) {
        const normalized = String(serverIp || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        const expiresAt = this.autoConnectedServerIps.get(normalized);
        if (!expiresAt) {
            return false;
        }

        if (Date.now() >= expiresAt) {
            this.autoConnectedServerIps.delete(normalized);
            this._autoConnectSkipLoggedIps.delete(normalized);
            return false;
        }

        return true;
    },

    markAutoConnected(serverIp) {
        const normalized = String(serverIp || '').trim().toLowerCase();
        if (!normalized) {
            return;
        }

        this.autoConnectedServerIps.set(normalized, Date.now() + this.LEFT_OFFENDER_TTL_MS);
        this._autoConnectSkipLoggedIps.delete(normalized);
        this.document.body.dataset.autoConnectedFor = normalized;
    },

    logAutoConnectSkipOnce(serverIp, message, debug = null) {
        const normalized = String(serverIp || '').trim().toLowerCase() || '_none';
        if (this._autoConnectSkipLoggedIps.has(normalized)) {
            return;
        }

        this._autoConnectSkipLoggedIps.add(normalized);
        if (debug !== null && debug !== undefined && debug !== '') {
            console.log(message, debug);
        } else {
            console.log(message);
        }
    },

    markOffenderOffline(steamId) {
        if (!steamId) return;
        this.offenderOffline.set(steamId, Date.now() + this.LEFT_OFFENDER_TTL_MS);
    },

    clearOffenderOffline(steamId) {
        if (!steamId) return;
        this.offenderOffline.delete(steamId);
    },

    isOffenderOffline(steamId) {
        if (!steamId) return false;

        const expiresAt = this.offenderOffline.get(steamId);
        if (!expiresAt) return false;

        if (Date.now() >= expiresAt) {
            this.offenderOffline.delete(steamId);
            return false;
        }

        return true;
    },

    markOffenderRelocated(steamId, serverIp) {
        if (!steamId || !serverIp) return;
        this.offenderRelocated.set(steamId, {
            serverIp: String(serverIp).trim().toLowerCase(),
            expiresAt: Date.now() + this.LEFT_OFFENDER_TTL_MS
        });
    },

    clearOffenderRelocated(steamId) {
        if (!steamId) return;
        this.offenderRelocated.delete(steamId);
    },

    getOffenderRelocatedServer(steamId) {
        if (!steamId) return null;

        const entry = this.offenderRelocated.get(steamId);
        if (!entry) return null;

        if (Date.now() >= entry.expiresAt) {
            this.offenderRelocated.delete(steamId);
            return null;
        }

        return entry.serverIp;
    },

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
    },

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
    },

    getTicketComplaintCategory() {
        return this.getTicketComplaintParts().category;
    },

    getPlayerComplaintText() {
        return this.getTicketComplaintParts().playerText;
    },

    complaintTextMatchesAutoconnectTrigger(text) {
        const haystack = String(text || '').toLowerCase();
        if (!haystack) return false;

        return (this.settings.reasonTriggersAutoconnect || []).some(trigger => {
            if (!trigger) return false;
            return haystack.includes(String(trigger).toLowerCase());
        });
    },

    isVoiceFallbackCategory(category) {
        const reasons = this.settings.autoConnectVoiceFallbackReasons
            || ['Нарушение правил', 'Спам', 'Попрошайничество'];
        const haystack = String(category || '').toLowerCase();
        if (!haystack) {
            return false;
        }

        return reasons.some(reason => haystack.includes(String(reason).toLowerCase()));
    },

    getAutoConnectScope() {
        const visibleTextarea = this.findVisibleTicketResolutionTextarea();
        if (visibleTextarea) {
            return this.getTicketScopeRoot(visibleTextarea);
        }

        return this.findActiveComplaintScope();
    },

    scopeHasInProgressStatus(scope) {
        if (!scope) {
            return false;
        }

        const roots = [scope];
        const activePanel = this.findActiveComplaintScope();
        if (activePanel && activePanel !== scope) {
            roots.push(activePanel);
        }

        for (const root of roots) {
            const found = Array.from(root.querySelectorAll('span')).some(span => {
                if (span.textContent.trim() !== 'В работе') {
                    return false;
                }

                let element = span.parentElement;
                while (element && element !== root) {
                    if (element.getAttribute?.('aria-hidden') === 'true') {
                        return false;
                    }
                    element = element.parentElement;
                }

                return true;
            });

            if (found) {
                return true;
            }
        }

        return false;
    },

    shouldAutoConnectToServer({analysisFallback = false} = {}) {
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

        const scope = this.getAutoConnectScope();
        if (!scope || !this.isActiveComplaintScope(scope)) {
            return {allowed: false, reason: 'активный тикет не найден'};
        }

        if (!this.scopeHasInProgressStatus(scope)) {
            return {allowed: false, reason: "статус 'В работе' не найден в активном тикете"};
        }

        const offenderField = this.findInfoFieldScoped('Нарушитель', scope);
        const offenderSteamId = this.extractSteamIdFromField(offenderField);
        const relocatedIp = offenderSteamId ? this.getOffenderRelocatedServer(offenderSteamId) : null;
        const ticketConnectLink = this.findTicketServerConnectLink(scope);
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

        if (analysisFallback) {
            return {
                allowed: true,
                reason: 'voice-fallback после анализа чата',
                debug: {category, analysisFallback: true, connectTarget, connectSource}
            };
        }

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
    },

    findTicketServerConnectLink(scope = null) {
        const root = scope || this.getAutoConnectScope() || this.document;
        const serverField = this.findInfoFieldScoped('Сервер', root);
        const valueBlock = this.findFieldValueBlock(serverField);
        const scopedLink = valueBlock?.querySelector('a[href^="steam://connect/"]');
        if (scopedLink) {
            return scopedLink;
        }

        for (const link of root.querySelectorAll('a[href^="steam://connect/"]')) {
            if (link.closest('table')) {
                continue;
            }
            return link;
        }

        return null;
    },

    extractServerIpFromConnectLink(link) {
        if (!link?.href) {
            return null;
        }

        return link.href.replace(/^steam:\/\/connect\//i, '').trim().toLowerCase() || null;
    },

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
    },

    connectToRelocatedServerForced() {
        if (!this.settings?.features?.autoConnectServer) {
            console.log('[Helper] Авто-подключение (форс-переезд) отменено: функция отключена');
            return false;
        }

        const scope = this.getAutoConnectScope();
        if (!scope || !this.isActiveComplaintScope(scope)) {
            console.log('[Helper] Авто-подключение (форс-переезд) отменено: активный тикет не найден');
            return false;
        }

        if (!this.scopeHasInProgressStatus(scope)) {
            console.log('[Helper] Авто-подключение (форс-переезд) отменено: статус «В работе» не найден');
            return false;
        }

        const offenderField = this.findInfoFieldScoped('Нарушитель', scope);
        const offenderSteamId = this.extractSteamIdFromField(offenderField);
        const relocatedIp = offenderSteamId ? this.getOffenderRelocatedServer(offenderSteamId) : null;

        if (!relocatedIp) {
            console.log('[Helper] Авто-подключение (форс-переезд) отменено: IP переезда не найден');
            return false;
        }

        console.log('[Helper] Авто-подключение (форс-переезд) к серверу:', relocatedIp);
        this.markAutoConnected(relocatedIp);
        this.connectToSteamServer(relocatedIp);
        return true;
    },

    connectToCurrentServer({forceRelocate = false, analysisFallback = false} = {}) {
        if (forceRelocate) {
            return this.connectToRelocatedServerForced();
        }

        const logPrefix = analysisFallback
            ? '[Helper] Авто-подключение (voice-fallback)'
            : '[Helper] Авто-подключение';
        const decision = this.shouldAutoConnectToServer({analysisFallback});
        if (!decision.allowed) {
            console.log(`${logPrefix} отменено: ${decision.reason}.`, decision.debug || '');
            return false;
        }

        const scope = this.getAutoConnectScope();
        const offenderField = this.findInfoFieldScoped('Нарушитель', scope);
        const offenderSteamId = this.extractSteamIdFromField(offenderField);
        const relocatedIp = offenderSteamId ? this.getOffenderRelocatedServer(offenderSteamId) : null;
        const connectLink = relocatedIp ? null : this.findTicketServerConnectLink(scope);
        const connectTarget = (relocatedIp || this.extractServerIpFromConnectLink(connectLink) || '').toLowerCase();

        if (connectTarget && this.hasRecentlyAutoConnected(connectTarget)) {
            this.logAutoConnectSkipOnce(
                connectTarget,
                `${logPrefix} уже выполнялось для сервера (TTL 8 мин): ${connectTarget}`
            );
            return false;
        }

        if (relocatedIp) {
            console.log(`${logPrefix} к серверу переезда:`, relocatedIp, decision.debug || '');
            this.markAutoConnected(connectTarget || relocatedIp);
            this.connectToSteamServer(relocatedIp);
            return true;
        }

        if (connectLink) {
            console.log(`${logPrefix} к серверу тикета:`, connectLink.href, decision.debug || '');
            if (connectTarget) {
                this.markAutoConnected(connectTarget);
            }
            connectLink.click();
            return true;
        }

        console.log(`${logPrefix}: ссылка steam:// не найдена в структуре тикета.`, decision.debug || '');
        return false;
    },

    hasActivePunishmentForVoiceFallback(textarea = null) {
        const scope = textarea
            ? this.getTicketScopeRoot(textarea)
            : (this.getAutoConnectScope() || this.document.body);
        const blocks = this.getHistoryBlocks(scope, {force: true});

        if (this.findActivePunishmentRow(blocks.ban)) {
            return 'ban';
        }

        if (this.findActivePunishmentRow(blocks.mute)) {
            return 'mute';
        }

        return null;
    },

    async maybeAutoConnectAfterChatAnalysis(analysisResult, textarea = null) {
        if (!this.settings?.features?.autoConnectServer) {
            return false;
        }

        const category = this.getTicketComplaintCategory();
        if (!this.isVoiceFallbackCategory(category)) {
            return false;
        }

        let kind = analysisResult?.kind;

        // Premature empty/loading: wait for chat DOM to settle, then re-analyze.
        if (kind === 'pending') {
            if (!textarea) {
                return false;
            }

            const settled = await this.waitForSettledChatHistory(textarea);
            if (!settled) {
                console.log('[Helper] Авто-подключение (voice-fallback) отменено: чат ещё не загрузился');
                return false;
            }

            const fresh = await this.processTicketRules(textarea);
            kind = fresh?.kind;
        }

        if (kind !== 'none' && kind !== 'warning') {
            return false;
        }

        const activePunishment = this.hasActivePunishmentForVoiceFallback(textarea);
        if (activePunishment) {
            console.log(
                `[Helper] Авто-подключение (voice-fallback) отменено: у игрока уже есть активный ${activePunishment === 'ban' ? 'бан' : 'мут'}`
            );
            return false;
        }

        console.log('[Helper] Авто-подключение (voice-fallback): анализ', kind, 'причина', category || 'неизвестна');
        return this.connectToCurrentServer({analysisFallback: true});
    },
};
