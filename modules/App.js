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
    }

    start() {
        this.chrome.storage.local.get(null, (result) => {});

        this.initSettingsListener();

        fetch(chrome.runtime.getURL("icons/icons.json"))
            .then(r => r.json())
            .then(data => {
                window.Icons = data;
            });

        this.chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== "local" || !changes.helperSettings) {
                return;
            }

            const settings = changes.helperSettings.newValue || {};

            this.updateSettings(settings);
        });

        this.observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;

            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                if (m.type === 'attributes' && m.attributeName === 'class') {
                    const targetClass = m.target.className;
                    if (typeof targetClass === 'string' && targetClass.includes('ioh-')) {
                        continue;
                    }
                }
                if (m.type === 'attributes' && m.attributeName.startsWith('data-')) {
                    continue;
                }
                shouldUpdate = true;
                break;
            }

            if (shouldUpdate) {
                this.runDOMUpdates();
            }
        });

        this.runDOMUpdates();

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

        if (this.observer) this.observer.disconnect();

        if (!previousSettings.features?.autoConnectServer && this.settings.features.autoConnectServer) {
            this.ticketService.connectToCurrentServer();
        }

        this.cleanupChangedSettings(previousSettings, this.settings);
        this.runDOMUpdates();
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
        if (this.observer) this.observer.disconnect();

        const textareas = this.document.querySelectorAll('textarea');
        textareas.forEach(textarea => {
            if (this.isNotificationTextarea(textarea)) {
                if (!textarea.parentElement.querySelector(".ioh-panel") && typeof this.templates.notification !== 'undefined') {
                    textarea.parentNode.insertBefore(this.panelService.createPanel(this.templates.notification, textarea, 'mod-notif-panel'), textarea);
                }
            } else if (this.isTicketResolutionTextarea(textarea)) {
                if (!this.document.getElementById('mod-ticket-panel') && typeof this.templates.ticket !== 'undefined') {
                    textarea.parentNode.insertBefore(this.panelService.createPanel(this.templates.ticket, textarea, 'mod-ticket-panel'), textarea);
                }
                if (this.features.processTicketRules) {
                    this.ticketService.processTicketRules(textarea);
                }
            }
        });

        if (this.features.scanSchedulePage) {
            this.moderatorService.scanSchedulePage();
        }
        this.moderatorService.highlightSavedModerators()

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

        if (this.observer) {
            this.observer.observe(this.document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true
            });
        }

        const rows = this.document.querySelectorAll('tr');
        rows.forEach(row => {
            if (this.features.highlightComplaintTriggers) {
                this.messageService.highlightComplaintTriggers(row);
            }
            if (this.features.highlightNewAccounts) {
                this.messageService.highlightNewAccounts(row);
            }
        });

        if (this.features.highlightDuplicateServers) {
            this.messageService.highlightDuplicateServerIps();
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
