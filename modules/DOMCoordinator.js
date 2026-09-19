import { isIohNode } from './shared/dom.js';

export class DOMCoordinator {
    constructor(app) {
        this.app = app;
        this.document = app.document;
        this.listeners = new Map();
        this.pending = new Set();
        this.bodyObserver = null;
        this.bodyDebounceId = null;
        this._ticketMountedLeadingFlushed = false;
        this.tablesRowsRafId = null;
        this.complaintQueueTableObservers = new Map();
        this.ticketPanelVisibilityObserver = null;
        this.ticketPanelVisibilityDebounceId = null;
        this.observedTicketPanelRoots = new WeakSet();
    }

    on(event, handler) {
        const list = this.listeners.get(event) || [];
        list.push(handler);
        this.listeners.set(event, list);
        return () => {
            this.listeners.set(
                event,
                (this.listeners.get(event) || []).filter(item => item !== handler)
            );
        };
    }

    emit(event) {
        this.pending.add(event);
    }

    notify(event) {
        this.emit(event);
        this.scheduleFlush();
    }

    init() {
        console.log('[Helper] DOMCoordinator: init');
        this.initBodyObserver();
        this.refreshComplaintQueueTableObservers();
        this.refreshComplaintQueueVisibilityObserver();
        this.emit('notification');
        this.emit('currentServerMods');
        this.emit('tableAdded');
        this.flush();
    }

    teardownAll() {
        console.log('[Helper] DOMCoordinator: teardownAll');
        this.teardownBodyObserver();
        this.teardownComplaintQueueTableObservers();
        this.teardownTicketPanelVisibilityObserver();
        if (this.tablesRowsRafId) {
            cancelAnimationFrame(this.tablesRowsRafId);
            this.tablesRowsRafId = null;
        }
        this.pending.clear();
    }

    teardownBodyObserver() {
        if (this.bodyObserver) {
            this.bodyObserver.disconnect();
            this.bodyObserver = null;
            console.log('[Helper] DOMCoordinator: bodyObserver teardown');
        }
        if (this.bodyDebounceId) {
            clearTimeout(this.bodyDebounceId);
            this.bodyDebounceId = null;
        }
        this._ticketMountedLeadingFlushed = false;
        this.pending.clear();
    }

    teardownComplaintQueueTableObservers() {
        if (this.complaintQueueTableObservers.size) {
            console.log(`[Helper] DOMCoordinator: complaintQueueTableObservers teardown (${this.complaintQueueTableObservers.size})`);
        }
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
            if (isIohNode(mutation.target)) {
                continue;
            }
            for (const node of mutation.addedNodes || []) {
                if (!node || node.nodeType !== 1 || isIohNode(node)) {
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
        console.log('[Helper] DOMCoordinator: complaintQueueTableObserver init');
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
            console.log('[Helper] DOMCoordinator: ticketPanelVisibilityObserver teardown');
        }
        if (this.ticketPanelVisibilityDebounceId) {
            clearTimeout(this.ticketPanelVisibilityDebounceId);
            this.ticketPanelVisibilityDebounceId = null;
        }
        this.observedTicketPanelRoots = new WeakSet();
    }

    scheduleFlush() {
        const leadingTicketFlush = this.pending.has('ticketMounted') && !this._ticketMountedLeadingFlushed;

        if (this.bodyDebounceId) {
            clearTimeout(this.bodyDebounceId);
        }

        if (leadingTicketFlush) {
            this._ticketMountedLeadingFlushed = true;
            this.flush();
        }

        this.bodyDebounceId = setTimeout(() => {
            this.bodyDebounceId = null;
            this._ticketMountedLeadingFlushed = false;
            if (this.pending.size) {
                this.flush();
            }
        }, 150);
    }

    flush() {
        const events = [...this.pending];
        this.pending.clear();
        if (events.length) {
            console.log('[Helper] DOMCoordinator: flush', events.join(', '));
        }
        for (const event of events) {
            for (const handler of this.listeners.get(event) || []) {
                handler();
            }
        }
    }

    initBodyObserver() {
        if (this.bodyObserver) {
            this.bodyObserver.disconnect();
        }

        console.log('[Helper] DOMCoordinator: bodyObserver init');
        this.bodyObserver = new MutationObserver((mutations) => {
            const rowsToUpdate = new Set();

            for (const mutation of mutations) {
                if (isIohNode(mutation.target)) {
                    continue;
                }

                if (mutation.type === 'attributes') {
                    if (mutation.attributeName !== 'aria-hidden') {
                        continue;
                    }

                    const target = mutation.target;
                    if (!target || target.nodeType !== 1) {
                        continue;
                    }
                    if (this.app.ticketService.isExtensionUiElement(target) || isIohNode(target)) {
                        continue;
                    }
                    if (target.getAttribute('aria-hidden') === 'true') {
                        continue;
                    }

                    if (this.isCurrentServerNode(target)) {
                        this.emit('currentServerMods');
                    }
                    continue;
                }

                for (const node of mutation.addedNodes || []) {
                    if (!node || node.nodeType !== 1 || isIohNode(node)) {
                        continue;
                    }
                    this.inspectAddedNode(node, rowsToUpdate);
                }
            }

            if (this.pending.size) {
                this.scheduleFlush();
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
            this.emit('notification');
        }

        if (this.isRelevantTicketMountNode(node)) {
            this.emit('ticketMounted');
        }

        if (this.isCurrentServerNode(node) || node.querySelector?.('a[href*="cybershoke.net/"]')) {
            this.emit('currentServerMods');
        }

        if (node.matches?.('table, tr') || node.querySelector?.('table, tr')) {
            this.emit('tableAdded');
        }

        if (this.isPunishmentDialogNode(node)) {
            this.emit('punishmentDialog');
        }

        if (node.matches?.('tr')) {
            rowsToUpdate.add(node);
        } else {
            const nestedRows = node.querySelectorAll?.('tr') || [];
            nestedRows.forEach(row => rowsToUpdate.add(row));
        }

        if (node.matches?.('[role="tabpanel"]') || node.querySelector?.('[role="tabpanel"]')) {
            this.emit('ticketMounted');
        }
    }

    isRelevantNotificationNode(node) {
        if (!node || node.nodeType !== 1) {
            return false;
        }

        if (isIohNode(node) || node.closest?.('.ioh-panel')) {
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

    isExtensionOrHelperNode(node) {
        return isIohNode(node) || this.app.ticketService.isExtensionUiElement(node);
    }

    isRelevantTicketMountNode(node) {
        if (!node || node.nodeType !== 1) {
            return false;
        }

        if (this.isExtensionOrHelperNode(node) || this.isCurrentServerNode(node)) {
            return false;
        }

        if (node.matches?.('textarea[placeholder*="Опишите детали закрытия"]')) {
            return true;
        }

        if (node.querySelector?.('textarea[placeholder*="Опишите детали закрытия"]')) {
            return true;
        }

        const headers = node.matches?.('h3')
            ? [node]
            : Array.from(node.querySelectorAll?.('h3') || []);
        return headers.some(h =>
            h.textContent?.includes('Информация тикета')
            || h.textContent?.includes('Информация об игроках')
        );
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
            console.log('[Helper] DOMCoordinator: ticketPanelVisibilityObserver init');
            this.ticketPanelVisibilityObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type !== 'attributes' || mutation.attributeName !== 'aria-hidden') {
                        continue;
                    }

                    if (isIohNode(mutation.target) || this.app.ticketService.isExtensionUiElement(mutation.target)) {
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
