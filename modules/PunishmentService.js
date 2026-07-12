class PunishmentService {
    constructor({ document, durations }) {
        this.document = document;
        this.durations = {
            defaultMuteReason: 'Reason_Mute_Toxic',
            mute: {},
            ban: {},
            ...(durations || {})
        };
        this.observer = null;
        this.debounceId = null;
        this.enabled = true;
        this.isProgrammaticSelectUpdate = false;
        this.userTimeSelectInteraction = null;
        this.boundReasonSelects = new WeakSet();
        this.boundTimeChangeListeners = new WeakSet();
        this.boundMuteTimeObservers = new WeakSet();
        this.boundSteamIdInputs = new WeakSet();
        this.desiredDurationByReasonSelect = new WeakMap();
        this.durationRestoreIds = new WeakMap();
        this.handleReasonChange = this.handleReasonChange.bind(this);
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);

        if (!this.enabled) {
            this.teardown();
        }
    }

    init() {
        if (!this.enabled) {
            return;
        }

        this.teardown();
        this.scanDialogs();

        this.observer = new MutationObserver((mutations) => {
            if (!this.enabled) {
                return;
            }

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes || []) {
                    if (this.isRelevantNode(node)) {
                        this.scheduleScan();
                        return;
                    }
                }
            }
        });

        this.observer.observe(this.document.body, {
            childList: true,
            subtree: true
        });
    }

    teardown() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        if (this.debounceId) {
            clearTimeout(this.debounceId);
            this.debounceId = null;
        }
    }

    scheduleScan() {
        if (this.debounceId) {
            clearTimeout(this.debounceId);
        }

        this.debounceId = setTimeout(() => {
            this.debounceId = null;
            this.scanDialogs();
        }, 150);
    }

    isRelevantNode(node) {
        if (!node || node.nodeType !== 1) {
            return false;
        }

        if (node.matches?.('[role="dialog"]')) {
            return Boolean(
                node.querySelector?.('#mute-reason, #ban-reason')
                || node.querySelector?.('#mute-time, #ban-time')
            );
        }

        if (node.matches?.('#mute-reason, #ban-reason, #mute-time, #ban-time')) {
            return true;
        }

        return Boolean(node.querySelector?.('#mute-reason, #ban-reason'));
    }

    scanDialogs() {
        if (!this.enabled) {
            return;
        }

        this.document.querySelectorAll('[role="dialog"]').forEach(dialog => {
            const muteReason = dialog.querySelector('#mute-reason');
            const banReason = dialog.querySelector('#ban-reason');

            if (muteReason) {
                const muteTime = dialog.querySelector('#mute-time');
                this.bindForm('mute', muteReason, muteTime, dialog);
                if (muteTime) {
                    this.bindTimeSelectListener(muteReason, muteTime);
                    this.observeMuteTimeOptions(muteReason, muteTime);
                }
            }

            if (banReason) {
                this.bindForm('ban', banReason, dialog.querySelector('#ban-time'));
            }
        });
    }

    bindForm(type, reasonSelect, timeSelect, dialog = null) {
        if (!reasonSelect || !timeSelect) {
            return;
        }

        if (!this.boundReasonSelects.has(reasonSelect)) {
            this.boundReasonSelects.add(reasonSelect);
            reasonSelect.addEventListener('change', this.handleReasonChange);

            if (type === 'mute') {
                this.applyDefaultMuteReason(reasonSelect, timeSelect);
                if (dialog) {
                    this.bindSteamIdListener(dialog, reasonSelect);
                }
            } else {
                this.applyDuration(reasonSelect, timeSelect, type);
            }
            return;
        }

        this.syncMuteDurationAfterSiteUpdate(reasonSelect, timeSelect);
    }

    shouldApplyX2ForDefaultReason(reasonSelect, timeSelect) {
        if (reasonSelect.value !== this.durations.defaultMuteReason) {
            return false;
        }

        const selectedOption = reasonSelect.options[reasonSelect.selectedIndex];
        const reasonLabel = selectedOption?.textContent?.trim() || '';
        const x2Value = this.findX2TimeOption(timeSelect, reasonLabel);
        if (x2Value == null) {
            return false;
        }

        const defaultDuration = this.getDefaultDuration('mute', reasonSelect.value);
        const desired = this.desiredDurationByReasonSelect.get(reasonSelect);

        return defaultDuration != null && desired === String(defaultDuration);
    }

    syncMuteDurationAfterSiteUpdate(reasonSelect, timeSelect) {
        if (!this.enabled || !reasonSelect?.isConnected || !timeSelect?.isConnected) {
            return false;
        }

        if (this.shouldApplyX2ForDefaultReason(reasonSelect, timeSelect)) {
            const selectedOption = reasonSelect.options[reasonSelect.selectedIndex];
            const reasonLabel = selectedOption?.textContent?.trim() || '';
            const x2Value = this.findX2TimeOption(timeSelect, reasonLabel);

            if (this.setSelectValue(timeSelect, x2Value)) {
                this.rememberDesiredDuration(reasonSelect, x2Value);
            } else if (timeSelect.value === x2Value) {
                this.rememberDesiredDuration(reasonSelect, x2Value);
            }

            return true;
        }

        return this.restoreDesiredDuration(reasonSelect, timeSelect);
    }

    applyDefaultMuteReason(reasonSelect, timeSelect) {
        const defaultReason = this.durations.defaultMuteReason;

        if (this.hasSelectOption(reasonSelect, defaultReason)
            && reasonSelect.value !== defaultReason) {
            this.setSelectValue(reasonSelect, defaultReason);
        }

        this.applyDuration(reasonSelect, timeSelect, 'mute');
    }

    rememberDesiredDuration(reasonSelect, value) {
        if (!reasonSelect || value == null) {
            return;
        }

        this.desiredDurationByReasonSelect.set(reasonSelect, String(value));
    }

    restoreDesiredDuration(reasonSelect, timeSelect) {
        if (!this.enabled || !reasonSelect?.isConnected || !timeSelect?.isConnected) {
            return false;
        }

        const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
        if (desired == null) {
            return false;
        }

        if (!this.hasSelectOption(timeSelect, desired)) {
            return false;
        }

        if (timeSelect.value === desired) {
            return false;
        }

        return this.setSelectValue(timeSelect, desired);
    }

    clearDurationRestore(reasonSelect) {
        const timeouts = this.durationRestoreIds.get(reasonSelect);
        if (!timeouts) {
            return;
        }

        timeouts.forEach(clearTimeout);
        this.durationRestoreIds.delete(reasonSelect);
    }

    scheduleDurationRestore(reasonSelect, timeSelect) {
        if (!this.enabled) {
            return;
        }

        this.clearDurationRestore(reasonSelect);

        const runRestore = () => {
            const dialog = reasonSelect.closest('[role="dialog"]');
            const currentTimeSelect = dialog?.querySelector('#mute-time') || timeSelect;

            if (!reasonSelect.isConnected || !currentTimeSelect?.isConnected) {
                return;
            }

            this.syncMuteDurationAfterSiteUpdate(reasonSelect, currentTimeSelect);
        };

        const timeouts = [
            setTimeout(runRestore, 50),
            setTimeout(runRestore, 150),
            setTimeout(runRestore, 400),
            setTimeout(runRestore, 800)
        ];

        this.durationRestoreIds.set(reasonSelect, timeouts);
    }

    bindSteamIdListener(dialog, reasonSelect) {
        const steamInput = dialog.querySelector('#mute-steamid64');
        if (!steamInput || this.boundSteamIdInputs.has(steamInput)) {
            return;
        }

        this.boundSteamIdInputs.add(steamInput);

        const handleSteamIdChange = () => {
            const timeSelect = dialog.querySelector('#mute-time');
            if (!timeSelect) {
                return;
            }

            if (timeSelect.value && this.hasSelectOption(timeSelect, timeSelect.value)) {
                this.rememberDesiredDuration(reasonSelect, timeSelect.value);
            }

            this.scheduleDurationRestore(reasonSelect, timeSelect);
        };

        steamInput.addEventListener('input', handleSteamIdChange);
        steamInput.addEventListener('paste', handleSteamIdChange);
    }

    bindTimeSelectListener(reasonSelect, timeSelect) {
        if (this.boundTimeChangeListeners.has(timeSelect)) {
            return;
        }

        this.boundTimeChangeListeners.add(timeSelect);

        timeSelect.addEventListener('pointerdown', () => {
            this.userTimeSelectInteraction = timeSelect;
        });

        timeSelect.addEventListener('change', () => {
            this.handleTimeSelectChange(reasonSelect, timeSelect);
        });
    }

    handleTimeSelectChange(reasonSelect, timeSelect) {
        if (this.isProgrammaticSelectUpdate) {
            return;
        }

        const dialog = reasonSelect.closest('[role="dialog"]');
        const currentTimeSelect = dialog?.querySelector('#mute-time') || timeSelect;

        if (this.userTimeSelectInteraction === currentTimeSelect) {
            this.userTimeSelectInteraction = null;
            this.rememberDesiredDuration(reasonSelect, currentTimeSelect.value);
            return;
        }

        const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
        if (desired != null && currentTimeSelect.value !== desired) {
            this.scheduleDurationRestore(reasonSelect, currentTimeSelect);
        }
    }

    scheduleMuteDurationRestore(reasonSelect, timeSelect) {
        this.scheduleDurationRestore(reasonSelect, timeSelect);
    }

    observeMuteTimeOptions(reasonSelect, timeSelect) {
        if (this.boundMuteTimeObservers.has(timeSelect)) {
            return;
        }

        this.boundMuteTimeObservers.add(timeSelect);

        const observer = new MutationObserver(() => {
            this.scheduleMuteDurationRestore(reasonSelect, timeSelect);
        });

        observer.observe(timeSelect, { childList: true, subtree: true });
        this.scheduleMuteDurationRestore(reasonSelect, timeSelect);
    }

    handleReasonChange(event) {
        const reasonSelect = event.currentTarget;
        const dialog = reasonSelect.closest('[role="dialog"]');
        if (!dialog) {
            return;
        }

        const isMute = reasonSelect.id === 'mute-reason';
        const timeSelect = dialog.querySelector(isMute ? '#mute-time' : '#ban-time');
        if (!timeSelect) {
            return;
        }

        this.applyDuration(reasonSelect, timeSelect, isMute ? 'mute' : 'ban');
    }

    applyDuration(reasonSelect, timeSelect, type) {
        const selectedOption = reasonSelect.options[reasonSelect.selectedIndex];
        const reasonValue = reasonSelect.value;
        const reasonLabel = selectedOption?.textContent?.trim() || '';

        const targetValue = this.resolveTimeOptionValue({
            reasonValue,
            reasonLabel,
            timeSelect,
            type
        });

        if (targetValue == null) {
            return;
        }

        if (this.setSelectValue(timeSelect, targetValue)) {
            this.rememberDesiredDuration(reasonSelect, targetValue);
        } else if (timeSelect.value === targetValue) {
            this.rememberDesiredDuration(reasonSelect, targetValue);
        }
    }

    normalizePunishmentReason(text) {
        return String(text || '')
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    getDefaultDuration(type, reasonValue) {
        const map = type === 'ban' ? this.durations.ban : this.durations.mute;
        return map?.[reasonValue] ?? null;
    }

    findX2TimeOption(timeSelect, reasonLabel) {
        if (!timeSelect || !reasonLabel) {
            return null;
        }

        const normalizedReason = this.normalizePunishmentReason(reasonLabel);

        for (const option of timeSelect.options) {
            const text = option.textContent || '';
            if (!/X2/i.test(text)) {
                continue;
            }

            const match = text.match(/—\s*(.+?)\s+X2/i);
            if (!match) {
                continue;
            }

            if (this.normalizePunishmentReason(match[1]) === normalizedReason) {
                return option.value;
            }
        }

        return null;
    }

    hasSelectOption(select, value) {
        if (!select || value == null) {
            return false;
        }

        return Array.from(select.options).some(option => option.value === String(value));
    }

    resolveTimeOptionValue({ reasonValue, reasonLabel, timeSelect, type }) {
        const x2Value = this.findX2TimeOption(timeSelect, reasonLabel);
        if (x2Value != null) {
            return x2Value;
        }

        const defaultDuration = this.getDefaultDuration(type, reasonValue);
        if (defaultDuration == null) {
            return null;
        }

        if (!this.hasSelectOption(timeSelect, defaultDuration)) {
            return null;
        }

        return String(defaultDuration);
    }

    setSelectValue(select, value) {
        if (!select || value == null) {
            return false;
        }

        const nextValue = String(value);
        if (select.value === nextValue) {
            return false;
        }

        this.isProgrammaticSelectUpdate = true;

        try {
            const descriptor = Object.getOwnPropertyDescriptor(
                window.HTMLSelectElement.prototype,
                'value'
            );

            if (descriptor?.set) {
                descriptor.set.call(select, nextValue);
            } else {
                select.value = nextValue;
            }

            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } finally {
            this.isProgrammaticSelectUpdate = false;
        }
    }
}

window.PunishmentService = PunishmentService;
