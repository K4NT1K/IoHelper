class App {
    constructor({ window, document, chrome, rules, templates, complaintTriggers, settings }) {
        this.window = window;
        this.document = document;
        this.chrome = chrome;
        this.rules = rules || [];
        this.templates = templates || {};
        this.settings = this.normalizeSettings(settings, complaintTriggers);
        this.features = this.settings.features;
        this.complaintTriggers = this.settings.complaintTriggers;
        this.observer = null;

        this.utils = new Utils({ document });
        this.badgeService = new BadgeService({ document });
        this.panelService = new PanelService({ document });
        this.messageService = new MessageService({
            document,
            utils: this.utils,
            badgeService: this.badgeService,
            complaintTriggers: this.complaintTriggers,
            newAccountHours: this.settings.newAccountHours
        });
        this.ticketService = new TicketService({
            document,
            utils: this.utils,
            badgeService: this.badgeService,
            rules: this.rules
        });
        this.moderatorService = new ModeratorService({ document, chrome });
    }

    normalizeSettings(settings, complaintTriggers) {
        const defaults = {
            features: {
                scanSchedulePage: true,
                highlightComplaintTriggers: true,
                highlightNewAccounts: true,
                processTicketRules: true,
                manageEmptyBlocks: true,
                translateText: true
            },
            newAccountHours: 7,
            complaintTriggers: complaintTriggers || []
        };

        const hours = Number(settings?.newAccountHours);

        return {
            features: { ...defaults.features, ...(settings?.features || {}) },
            newAccountHours: Number.isFinite(hours) ? Math.min(Math.max(hours, 1), 168) : defaults.newAccountHours,
            complaintTriggers: Array.isArray(settings?.complaintTriggers)
                ? settings.complaintTriggers
                : defaults.complaintTriggers
        };
    }

    updateSettings(settings) {
        const previousSettings = this.settings;
        this.settings = this.normalizeSettings(settings, this.complaintTriggers);
        this.features = this.settings.features;
        this.complaintTriggers = this.settings.complaintTriggers;
        this.messageService.complaintTriggers = this.complaintTriggers;
        this.messageService.newAccountHours = this.settings.newAccountHours;

        if (this.observer) this.observer.disconnect();
        this.cleanupChangedSettings(previousSettings, this.settings);
        this.runDOMUpdates();
    }

    cleanupChangedSettings(previousSettings, nextSettings) {
        const previousFeatures = previousSettings?.features || {};
        const nextFeatures = nextSettings.features;
        const triggersChanged = JSON.stringify(previousSettings?.complaintTriggers || []) !== JSON.stringify(nextSettings.complaintTriggers);
        const newAccountHoursChanged = previousSettings?.newAccountHours !== nextSettings.newAccountHours;

        if (!nextFeatures.highlightComplaintTriggers || triggersChanged) {
            this.messageService.clearComplaintTriggerHighlights();
        }

        if (!nextFeatures.highlightNewAccounts || newAccountHoursChanged) {
            this.messageService.clearNewAccountHighlights();
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
        this.chrome.storage.local.get(null, (result) => {
            console.log("[ModerHelper Debug] Данные в хранилище при старте страницы:", result);
        });

        if (this.chrome.storage?.onChanged) {
            this.chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName === 'local' && changes.helperSettings) {
                    this.updateSettings(changes.helperSettings.newValue);
                }
            });
        }

        this.observer = new MutationObserver(() => this.runDOMUpdates());
        this.observer.observe(this.document.documentElement, { childList: true, subtree: true });
        this.runDOMUpdates();
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
                if (parent.innerText && (parent.innerText.includes('Отправить уведомление') || parent.innerText.includes('Уведомление игрока'))) {
                    isNotificationModal = true;
                    break;
                }
                parent = parent.parentElement;
            }

            if (isNotificationModal) {
                if (!this.document.getElementById('mod-notif-panel') && typeof this.templates.notif !== 'undefined') {
                    textarea.parentNode.insertBefore(this.panelService.createPanel(this.templates.notif, textarea, 'mod-notif-panel'), textarea);
                }
            } else if (textarea.placeholder && (textarea.placeholder.includes('детали') || textarea.closest('form'))) {
                if (!this.document.getElementById('mod-ticket-panel') && typeof this.templates.ticket !== 'undefined') {
                    textarea.parentNode.insertBefore(this.panelService.createPanel(this.templates.ticket, textarea, 'mod-ticket-panel'), textarea);
                }
                if (this.features.processTicketRules) {
                    this.ticketService.processTicketRules(textarea);
                }
                if (this.features.manageEmptyBlocks) {
                    this.ticketService.manageEmptyBlocks();
                }
            }
        });

        if (this.observer) this.observer.observe(this.document.documentElement, { childList: true, subtree: true });

        const rows = this.document.querySelectorAll('tr');
        rows.forEach(row => {
            if (this.features.highlightComplaintTriggers) {
                this.messageService.highlightComplaintTriggers(row);
            }
            if (this.features.highlightNewAccounts) {
                this.messageService.highlightNewAccounts(row);
            }
        });
    }
}

window.App = App;



