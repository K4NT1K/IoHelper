class DOMCoordinator {
    constructor(app) {
        this.app = app;
        this.document = app.document;
        this.bodyObserver = null;
        this.bodyDebounceId = null;
        this._ticketMountedLeadingFlushed = false;
        this.pendingDispatch = {
            notification: false,
            ticketMounted: false,
            currentServer: false,
            currentServerMods: false,
            tableEnhancements: false,
            punishmentDialog: false
        };
        this.tablesRowsObserver = null;
        this.tablesRowsRafId = null;
        this.complaintQueueTableObservers = new Map();
        this.ticketPanelVisibilityObserver = null;
        this.ticketPanelVisibilityDebounceId = null;
        this.observedTicketPanelRoots = new WeakSet();
    }

    init() {
        this.initBodyObserver();
        this.initTablesRowsObserver();
        this.refreshComplaintQueueTableObservers();
        this.refreshComplaintQueueVisibilityObserver();

        this.pendingDispatch.notification = true;
        this.pendingDispatch.currentServer = true;
        this.pendingDispatch.currentServerMods = true;
        this.pendingDispatch.tableEnhancements = true;
        this.flushBodyDispatch();
    }

    teardownAll() {
        this.teardownBodyObserver();
        this.teardownTablesRowsObserver();
        this.teardownComplaintQueueTableObservers();
        this.teardownTicketPanelVisibilityObserver();
    }

    teardownBodyObserver() {
        if (this.bodyObserver) {
            this.bodyObserver.disconnect();
            this.bodyObserver = null;
        }
        if (this.bodyDebounceId) {
            clearTimeout(this.bodyDebounceId);
            this.bodyDebounceId = null;
        }
        this._ticketMountedLeadingFlushed = false;
        this.resetPendingDispatch();
    }

    teardownTablesRowsObserver() {
        if (this.tablesRowsObserver) {
            this.tablesRowsObserver.disconnect();
            this.tablesRowsObserver = null;
        }
        if (this.tablesRowsRafId) {
            cancelAnimationFrame(this.tablesRowsRafId);
            this.tablesRowsRafId = null;
        }
    }

    teardownComplaintQueueTableObservers() {
        for (const observer of this.complaintQueueTableObservers.values()) {
            observer.disconnect();
        }
        this.complaintQueueTableObservers.clear();
    }

    isComplaintQueueRow(row) {
        const table = row?.closest?.('table');
        return Boolean(table && this.app.ticketService.isComplaintQueueTable(table));
    }

    handleComplaintQueueTableMutations(mutations) {
        const newRows = new Set();
        const updatedRows = new Set();

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes || []) {
                if (!node || node.nodeType !== 1) {
                    continue;
                }

                if (node.matches?.('tr')) {
                    newRows.add(node);
                    continue;
                }

                const nestedRows = node.querySelectorAll?.('tr') || [];
                nestedRows.forEach(row => newRows.add(row));
            }

            const target = mutation.target;
            const row = target?.nodeType === 1
                ? target.closest?.('tbody tr')
                : target?.parentElement?.closest?.('tbody tr');
            if (row && !newRows.has(row)) {
                updatedRows.add(row);
            }
        }

        if (newRows.size) {
            newRows.forEach(row => this.app._applyRowHighlights(row));
        }

        if (updatedRows.size) {
            this.scheduleRowHighlights(updatedRows);
        }
    }

    observeComplaintQueueTable(table) {
        if (this.complaintQueueTableObservers.has(table)) {
            return;
        }

        const tbody = table.querySelector('tbody');
        if (!tbody) {
            return;
        }

        const observer = new MutationObserver((mutations) => {
            this.handleComplaintQueueTableMutations(mutations);
        });

        observer.observe(tbody, {
            childList: true,
            subtree: true,
            characterData: true
        });
        this.complaintQueueTableObservers.set(table, observer);
    }

    refreshComplaintQueueTableObservers() {
        const tables = this.app.ticketService.findComplaintQueueTables();
        const activeTables = new Set(tables);

        for (const [table, observer] of this.complaintQueueTableObservers) {
            if (!this.document.contains(table) || !activeTables.has(table)) {
                observer.disconnect();
                this.complaintQueueTableObservers.delete(table);
            }
        }

        tables.forEach(table => this.observeComplaintQueueTable(table));
    }

    teardownTicketPanelVisibilityObserver() {
        if (this.ticketPanelVisibilityObserver) {
            this.ticketPanelVisibilityObserver.disconnect();
            this.ticketPanelVisibilityObserver = null;
        }
        if (this.ticketPanelVisibilityDebounceId) {
            clearTimeout(this.ticketPanelVisibilityDebounceId);
            this.ticketPanelVisibilityDebounceId = null;
        }
        this.observedTicketPanelRoots = new WeakSet();
    }

    resetPendingDispatch() {
        this.pendingDispatch = {
            notification: false,
            ticketMounted: false,
            currentServer: false,
            currentServerMods: false,
            tableEnhancements: false,
            punishmentDialog: false
        };
    }

    initBodyObserver() {
        if (this.bodyObserver) {
            this.bodyObserver.disconnect();
        }

        this.bodyObserver = new MutationObserver((mutations) => {
            const rowsToUpdate = new Set();

            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    if (mutation.attributeName !== 'aria-hidden') {
                        continue;
                    }

                    const target = mutation.target;
                    if (!target || target.nodeType !== 1) {
                        continue;
                    }
                    if (this.app.ticketService.isExtensionUiElement(target)) {
                        continue;
                    }
                    if (target.getAttribute('aria-hidden') === 'true') {
                        continue;
                    }

                    if (this.isCurrentServerNode(target)) {
                        this.pendingDispatch.currentServer = true;
                        this.pendingDispatch.currentServerMods = true;
                    }
                    continue;
                }

                for (const node of mutation.addedNodes || []) {
                    if (!node || node.nodeType !== 1) {
                        continue;
                    }

                    this.inspectAddedNode(node, rowsToUpdate);
                }
            }

            if (this.hasPendingBodyWork()) {
                this.scheduleBodyDispatch();
            }

            if (rowsToUpdate.size) {
                rowsToUpdate.forEach(row => {
                    if (!this.isComplaintQueueRow(row)) {
                        this.app._applyRowHighlights(row);
                    }
                });
            }
        });

        this.bodyObserver.observe(this.document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-hidden']
        });
    }

    inspectAddedNode(node, rowsToUpdate) {
        if (this.isRelevantNotificationNode(node)) {
            this.pendingDispatch.notification = true;
        }

        if (this.isRelevantTicketMountNode(node)) {
            this.pendingDispatch.ticketMounted = true;
        }

        if (this.isCurrentServerNode(node)) {
            this.pendingDispatch.currentServer = true;
            this.pendingDispatch.currentServerMods = true;
        } else if (node.querySelector?.('a[href*="cybershoke.net/"]')) {
            this.pendingDispatch.currentServerMods = true;
        }

        if (node.matches?.('table, tr') || node.querySelector?.('table, tr')) {
            this.pendingDispatch.tableEnhancements = true;
        }

        if (this.isPunishmentDialogNode(node)) {
            this.pendingDispatch.punishmentDialog = true;
        }

        if (node.matches?.('tr')) {
            rowsToUpdate.add(node);
        } else {
            const nestedRows = node.querySelectorAll?.('tr') || [];
            nestedRows.forEach(row => rowsToUpdate.add(row));
        }

        if (node.matches?.('[role="tabpanel"]') || node.querySelector?.('[role="tabpanel"]')) {
            this.pendingDispatch.ticketMounted = true;
        }
    }

    hasPendingBodyWork() {
        return Object.values(this.pendingDispatch).some(Boolean);
    }

    scheduleBodyDispatch() {
        const leadingTicketFlush = this.pendingDispatch.ticketMounted && !this._ticketMountedLeadingFlushed;

        if (this.bodyDebounceId) {
            clearTimeout(this.bodyDebounceId);
        }

        if (leadingTicketFlush) {
            this._ticketMountedLeadingFlushed = true;
            this.flushBodyDispatch();
        }

        this.bodyDebounceId = setTimeout(() => {
            this.bodyDebounceId = null;
            this._ticketMountedLeadingFlushed = false;
            if (this.hasPendingBodyWork()) {
                this.flushBodyDispatch();
            }
        }, 150);
    }

    flushBodyDispatch() {
        const dispatch = { ...this.pendingDispatch };
        this.resetPendingDispatch();

        if (dispatch.notification) {
            this.app.initNotificationPanels();
        }

        if (dispatch.ticketMounted) {
            this.app.initTicketSectionFeatures();
            this.refreshComplaintQueueVisibilityObserver();
            if (this.app.features.highlightNewAccounts || this.app.features.highlightComplaintTriggers) {
                this.app._reapplyTicketRowHighlights();
            }
        }

        if (dispatch.currentServerMods) {
            this.app.moderatorService.highlightSavedModerators();
        }

        if (dispatch.currentServer) {
            this.app.initCurrentServerFeatures();
        }

        if (dispatch.tableEnhancements) {
            this.app.initTableFeatures();
            this.refreshComplaintQueueTableObservers();
            this.app._reapplyTicketRowHighlights();
        }

        if (dispatch.punishmentDialog && this.app.features.autoPunishmentDuration !== false) {
            this.app.punishmentService.scheduleScan();
        }
    }

    isRelevantNotificationNode(node) {
        if (!node || node.nodeType !== 1) {
            return false;
        }

        if (node.closest?.('.ioh-panel')) {
            return false;
        }

        if (node.matches?.('textarea') || node.matches?.('[role="dialog"]')) {
            return true;
        }

        const text = node.textContent || '';
        if (text.includes('Отправить уведомление')) {
            return true;
        }

        return Boolean(node.querySelector?.('textarea, [role="dialog"]'));
    }

    isRelevantTicketMountNode(node) {
        if (!node || node.nodeType !== 1) {
            return false;
        }

        if (
            node.closest?.('.ioh-panel') ||
            node.closest?.('.ioh-info-badge') ||
            node.closest?.('.ioh-account-created') ||
            node.closest?.('.ioh-faceit-elo') ||
            node.closest?.('#ioh-ticket-punishment-actions') ||
            node.closest?.('.ioh-ticket-punishment-actions')
        ) {
            return false;
        }

        if (node.matches?.('textarea[placeholder*="Опишите детали закрытия"]')) {
            return true;
        }
        if (node.matches?.('textarea') || node.matches?.('h3')) {
            return true;
        }
        if (node.querySelector?.('textarea[placeholder*="Опишите детали закрытия"]')) {
            return true;
        }
        if (node.querySelector?.('h3')) {
            return true;
        }
        if (node.textContent?.includes('История Чата') || node.textContent?.includes('Нарушитель')) {
            return true;
        }

        return false;
    }

    isCurrentServerNode(node) {
        if (!node || node.nodeType !== 1) {
            return false;
        }

        if (node.matches?.('h3') && node.textContent?.includes('Текущий сервер')) {
            return true;
        }

        if (node.querySelector?.('h3')) {
            return Array.from(node.querySelectorAll('h3'))
                .some(h => h.textContent?.includes('Текущий сервер'));
        }

        return false;
    }

    isPunishmentDialogNode(node) {
        if (!node || node.nodeType !== 1) {
            return false;
        }

        return this.app.punishmentService.isRelevantNode(node);
    }

    initTablesRowsObserver() {
        this.teardownTablesRowsObserver();

        this.tablesRowsObserver = new MutationObserver((mutations) => {
            const newRows = new Set();
            const updatedRows = new Set();

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes || []) {
                    if (!node || node.nodeType !== 1) {
                        continue;
                    }

                    if (node.matches?.('tr')) {
                        if (!this.isComplaintQueueRow(node)) {
                            newRows.add(node);
                        }
                        continue;
                    }

                    const nestedRows = node.querySelectorAll?.('tr') || [];
                    nestedRows.forEach(row => {
                        if (!this.isComplaintQueueRow(row)) {
                            newRows.add(row);
                        }
                    });
                }

                const target = mutation.target;
                const row = target?.nodeType === 1
                    ? target.closest?.('tbody tr')
                    : target?.parentElement?.closest?.('tbody tr');
                if (row && !newRows.has(row) && !this.isComplaintQueueRow(row)) {
                    updatedRows.add(row);
                }
            }

            if (newRows.size) {
                newRows.forEach(row => this.app._applyRowHighlights(row));
            }

            if (updatedRows.size) {
                this.scheduleRowHighlights(updatedRows);
            }
        });

        this.app._reapplyTicketRowHighlights();
        this.refreshComplaintQueueTableObservers();
        this.tablesRowsObserver.observe(this.document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    scheduleRowHighlights(rows) {
        if (!rows.size) {
            return;
        }

        if (this.tablesRowsRafId) {
            cancelAnimationFrame(this.tablesRowsRafId);
        }

        const rowsToUpdate = rows;
        this.tablesRowsRafId = requestAnimationFrame(() => {
            this.tablesRowsRafId = null;
            rowsToUpdate.forEach(row => this.app._applyRowHighlights(row));
        });
    }

    findTicketPanelRoots() {
        const roots = new Set();
        const textarea = this.app.ticketService.findVisibleTicketResolutionTextarea();
        const scope = textarea?.closest('section, article, main, [role="main"]');
        if (scope) {
            roots.add(scope);
        }

        this.document.querySelectorAll('[role="tabpanel"]').forEach(panel => {
            if (panel.closest('section, article, main, [role="main"]')) {
                roots.add(panel);
            }
        });

        // Open complaint overlay is often an aria-hidden=false panel outside <main>.
        this.document.querySelectorAll('[aria-hidden="false"]').forEach(panel => {
            if (this.isCurrentServerNode(panel) || this.isRelevantTicketMountNode(panel)) {
                roots.add(panel);
            }
        });

        return roots;
    }

    findComplaintQueueVisibilityRoots() {
        const roots = new Set(this.findTicketPanelRoots());

        if (!this.app.messageService._isComplaintQueuePage()) {
            return roots;
        }

        const main = this.document.querySelector('main');
        if (main) {
            roots.add(main);
        }

        this.app.ticketService.findComplaintQueueTables().forEach(table => {
            const container = table.closest('section, article, [role="main"], [aria-hidden]') || table.parentElement;
            if (container) {
                roots.add(container);
            }
        });

        return roots;
    }

    refreshComplaintQueueVisibilityObserver() {
        const roots = this.findComplaintQueueVisibilityRoots();
        if (!roots.size) {
            return;
        }

        if (!this.ticketPanelVisibilityObserver) {
            this.ticketPanelVisibilityObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type !== 'attributes' || mutation.attributeName !== 'aria-hidden') {
                        continue;
                    }

                    if (this.app.ticketService.isExtensionUiElement(mutation.target)) {
                        continue;
                    }

                    if (mutation.target.getAttribute('aria-hidden') === 'true') {
                        continue;
                    }

                    this.scheduleTicketTabVisibilityRefresh();
                    return;
                }
            });
        }

        for (const root of roots) {
            if (this.observedTicketPanelRoots.has(root)) {
                continue;
            }

            this.observedTicketPanelRoots.add(root);
            this.ticketPanelVisibilityObserver.observe(root, {
                attributes: true,
                attributeFilter: ['aria-hidden'],
                subtree: true
            });
        }
    }

    scheduleTicketTabVisibilityRefresh() {
        if (this.ticketPanelVisibilityDebounceId) {
            clearTimeout(this.ticketPanelVisibilityDebounceId);
        }

        this.ticketPanelVisibilityDebounceId = setTimeout(() => {
            this.ticketPanelVisibilityDebounceId = null;
            this.app.onTicketTabVisibilityChange();
        }, 120);
    }
}

window.DOMCoordinator = DOMCoordinator;
