class App {
    constructor({window, document, chrome, config}) {
        this.window = window;
        this.document = document;
        this.chrome = chrome;
        this.rules = config.muteRules || [];
        this.muteExceptions = config.muteExceptions || {};
        this.templates = config.templates || {};
        this.settings = config.settings;
        this.features = this.settings.features;
        this.reasonTriggers = this.settings.reasonTriggers;
        this.observer = null;
        this.ipTrackTimeoutId = null;
        this.ticketChatHistoryObservers = new Map();
        this.tablesRowsObserver = null;
        this.currentServerModeratorsObserver = null;
        this.currentServerModeratorsDebounceId = null;
        this.ticketInitObserver = null;
        this.ticketInitDebounceId = null;
        this.currentServerSectionObserver = null;
        this.currentServerSectionDebounceId = null;
        this.tableEnhancementsObserver = null;
        this.tableEnhancementsDebounceId = null;
        this.notificationModalObserver = null;
        this.notificationModalDebounceId = null;
        this.navigationWatcherInstalled = false;
        this._lastHref = this.window?.location?.href || '';
        this._lastTicketSectionPath = '';

        this.utils = new Utils({document});
        this.badgeService = new BadgeService({document});
        this.panelService = new PanelService({document});
        this.messageService = new MessageService({
            document,
            utils: this.utils,
            badgeService: this.badgeService,
            settings: this.settings
        });
        this.ticketService = new TicketService({
            document,
            utils: this.utils,
            badgeService: this.badgeService,
            panelService: this.panelService,
            settings: this.settings,
            rules: this.rules,
            muteExceptions: this.muteExceptions
        });
        this.moderatorService = new ModeratorService({document, chrome});
        this.optimizer = new Optimizer({window, disabledTabKeys: ['reports']});
    }

    start() {
        this.chrome.storage.local.get(null, (result) => {});

        this.initSettingsListener();

        fetch(chrome.runtime.getURL("icons/icons.json"))
            .then(r => r.json())
            .then(data => {
                window.Icons = data;
                this.runDOMUpdates();
            });

        this.chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== "local" || !changes.helperSettings) {
                return;
            }

            const settings = changes.helperSettings.newValue || {};

            this.updateSettings(settings);
        });

        this.optimizer.setEnabled(this.features.optimizeSpaTabs);
        this.initNavigationWatcher();
        this.runDOMUpdates();
        this.initTicketMountObserver();
        this.initCurrentServerSectionObserver();
        this.initCurrentServerModeratorsObserver();
        this.initTableEnhancementsObserver();
        this.initTablesRowsObserver();
        this.initNotificationModalObserver();

        this.handleTrackOffenderLoop();
    }

    initSettingsListener() {
        this.chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'updateSettings' && request.settings) {
                this.updateSettings(request.settings);
                sendResponse({ status: 'success' });
            }
        });
    }

    updateSettings(settings) {
        const previousSettings = structuredClone(this.settings);
        const previousFeatures = previousSettings?.features || {};
        const newAccountHoursChanged = previousSettings?.newAccountHours !== settings.newAccountHours;
        const newAccountsReenabled = !previousFeatures.highlightNewAccounts && settings.features?.highlightNewAccounts;

        this.settings = {
            ...this.settings,
            ...settings,
            features: {
                ...this.settings.features,
                ...(settings.features || {})
            }
        };

        this.features = this.settings.features;
        this.reasonTriggers = this.settings.reasonTriggers;

        this.messageService.settings = this.settings;
        this.ticketService.settings = this.settings;
        this.ticketService.rules = this.rules;
        this.ticketService.muteExceptions = this.muteExceptions;
        this.ticketService.setCurrentServerRefreshInterval(this.settings.serverRefreshInterval);

        if (!previousSettings.features?.autoConnectServer && this.settings.features.autoConnectServer) {
            this.ticketService.connectToCurrentServer();
        }

        this.cleanupChangedSettings(previousSettings, this.settings);

        if (this.features.highlightNewAccounts && (newAccountHoursChanged || newAccountsReenabled)) {
            this.messageService.reapplyNewAccountHighlights();
        }

        if (!this.features.processTicketRules) {
            this.teardownTicketChatHistoryObservers();
        }

        this.optimizer.setEnabled(this.features.optimizeSpaTabs);
        this.runDOMUpdates();
        this.initTicketMountObserver();
        this.initCurrentServerSectionObserver();
        this.initTableEnhancementsObserver();
        this.handleTrackOffenderLoop(previousSettings);
    }

    handleTrackOffenderLoop(previousSettings = null) {
        const isEnabled = this.features.trackOffenderServer;
        const currentInterval = this.settings.trackOffenderInterval || 5;
        const prevInterval = previousSettings?.trackOffenderInterval;

        if (!isEnabled || (prevInterval !== undefined && prevInterval !== currentInterval)) {
            if (this.ipTrackTimeoutId) {
                clearTimeout(this.ipTrackTimeoutId);
                this.ipTrackTimeoutId = null;
            }
        }

        if (isEnabled && !this.ipTrackTimeoutId) {
            this.scheduleNextCheck();
        }
    }

    scheduleNextCheck() {
        if (!this.features.trackOffenderServer) return;

        const intervalMs = (this.settings.trackOffenderInterval || 5) * 1000;

        this.ipTrackTimeoutId = setTimeout(async () => {
            try {
                await this.ticketService.checkOffendersServers();
            } catch (err) {
                console.error(err);
            }
            this.scheduleNextCheck();
        }, intervalMs);
    }

    cleanupChangedSettings(previousSettings, nextSettings) {
        const previousFeatures = previousSettings?.features || {};
        const nextFeatures = nextSettings.features;
        const triggersChanged = JSON.stringify(previousSettings?.reasonTriggers || []) !== JSON.stringify(nextSettings.reasonTriggers);
        const newAccountHoursChanged = previousSettings?.newAccountHours !== nextSettings.newAccountHours;

        if (!nextFeatures.highlightComplaintTriggers || triggersChanged) {
            this.messageService.clearComplaintTriggerHighlights();
        }

        if (!nextFeatures.highlightNewAccounts || newAccountHoursChanged) {
            this.messageService.clearNewAccountHighlights();
        }

        if (
            !nextFeatures.highlightDuplicateServers && previousFeatures.highlightDuplicateServers !== false
        ) {
            this.messageService.clearDuplicateServerHighlights();
        }

        if (!nextFeatures.processTicketRules && previousFeatures.processTicketRules !== false) {
            this.ticketService.clearTicketRuleBadge();
        }

        if (!nextFeatures.manageEmptyBlocks && previousFeatures.manageEmptyBlocks !== false) {
            this.ticketService.restoreManagedEmptyBlocks();
        }

        if (!nextFeatures.translateText && previousFeatures.translateText !== false) {
            this.messageService.clearTranslationDecorations();
        }

        const intervalChanged = previousSettings?.trackOffenderInterval !== nextSettings.trackOffenderInterval;

        if ((!nextFeatures.trackOffenderServer || intervalChanged) && this.ipTrackInterval) {
            clearInterval(this.ipTrackInterval);
            this.ipTrackInterval = null;
        }
    }

    runDOMUpdates() {
        this.initPageSpecificFeatures();
        this.initTicketSectionFeatures();
        this.initCurrentServerFeatures();
        this.initTableFeatures();
    }

    initPageSpecificFeatures() {
        this.optimizer.setEnabled(this.features.optimizeSpaTabs);

        if (this.features.scanSchedulePage) {
            this.moderatorService.scanSchedulePage();
        }
    }

    initTicketSectionFeatures() {
        this.initNotificationPanels();

        const ticketPath = window.location.pathname || window.location.href;
        if (this._lastTicketSectionPath !== ticketPath) {
            this._lastTicketSectionPath = ticketPath;
            this.ticketService.resetChatAnalysisCache();
        }

        const textareas = this.document.querySelectorAll('textarea');
        textareas.forEach(textarea => {
            if (this.isTicketResolutionTextarea(textarea)) {
                if (!this.document.getElementById('mod-ticket-panel') && typeof this.templates.ticket !== 'undefined') {
                    textarea.parentNode.insertBefore(this.panelService.createPanel(this.templates.ticket, textarea, 'mod-ticket-panel'), textarea);
                }
                if (this.features.processTicketRules) {
                    this.ensureTicketChatHistoryObserver(textarea);
                }
                if (this.features.autoConnectServer) {
                    this.ticketService.connectToCurrentServer();
                }
            }
        });

        const hasCurrentServer = Array.from(this.document.querySelectorAll('h3'))
            .some(h => h.textContent?.includes('Текущий сервер'));
        if (hasCurrentServer) {
            this.initCurrentServerFeatures();
        }

        if (this.features.translateText) {
            this.messageService.processChatMessages();
        }

        if (this.features.manageEmptyBlocks) {
            this.ticketService.manageEmptyBlocks();
        }

        if (this.features.showSteamAccountCreationDate) {
            this.ticketService.renderSteamAccountCreationDate();
        } else {
            this.ticketService.clearSteamAccountCreationDate();
        }
    }

    initCurrentServerFeatures() {
        this.moderatorService.highlightSavedModerators();
        this.ticketService.setCurrentServerRefreshInterval(this.settings.serverRefreshInterval);

        if (this.settings.serverRefreshInterval > 0) {
            this.ticketService.refreshCurrentServerNowIfAvailable();
        }
    }

    initNotificationPanels() {
        if (typeof this.templates.notification === 'undefined') return;

        const textareas = this.document.querySelectorAll('textarea');
        textareas.forEach(textarea => {
            if (!this.isNotificationTextarea(textarea)) return;
            if (!textarea.parentElement) return;
            if (textarea.parentElement.querySelector('.ioh-panel')) return;

            textarea.parentNode.insertBefore(
                this.panelService.createPanel(
                    this.templates.notification,
                    textarea,
                    'mod-notif-panel'
                ),
                textarea
            );
        });
    }

    initNotificationModalObserver() {
        if (this.notificationModalObserver) {
            this.notificationModalObserver.disconnect();
        }

        const triggerNotificationPanels = () => {
            if (this.notificationModalDebounceId) {
                clearTimeout(this.notificationModalDebounceId);
            }

            this.notificationModalDebounceId = setTimeout(() => {
                this.notificationModalDebounceId = null;
                this.initNotificationPanels();
            }, 150);
        };

        const isRelevantNotificationNode = (node) => {
            if (!node || node.nodeType !== 1) return false;

            if (node.closest?.('.ioh-panel')) {
                return false;
            }

            if (node.matches?.('textarea')) {
                return true;
            }

            if (node.matches?.('[role="dialog"]')) {
                return true;
            }

            const text = node.textContent || '';
            if (text.includes('Отправить уведомление')) {
                return true;
            }

            if (node.querySelector?.('textarea, [role="dialog"]')) {
                return true;
            }

            return false;
        };

        this.notificationModalObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes || []) {
                    if (isRelevantNotificationNode(node)) {
                        triggerNotificationPanels();
                        return;
                    }
                }
            }
        });

        this.notificationModalObserver.observe(this.document.body, {
            childList: true,
            subtree: true
        });

        triggerNotificationPanels();
    }

    initTableFeatures() {
        if (this.features.squareTickets) {
            this.ticketService.renderSquareTicketCards();
        } else {
            this.ticketService.clearSquareTicketCards();
        }

        if (this.features.highlightDuplicateServers) {
            this.messageService.highlightDuplicateServerIps();
        }
    }

    initNavigationWatcher() {
        if (this.navigationWatcherInstalled) return;
        this.navigationWatcherInstalled = true;

        const self = this;
        const history = this.window.history;

        if (history?.pushState) {
            const originalPushState = history.pushState;
            history.pushState = function () {
                const ret = originalPushState.apply(this, arguments);
                self.handleNavigationChange();
                return ret;
            };
        }

        if (history?.replaceState) {
            const originalReplaceState = history.replaceState;
            history.replaceState = function () {
                const ret = originalReplaceState.apply(this, arguments);
                self.handleNavigationChange();
                return ret;
            };
        }

        this.window.addEventListener('popstate', () => this.handleNavigationChange());
    }

    handleNavigationChange() {
        const href = this.window.location.href;
        if (href === this._lastHref) return;
        this._lastHref = href;

        delete this.document.body.dataset.autoConnected;
        delete this.document.body.dataset.autoConnectedFor;

        this.teardownTicketChatHistoryObservers();
        this.teardownTablesRowsObserver();
        this.teardownCurrentServerSectionObserver();
        this.teardownTableEnhancementsObserver();
        this.teardownCurrentServerModeratorsObserver();
        this.ticketService.clearTicketRuleBadge();
        this.ticketService.resetChatAnalysisCache();

        this.runDOMUpdates();
        this.initCurrentServerFeatures();
        this.initCurrentServerSectionObserver();
        this.initCurrentServerModeratorsObserver();
        this.initTicketMountObserver();
        this.initTableEnhancementsObserver();
        this.initTablesRowsObserver();
    }

    teardownTicketChatHistoryObservers() {
        for (const entry of this.ticketChatHistoryObservers.values()) {
            if (entry.debounceTimerId) {
                clearTimeout(entry.debounceTimerId);
            }
            entry.observer.disconnect();
        }
        this.ticketChatHistoryObservers.clear();
        this.ticketService.resetChatAnalysisCache();
    }

    teardownTablesRowsObserver() {
        if (!this.tablesRowsObserver) return;
        this.tablesRowsObserver.disconnect();
        this.tablesRowsObserver = null;
    }

    teardownCurrentServerModeratorsObserver() {
        if (!this.currentServerModeratorsObserver) return;
        this.currentServerModeratorsObserver.disconnect();
        this.currentServerModeratorsObserver = null;
        if (this.currentServerModeratorsDebounceId) {
            clearTimeout(this.currentServerModeratorsDebounceId);
            this.currentServerModeratorsDebounceId = null;
        }
    }

    teardownCurrentServerSectionObserver() {
        if (!this.currentServerSectionObserver) return;
        this.currentServerSectionObserver.disconnect();
        this.currentServerSectionObserver = null;
        if (this.currentServerSectionDebounceId) {
            clearTimeout(this.currentServerSectionDebounceId);
            this.currentServerSectionDebounceId = null;
        }
    }

    teardownTableEnhancementsObserver() {
        if (!this.tableEnhancementsObserver) return;
        this.tableEnhancementsObserver.disconnect();
        this.tableEnhancementsObserver = null;
        if (this.tableEnhancementsDebounceId) {
            clearTimeout(this.tableEnhancementsDebounceId);
            this.tableEnhancementsDebounceId = null;
        }
    }

    initTicketMountObserver() {
        if (this.ticketInitObserver) {
            this.ticketInitObserver.disconnect();
        }

        this.ticketInitObserver = new MutationObserver((mutations) => {
            if (!this._hasRelevantTicketMountMutation(mutations)) {
                return;
            }

            if (this.ticketInitDebounceId) {
                clearTimeout(this.ticketInitDebounceId);
            }

            this.ticketInitDebounceId = setTimeout(() => {
                this.ticketInitDebounceId = null;
                this.runDOMUpdates();
            }, 120);
        });

        this.ticketInitObserver.observe(this.document.body, {
            childList: true,
            subtree: true
        });
    }

    initCurrentServerModeratorsObserver() {
        // Re-init safely (e.g. after SPA navigation).
        this.teardownCurrentServerModeratorsObserver();

        const triggerHighlight = () => {
            if (this.currentServerModeratorsDebounceId) {
                clearTimeout(this.currentServerModeratorsDebounceId);
            }

            this.currentServerModeratorsDebounceId = setTimeout(() => {
                this.currentServerModeratorsDebounceId = null;
                // Highlight is idempotent via CSS class.
                this.moderatorService.highlightSavedModerators();
            }, 180);
        };

        this.currentServerModeratorsObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes || []) {
                    if (!node || node.nodeType !== 1) continue;

                    // Fast paths: the section/header or any moderator profile link.
                    if (node.matches?.('h3') && node.textContent?.includes('Текущий сервер')) {
                        triggerHighlight();
                        return;
                    }

                    if (node.querySelector?.('a[href*="cybershoke.net/"]')) {
                        triggerHighlight();
                        return;
                    }
                }
            }
        });

        this.currentServerModeratorsObserver.observe(this.document.body, {
            childList: true,
            subtree: true
        });

        // Also run once in case the table already exists.
        triggerHighlight();
    }

    initCurrentServerSectionObserver() {
        this.teardownCurrentServerSectionObserver();

        const triggerCurrentServerInit = () => {
            if (this.currentServerSectionDebounceId) {
                clearTimeout(this.currentServerSectionDebounceId);
            }

            this.currentServerSectionDebounceId = setTimeout(() => {
                this.currentServerSectionDebounceId = null;
                this.initCurrentServerFeatures();
                this.initNotificationPanels();
            }, 160);
        };

        this.currentServerSectionObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes || []) {
                    if (!node || node.nodeType !== 1) continue;

                    if (node.matches?.('h3') && node.textContent?.includes('Текущий сервер')) {
                        triggerCurrentServerInit();
                        return;
                    }

                    if (node.querySelector?.('h3')) {
                        const header = Array.from(node.querySelectorAll('h3')).find(h => h.textContent?.includes('Текущий сервер'));
                        if (header) {
                            triggerCurrentServerInit();
                            return;
                        }
                    }

                    if (node.matches?.('button') && node.textContent?.includes('Обновить')) {
                        triggerCurrentServerInit();
                        return;
                    }

                    if (node.querySelector?.('button')) {
                        const refreshButton = Array.from(node.querySelectorAll('button')).find(btn => btn.textContent?.includes('Обновить'));
                        if (refreshButton) {
                            triggerCurrentServerInit();
                            return;
                        }
                    }

                    // If the page renders notification textarea asynchronously, also trigger
                    // on generic textarea mounts.
                    if (node.matches?.('textarea')) {
                        triggerCurrentServerInit();
                        return;
                    }

                    if (node.querySelector?.('textarea')) {
                        triggerCurrentServerInit();
                        return;
                    }
                }
            }
        });

        this.currentServerSectionObserver.observe(this.document.body, {
            childList: true,
            subtree: true
        });

        triggerCurrentServerInit();
    }

    initTableEnhancementsObserver() {
        this.teardownTableEnhancementsObserver();

        const triggerTableInit = () => {
            if (this.tableEnhancementsDebounceId) {
                clearTimeout(this.tableEnhancementsDebounceId);
            }

            this.tableEnhancementsDebounceId = setTimeout(() => {
                this.tableEnhancementsDebounceId = null;
                this.initTableFeatures();
            }, 160);
        };

        this.tableEnhancementsObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes || []) {
                    if (!node || node.nodeType !== 1) continue;

                    if (node.matches?.('table, tr')) {
                        triggerTableInit();
                        return;
                    }

                    if (node.querySelector?.('table, tr')) {
                        triggerTableInit();
                        return;
                    }
                }
            }
        });

        this.tableEnhancementsObserver.observe(this.document.body, {
            childList: true,
            subtree: true
        });

        triggerTableInit();
    }

    _hasRelevantTicketMountMutation(mutations) {
        const isRelevantNode = (node) => {
            if (!node || node.nodeType !== 1) return false;

            if (
                node.closest?.('.ioh-panel') ||
                node.closest?.('.ioh-info-badge') ||
                node.closest?.('.ioh-account-created')
            ) {
                return false;
            }

            if (node.matches?.('textarea[placeholder*="Опишите детали закрытия"]')) return true;
            if (node.matches?.('textarea')) return true;
            if (node.matches?.('h3')) return true;
            if (node.querySelector?.('textarea[placeholder*="Опишите детали закрытия"]')) return true;
            if (node.querySelector?.('h3')) return true;
            if (node.textContent?.includes('История Чата')) return true;
            if (node.textContent?.includes('Нарушитель')) return true;

            return false;
        };

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes || []) {
                if (isRelevantNode(node)) {
                    return true;
                }
            }
        }

        return false;
    }

    _findChatHistoryBlockScoped(scopeEl) {
        const containers = [];
        if (scopeEl) {
            containers.push(scopeEl);
            const closestSection = scopeEl.closest?.('section, article, main, [role="main"]');
            if (closestSection && !containers.includes(closestSection)) {
                containers.push(closestSection);
            }
        }
        containers.push(this.document.body);

        for (const container of containers) {
            const headers = Array.from(container.querySelectorAll('h3'));
            const targetHeader = headers.find(h3 => h3.textContent.includes('История Чата'));
            if (!targetHeader) continue;

            let parent = targetHeader.parentElement;
            while (parent && parent !== this.document.body) {
                if (parent.querySelector('table')) {
                    return parent;
                }
                parent = parent.parentElement;
            }
        }

        return this.ticketService.getBlockByHeader('История Чата');
    }

    ensureTicketChatHistoryObserver(textarea) {
        if (this.ticketChatHistoryObservers.has(textarea)) return;
        if (!this.document.contains(textarea)) return;

        const scopeEl = textarea.closest('section, article, main, [role="main"]')
            || textarea.parentElement
            || this.document.body;
        let chatHistoryBlock = this._findChatHistoryBlockScoped(scopeEl);

        const attachObserver = (block) => {
            if (!block) return;
            if (this.ticketChatHistoryObservers.has(textarea)) return;

            const entry = {
                observer: null,
                debounceTimerId: null,
            };

            const observer = new MutationObserver(() => {
                if (!this.features.processTicketRules) return;
                this._debouncedProcessTicketRules(textarea);
            });
            entry.observer = observer;
            entry.observer.observe(block, {childList: true, subtree: true});
            this.ticketChatHistoryObservers.set(textarea, entry);

            this._runTicketChatAnalysis(textarea);
        };

        if (chatHistoryBlock) {
            attachObserver(chatHistoryBlock);
            return;
        }

        // Wait until chat history appears (ticket DOM can be rendered in phases).
        const tempObserver = new MutationObserver(() => {
            if (!this.document.contains(textarea)) {
                tempObserver.disconnect();
                return;
            }

            const nextBlock = this._findChatHistoryBlockScoped(scopeEl);
            if (!nextBlock) return;

            tempObserver.disconnect();
            attachObserver(nextBlock);
        });

        tempObserver.observe(this.document.body, {childList: true, subtree: true});
    }

    _debouncedProcessTicketRules(textarea, delayMs = 250) {
        const entry = this.ticketChatHistoryObservers.get(textarea);
        if (!entry) return;
        if (!this.features.processTicketRules) return;

        if (entry.debounceTimerId) {
            clearTimeout(entry.debounceTimerId);
            entry.debounceTimerId = null;
        }

        entry.debounceTimerId = setTimeout(() => {
            entry.debounceTimerId = null;
            this._runTicketChatAnalysis(textarea);
        }, delayMs);
    }

    _runTicketChatAnalysis(textarea) {
        if (!this.document.contains(textarea)) return;

        if (this.features.manageEmptyBlocks) {
            this.ticketService.manageEmptyBlocks();
        }

        if (this.features.translateText) {
            this.messageService.processChatMessages();
        }

        this.ticketService.processTicketRules(textarea);
    }

    initTablesRowsObserver() {
        // If SPA content is re-rendered, ensure we don't keep an old observer.
        this.teardownTablesRowsObserver();

        const self = this;
        this.tablesRowsObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes || []) {
                    if (!node || node.nodeType !== 1) continue;

                    if (node.matches && node.matches('tr')) {
                        self._applyRowHighlights(node);
                        continue;
                    }

                    const rows = node.querySelectorAll?.('tr') || [];
                    rows.forEach(row => self._applyRowHighlights(row));
                }
            }
        });

        // Apply once for existing content.
        this.document.querySelectorAll('tr').forEach(row => this._applyRowHighlights(row));
        this.tablesRowsObserver.observe(this.document.documentElement, {childList: true, subtree: true});
    }

    _applyRowHighlights(row) {
        if (this.features.highlightComplaintTriggers) {
            this.messageService.highlightComplaintTriggers(row);
        }
        if (this.features.highlightNewAccounts) {
            this.messageService.highlightNewAccounts(row);
        }
    }

    isNotificationTextarea(textarea) {
        let parent = textarea.parentElement;
        while (parent && parent !== this.document.body) {
            if (parent.innerText && parent.innerText.includes('Отправить уведомление')) {
                return true;
            }
            parent = parent.parentElement;
        }
        return false;
    }

    isTicketResolutionTextarea(textarea) {
        return Boolean(textarea.placeholder && textarea.placeholder.includes('Опишите детали закрытия'));
    }
}

window.App = App;
