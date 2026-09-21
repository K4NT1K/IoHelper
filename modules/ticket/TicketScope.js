export const TicketScopeMethods = {
    getChatCacheKey(textarea) {
        const scope = this.getTicketScopeRoot(textarea);
        const blocks = this.getHistoryBlocks(scope);
        const offenderId = blocks.offenderSteamId || 'unknown';
        const scopeToken = scope?.getAttribute?.('aria-hidden') ?? scope?.className?.slice(0, 40) ?? '';
        const path = window.location.pathname || window.location.href;
        return `${path}|${offenderId}|${scopeToken}`;
    },

    getHistoryBlocks(scope, {force = false} = {}) {
        const root = scope || this.document.body;
        if (!this._scopeCache) {
            this._scopeCache = new WeakMap();
        }

        const cached = force ? null : this._scopeCache.get(root);
        if (cached && this.isHistoryCacheValid(cached)) {
            return cached;
        }

        const next = {
            chat: this.getBlockByHeaderScoped('История Чата', root),
            mute: this.getBlockByHeaderScoped('История Мутов', root),
            ban: this.getBlockByHeaderScoped('История Банов', root)
                || this.getBlockByHeaderScoped('История банов', root),
            warning: this.getWarningHistoryBlockScoped(root),
            offenderSteamId: this.extractSteamIdFromField(
                this.findInfoFieldScoped('Нарушитель', root)
            ) || 'unknown'
        };
        if (next.chat) {
            this._scopeCache.set(root, next);
        }
        return next;
    },

    isHistoryCacheValid(cached) {
        if (!cached) {
            return false;
        }

        return [
            [cached.chat, ['История Чата']],
            [cached.mute, ['История Мутов']],
            [cached.ban, ['История Банов', 'История банов']],
            [cached.warning, ['История предупреждений', 'История Предупреждений']]
        ].every(([node, labels]) => this.isCachedHistoryNodeValid(node, labels));
    },

    isCachedHistoryNodeValid(node, labels) {
        if (!node) {
            return true;
        }
        if (!this.document.contains(node)) {
            return false;
        }
        const text = node.textContent || '';
        return labels.some(label => text.includes(label));
    },

    invalidateHistoryCache(scope) {
        if (!this._scopeCache) {
            this._scopeCache = new WeakMap();
            return;
        }
        if (scope) {
            this._scopeCache.delete(scope);
            return;
        }
        this._scopeCache = new WeakMap();
    },

    getTicketScopeRoot(textarea) {
        if (!textarea) {
            return this.document.body;
        }

        let element = textarea.parentElement;
        while (element && element !== this.document.body) {
            if (element.hasAttribute?.('aria-hidden') || element.matches?.('section, article, main, [role="main"]')) {
                return element;
            }
            element = element.parentElement;
        }

        return textarea.closest('section, article, main, [role="main"]')
            || textarea.parentElement
            || this.document.body;
    },

    isVisibleTicketTextarea(textarea) {
        if (!textarea || !this.document.contains(textarea)) {
            return false;
        }

        let element = textarea;
        while (element) {
            if (element.getAttribute?.('aria-hidden') === 'true') {
                return false;
            }

            const style = window.getComputedStyle?.(element);
            if (style?.display === 'none' || style?.visibility === 'hidden') {
                return false;
            }

            element = element.parentElement;
        }

        return textarea.getClientRects().length > 0;
    },

    findVisibleTicketResolutionTextarea() {
        const textareas = this.document.querySelectorAll('textarea[placeholder*="Опишите детали закрытия"]');
        for (const textarea of textareas) {
            if (this.isVisibleTicketTextarea(textarea)) {
                return textarea;
            }
        }

        return null;
    },

    isComplaintPage() {
        const path = window.location.pathname || '';
        return /\/support\/(ticket|report)\b|\/ticket\/|\/reports?\//i.test(path);
    },

    isOpenComplaintScope(scopeEl) {
        if (!scopeEl) {
            return false;
        }

        const hasOffender = this.findInfoFieldScoped('Нарушитель', scopeEl);
        const hasPlayerInfo = Array.from(scopeEl.querySelectorAll('h3')).some(
            header => header.textContent.includes('Информация об игроках')
        );

        return Boolean(hasOffender || hasPlayerInfo);
    },

    isActiveComplaintScope(scopeEl) {
        if (!scopeEl || !this.document.contains(scopeEl) || !this.isOpenComplaintScope(scopeEl)) {
            return false;
        }

        let element = scopeEl;
        while (element && element !== this.document.body) {
            const ariaHidden = element.getAttribute?.('aria-hidden');
            if (ariaHidden === 'true') {
                return false;
            }
            if (ariaHidden === 'false') {
                return true;
            }
            element = element.parentElement;
        }

        return true;
    },

    findActiveComplaintScope() {
        const hiddenFalsePanels = this.document.querySelectorAll('[aria-hidden="false"]');
        for (const panel of hiddenFalsePanels) {
            if (this.isOpenComplaintScope(panel)) {
                return panel;
            }
        }

        const structuralScopes = this.document.querySelectorAll('section, article, main, [role="main"]');
        for (const scope of structuralScopes) {
            if (this.isActiveComplaintScope(scope)) {
                return scope;
            }
        }

        return null;
    },

    isSitePunishmentDialogOpen() {
        return Boolean(this.document.querySelector('[role="dialog"][data-state="open"]'));
    },

    isTargetPunishmentDialogOpen(type) {
        const inputSelector = type === 'ban' ? '#ban-steamid64' : '#mute-steamid64';
        return Boolean(this.document.querySelector(`[role="dialog"][data-state="open"] ${inputSelector}`));
    },

    getHistoryAccordionButton(textMatch, scopeEl) {
        const root = scopeEl || this.document.body;
        return Array.from(root.querySelectorAll('button[aria-expanded]')).find(button => {
            const text = (button.textContent || '').replace(/\s+/g, ' ');
            return text.includes(textMatch);
        }) || null;
    },

    findCardSurface(el) {
        let node = el;
        while (node && node !== this.document.body) {
            if (node.getAttribute?.('data-pet-surface') === 'card') {
                return node;
            }
            if (node.attributes) {
                for (const attr of node.attributes) {
                    if (attr.name.startsWith('data-') && attr.value === 'card') {
                        return node;
                    }
                }
            }
            node = node.parentElement;
        }
        return null;
    },

    getHistorySectionCard(textMatch, scopeEl) {
        const accordion = this.getHistoryAccordionButton(textMatch, scopeEl);
        if (accordion) {
            return this.findCardSurface(accordion) || null;
        }

        const root = scopeEl || this.document.body;
        const header = Array.from(root.querySelectorAll('h3')).find(h3 =>
            (h3.textContent || '').includes(textMatch)
        );
        if (!header) {
            return null;
        }

        return this.findCardSurface(header) || null;
    },

    isChatHistoryEmptyScoped(scopeEl) {
        const accordion = this.getHistoryAccordionButton('История Чата', scopeEl);
        if (accordion) {
            const hasEmptyBadge = Array.from(accordion.querySelectorAll('span'))
                .some(span => (span.textContent || '').trim() === 'Пусто');
            if (hasEmptyBadge) {
                return true;
            }

            const card = this.getHistorySectionCard('История Чата', scopeEl);
            const cardText = card?.innerText || '';
            if (cardText.includes('Чат пуст')) {
                return true;
            }

            const rows = Array.from(card?.querySelectorAll('tbody tr, tr') || [])
                .filter(row => row.querySelector('td'));
            return rows.length === 0;
        }

        const chatHistoryBlock = this.getBlockByHeaderScoped('История Чата', scopeEl);
        if (!chatHistoryBlock || chatHistoryBlock.style.display === 'none') {
            return true;
        }

        if ((chatHistoryBlock.innerText || '').includes('Чат пуст')) {
            return true;
        }

        const rows = Array.from(chatHistoryBlock.querySelectorAll('tbody tr, tr'))
            .filter(row => row.querySelector('td'));
        return rows.length === 0;
    },

    /**
     * Chat is "settled" only when we know the final empty/non-empty state:
     * explicit Пусто / «Чат пуст», or at least one message row.
     * Missing table / zero rows without empty markers = still loading.
     */
    isChatHistorySettledScoped(scopeEl) {
        const accordion = this.getHistoryAccordionButton('История Чата', scopeEl);
        if (accordion) {
            const hasEmptyBadge = Array.from(accordion.querySelectorAll('span'))
                .some(span => (span.textContent || '').trim() === 'Пусто');
            if (hasEmptyBadge) {
                return true;
            }

            const card = this.getHistorySectionCard('История Чата', scopeEl);
            if ((card?.innerText || '').includes('Чат пуст')) {
                return true;
            }

            const rows = Array.from(card?.querySelectorAll('tbody tr, tr') || [])
                .filter(row => row.querySelector('td'));
            return rows.length > 0;
        }

        const chatHistoryBlock = this.getBlockByHeaderScoped('История Чата', scopeEl);
        if (!chatHistoryBlock) {
            return false;
        }

        if ((chatHistoryBlock.innerText || '').includes('Чат пуст')) {
            return true;
        }

        const rows = Array.from(chatHistoryBlock.querySelectorAll('tbody tr, tr'))
            .filter(row => row.querySelector('td'));
        return rows.length > 0;
    },

    async waitForSettledChatHistory(textarea, {timeoutMs = 2000, pollMs = 120} = {}) {
        if (!textarea || !this.document.contains(textarea)) {
            return false;
        }

        const scopeNow = this.getTicketScopeRoot(textarea);
        if (this.isChatHistorySettledScoped(scopeNow)) {
            return true;
        }

        return new Promise(resolve => {
            let settled = false;
            const startedAt = Date.now();
            const observeRoot = this.getTicketScopeRoot(textarea) || this.document.body;

            const cleanup = () => {
                observer.disconnect();
                clearInterval(intervalId);
            };

            const finish = (ok) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                resolve(ok);
            };

            const check = () => {
                if (!this.document.contains(textarea)) {
                    finish(false);
                    return;
                }

                const scope = this.getTicketScopeRoot(textarea);
                if (this.isChatHistorySettledScoped(scope)) {
                    this.invalidateHistoryCache(scope);
                    finish(true);
                    return;
                }

                if (Date.now() - startedAt >= timeoutMs) {
                    console.log('[Helper] chat history: settle timeout');
                    finish(false);
                }
            };

            const observer = new MutationObserver(() => check());
            observer.observe(observeRoot, {childList: true, subtree: true, characterData: true});
            const intervalId = setInterval(check, pollMs);
            check();
        });
    },

    HISTORY_SECTION_LABELS: [
        'История Чата',
        'История Мутов',
        'История Банов',
        'История банов',
        'История предупреждений',
        'История Предупреждений',
        'История Тикетов'
    ],

    isHistoryAccordionEmpty(textMatch, scopeEl) {
        const accordion = this.getHistoryAccordionButton(textMatch, scopeEl);
        if (!accordion) {
            return false;
        }

        return Array.from(accordion.querySelectorAll('span'))
            .some(span => (span.textContent || '').trim() === 'Пусто');
    },

    cardHasForeignHistoryHeader(node, textMatch) {
        if (!node) {
            return false;
        }

        const headers = [
            ...node.querySelectorAll('h3'),
            ...node.querySelectorAll('button[aria-expanded]')
        ];

        return headers.some(header => {
            const text = header.textContent || '';
            return this.HISTORY_SECTION_LABELS.some(label =>
                label !== textMatch && text.includes(label)
            );
        });
    },

    isDedicatedHistoryCard(node, textMatch) {
        if (!node) {
            return false;
        }

        const ownHeaders = [
            ...node.querySelectorAll('h3'),
            ...node.querySelectorAll('button[aria-expanded]')
        ];
        const hasOwnHeader = ownHeaders.some(header =>
            (header.textContent || '').includes(textMatch)
        );
        if (!hasOwnHeader) {
            return false;
        }

        return !this.cardHasForeignHistoryHeader(node, textMatch);
    },

    getBlockByHeaderScoped(textMatch, scopeEl) {
        const root = scopeEl || this.document.body;
        if (this.isHistoryAccordionEmpty(textMatch, root)) {
            return null;
        }

        const headers = Array.from(root.querySelectorAll('h3'));
        const targetHeader = headers.find(h3 => (h3.textContent || '').includes(textMatch));
        if (targetHeader) {
            const headerCard = this.findCardSurface(targetHeader);
            if (headerCard?.querySelector('table') && this.isDedicatedHistoryCard(headerCard, textMatch)) {
                return headerCard;
            }

            let parent = targetHeader.parentElement;
            while (parent && parent !== this.document.body) {
                if (this.cardHasForeignHistoryHeader(parent, textMatch)) {
                    break;
                }
                if (parent.querySelector('table') && this.isDedicatedHistoryCard(parent, textMatch)) {
                    return parent;
                }
                parent = parent.parentElement;
            }
        }

        const card = this.getHistorySectionCard(textMatch, scopeEl);
        if (card?.querySelector('table') && this.isDedicatedHistoryCard(card, textMatch)) {
            return card;
        }

        return null;
    },

    getBlockByHeader(textMatch) {
        return this.getBlockByHeaderScoped(textMatch, this.document.body);
    },

    isExtensionUiElement(element) {
        return Boolean(
            element?.closest('[data-ioh], .ioh-analysis-row, .ioh-analysis-label, .ioh-analysis-value, #mod-ticket-panel, #mod-notif-panel, #helper-suggest-badge, #ioh-ticket-punishment-actions, #ioh-ticket-issue-mute, #ioh-ticket-issue-ban, .ioh-badge-row, .ioh-account-created, .ioh-faceit-elo')
        );
    },

    _isElementVisible(element) {
        if (!element?.isConnected) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    },

    findInfoFieldScoped(labelText, scopeEl) {
        const root = scopeEl || this.document.body;
        const label = Array.from(root.querySelectorAll('span, div'))
            .find(element => !this.isExtensionUiElement(element) && element.textContent.trim() === labelText);

        return label?.parentElement || null;
    },

    findInfoField(labelText) {
        const label = Array.from(this.document.querySelectorAll('span, div'))
            .find(element => !this.isExtensionUiElement(element) && element.textContent.trim() === labelText);

        return label?.parentElement || null;
    },

    findInfoFieldByLabels(labelTexts) {
        for (const labelText of labelTexts) {
            const field = this.findInfoField(labelText);
            if (field) {
                return field;
            }
        }

        return null;
    },

    findFieldValueBlock(field) {
        if (!field) {
            return null;
        }

        return Array.from(field.children).find(child => child.tagName === 'DIV') || null;
    },

    extractSteamIdFromField(field) {
        const valueBlock = this.findFieldValueBlock(field);
        const profileLink = valueBlock?.querySelector('a[href*="cybershoke.net/"], a[href*="/moderator/profile/"]');
        const sourceText = `${profileLink?.href || ''} ${profileLink?.textContent || ''}`;
        const steamIdMatch = sourceText.match(/\d{17,18}/);

        return steamIdMatch ? steamIdMatch[0] : null;
    },
};
