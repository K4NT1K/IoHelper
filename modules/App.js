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
        this.reasonTriggersAutoconnect = this.settings.reasonTriggersAutoconnect;
        this.ipTrackTimeoutId = null;
        this.ticketChatHistoryObservers = new Map();
        this.visibilityCatchUpInstalled = false;
        this.visibilityCatchUpDebounceId = null;
        this.navigationWatcherInstalled = false;
        this._lastHref = this.window?.location?.href || '';
        this._lastTicketSectionPath = '';
        this._lastVisibleTicketTextarea = null;
        this._wasOnComplaintDetail = this.isComplaintDetailPage();

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
            settings: this.settings,
            rules: this.rules,
            muteExceptions: this.muteExceptions,
            chrome
        });
        this.moderatorService = new ModeratorService({document, chrome});
        this.punishmentService = new PunishmentService({
            document,
            durations: config.punishmentDurations,
            utils: this.utils
        });
        this.domCoordinator = new DOMCoordinator(this);
        this.messageService.ticketService = this.ticketService;
    }

    start() {
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

        this.initNavigationWatcher();
        this.domCoordinator.init();
        this.initPunishmentFormObserver();
        this.ticketService.initMuteIssueFeature();
        this.initVisibilityCatchUpListener();

        this.handleTrackOffenderLoop();
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

        if (settings.reasonTriggersAutoconnect) {
            this.settings.reasonTriggersAutoconnect = settings.reasonTriggersAutoconnect;
        }

        this.features = this.settings.features;
        this.reasonTriggers = this.settings.reasonTriggers;
        this.reasonTriggersAutoconnect = this.settings.reasonTriggersAutoconnect;
        this.messageService.settings = this.settings;
        this.ticketService.settings = this.settings;
        this.ticketService.rules = this.rules;
        this.ticketService.muteExceptions = this.muteExceptions;

        if (previousSettings.serverRefreshInterval !== settings.serverRefreshInterval) {
            this.ticketService.stopCurrentServerRefresh();
        }

        if (!previousSettings.features?.autoConnectServer && this.settings.features.autoConnectServer) {
            this.ticketService.connectToCurrentServer();
        }

        this.cleanupChangedSettings(previousSettings, this.settings);

        if (this.features.highlightNewAccounts && (newAccountHoursChanged || newAccountsReenabled)) {
            this.messageService.reapplyNewAccountHighlights();
        }

        if (!this.features.processTicketRules) {
            this.teardownTicketChatHistoryObservers();
            this.ticketService.teardownTicketPunishmentButtons();
        }

        this.punishmentService.setEnabled(this.features.autoPunishmentDuration !== false);
        if (this.features.autoPunishmentDuration !== false) {
            this.initPunishmentFormObserver();
        }
        this.runDOMUpdates();
        this.domCoordinator.init();
        this.handleTrackOffenderLoop(previousSettings);
    }

    handleTrackOffenderLoop(previousSettings = null) {
        const isEnabled = this.features.trackOffenderServer;
        const currentInterval = this.settings.trackOffenderInterval || 5;
        const currentReviewInterval = this.settings.trackOffenderIntervalWhileReviewing || 30;
        const prevInterval = previousSettings?.trackOffenderInterval;
        const prevReviewInterval = previousSettings?.trackOffenderIntervalWhileReviewing;

        const intervalChanged = prevInterval !== undefined && prevInterval !== currentInterval;
        const reviewIntervalChanged = prevReviewInterval !== undefined && prevReviewInterval !== currentReviewInterval;

        if (!isEnabled || intervalChanged || reviewIntervalChanged) {
            if (this.ipTrackTimeoutId) {
                clearTimeout(this.ipTrackTimeoutId);
                this.ipTrackTimeoutId = null;
            }
        }

        if (isEnabled && !this.ipTrackTimeoutId) {
            void this.runOffenderTrackingPass();
            this.scheduleNextOffenderInterval();
        }
    }

    isComplaintQueuePage() {
        const path = this.window.location.pathname || '';
        return /\/support\/(tickets|reports)\b/i.test(path);
    }

    isComplaintDetailPage() {
        const path = this.window.location.pathname || '';
        if (/\/support\/(tickets|reports)\b/i.test(path)) {
            return false;
        }
        return /\/ticket\/|\/reports?\//i.test(path);
    }

    isReviewingComplaint() {
        return this.isComplaintDetailPage();
    }

    getOffenderTrackIntervalSec() {
        return this.isComplaintDetailPage()
            ? (this.settings.trackOffenderIntervalWhileReviewing || 30)
            : (this.settings.trackOffenderInterval || 5);
    }

    syncOffenderTrackingForPage() {
        const next = this.isComplaintDetailPage();

        if (this._wasOnComplaintDetail === next) {
            return;
        }

        const exitedDetail = this._wasOnComplaintDetail && !next;
        this._wasOnComplaintDetail = next;

        if (!this.features.trackOffenderServer) {
            return;
        }

        if (this.ipTrackTimeoutId) {
            clearTimeout(this.ipTrackTimeoutId);
            this.ipTrackTimeoutId = null;
        }

        if (exitedDetail) {
            void (async () => {
                await this.runOffenderTrackingPass();
                this.scheduleNextOffenderInterval();
            })();
            return;
        }

        this.scheduleNextOffenderInterval();
    }

    async runOffenderTrackingPass() {
        if (!this.features.trackOffenderServer) {
            return;
        }

        if (this.document.hidden) {
            return;
        }

        try {
            const cacheIntervalMs = this.getOffenderTrackIntervalSec() * 1000;
            await this.ticketService.checkOffendersServers(cacheIntervalMs, {
                singleRowPerPass: this.isComplaintDetailPage()
            });
        } catch (err) {
            console.error(err);
        }
    }

    scheduleNextOffenderInterval() {
        if (!this.features.trackOffenderServer) {
            return;
        }

        const intervalMs = this.getOffenderTrackIntervalSec() * 1000;

        this.ipTrackTimeoutId = setTimeout(async () => {
            this.ipTrackTimeoutId = null;
            await this.runOffenderTrackingPass();
            this.scheduleNextOffenderInterval();
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
            this.ticketService.teardownTicketPunishmentButtons();
        }

        if (!nextFeatures.translateText && previousFeatures.translateText !== false) {
            this.messageService.clearTranslationDecorations();
        }

        const intervalChanged = previousSettings?.trackOffenderInterval !== nextSettings.trackOffenderInterval
            || previousSettings?.trackOffenderIntervalWhileReviewing !== nextSettings.trackOffenderIntervalWhileReviewing;

        if ((!nextFeatures.trackOffenderServer || intervalChanged) && this.ipTrackTimeoutId) {
            clearTimeout(this.ipTrackTimeoutId);
            this.ipTrackTimeoutId = null;
        }

        if (
            (!nextFeatures.trackOffenderServer && previousFeatures.trackOffenderServer)
            || (!nextFeatures.showOffenderVipBadge && previousFeatures.showOffenderVipBadge !== false)
        ) {
            this.ticketService.clearOffenderVipBadges();
        }

        if (!nextFeatures.trackOffenderServer && previousFeatures.trackOffenderServer) {
            this.ticketService.clearOffenderProfileVerification();
        }

        const vipStatusesChanged = JSON.stringify(previousSettings?.offenderVipStatuses || [])
            !== JSON.stringify(nextSettings.offenderVipStatuses || []);
        const vipBadgeReenabled = !previousFeatures.showOffenderVipBadge
            && nextFeatures.showOffenderVipBadge !== false;

        if (
            nextFeatures.trackOffenderServer
            && nextFeatures.showOffenderVipBadge !== false
            && (vipStatusesChanged || vipBadgeReenabled)
        ) {
            this.ticketService.refreshOffenderVipBadges();
        }

        if (!previousFeatures.trackOffenderServer && nextFeatures.trackOffenderServer) {
            this.ticketService.refreshOffenderProfileVerification();
        }
    }

    runDOMUpdates() {
        this.initPageSpecificFeatures();
        this.initTicketSectionFeatures();
        this.initCurrentServerFeatures();
        this.initTableFeatures();
    }

    initPageSpecificFeatures() {
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

        if (this.features.showSteamAccountCreationDate) {
            this.ticketService.renderSteamAccountCreationDate();
        } else {
            this.ticketService.clearSteamAccountCreationDate();
        }

        if (this.features.showFaceitElo) {
            this.ticketService.renderFaceitElo();
        } else {
            this.ticketService.clearFaceitElo();
        }

        this.ticketService.refreshComplaintPunishmentButtons();
        this.syncOffenderTrackingForPage();
    }

    initCurrentServerFeatures() {
        this.moderatorService.highlightSavedModerators();

        if (this.settings.serverRefreshInterval <= 0) {
            this.ticketService.stopCurrentServerRefresh();
            return;
        }

        if (!this.ticketService.hasCurrentServerSection()) {
            return;
        }

        const ticketKey = this.ticketService.getCurrentServerRefreshTicketKey();
        this.ticketService.ensureCurrentServerRefresh(ticketKey, this.settings.serverRefreshInterval);
    }

    initVisibilityCatchUpListener() {
        if (this.visibilityCatchUpInstalled) {
            return;
        }

        this.visibilityCatchUpInstalled = true;

        const scheduleCatchUp = () => {
            if (this.document.visibilityState === 'hidden') {
                return;
            }

            if (this.visibilityCatchUpDebounceId) {
                clearTimeout(this.visibilityCatchUpDebounceId);
            }

            this.visibilityCatchUpDebounceId = setTimeout(() => {
                this.visibilityCatchUpDebounceId = null;
                this._handlePageReturnCatchUp();
            }, 80);
        };

        this.document.addEventListener('visibilitychange', scheduleCatchUp);
        this.window.addEventListener('focus', scheduleCatchUp);
        this.window.addEventListener('pageshow', scheduleCatchUp);
    }

    _handlePageReturnCatchUp() {
        if (this.features.highlightComplaintTriggers) {
            this._getHighlightTargetRows().forEach(row => this.messageService.highlightComplaintTriggers(row));
        }
        if (this.features.highlightNewAccounts) {
            if (this.messageService._isComplaintQueuePage()) {
                this.messageService.syncNewAccountHighlights();
            } else {
                this._getHighlightTargetRows().forEach(row => this.messageService.highlightNewAccounts(row));
            }
        }

        if (this.settings.serverRefreshInterval > 0) {
            this.initCurrentServerFeatures();
        }
    }

    initNotificationPanels() {
        if (typeof this.templates.notification === 'undefined') return;

        const textareas = this.document.querySelectorAll('textarea');
        textareas.forEach(textarea => {
            if (!this.isNotificationTextarea(textarea)) return;

            this.hideSiteNotificationTemplates(textarea);

            const existingPanel = this.findNotificationPanelNear(textarea);
            if (existingPanel) {
                if (existingPanel.previousElementSibling !== textarea) {
                    const siteTemplates = this.findSiteNotificationTemplatesContainer(textarea);
                    if (siteTemplates) {
                        siteTemplates.insertAdjacentElement('beforebegin', existingPanel);
                    } else {
                        textarea.insertAdjacentElement('afterend', existingPanel);
                    }
                }
                return;
            }

            const panel = this.panelService.createPanel(
                this.templates.notification,
                textarea,
                'mod-notif-panel'
            );

            const siteTemplates = this.findSiteNotificationTemplatesContainer(textarea);
            if (siteTemplates) {
                siteTemplates.insertAdjacentElement('beforebegin', panel);
            } else {
                textarea.insertAdjacentElement('afterend', panel);
            }
        });
    }

    findNotificationPanelNear(textarea) {
        const dialog = textarea.closest('[role="dialog"]') || textarea.parentElement;
        if (!dialog) {
            return null;
        }

        return dialog.querySelector('#mod-notif-panel');
    }

    getSiteNotificationChipLabels() {
        return [
            'Здравствуйте',
            'Не спамьте',
            'Не оскорбляйте',
            'Не провоцируйте',
            'Не мониторьте',
            'Не препятствуйте другим',
            'Это нарушение правил проекта',
            'Измените никнейм',
            'Не нарушайте правила режима'
        ];
    }

    isSiteNotificationChipButton(button) {
        if (!button || button.closest('.ioh-panel')) {
            return false;
        }

        const text = (button.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text === 'Отправить') {
            return false;
        }

        return this.getSiteNotificationChipLabels().some(label => text === label || text.startsWith(label));
    }

    findSiteNotificationTemplatesContainer(textarea) {
        const dialog = textarea.closest('[role="dialog"]');
        if (!dialog) {
            return null;
        }

        const chipButtons = Array.from(dialog.querySelectorAll('button')).filter(button =>
            this.isSiteNotificationChipButton(button)
        );

        if (chipButtons.length < 2) {
            return null;
        }

        let container = chipButtons[0].parentElement;
        while (container && container !== dialog) {
            const chipCount = Array.from(container.children).filter(child =>
                child.tagName === 'BUTTON' && this.isSiteNotificationChipButton(child)
            ).length;

            if (chipCount >= 2 && !container.contains(textarea)) {
                return container;
            }

            container = container.parentElement;
        }

        return chipButtons[0].parentElement;
    }

    hideSiteNotificationTemplates(textarea) {
        const container = this.findSiteNotificationTemplatesContainer(textarea);
        if (!container) {
            return;
        }

        if (container.style.display !== 'none') {
            container.dataset.iohPrevDisplay = container.style.display || '';
            container.style.display = 'none';
        }
        container.dataset.iohHiddenSiteTemplates = 'true';
    }

    initPunishmentFormObserver() {
        if (this.features.autoPunishmentDuration === false) {
            this.punishmentService.teardown();
            return;
        }

        this.punishmentService.init();
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

        if (!this.ticketService.isComplaintPage()) {
            this.ticketService.clearAutoConnectedServers();
        } else {
            delete this.document.body.dataset.autoConnected;
            delete this.document.body.dataset.autoConnectedFor;
        }
        this._lastVisibleTicketTextarea = null;

        this.teardownTicketChatHistoryObservers();
        this.ticketService.teardownTicketPunishmentButtons();
        this.domCoordinator.teardownAll();
        this.ticketService.clearTicketRuleBadge();
        this.ticketService.resetChatAnalysisCache();
        this.ticketService.stopCurrentServerRefresh();

        this.runDOMUpdates();
        this.initCurrentServerFeatures();
        this.domCoordinator.init();
        this.syncOffenderTrackingForPage();

        void this.ticketService.scanModeratorPunishmentPermissions();

        void this.ticketService.loadModeratorPermissions().then(() => {
            if (this.ticketService.isComplaintPage()) {
                this.ticketService.refreshComplaintPunishmentButtons();
            }
        });
    }

    onTicketTabVisibilityChange() {
        if (this.ticketService.isSitePunishmentDialogOpen()) {
            return;
        }

        const visibleTextarea = this.ticketService.findVisibleTicketResolutionTextarea();
        const textareaChanged = visibleTextarea !== this._lastVisibleTicketTextarea;
        this._lastVisibleTicketTextarea = visibleTextarea;

        if (visibleTextarea && this.features.processTicketRules && textareaChanged) {
            this.ensureTicketChatHistoryObserver(visibleTextarea);
            this.ticketService.resetChatAnalysisCache(visibleTextarea);
            this._runTicketChatAnalysis(visibleTextarea);
        }

        this.ticketService.refreshComplaintPunishmentButtons();

        if (this.features.highlightComplaintTriggers) {
            this._getHighlightTargetRows().forEach(row => this.messageService.highlightComplaintTriggers(row));
        }
        if (this.features.highlightNewAccounts) {
            if (this.messageService._isComplaintQueuePage()) {
                this.messageService.syncNewAccountHighlights();
            } else {
                this._getHighlightTargetRows().forEach(row => this.messageService.highlightNewAccounts(row));
            }
        }

        if (this.settings.serverRefreshInterval > 0) {
            this.initCurrentServerFeatures();
        }

        this.syncOffenderTrackingForPage();
    }

    teardownTicketChatHistoryObservers() {
        for (const entry of this.ticketChatHistoryObservers.values()) {
            if (entry.debounceTimerId) {
                clearTimeout(entry.debounceTimerId);
            }
            entry.observer?.disconnect();
            entry.waitObserver?.disconnect();
        }
        this.ticketChatHistoryObservers.clear();
        this.ticketService.resetChatAnalysisCache();
    }

    _findChatHistoryBlockScoped(scopeEl) {
        return this._findHistoryBlockScoped(scopeEl, ['История Чата']);
    }

    _findWarningHistoryBlockScoped(scopeEl) {
        return this._findHistoryBlockScoped(scopeEl, ['История предупреждений', 'История Предупреждений']);
    }

    _findHistoryBlockScoped(scopeEl, headerTexts) {
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
            for (const headerText of headerTexts) {
                const block = this.ticketService.getBlockByHeaderScoped(headerText, container);
                if (block) {
                    return block;
                }

                const card = this.ticketService.getHistorySectionCard(headerText, container);
                if (card) {
                    return card;
                }
            }
        }

        return null;
    }

    ensureTicketChatHistoryObserver(textarea) {
        if (this.ticketChatHistoryObservers.has(textarea)) return;
        if (!this.document.contains(textarea)) return;
        if (!this.ticketService.isVisibleTicketTextarea(textarea)) return;

        const scopeEl = textarea.closest('section, article, main, [role="main"]')
            || textarea.parentElement
            || this.document.body;

        const entry = {
            observer: null,
            waitObserver: null,
            debounceTimerId: null,
            chatAttached: false,
            warningAttached: false,
        };

        const observer = new MutationObserver(() => {
            if (!this.features.processTicketRules) return;
            if (!this.ticketService.isVisibleTicketTextarea(textarea)) return;
            this._debouncedProcessTicketRules(textarea);
        });
        entry.observer = observer;

        const tryAttachBlocks = () => {
            const chatHistoryBlock = this._findChatHistoryBlockScoped(scopeEl);
            const warningHistoryBlock = this._findWarningHistoryBlockScoped(scopeEl);

            if (chatHistoryBlock && !entry.chatAttached) {
                observer.observe(chatHistoryBlock, {childList: true, subtree: true});
                entry.chatAttached = true;
            }

            if (warningHistoryBlock && !entry.warningAttached) {
                observer.observe(warningHistoryBlock, {childList: true, subtree: true});
                entry.warningAttached = true;
            }

            return entry.chatAttached;
        };

        const finishWaitObserver = () => {
            if (entry.waitObserver) {
                entry.waitObserver.disconnect();
                entry.waitObserver = null;
            }
        };

        if (tryAttachBlocks()) {
            this.ticketChatHistoryObservers.set(textarea, entry);
            this._runTicketChatAnalysis(textarea);

            if (!entry.warningAttached) {
                const waitObserver = new MutationObserver(() => {
                    if (!this.document.contains(textarea)) {
                        finishWaitObserver();
                        return;
                    }

                    tryAttachBlocks();
                    if (entry.warningAttached) {
                        finishWaitObserver();
                    }
                });
                entry.waitObserver = waitObserver;
                waitObserver.observe(this.document.body, {childList: true, subtree: true});
            }
            return;
        }

        // Wait until chat history appears (ticket DOM can be rendered in phases).
        const waitObserver = new MutationObserver(() => {
            if (!this.document.contains(textarea)) {
                finishWaitObserver();
                return;
            }

            if (!tryAttachBlocks()) return;

            finishWaitObserver();
            if (!this.ticketChatHistoryObservers.has(textarea)) {
                this.ticketChatHistoryObservers.set(textarea, entry);
            }
            this._runTicketChatAnalysis(textarea);

            if (!entry.warningAttached) {
                const warningWaitObserver = new MutationObserver(() => {
                    if (!this.document.contains(textarea)) {
                        warningWaitObserver.disconnect();
                        entry.waitObserver = null;
                        return;
                    }

                    tryAttachBlocks();
                    if (entry.warningAttached) {
                        warningWaitObserver.disconnect();
                        entry.waitObserver = null;
                    }
                });
                entry.waitObserver = warningWaitObserver;
                warningWaitObserver.observe(this.document.body, {childList: true, subtree: true});
            }
        });
        entry.waitObserver = waitObserver;
        this.ticketChatHistoryObservers.set(textarea, entry);
        waitObserver.observe(this.document.body, {childList: true, subtree: true});
    }

    _debouncedProcessTicketRules(textarea, delayMs = 100) {
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
        if (!this.ticketService.isVisibleTicketTextarea(textarea)) return;

        if (this.features.translateText) {
            this.messageService.processChatMessages();
        }

        this.ticketService.processTicketRules(textarea);
    }

    _getHighlightTargetRows() {
        if (this.messageService._isComplaintQueuePage()) {
            return this.messageService._getComplaintQueueRows();
        }

        return Array.from(this.document.querySelectorAll('table tbody tr'));
    }

    _reapplyTicketRowHighlights() {
        if (this.features.highlightComplaintTriggers) {
            this._getHighlightTargetRows().forEach(row => this.messageService.highlightComplaintTriggers(row));
        }
        if (this.features.highlightNewAccounts) {
            if (this.messageService._isComplaintQueuePage()) {
                this.messageService.syncNewAccountHighlights();
            } else {
                this._getHighlightTargetRows().forEach(row => this.messageService.highlightNewAccounts(row));
            }
        }
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
