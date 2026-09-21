export const QueueCardsMethods = {
    findComplaintQueueTables() {
        const tables = Array.from(this.document.querySelectorAll('table'));

        return tables.filter(table => this.isComplaintQueueTable(table));
    },

    isComplaintQueueTable(table) {
        const thTexts = Array.from(table.querySelectorAll('thead th'))
            .map(th => (th.textContent || '').trim());

        if (thTexts.length < 6) {
            return false;
        }

        const hasTime = thTexts.some(t => t.includes('Время'));
        const hasServer = thTexts.some(t => t.includes('Сервер'));
        const hasSender = thTexts.some(t => t.includes('Отправитель'));
        const hasOffender = thTexts.some(t => t.includes('Нарушитель'));
        const hasReason = thTexts.some(t => t.includes('Причина'));

        return hasTime && hasServer && hasSender && hasOffender && hasReason;
    },

    findTicketTablesForCards() {
        return this.findComplaintQueueTables();
    },

    renderSquareTicketCards() {
        const tables = this.findComplaintQueueTables();

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
    },

    clearSquareTicketCards() {
        this.document.querySelectorAll('table.ioh-ticket-cards-enabled').forEach(table => {
            table.classList.remove('ioh-ticket-cards-enabled');
            table.querySelectorAll('td[data-ioh-label]').forEach(td => {
                td.removeAttribute('data-ioh-label');
            });
        });
    },
};
