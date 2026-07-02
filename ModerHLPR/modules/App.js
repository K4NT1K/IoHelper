class App {
    constructor({ window, document, chrome, rules, templates, complaintTriggers }) {
        this.window = window;
        this.document = document;
        this.chrome = chrome;
        this.rules = rules || [];
        this.templates = templates || {};
        this.complaintTriggers = complaintTriggers || [];
        this.observer = null;

        this.utils = new Utils({ document });
        this.badgeService = new BadgeService({ document });
        this.panelService = new PanelService({ document });
        this.messageService = new MessageService({
            document,
            utils: this.utils,
            badgeService: this.badgeService,
            complaintTriggers: this.complaintTriggers
        });
        this.ticketService = new TicketService({
            document,
            utils: this.utils,
            badgeService: this.badgeService,
            rules: this.rules
        });
        this.moderatorService = new ModeratorService({ document, chrome });
    }

    start() {
        this.chrome.storage.local.get(null, (result) => {
            console.log("[ModerHelper Debug] Данные в хранилище при старте страницы:", result);
        });

        this.observer = new MutationObserver(() => this.runDOMUpdates());
        this.observer.observe(this.document.documentElement, { childList: true, subtree: true });
        this.runDOMUpdates();
    }

    runDOMUpdates() {
        if (this.observer) this.observer.disconnect();

        if (this.window.location.href.includes('/worktime')) {
            this.moderatorService.scanSchedulePage();
        }

        this.moderatorService.highlightSavedModerators();
        this.messageService.processChatMessages();

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
                this.ticketService.processTicketRules(textarea);
                this.ticketService.manageEmptyBlocks();
            }
        });

        if (this.observer) this.observer.observe(this.document.documentElement, { childList: true, subtree: true });

        const rows = this.document.querySelectorAll('tr');
        rows.forEach(row => {
            this.messageService.highlightComplaintTriggers(row);
            this.messageService.highlightNewAccounts(row);
        });
    }
}

window.App = App;
window.ModerHLPRApp = App;



