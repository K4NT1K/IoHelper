class SitePunishmentBridge {
    static PANELS = {
        mute: {
            sectionTitle: 'Управление мутами',
            route: '/comms/list',
            inputSelector: '#mute-steamid64'
        },
        ban: {
            sectionTitle: 'Управление банами',
            route: '/bans/list',
            inputSelector: '#ban-steamid64'
        }
    };

    constructor({document, ticketService}) {
        this.document = document;
        this.ticketService = ticketService;
        this._returnContext = null;
        this._dialogCleanupObserver = null;
        this._lastFailReason = null;
    }

    openMuteForm(steamId) {
        return this.openForm('mute', steamId);
    }

    openBanForm(steamId) {
        return this.openForm('ban', steamId);
    }

    _debugLog(reason, details = {}) {
        this.ticketService.debugPunishmentLog(reason, details);
    }

    async openForm(type, steamId) {
        const hasPermission = type === 'ban'
            ? this.ticketService.canIssueBan
            : this.ticketService.canIssueMute;

        if (!hasPermission) {
            return false;
        }

        this._lastFailReason = null;

        let opened = await this._trySilentOpen(type);

        if (!opened && !this.ticketService.isPanelReadyForType(type)) {
            opened = await this._runVisibleInitFlow(type);
        } else if (!opened) {
            this.ticketService.resetPanelReady(type);
            opened = await this._trySilentRemount(type);
        }

        if (!opened) {
            this._clearReturnContext();
            this.ticketService.handlePunishmentOpenFailure(type);
            const panel = SitePunishmentBridge.PANELS[type];
            console.warn(`[IO Helper] Нет доступа к форме выдачи ${type === 'ban' ? 'бана' : 'мута'}. Откройте «${panel.sectionTitle}».`);
            this._debugLog(this._lastFailReason || 'open_form_failed', {type});
            return false;
        }

        this.ticketService.markPanelReady(type);
        this.ticketService.recordPunishmentOpenSuccess();
        await this.ticketService.persistPanelReadyState();

        if (steamId) {
            if (type === 'ban') {
                this.ticketService.prefillBanFormSteamId(steamId);
            } else {
                this.ticketService.prefillMuteFormSteamId(steamId);
            }
        }

        return true;
    }

    async _runVisibleInitFlow(type) {
        return this._runManagementActivationFlow(type);
    }

    async _trySilentRemount(type) {
        return this._runManagementActivationFlow(type);
    }

    async _runManagementActivationFlow(type) {
        this._saveReturnContext(type);
        const returnContext = this._returnContext;

        this.ticketService.suppressPermissionScan();
        try {
            const activated = await this.ticketService.activateManagementPanel(type);
            if (!activated) {
                this._lastFailReason = 'management_tab_not_created';
                this._debugLog('management_tab_not_created', {type});
                return false;
            }

            this._applyManagementTabInitFlags(returnContext);

            const hasIssueButton = await this._waitForIssueButton(type, 5000);
            if (!hasIssueButton) {
                this._lastFailReason = 'issue_button_not_found';
                this._debugLog('issue_button_not_found', {type});
                return false;
            }

            let opened = await this._tryLiveButtonClick(type, 5000);
            if (!opened) {
                await new Promise(resolve => setTimeout(resolve, 300));
                opened = await this._tryLiveButtonClick(type, 5000);
            }

            if (!opened) {
                this._lastFailReason = 'dialog_not_opened';
                this._debugLog('dialog_not_opened', {type});
                return false;
            }

            await new Promise(resolve => setTimeout(resolve, 150));

            const returned = await this._returnToTicketTab(returnContext, {closeManagementTab: false});
            if (!returned) {
                this._debugLog('return_to_ticket_failed', {
                    type,
                    tabLabel: returnContext.tabLabel,
                    pathname: returnContext.pathname
                });
            }

            if (!this._isTargetDialogOpen(type)) {
                const retried = await this._tryLiveButtonClick(type, 3000);
                if (!retried) {
                    this._lastFailReason = 'dialog_closed_after_return';
                    this._debugLog('dialog_closed_after_return', {type, returned});
                    return false;
                }
            }

            this._scheduleManagementTabCleanupOnDialogClose(
                type,
                this._shouldCloseManagementTabOnCleanup(returnContext)
            );
            return true;
        } finally {
            this.ticketService.releasePermissionScan();
        }
    }

    _saveReturnContext(type) {
        const tabContext = this.ticketService.collectReturnTabContext();
        this._returnContext = {
            ...tabContext,
            managementType: type || null,
            managementTabWasOpen: this.ticketService.isManagementSpaTabOpen(type),
            openedManagementTabForInit: false
        };
    }

    _applyManagementTabInitFlags(returnContext) {
        if (returnContext.managementTabWasOpen) {
            return;
        }

        if (this.ticketService.getLastManagementOpenedViaAside()
            || this.ticketService.isManagementSpaTabOpen(returnContext.managementType)) {
            returnContext.openedManagementTabForInit = true;
        }
    }

    _shouldCloseManagementTabOnCleanup(returnContext) {
        return returnContext.openedManagementTabForInit && !returnContext.managementTabWasOpen;
    }

    _clearReturnContext() {
        this._returnContext = null;
    }

    _scheduleManagementTabCleanupOnDialogClose(type, shouldClose) {
        if (!shouldClose) {
            return;
        }

        if (this._dialogCleanupObserver) {
            this._dialogCleanupObserver.disconnect();
            this._dialogCleanupObserver = null;
        }

        const cleanup = () => {
            if (this._isTargetDialogOpen(type)) {
                return;
            }

            this._dialogCleanupObserver?.disconnect();
            this._dialogCleanupObserver = null;

            this.ticketService.suppressPermissionScan();
            try {
                this.ticketService.closeManagementTab(type);
            } finally {
                this.ticketService.releasePermissionScan();
            }
        };

        this._dialogCleanupObserver = new MutationObserver(cleanup);
        this._dialogCleanupObserver.observe(this.document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-state', 'open']
        });
    }

    async _returnToTicketTab(returnContext, options = {}) {
        const {closeManagementTab = false} = options;

        this.ticketService.suppressPermissionScan();
        let returned = false;

        try {
            returned = await this.ticketService.restoreSpaTabFromContext(returnContext);

            if (closeManagementTab && returnContext.managementType) {
                this.ticketService.closeManagementTab(returnContext.managementType);
            }
        } finally {
            this.ticketService.releasePermissionScan();
        }

        this._clearReturnContext();
        this.ticketService.refreshComplaintPunishmentButtons();
        return returned;
    }

    _findIssueButton(type) {
        return type === 'ban'
            ? this.ticketService.findSiteIssueBanButton()
            : this.ticketService.findSiteIssueMuteButton();
    }

    async _trySilentOpen(type) {
        if (!this.ticketService.isPanelReadyForType(type)) {
            return false;
        }

        const handler = this.ticketService.getCachedIssueHandler(type);
        if (handler) {
            const cachedButton = this.ticketService.getLastKnownIssueButton(type);
            if (this.ticketService.invokeCachedSiteHandler(handler, type, cachedButton)
                && await this._waitForDialogOpen(type, 3000)) {
                return true;
            }
        }

        if (this.ticketService.isManagementPanelMounted(type)) {
            const button = this.ticketService.resolveIssueButtonForType(type);
            if (button
                && this.ticketService.dispatchElementClick(button)
                && await this._waitForDialogOpen(type, 3000)) {
                return true;
            }
        }

        return false;
    }

    async _tryLiveButtonClick(type, timeoutMs = 2000) {
        if (!this.ticketService.isManagementPanelActiveForType(type)) {
            return false;
        }

        const button = this._findIssueButton(type);
        if (!button) {
            return false;
        }

        this.ticketService._cacheIssueHandlerFromButton(button, type);

        if (!this.ticketService.dispatchElementClick(button)) {
            return false;
        }

        return this._waitForDialogOpen(type, timeoutMs);
    }

    _waitForIssueButton(type, timeoutMs) {
        const hasButton = () => (
            this.ticketService.isManagementPanelActiveForType(type)
            && Boolean(this._findIssueButton(type))
        );

        if (hasButton()) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const observer = new MutationObserver(() => {
                if (hasButton()) {
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
                resolve(hasButton());
            }, timeoutMs + 50);
        });
    }

    _isTargetDialogOpen(type) {
        return this.ticketService.isTargetPunishmentDialogOpen(type);
    }

    _waitForDialogOpen(type, timeoutMs) {
        if (this._isTargetDialogOpen(type)) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            const observer = new MutationObserver(() => {
                if (this._isTargetDialogOpen(type)) {
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
                attributeFilter: ['data-state', 'open']
            });

            setTimeout(() => {
                observer.disconnect();
                resolve(this._isTargetDialogOpen(type));
            }, timeoutMs + 50);
        });
    }
}

window.SitePunishmentBridge = SitePunishmentBridge;
