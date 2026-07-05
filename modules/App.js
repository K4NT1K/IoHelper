class App {
    constructor({window, document, chrome, config}) {
        this.window = window;
        this.document = document;
        this.chrome = chrome;
        this.rules = config.muteRules || [];
        this.templates = config.templates || {};
        this.settings = config.settings;
        this.features = this.settings.features;
        this.reasonTriggers = this.settings.reasonTriggers;
        this.observer = null;

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
            rules: this.rules
        });
        this.moderatorService = new ModeratorService({document, chrome});
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
        this.ticketService.setCurrentServerRefreshInterval(this.settings.serverRefreshInterval);

        if (this.observer) this.observer.disconnect();

        this.cleanupChangedSettings(previousSettings, this.settings);
        this.runDOMUpdates();
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
    }

    start() {
        this.chrome.storage.local.get(null, (result) => {});

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

        this.observer = new MutationObserver(() => this.runDOMUpdates());
        this.observer.observe(this.document.documentElement, {childList: true, subtree: true});
        this.runDOMUpdates();
        this.ticketService.setCurrentServerRefreshInterval(this.settings.serverRefreshInterval);
    }

    runDOMUpdates() {
        if (this.observer) this.observer.disconnect();

        if (this.features.scanSchedulePage && this.window.location.href.includes('/worktime')) {
            this.moderatorService.scanSchedulePage();
        }

        this.moderatorService.highlightSavedModerators();
        if (this.features.translateText) {
            this.messageService.processChatMessages();
        }

        const textareas = this.document.querySelectorAll('textarea');
        textareas.forEach(textarea => {
            let parent = textarea.parentElement;
            let isNotificationModal = false;
            while (parent && parent !== this.document.body) {
                if (parent.innerText && (parent.innerText.includes('Отправить уведомление'))) {
                    isNotificationModal = true;
                    break;
                }
                parent = parent.parentElement;
            }

            if (isNotificationModal) {
                if (!textarea.parentElement.querySelector(".moderhlpr-panel") && typeof this.templates.notification !== 'undefined') {
                    textarea.parentNode.insertBefore(this.panelService.createPanel(this.templates.notification, textarea, 'mod-notif-panel'), textarea);
                }
            } else if (textarea.placeholder && (textarea.placeholder.includes('Опишите детали закрытия'))) {
                if (!this.document.getElementById('mod-ticket-panel') && typeof this.templates.ticket !== 'undefined') {
                    textarea.parentNode.insertBefore(this.panelService.createPanel(this.templates.ticket, textarea, 'mod-ticket-panel'), textarea);
                }
                if (this.features.processTicketRules) {
                    this.ticketService.processTicketRules(textarea);
                }
            }
        });

        if (this.features.manageEmptyBlocks) {
            this.ticketService.manageEmptyBlocks();
        }

        if (this.observer) this.observer.observe(this.document.documentElement, {childList: true, subtree: true});

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
}

window.App = App;

