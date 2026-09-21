import { markIoh } from '../shared/dom.js';

export const PunishmentPanelMethods = {
    _isExtensionPunishmentButton(button) {
        return button?.id === this.TICKET_MUTE_BUTTON_ID
            || button?.id === this.TICKET_BAN_BUTTON_ID
            || Boolean(button?.closest(`#${this.TICKET_PUNISHMENT_ACTIONS_ID}`));
    },

    async loadModeratorPermissions() {
        let permissions = null;

        if (this.chrome?.storage?.local) {
            try {
                const result = await this.chrome.storage.local.get(this.MODERATOR_PERMISSIONS_KEY);
                if (result[this.MODERATOR_PERMISSIONS_KEY]) {
                    permissions = result[this.MODERATOR_PERMISSIONS_KEY];
                }
            } catch (error) {
                // ignore storage errors
            }
        }

        if (!permissions) {
            try {
                const sessionRaw = sessionStorage.getItem(this.MODERATOR_PERMISSIONS_KEY);
                if (sessionRaw) {
                    permissions = JSON.parse(sessionRaw);
                }
            } catch (error) {
                // ignore session storage errors
            }
        }

        this.canIssueMute = Boolean(permissions?.mute);
        this.canIssueBan = Boolean(permissions?.ban);
        this.mutePanelReady = Boolean(permissions?.mutePanelReady);
        this.banPanelReady = Boolean(permissions?.banPanelReady);
        this._permissionsHydrated = true;
    },

    isPunishmentDebugEnabled() {
        try {
            return localStorage.getItem('iohDebugPunishment') === '1';
        } catch (error) {
            return false;
        }
    },

    debugPunishmentLog(reason, details = {}) {
        if (!this.isPunishmentDebugEnabled()) {
            return;
        }

        console.warn(`[IO Helper][punishment] ${reason}`, details);
    },

    recordPunishmentOpenSuccess() {
        this._punishmentInitFailCount = 0;
    },

    handlePunishmentOpenFailure(type) {
        this.resetPanelReady(type);

        if (type === 'ban') {
            this._cachedOpenBanHandler = null;
            this._cachedBanIssueButton = null;
        } else {
            this._cachedOpenMuteHandler = null;
            this._cachedMuteIssueButton = null;
        }

        this._punishmentInitFailCount += 1;

        if (this._punishmentInitFailCount < 2) {
            return;
        }

        this._punishmentInitFailCount = 0;

        if (type === 'ban') {
            this.canIssueBan = false;
        } else {
            this.canIssueMute = false;
        }

        void this._persistModeratorPermissions();
        this.refreshComplaintPunishmentButtons();
    },

    async persistPanelReadyState() {
        await this._persistModeratorPermissions();
    },

    isPanelReadyForType(type) {
        return type === 'ban' ? this.banPanelReady : this.mutePanelReady;
    },

    resetPanelReady(type) {
        if (type === 'ban') {
            this.banPanelReady = false;
            this._cachedOpenBanHandler = null;
            this._cachedBanIssueButton = null;
            return;
        }

        this.mutePanelReady = false;
        this._cachedOpenMuteHandler = null;
        this._cachedMuteIssueButton = null;
    },

    getCachedIssueButton(type) {
        const button = type === 'ban' ? this._cachedBanIssueButton : this._cachedMuteIssueButton;
        return button?.isConnected ? button : null;
    },

    getLastKnownIssueButton(type) {
        return type === 'ban' ? this._cachedBanIssueButton : this._cachedMuteIssueButton;
    },

    getCachedIssueHandler(type) {
        const handler = type === 'ban' ? this._cachedOpenBanHandler : this._cachedOpenMuteHandler;
        return typeof handler === 'function' ? handler : null;
    },

    isManagementPanelMounted(type) {
        return Boolean(this.findSiteIssueButtonForType(type, {requireVisible: false}));
    },

    findSiteIssueButtonForType(type, options = {}) {
        return this.findSiteIssueButtonInSection(
            this.getManagementSectionTitleForType(type),
            options
        );
    },

    resolveIssueButtonForType(type) {
        const sectionTitle = this.getManagementSectionTitleForType(type);
        let button = this.getCachedIssueButton(type)
            ?? this.findSiteIssueButtonForType(type, { requireVisible: false });

        if (!button?.isConnected) {
            button = this.findSiteIssueButtonForType(type, { requireVisible: false });
        }

        if (!button || !this._isButtonInSection(button, sectionTitle)) {
            return null;
        }

        this._cacheIssueHandlerFromButton(button, type);
        return button;
    },

    markPanelReady(type) {
        if (type === 'ban') {
            this.banPanelReady = true;
        } else {
            this.mutePanelReady = true;
        }
    },

    suppressPermissionScan() {
        this._permissionScanSuppressed += 1;
    },

    releasePermissionScan() {
        if (this._permissionScanSuppressed > 0) {
            this._permissionScanSuppressed -= 1;
        }
    },

    _handleManagementPanelVisibilityForScan() {
        const muteActive = this.isMuteManagementPanelActive();
        const banActive = this.isBanManagementPanelActive();

        if (this._permissionScanSuppressed > 0) {
            this._wasMutePanelActive = muteActive;
            this._wasBanPanelActive = banActive;
            return;
        }

        const shouldScan = (muteActive && !this._wasMutePanelActive)
            || (banActive && !this._wasBanPanelActive);

        this._wasMutePanelActive = muteActive;
        this._wasBanPanelActive = banActive;

        if (shouldScan) {
            void this.scanModeratorPunishmentPermissions();
        }
    },

    _cancelPermissionRevoke(type) {
        const timerKey = type === 'ban' ? '_banRevokeDebounceId' : '_muteRevokeDebounceId';
        if (this[timerKey]) {
            clearTimeout(this[timerKey]);
            this[timerKey] = null;
        }
    },

    _schedulePermissionRevoke(type) {
        const timerKey = type === 'ban' ? '_banRevokeDebounceId' : '_muteRevokeDebounceId';
        this._cancelPermissionRevoke(type);
        this[timerKey] = setTimeout(() => {
            this[timerKey] = null;
            void this._tryRevokePermission(type);
        }, 500);
    },

    async _tryRevokePermission(type) {
        if (this._isUpdatingPunishmentButtons) {
            return;
        }

        const panelActive = type === 'ban' ? this.isBanManagementPanelActive() : this.isMuteManagementPanelActive();
        const button = type === 'ban' ? this.findSiteIssueBanButton() : this.findSiteIssueMuteButton();

        if (!panelActive || button) {
            return;
        }

        let changed = false;

        if (type === 'ban' && this.canIssueBan) {
            this.canIssueBan = false;
            this.banPanelReady = false;
            this._cachedOpenBanHandler = null;
            this._cachedBanIssueButton = null;
            changed = true;
        } else if (type === 'mute' && this.canIssueMute) {
            this.canIssueMute = false;
            this.mutePanelReady = false;
            this._cachedOpenMuteHandler = null;
            this._cachedMuteIssueButton = null;
            changed = true;
        }

        if (!changed) {
            return;
        }

        await this._persistModeratorPermissions();
        this.refreshComplaintPunishmentButtons();
    },

    async _persistModeratorPermissions() {
        const permissions = {
            mute: this.canIssueMute,
            ban: this.canIssueBan,
            mutePanelReady: this.mutePanelReady,
            banPanelReady: this.banPanelReady
        };

        try {
            sessionStorage.setItem(this.MODERATOR_PERMISSIONS_KEY, JSON.stringify(permissions));
        } catch (error) {
            // ignore session storage errors
        }

        if (!this.chrome?.storage?.local) {
            return;
        }

        try {
            await this.chrome.storage.local.set({
                [this.MODERATOR_PERMISSIONS_KEY]: permissions
            });
        } catch (error) {
            // ignore storage errors
        }
    },

    isMuteManagementRoute() {
        return /\/comms\/list\b/i.test(window.location.pathname || '');
    },

    isBanManagementRoute() {
        return /\/bans\/list\b/i.test(window.location.pathname || '');
    },

    getManagementRouteForType(type) {
        return type === 'ban' ? this.BAN_MANAGEMENT_ROUTE : this.MUTE_MANAGEMENT_ROUTE;
    },

    isMuteManagementPanelActive() {
        return this._isManagementPanelVisible('Управление мутами');
    },

    isBanManagementPanelActive() {
        return this._isManagementPanelVisible('Управление банами');
    },

    isMuteManagementPage() {
        return this.isMuteManagementPanelActive();
    },

    isBanManagementPage() {
        return this.isBanManagementPanelActive();
    },

    getManagementSectionTitleForType(type) {
        return type === 'ban' ? 'Управление банами' : 'Управление мутами';
    },

    isManagementPanelActiveForType(type) {
        return type === 'ban' ? this.isBanManagementPanelActive() : this.isMuteManagementPanelActive();
    },

    isManagementSpaTabOpen(type) {
        return Boolean(this.findSpaTabButton(this.getManagementSectionTitleForType(type)));
    },

    findAsideLauncherButton() {
        const aside = this.document.querySelector('aside');
        if (!aside) {
            return null;
        }

        const byReorderId = aside.querySelector(
            'button.glass-fx[data-reorder-id="6"], button[class*="glass-fx"][data-reorder-id="6"]'
        );
        if (byReorderId && !this.isExtensionUiElement(byReorderId)) {
            return byReorderId;
        }

        const byMenuIcon = Array.from(aside.querySelectorAll('button'))
            .filter(button => !this.isExtensionUiElement(button))
            .find(button => button.querySelector('use[href="#lc-menu"]'));
        if (byMenuIcon) {
            return byMenuIcon;
        }

        const byAriaExpanded = Array.from(aside.querySelectorAll('button[aria-expanded]'))
            .filter(button => !this.isExtensionUiElement(button) && !button.closest('nav'))
            .find(button => button.querySelector('svg'));
        if (byAriaExpanded) {
            return byAriaExpanded;
        }

        const buttons = Array.from(aside.querySelectorAll('button.glass-fx, button[class*="glass-fx"]'))
            .filter(button => !this.isExtensionUiElement(button) && !button.closest('nav'));

        return buttons.find(button => button.querySelector('svg')) || buttons[0] || null;
    },

    findAsideManagementLink(type) {
        const route = this.getManagementRouteForType(type);
        const aside = this.document.querySelector('aside');
        if (!aside) {
            return null;
        }

        const link = aside.querySelector(
            `nav a.glass-fx[href="${route}"], nav a[class*="glass-fx"][href="${route}"]`
        );

        if (link && !this.isExtensionUiElement(link)) {
            return link;
        }

        return null;
    },

    isAsideManagementNavVisible() {
        const muteLink = this.findAsideManagementLink('mute');
        const banLink = this.findAsideManagementLink('ban');
        return [muteLink, banLink].some(link => link && this._isElementVisible(link));
    },

    waitForAsideManagementNav(timeoutMs = 2000) {
        if (this.isAsideManagementNavVisible()) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const observer = new MutationObserver(() => {
                if (this.isAsideManagementNavVisible()) {
                    observer.disconnect();
                    resolve(true);
                } else if (Date.now() > deadline) {
                    observer.disconnect();
                    resolve(false);
                }
            });

            observer.observe(this.document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-hidden', 'class', 'style', 'data-state']
            });

            setTimeout(() => {
                observer.disconnect();
                resolve(this.isAsideManagementNavVisible());
            }, timeoutMs + 50);
        });
    },

    async openAsideManagementNav() {
        if (this.isAsideManagementNavVisible()) {
            return true;
        }

        const launcher = this.findAsideLauncherButton();
        if (!launcher) {
            this.debugPunishmentLog('aside_launcher_not_found');
            return false;
        }

        if (!this.dispatchElementClick(launcher)) {
            return false;
        }

        const opened = await this.waitForAsideManagementNav(5000);
        if (!opened) {
            this.debugPunishmentLog('aside_nav_not_opened');
        }

        return opened;
    },

    waitForSpaTabExists(tabLabel, timeoutMs = 3000) {
        if (this.findSpaTabButton(tabLabel)) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const observer = new MutationObserver(() => {
                if (this.findSpaTabButton(tabLabel)) {
                    observer.disconnect();
                    resolve(true);
                } else if (Date.now() > deadline) {
                    observer.disconnect();
                    resolve(false);
                }
            });

            observer.observe(this.document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-current', 'aria-hidden', 'class']
            });

            setTimeout(() => {
                observer.disconnect();
                resolve(Boolean(this.findSpaTabButton(tabLabel)));
            }, timeoutMs + 50);
        });
    },

    async openManagementTabViaAside(type) {
        const sectionTitle = this.getManagementSectionTitleForType(type);

        const navOpened = await this.openAsideManagementNav();
        if (!navOpened) {
            return false;
        }

        const link = this.findAsideManagementLink(type);
        if (!link || !this.dispatchElementClick(link)) {
            return false;
        }

        const tabExists = await this.waitForSpaTabExists(sectionTitle, 5000);
        if (!tabExists) {
            this.debugPunishmentLog('management_tab_not_created', {type, via: 'aside'});
            return false;
        }

        await this.waitForSpaTabActive(sectionTitle, 5000);
        return true;
    },

    findSpaTabCloseButton(tab) {
        if (!tab) {
            return null;
        }

        const closeUse = tab.querySelector('use[href="#lc-x"]');
        if (closeUse) {
            return closeUse.closest('span[role="button"]');
        }

        return Array.from(tab.querySelectorAll('span[role="button"]'))
            .find(span => span.querySelector('svg') && !span.querySelector('use[href="#lc-rotate-cw"]'))
            ?? null;
    },

    closeSpaTab(tabLabel) {
        const tab = this.findSpaTabButton(tabLabel);
        if (!tab) {
            return false;
        }

        const closeButton = this.findSpaTabCloseButton(tab);
        if (!closeButton) {
            return false;
        }

        return this.dispatchElementClick(closeButton);
    },

    closeManagementTab(type) {
        return this.closeSpaTab(this.getManagementSectionTitleForType(type));
    },

    findSpaTabButton(tabLabel) {
        if (!tabLabel) {
            return null;
        }

        const glassFxTabs = Array.from(this.document.querySelectorAll('nav button.glass-fx, nav button[class*="glass-fx"]'));

        for (const button of glassFxTabs) {
            if (this.isExtensionUiElement(button)) {
                continue;
            }

            const spans = Array.from(button.querySelectorAll('span'));
            if (spans.some(span => span.textContent.trim() === tabLabel)) {
                return button;
            }
        }

        return Array.from(this.document.querySelectorAll('nav button')).find(button => {
            if (this.isExtensionUiElement(button)) {
                return false;
            }

            return Array.from(button.querySelectorAll('span'))
                .some(span => span.textContent.trim() === tabLabel);
        }) || null;
    },

    _getAllSpaTabButtons() {
        return Array.from(this.document.querySelectorAll('nav button.glass-fx, nav button[class*="glass-fx"], nav button'))
            .filter(button => !this.isExtensionUiElement(button));
    },

    _getSpaTabLabelFromButton(button) {
        if (!button) {
            return null;
        }

        const labelSpan = Array.from(button.querySelectorAll('span'))
            .find(span => span.textContent.trim());

        return labelSpan ? labelSpan.textContent.trim() : null;
    },

    findSpaTabButtonFuzzy(tabLabel, options = {}) {
        const {isComplaintReturn = false} = options;

        if (!tabLabel) {
            return null;
        }

        const exact = this.findSpaTabButton(tabLabel);
        if (exact) {
            const exactLabel = this._getSpaTabLabelFromButton(exact);
            if (!isComplaintReturn || !this.isTicketListTabLabel(exactLabel)) {
                return exact;
            }
        }

        if (isComplaintReturn && tabLabel.toLowerCase() === 'тикет') {
            return this.findComplaintDetailSpaTab(null);
        }

        const normalizedLabel = tabLabel.toLowerCase();

        for (const button of this._getAllSpaTabButtons()) {
            const label = this._getSpaTabLabelFromButton(button);
            if (!label || this.isTicketListTabLabel(label)) {
                continue;
            }

            const normalized = label.toLowerCase();
            if (normalized === normalizedLabel) {
                return button;
            }

            if (normalized.startsWith(`${normalizedLabel} `) || normalized.startsWith(`${normalizedLabel}#`)) {
                return button;
            }
        }

        return null;
    },

    isTicketListTabLabel(label) {
        if (!label) {
            return false;
        }

        const normalized = label.toLowerCase().trim();
        return this.TICKET_LIST_TAB_LABELS.some(listLabel => {
            const listNormalized = listLabel.toLowerCase();
            return normalized === listNormalized || normalized.includes(listNormalized);
        });
    },

    extractTicketIdFromComplaintScope(scopeEl) {
        if (!scopeEl) {
            return null;
        }

        const headers = scopeEl.querySelectorAll('h3');
        for (const header of headers) {
            const text = header.textContent || '';
            const ticketMatch = text.match(/(?:тикет|ticket|жалоб)[^#]*#(\d+)/i);
            if (ticketMatch) {
                return ticketMatch[1];
            }

            const hashMatch = text.match(/#(\d+)/);
            if (hashMatch && /тикет|ticket|жалоб/i.test(text)) {
                return hashMatch[1];
            }
        }

        return null;
    },

    extractActiveComplaintTicketId() {
        const scope = this.findActiveComplaintScope() || this._lastPunishmentScope;
        return this.extractTicketIdFromComplaintScope(scope);
    },

    findSpaTabByTicketId(ticketId) {
        if (!ticketId) {
            return null;
        }

        const id = String(ticketId);
        return this._getAllSpaTabButtons().find(button => {
            const label = this._getSpaTabLabelFromButton(button);
            return label && label.includes(`#${id}`);
        }) || null;
    },

    findComplaintDetailSpaTab(ticketId = null) {
        if (ticketId) {
            const byId = this.findSpaTabByTicketId(ticketId);
            if (byId) {
                return byId;
            }
        }

        return this._getAllSpaTabButtons().find(button => {
            const label = this._getSpaTabLabelFromButton(button);
            if (!label || this.isTicketListTabLabel(label)) {
                return false;
            }

            const normalized = label.toLowerCase();
            return normalized === 'тикет'
                || /^тикет\s*#\d+/.test(normalized)
                || (normalized.startsWith('тикет ') && !normalized.includes('актуальные'));
        }) || null;
    },

    isComplaintDetailPath(pathname, ticketId = null) {
        const path = pathname || '';
        if (ticketId && path.includes(String(ticketId))) {
            return true;
        }

        return /\/(?:support\/(?:ticket|report)|tickets?|reports?)\/[\w-]+\/?$/i.test(path)
            && !/\/(?:support\/)?(?:tickets?|reports?)\/?$/i.test(path);
    },

    isComplaintScopeRestored() {
        return Boolean(this.findActiveComplaintScope());
    },

    waitForComplaintScopeRestored(timeoutMs = 3000) {
        if (this.isComplaintScopeRestored()) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const observer = new MutationObserver(() => {
                if (this.isComplaintScopeRestored()) {
                    observer.disconnect();
                    resolve(true);
                } else if (Date.now() > deadline) {
                    observer.disconnect();
                    resolve(false);
                }
            });

            observer.observe(this.document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-hidden', 'class', 'style']
            });

            setTimeout(() => {
                observer.disconnect();
                resolve(this.isComplaintScopeRestored());
            }, timeoutMs + 50);
        });
    },

    findNonManagementSpaTab(excludeLabels = []) {
        const managementLabels = ['Управление мутами', 'Управление банами'];
        const exclude = new Set([...managementLabels, ...excludeLabels]
            .map(label => label.toLowerCase()));

        return this._getAllSpaTabButtons().find(button => {
            const label = this._getSpaTabLabelFromButton(button);
            return label
                && !exclude.has(label.toLowerCase())
                && !this.isTicketListTabLabel(label);
        }) || null;
    },

    findActiveSpaTabButton() {
        return Array.from(this.document.querySelectorAll('nav button.glass-fx, nav button[class*="glass-fx"]'))
            .find(button => !this.isExtensionUiElement(button) && button.getAttribute('aria-current') === 'page')
            || null;
    },

    collectSpaTabLabelCandidates() {
        const candidates = [];
        const activeTab = this.findActiveSpaTabButton();

        if (activeTab) {
            const label = this._getSpaTabLabelFromButton(activeTab);
            if (label) {
                candidates.push(label);
            }
        }

        const headerTitle = this.document.querySelector('header span');
        if (headerTitle && !this.isExtensionUiElement(headerTitle)) {
            const text = headerTitle.textContent.trim();
            if (text && !candidates.includes(text)) {
                candidates.push(text);
            }
        }

        return candidates;
    },

    collectReturnTabContext() {
        const complaintScope = this.findActiveComplaintScope() || this._lastPunishmentScope;
        const isComplaintReturn = Boolean(complaintScope && this.isOpenComplaintScope(complaintScope));
        const ticketId = isComplaintReturn
            ? this.extractTicketIdFromComplaintScope(complaintScope)
            : null;

        let activeTabButton = this.findActiveSpaTabButton();
        if (!activeTabButton && isComplaintReturn) {
            activeTabButton = this.findComplaintDetailSpaTab(ticketId);
        }

        const tabLabelCandidates = this.collectSpaTabLabelCandidates();

        if (ticketId) {
            const ticketTab = this.findSpaTabByTicketId(ticketId);
            if (ticketTab) {
                activeTabButton = ticketTab;
                const ticketTabLabel = this._getSpaTabLabelFromButton(ticketTab);
                if (ticketTabLabel && !tabLabelCandidates.includes(ticketTabLabel)) {
                    tabLabelCandidates.unshift(ticketTabLabel);
                }
            }
        }

        const tabLabel = activeTabButton
            ? this._getSpaTabLabelFromButton(activeTabButton)
            : tabLabelCandidates[0] || null;

        return {
            pathname: window.location.pathname || '/',
            href: window.location.href,
            tabLabel,
            tabButton: activeTabButton,
            tabLabelCandidates,
            ticketId,
            isComplaintReturn
        };
    },

    isPathnameActive(pathname) {
        return Boolean(pathname && window.location.pathname === pathname);
    },

    navigateViaPushState(pathname) {
        const targetPath = pathname?.startsWith('/') ? pathname : `/${pathname || ''}`;
        if (!targetPath || window.location.pathname === targetPath) {
            return;
        }

        const targetUrl = `${window.location.origin}${targetPath}`;
        window.history.pushState(null, '', targetUrl);
        window.dispatchEvent(new PopStateEvent('popstate', {state: null}));
    },

    async restoreSpaTabFromContext(returnContext) {
        const {
            tabButton,
            tabLabel,
            tabLabelCandidates = [],
            pathname,
            ticketId,
            isComplaintReturn
        } = returnContext || {};

        const tryActivateTab = async (tab) => {
            if (!tab?.isConnected) {
                return false;
            }

            this.dispatchElementClick(tab);
            const activeLabel = this._getSpaTabLabelFromButton(tab);
            if (activeLabel) {
                await this.waitForSpaTabActive(activeLabel, 4000);
            }

            if (isComplaintReturn) {
                return this.waitForComplaintScopeRestored(3000);
            }

            return this.isPathnameActive(pathname)
                || (activeLabel ? this.isSpaTabActive(activeLabel) : false);
        };

        if (await tryActivateTab(tabButton)) {
            return true;
        }

        if (ticketId) {
            const ticketTab = this.findSpaTabByTicketId(ticketId);
            if (await tryActivateTab(ticketTab)) {
                return true;
            }
        }

        const labelsToTry = [...new Set([tabLabel, ...tabLabelCandidates].filter(Boolean))];
        for (const label of labelsToTry) {
            const tab = this.findSpaTabButton(label)
                || this.findSpaTabButtonFuzzy(label, {isComplaintReturn});
            if (await tryActivateTab(tab)) {
                return true;
            }
        }

        if (isComplaintReturn) {
            const complaintTab = this.findComplaintDetailSpaTab(ticketId);
            if (await tryActivateTab(complaintTab)) {
                return true;
            }
        } else {
            const tab = this.findNonManagementSpaTab(tabLabelCandidates);
            if (await tryActivateTab(tab)) {
                return true;
            }
        }

        const canUsePathFallback = pathname && (
            !isComplaintReturn || this.isComplaintDetailPath(pathname, ticketId)
        );
        if (canUsePathFallback) {
            this.navigateViaPushState(pathname);
            await new Promise(resolve => setTimeout(resolve, 150));

            if (isComplaintReturn && this.isComplaintScopeRestored()) {
                return true;
            }

            if (this.isPathnameActive(pathname)) {
                return true;
            }
        }

        return false;
    },

    findActiveSpaTabLabel() {
        const currentTab = this.findActiveSpaTabButton();

        if (currentTab) {
            const label = this._getSpaTabLabelFromButton(currentTab);
            if (label) {
                return label;
            }
        }

        const headerTitle = this.document.querySelector('header span');
        if (headerTitle && !this.isExtensionUiElement(headerTitle)) {
            const text = headerTitle.textContent.trim();
            if (text) {
                return text;
            }
        }

        return null;
    },

    isSpaTabActive(tabLabel) {
        if (!tabLabel) {
            return false;
        }

        const tab = this.findSpaTabButton(tabLabel);
        if (tab?.getAttribute('aria-current') === 'page') {
            return true;
        }

        const headerTitle = this.document.querySelector('header span');
        if (headerTitle && !this.isExtensionUiElement(headerTitle)) {
            return headerTitle.textContent.trim() === tabLabel;
        }

        return false;
    },

    waitForSpaTabActive(tabLabel, timeoutMs = 3000) {
        if (this.isSpaTabActive(tabLabel)) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const observer = new MutationObserver(() => {
                if (this.isSpaTabActive(tabLabel)) {
                    observer.disconnect();
                    resolve(true);
                } else if (Date.now() > deadline) {
                    observer.disconnect();
                    resolve(false);
                }
            });

            observer.observe(this.document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-current', 'aria-hidden', 'class']
            });

            setTimeout(() => {
                observer.disconnect();
                resolve(this.isSpaTabActive(tabLabel));
            }, timeoutMs + 50);
        });
    },

    dispatchElementClick(element) {
        if (!element) {
            return false;
        }

        const handler = this.extractReactClickHandler(element);
        const event = {
            preventDefault() {},
            stopPropagation() {},
            nativeEvent: new MouseEvent('click', {bubbles: true}),
            currentTarget: element,
            target: element
        };

        if (typeof handler === 'function') {
            try {
                handler(event);
                return true;
            } catch (error) {
                // fall through to native click
            }
        }

        try {
            element.click();
            return true;
        } catch (error) {
            return false;
        }
    },

    waitForPanelActive(sectionTitle, timeoutMs = 3000) {
        if (this._isManagementPanelVisible(sectionTitle)) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const observer = new MutationObserver(() => {
                if (this._isManagementPanelVisible(sectionTitle)) {
                    observer.disconnect();
                    resolve(true);
                } else if (Date.now() > deadline) {
                    observer.disconnect();
                    resolve(false);
                }
            });

            observer.observe(this.document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-hidden', 'class', 'style']
            });

            setTimeout(() => {
                observer.disconnect();
                resolve(this._isManagementPanelVisible(sectionTitle));
            }, timeoutMs + 50);
        });
    },

    getLastManagementOpenedViaAside() {
        return this._lastManagementOpenedViaAside;
    },

    async activateManagementPanel(type) {
        const sectionTitle = this.getManagementSectionTitleForType(type);
        this._lastManagementOpenedViaAside = false;

        if (this.isManagementPanelActiveForType(type)) {
            return true;
        }

        let tab = this.findSpaTabButton(sectionTitle);

        if (!tab) {
            const openedViaAside = await this.openManagementTabViaAside(type);
            if (!openedViaAside) {
                const route = this.getManagementRouteForType(type);
                this.navigateViaPushState(route);

                const tabExists = await this.waitForSpaTabExists(sectionTitle, 5000);
                if (!tabExists) {
                    this.debugPunishmentLog('management_tab_not_created', {type, via: 'pushState'});
                    return false;
                }
            } else {
                this._lastManagementOpenedViaAside = true;
            }

            tab = this.findSpaTabButton(sectionTitle);
            if (!tab) {
                return false;
            }
        }

        if (!this.isManagementPanelActiveForType(type)) {
            if (!this.dispatchElementClick(tab)) {
                return false;
            }

            const activated = await this.waitForPanelActive(sectionTitle, 5000);
            if (!activated) {
                return false;
            }
        }

        const route = this.getManagementRouteForType(type);
        const routePattern = route.replace(/^\//, '');
        if (!window.location.pathname.includes(routePattern)) {
            this.navigateViaPushState(route);
        }

        return true;
    },

    _isManagementPanelVisible(sectionTitle) {
        const headers = Array.from(this.document.querySelectorAll('span, h1, h2, h3'))
            .filter(element => (
                !this.isExtensionUiElement(element)
                && element.textContent.trim() === sectionTitle
            ));

        for (const header of headers) {
            let element = header;
            while (element && element !== this.document.body) {
                const ariaHidden = element.getAttribute?.('aria-hidden');
                if (ariaHidden === 'true') {
                    break;
                }
                if (ariaHidden === 'false') {
                    return true;
                }
                element = element.parentElement;
            }
        }

        return false;
    },

    _getManagementPanelRoot(header) {
        let element = header.parentElement;
        while (element && element !== this.document.body) {
            if (element.hasAttribute?.('aria-hidden')) {
                return element;
            }
            element = element.parentElement;
        }

        return null;
    },

    _isButtonInSection(button, sectionTitle) {
        if (!button) {
            return false;
        }

        const headers = Array.from(this.document.querySelectorAll('span, h1, h2, h3'))
            .filter(element => (
                !this.isExtensionUiElement(element)
                && element.textContent.trim() === sectionTitle
            ));

        for (const header of headers) {
            const panelRoot = this._getManagementPanelRoot(header);
            if (panelRoot?.contains(button)) {
                return true;
            }
        }

        return false;
    },

    _isHeaderInVisiblePanel(header) {
        let element = header;
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

        return false;
    },

    findSiteIssueButtonInSection(sectionTitle, { requireVisible = true } = {}) {
        const headers = Array.from(this.document.querySelectorAll('span, h1, h2, h3'))
            .filter(element => !this.isExtensionUiElement(element) && element.textContent.trim() === sectionTitle);

        for (const header of headers) {
            if (requireVisible && !this._isHeaderInVisiblePanel(header)) {
                continue;
            }

            const panelRoot = this._getManagementPanelRoot(header);
            if (!panelRoot) {
                continue;
            }

            const button = Array.from(panelRoot.querySelectorAll('button')).find(candidate => (
                !this._isExtensionPunishmentButton(candidate)
                && candidate.textContent.trim() === 'Выдать блокировку'
            ));
            if (button) {
                return button;
            }
        }

        return null;
    },

    findSiteIssueMuteButton() {
        return this.findSiteIssueButtonInSection('Управление мутами');
    },

    findSiteIssueBanButton() {
        return this.findSiteIssueButtonInSection('Управление банами');
    },

    extractReactClickHandler(element) {
        if (!element) {
            return null;
        }

        const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
        if (propsKey && typeof element[propsKey]?.onClick === 'function') {
            return element[propsKey].onClick;
        }

        const fiberKey = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
        let fiber = fiberKey ? element[fiberKey] : null;
        while (fiber) {
            if (typeof fiber.memoizedProps?.onClick === 'function') {
                return fiber.memoizedProps.onClick;
            }
            if (typeof fiber.pendingProps?.onClick === 'function') {
                return fiber.pendingProps.onClick;
            }
            fiber = fiber.return;
        }

        return null;
    },

    _cacheIssueHandlerFromButton(button, type) {
        const sectionTitle = type === 'ban' ? 'Управление банами' : 'Управление мутами';
        if (!this._isButtonInSection(button, sectionTitle)) {
            return;
        }

        const handler = this.extractReactClickHandler(button);
        if (typeof handler !== 'function') {
            return;
        }

        if (type === 'ban') {
            this._cachedOpenBanHandler = handler;
            this._cachedBanIssueButton = button;
            return;
        }

        this._cachedOpenMuteHandler = handler;
        this._cachedMuteIssueButton = button;
    },

    async scanModeratorPunishmentPermissions() {
        if (this._isUpdatingPunishmentButtons || this._permissionScanSuppressed > 0) {
            return;
        }

        const mutePanelActive = this.isMuteManagementPanelActive();
        const banPanelActive = this.isBanManagementPanelActive();

        if (!mutePanelActive && !banPanelActive) {
            return;
        }

        let changed = false;

        if (mutePanelActive) {
            const muteButton = this.findSiteIssueMuteButton();

            if (muteButton) {
                this._cancelPermissionRevoke('mute');
                this._cacheIssueHandlerFromButton(muteButton, 'mute');
                if (!this.canIssueMute) {
                    this.canIssueMute = true;
                    changed = true;
                }
            } else if (this.canIssueMute) {
                this._schedulePermissionRevoke('mute');
            }
        }

        if (banPanelActive) {
            const banButton = this.findSiteIssueBanButton();

            if (banButton) {
                this._cancelPermissionRevoke('ban');
                this._cacheIssueHandlerFromButton(banButton, 'ban');
                if (!this.canIssueBan) {
                    this.canIssueBan = true;
                    changed = true;
                }
            } else if (this.canIssueBan) {
                this._schedulePermissionRevoke('ban');
            }
        }

        if (changed) {
            await this._persistModeratorPermissions();
            this.refreshComplaintPunishmentButtons();
        }
    },

    initMuteIssueFeature() {
        if (this._punishmentPermissionObserver) {
            console.log('[Helper] punishmentPermissionObserver: skip — уже инициализирован');
            return;
        }

        console.log('[Helper] punishmentPermissionObserver: init');
        this.loadModeratorPermissions().then(() => {
            this.refreshComplaintPunishmentButtons();
            setTimeout(() => this.refreshComplaintPunishmentButtons(), 500);
        });

        this._wasMutePanelActive = this.isMuteManagementPanelActive();
        this._wasBanPanelActive = this.isBanManagementPanelActive();
        this.scanModeratorPunishmentPermissions();

        this._punishmentPermissionObserver = new MutationObserver(() => {
            if (this._punishmentPermissionDebounceId) {
                clearTimeout(this._punishmentPermissionDebounceId);
            }

            this._punishmentPermissionDebounceId = setTimeout(() => {
                this._punishmentPermissionDebounceId = null;
                this._handleManagementPanelVisibilityForScan();
            }, 150);
        });

        this._punishmentPermissionObserver.observe(this.document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-hidden']
        });
    },

    findCloseTicketButton(scopeEl) {
        const root = scopeEl || this.document.body;
        return Array.from(root.querySelectorAll('button')).find(
            button => button.textContent.trim() === 'Закрыть тикет'
        ) || null;
    },

    findPunishmentInsertPoint(scopeEl) {
        const root = scopeEl || this.document.body;
        const closeButton = this.findCloseTicketButton(root);
        if (closeButton?.parentNode) {
            return {parent: closeButton.parentNode, before: closeButton};
        }

        const backButton = Array.from(root.querySelectorAll('button')).find(
            button => button.textContent.trim().includes('Вернуться назад')
        );
        if (backButton?.parentNode) {
            return {parent: backButton.parentNode, before: backButton};
        }

        const actionRow = root.querySelector('.sc-jcEreA');
        if (actionRow) {
            return {parent: actionRow, before: null};
        }

        return {parent: root, before: null};
    },

    createPunishmentActionsContainer() {
        let container = this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
        if (container) {
            this.refreshPunishmentActionButtonIcons(container);
            return container;
        }

        container = this.document.createElement('div');
        container.id = this.TICKET_PUNISHMENT_ACTIONS_ID;
        container.className = 'ioh-ticket-punishment-actions';
        markIoh(container);

        const muteIcon = window.Icons?.mute || '';
        const banIcon = window.Icons?.ban || '';

        const muteButton = this.document.createElement('button');
        muteButton.id = this.TICKET_MUTE_BUTTON_ID;
        muteButton.type = 'button';
        muteButton.className = 'ioh-ticket-issue-mute';
        muteButton.innerHTML = `<span class="ioh-icon-box">${muteIcon}</span><span class="ioh-ticket-issue-label">МУТ</span>`;
        muteButton.addEventListener('click', this.handleTicketMuteButtonClick);

        const banButton = this.document.createElement('button');
        banButton.id = this.TICKET_BAN_BUTTON_ID;
        banButton.type = 'button';
        banButton.className = 'ioh-ticket-issue-ban';
        banButton.innerHTML = `<span class="ioh-icon-box">${banIcon}</span><span class="ioh-ticket-issue-label">БАН</span>`;
        banButton.addEventListener('click', this.handleTicketBanButtonClick);

        container.append(muteButton, banButton);
        return container;
    },

    refreshPunishmentActionButtonIcons(container = null) {
        const root = container || this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
        if (!root || !window.Icons) {
            return;
        }

        const muteBox = root.querySelector(`#${this.TICKET_MUTE_BUTTON_ID} .ioh-icon-box`);
        const banBox = root.querySelector(`#${this.TICKET_BAN_BUTTON_ID} .ioh-icon-box`);
        if (muteBox && window.Icons.mute && !muteBox.querySelector('.ioh-badge-icon')) {
            muteBox.innerHTML = window.Icons.mute;
        }
        if (banBox && window.Icons.ban && !banBox.querySelector('.ioh-badge-icon')) {
            banBox.innerHTML = window.Icons.ban;
        }
    },

    _ensurePunishmentActionsPlacement(scope) {
        const insertPoint = this.findPunishmentInsertPoint(scope);
        if (!insertPoint?.parent) {
            return false;
        }

        const container = this.createPunishmentActionsContainer();
        if (insertPoint.before) {
            if (container.parentNode !== insertPoint.parent || container.nextElementSibling !== insertPoint.before) {
                insertPoint.parent.insertBefore(container, insertPoint.before);
            }
        } else if (container.parentNode !== insertPoint.parent) {
            insertPoint.parent.appendChild(container);
        }

        this._lastPunishmentScope = scope;
        return true;
    },

    shouldShowTicketMuteButton(scope) {
        if (!this._permissionsHydrated || !this.canIssueMute) {
            return false;
        }

        if (!scope || !this.isOpenComplaintScope(scope)) {
            return false;
        }

        const muteHistoryBlock = this.getBlockByHeaderScoped('История Мутов', scope);
        if (muteHistoryBlock && this.hasActiveMute(muteHistoryBlock)) {
            return false;
        }

        return true;
    },

    shouldShowTicketBanButton(scope) {
        if (!this._permissionsHydrated || !this.canIssueBan) {
            return false;
        }

        return Boolean(scope && this.isOpenComplaintScope(scope));
    },

    _applyPunishmentButtonsVisibility(scope) {
        const container = this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
        if (!container) {
            return;
        }

        const muteButton = this.document.getElementById(this.TICKET_MUTE_BUTTON_ID);
        const banButton = this.document.getElementById(this.TICKET_BAN_BUTTON_ID);
        const showMute = this.shouldShowTicketMuteButton(scope);
        const showBan = this.shouldShowTicketBanButton(scope);

        if (!showMute && !showBan) {
            if (container.style.display !== 'none') {
                container.style.display = 'none';
            }
            return;
        }

        if (container.style.display !== '') {
            container.style.display = '';
        }
        if (muteButton) {
            const nextMuteDisplay = showMute ? '' : 'none';
            if (muteButton.style.display !== nextMuteDisplay) {
                muteButton.style.display = nextMuteDisplay;
            }
        }
        if (banButton) {
            const nextBanDisplay = showBan ? '' : 'none';
            if (banButton.style.display !== nextBanDisplay) {
                banButton.style.display = nextBanDisplay;
            }
        }
    },

    updateTicketPunishmentButtons() {
        if (!this.isComplaintPage()) {
            return;
        }

        if (this.isSitePunishmentDialogOpen() && this._lastPunishmentScope?.isConnected) {
            this._applyPunishmentButtonsVisibility(this._lastPunishmentScope);
            return;
        }

        const scope = this.findActiveComplaintScope() || (
            this._lastPunishmentScope?.isConnected ? this._lastPunishmentScope : null
        );
        const hasPermissions = this.canIssueMute || this.canIssueBan;

        if (!scope) {
            if (!hasPermissions && !this.isSitePunishmentDialogOpen()) {
                const container = this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
                if (container) {
                    container.style.display = 'none';
                }
            }
            return;
        }

        this._isUpdatingPunishmentButtons = true;
        try {
            if (!this._ensurePunishmentActionsPlacement(scope)) {
                return;
            }

            this._applyPunishmentButtonsVisibility(scope);
        } finally {
            this._isUpdatingPunishmentButtons = false;
        }
    },

    ensureTicketPunishmentButtons() {
        this.updateTicketPunishmentButtons();
    },

    refreshComplaintPunishmentButtons() {
        if (!this.isComplaintPage()) {
            return;
        }

        this.updateTicketPunishmentButtons();
    },

    refreshTicketPunishmentButtons() {
        this.refreshComplaintPunishmentButtons();
    },

    clearTicketPunishmentButtons() {
        this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID)?.remove();
        this._lastPunishmentScope = null;
    },

    teardownTicketPunishmentButtons() {
        this.clearTicketPunishmentButtons();
    },

    getOffenderSteamIdForScope(scope) {
        const offenderField = this.findInfoFieldScoped('Нарушитель', scope);
        return this.extractSteamIdFromField(offenderField);
    },

    getActivePunishmentScope() {
        return this.findActiveComplaintScope() || this._lastPunishmentScope;
    },

    handleTicketMuteButtonClick() {
        const scope = this.getActivePunishmentScope();
        const steamId = this.getOffenderSteamIdForScope(scope);
        void this.openSiteMuteForm(steamId);
    },

    handleTicketBanButtonClick() {
        const scope = this.getActivePunishmentScope();
        const steamId = this.getOffenderSteamIdForScope(scope);
        void this.openSiteBanForm(steamId);
    },

    invokeCachedSiteHandler(handler, type, button = null) {
        if (typeof handler !== 'function') {
            return false;
        }

        const eventTarget = (button?.isConnected ? button : null)
            ?? this.getCachedIssueButton(type)
            ?? this.getLastKnownIssueButton(type);

        try {
            handler({
                preventDefault() {},
                stopPropagation() {},
                nativeEvent: new MouseEvent('click', {bubbles: true}),
                currentTarget: eventTarget,
                target: eventTarget
            });
            return true;
        } catch (error) {
            console.warn(`[IO Helper] Не удалось открыть форму ${type}:`, error);
            if (type === 'ban') {
                this._cachedOpenBanHandler = null;
            } else {
                this._cachedOpenMuteHandler = null;
            }
            return false;
        }
    },

    openSiteMuteForm(steamId) {
        return this.punishmentBridge.openMuteForm(steamId);
    },

    openSiteBanForm(steamId) {
        return this.punishmentBridge.openBanForm(steamId);
    },

    prefillMuteFormSteamId(steamId) {
        this._prefillPunishmentFormSteamId(steamId, '#mute-steamid64');
    },

    prefillBanFormSteamId(steamId) {
        this._prefillPunishmentFormSteamId(steamId, '#ban-steamid64');
    },

    _prefillPunishmentFormSteamId(steamId, inputSelector) {
        if (!steamId) {
            return;
        }

        const applyValue = (input) => {
            if (!input) {
                return false;
            }

            if (input.value !== steamId) {
                input.value = steamId;
                input.dispatchEvent(new Event('input', {bubbles: true}));
                input.dispatchEvent(new Event('change', {bubbles: true}));
            }

            return true;
        };

        const existingInput = this.document.querySelector(`[role="dialog"] ${inputSelector}`);
        if (applyValue(existingInput)) {
            return;
        }

        const deadline = Date.now() + 2000;
        const observer = new MutationObserver(() => {
            const input = this.document.querySelector(`[role="dialog"] ${inputSelector}`);
            if (applyValue(input)) {
                observer.disconnect();
                return;
            }

            if (Date.now() > deadline) {
                observer.disconnect();
            }
        });

        observer.observe(this.document.body, {childList: true, subtree: true});
        setTimeout(() => observer.disconnect(), 2100);
    },
};
