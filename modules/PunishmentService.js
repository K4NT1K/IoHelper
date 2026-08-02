class PunishmentService {
    constructor({ document, durations, utils = null }) {
        this.document = document;
        this.utils = utils;
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
        this.userDurationOverrideByReason = new WeakMap();
        this.durationRestoreIds = new WeakMap();
        this.listboxBodyObserver = null;
        this.suppressDurationRestoreUntil = 0;
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
            console.log('[Helper] PunishmentService: skip init — отключен');
            return;
        }

        console.log('[Helper] PunishmentService: init');
        this.teardown();
        this.scanDialogs();
    }

    teardown() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        if (this.listboxBodyObserver) {
            this.listboxBodyObserver.disconnect();
            this.listboxBodyObserver = null;
            console.log('[Helper] PunishmentService: listboxBodyObserver teardown');
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

        if (node.matches?.('#mute-reason, #ban-reason, #mute-time, #ban-time, [role="listbox"]')) {
            return true;
        }

        return Boolean(
            node.querySelector?.('#mute-reason, #ban-reason, #mute-time, [role="listbox"]')
        );
    }

    isMuteDurationListboxControl(el) {
        return Boolean(
            el
            && el.id === 'mute-time'
            && el.tagName === 'BUTTON'
        );
    }

    isNativeTimeSelect(el) {
        return Boolean(el && el.tagName === 'SELECT');
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

    bindForm(type, reasonSelect, timeControl, dialog = null) {
        if (!reasonSelect || !timeControl) {
            return;
        }

        if (!this.boundReasonSelects.has(reasonSelect)) {
            this.boundReasonSelects.add(reasonSelect);
            reasonSelect.addEventListener('change', this.handleReasonChange);

            if (type === 'mute') {
                void this.initializeMuteForm(reasonSelect, timeControl, dialog);
                if (dialog) {
                    this.bindSteamIdListener(dialog, reasonSelect);
                }
            } else {
                this.applyDuration(reasonSelect, timeControl, type);
            }
            return;
        }

        this.syncMuteDurationAfterSiteUpdate(reasonSelect, timeControl);
    }

    hasUserDurationOverride(reasonSelect) {
        return Boolean(reasonSelect && this.userDurationOverrideByReason.get(reasonSelect));
    }

    isUserInteractingWithTimeControl(timeControl) {
        return Boolean(timeControl && this.userTimeSelectInteraction === timeControl);
    }

    isDurationRestoreSuppressed() {
        return Date.now() < this.suppressDurationRestoreUntil;
    }

    suppressDurationRestore(ms = 500) {
        this.suppressDurationRestoreUntil = Date.now() + ms;
    }

    endProgrammaticSelectUpdate() {
        queueMicrotask(() => {
            setTimeout(() => {
                this.isProgrammaticSelectUpdate = false;
            }, 50);
        });
    }

    setUserDurationOverride(reasonSelect, enabled = true) {
        if (!reasonSelect) {
            return;
        }

        if (enabled) {
            this.userDurationOverrideByReason.set(reasonSelect, true);
        } else {
            this.userDurationOverrideByReason.delete(reasonSelect);
        }
    }

    clearUserDurationOverride(reasonSelect) {
        this.setUserDurationOverride(reasonSelect, false);
    }

    async initializeMuteForm(reasonSelect, timeControl, dialog = null) {
        this.clearUserDurationOverride(reasonSelect);

        const synced = await this.syncMuteReasonFromSiteX2(
            reasonSelect,
            timeControl,
            dialog || reasonSelect.closest('[role="dialog"]')
        );

        if (synced) {
            return;
        }

        this.applyDefaultMuteReason(reasonSelect, timeControl);
    }

    hasSiteX2Badge(dialog) {
        if (!dialog) {
            return false;
        }

        const label = dialog.querySelector('label[for="mute-time"]');
        const row = label?.parentElement;
        if (!row) {
            return false;
        }

        return Array.from(row.querySelectorAll('span')).some(
            span => (span.textContent || '').trim().toUpperCase() === 'X2'
        );
    }

    setReasonByLabel(reasonSelect, reasonLabel) {
        if (!reasonSelect || !reasonLabel) {
            return false;
        }

        const normalized = this.normalizePunishmentReason(reasonLabel);
        const option = Array.from(reasonSelect.options).find(
            opt => this.normalizePunishmentReason(opt.textContent || '') === normalized
        );

        if (!option) {
            return false;
        }

        if (reasonSelect.value === option.value) {
            return true;
        }

        return this.setSelectValue(reasonSelect, option.value);
    }

    findPreferredSiteX2Option(listbox, timeControl) {
        const x2Options = this.getDurationOptions(listbox).filter(option => this.isX2Option(option));
        if (!x2Options.length) {
            return null;
        }

        const selected = x2Options.find(option => option.getAttribute('aria-selected') === 'true');
        if (selected) {
            return selected;
        }

        const buttonSeconds = this.parseDurationLabelToSeconds(this.getOptionPrimaryText(timeControl));
        if (buttonSeconds != null) {
            const byButton = x2Options.find(option => (
                this.parseDurationLabelToSeconds(this.getOptionPrimaryText(option)) === buttonSeconds
            ));
            if (byButton) {
                return byButton;
            }
        }

        return x2Options[0];
    }

    async syncMuteReasonFromSiteX2(reasonSelect, timeControl, dialog) {
        if (!this.isMuteDurationListboxControl(timeControl)) {
            return false;
        }

        this.clearDurationRestore(reasonSelect);
        this.isProgrammaticSelectUpdate = true;

        try {
            const hasBadge = this.hasSiteX2Badge(dialog);
            const listbox = await this.waitForDurationListbox(timeControl);
            if (!listbox) {
                return false;
            }

            const x2Option = this.findPreferredSiteX2Option(listbox, timeControl);
            if (!x2Option) {
                this.closeMuteDurationListbox(timeControl);
                return hasBadge ? false : false;
            }

            const x2Reason = this.extractX2ReasonFromOption(x2Option);
            if (x2Reason) {
                this.setReasonByLabel(reasonSelect, x2Reason);
            }

            const seconds = this.parseDurationLabelToSeconds(this.getOptionPrimaryText(x2Option));
            const desired = seconds != null
                ? String(seconds)
                : `x2:${this.normalizePunishmentReason(x2Reason || '')}`;

            const needsClick = this.getTimeControlValue(timeControl) !== desired
                || x2Option.getAttribute('aria-selected') !== 'true';

            if (needsClick) {
                x2Option.click();
                this.rememberDesiredDuration(reasonSelect, desired);
                this.suppressDurationRestore();
                await this.ensureMuteDurationListboxClosed(timeControl);
            } else {
                this.rememberDesiredDuration(reasonSelect, desired);
                this.closeMuteDurationListbox(timeControl);
                this.suppressDurationRestore();
            }
            return true;
        } finally {
            this.endProgrammaticSelectUpdate();
        }
    }

    getReasonLabel(reasonSelect) {
        const selectedOption = reasonSelect?.options?.[reasonSelect.selectedIndex];
        return selectedOption?.textContent?.trim() || '';
    }

    shouldApplyX2ForDefaultReason(reasonSelect, timeControl) {
        if (reasonSelect.value !== this.durations.defaultMuteReason) {
            return false;
        }

        const reasonLabel = this.getReasonLabel(reasonSelect);
        const x2Value = this.findX2TimeOption(timeControl, reasonLabel);
        if (x2Value == null) {
            return false;
        }

        const defaultDuration = this.getDefaultDuration('mute', reasonSelect.value);
        const desired = this.desiredDurationByReasonSelect.get(reasonSelect);

        return defaultDuration != null && desired === String(defaultDuration);
    }

    syncMuteDurationAfterSiteUpdate(reasonSelect, timeControl) {
        if (!this.enabled || !reasonSelect?.isConnected || !timeControl?.isConnected) {
            return false;
        }

        if (this.hasUserDurationOverride(reasonSelect)
            || this.isUserInteractingWithTimeControl(timeControl)
            || this.isDurationRestoreSuppressed()
            || this.isProgrammaticSelectUpdate) {
            return false;
        }

        if (this.isMuteDurationListboxControl(timeControl)) {
            const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
            const current = this.getTimeControlValue(timeControl);

            if (desired != null && current === String(desired)) {
                return false;
            }

            void this.applyMuteListboxDuration(reasonSelect, timeControl);
            return true;
        }

        if (this.shouldApplyX2ForDefaultReason(reasonSelect, timeControl)) {
            const reasonLabel = this.getReasonLabel(reasonSelect);
            const x2Value = this.findX2TimeOption(timeControl, reasonLabel);

            if (this.setSelectValue(timeControl, x2Value)) {
                this.rememberDesiredDuration(reasonSelect, x2Value);
            } else if (this.getTimeControlValue(timeControl) === String(x2Value)) {
                this.rememberDesiredDuration(reasonSelect, x2Value);
            }

            return true;
        }

        return this.restoreDesiredDuration(reasonSelect, timeControl);
    }

    applyDefaultMuteReason(reasonSelect, timeControl) {
        this.clearUserDurationOverride(reasonSelect);
        const defaultReason = this.durations.defaultMuteReason;

        if (this.hasSelectOption(reasonSelect, defaultReason)
            && reasonSelect.value !== defaultReason) {
            this.setSelectValue(reasonSelect, defaultReason);
        }

        this.applyDuration(reasonSelect, timeControl, 'mute');
    }

    rememberDesiredDuration(reasonSelect, value) {
        if (!reasonSelect || value == null) {
            return;
        }

        this.desiredDurationByReasonSelect.set(reasonSelect, String(value));
    }

    restoreDesiredDuration(reasonSelect, timeControl) {
        if (!this.enabled || !reasonSelect?.isConnected || !timeControl?.isConnected) {
            return false;
        }

        if (this.hasUserDurationOverride(reasonSelect)) {
            return false;
        }

        const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
        if (desired == null) {
            return false;
        }

        if (!this.hasTimeControlOption(timeControl, desired)) {
            return false;
        }

        if (this.getTimeControlValue(timeControl) === String(desired)) {
            return false;
        }

        return this.setTimeControlValue(timeControl, desired);
    }

    clearDurationRestore(reasonSelect) {
        const timeouts = this.durationRestoreIds.get(reasonSelect);
        if (!timeouts) {
            return;
        }

        timeouts.forEach(clearTimeout);
        this.durationRestoreIds.delete(reasonSelect);
    }

    scheduleDurationRestore(reasonSelect, timeControl) {
        if (!this.enabled) {
            return;
        }

        if (this.hasUserDurationOverride(reasonSelect)
            || this.isUserInteractingWithTimeControl(timeControl)
            || this.isDurationRestoreSuppressed()
            || this.isProgrammaticSelectUpdate) {
            return;
        }

        this.clearDurationRestore(reasonSelect);

        const runRestore = () => {
            if (this.hasUserDurationOverride(reasonSelect)
                || this.isDurationRestoreSuppressed()
                || this.isProgrammaticSelectUpdate) {
                return;
            }

            const dialog = reasonSelect.closest('[role="dialog"]');
            const currentTimeControl = dialog?.querySelector('#mute-time') || timeControl;

            if (!reasonSelect.isConnected || !currentTimeControl?.isConnected) {
                return;
            }

            if (this.isUserInteractingWithTimeControl(currentTimeControl)) {
                return;
            }

            this.syncMuteDurationAfterSiteUpdate(reasonSelect, currentTimeControl);
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
            if (this.hasUserDurationOverride(reasonSelect)) {
                return;
            }

            const timeControl = dialog.querySelector('#mute-time');
            if (!timeControl) {
                return;
            }

            // SteamID load may reveal X2 options — re-apply for current reason once.
            void this.applyMuteListboxDuration(reasonSelect, timeControl);
        };

        steamInput.addEventListener('input', handleSteamIdChange);
        steamInput.addEventListener('paste', handleSteamIdChange);
    }

    bindTimeSelectListener(reasonSelect, timeControl) {
        if (this.boundTimeChangeListeners.has(timeControl)) {
            return;
        }

        this.boundTimeChangeListeners.add(timeControl);

        timeControl.addEventListener('pointerdown', () => {
            this.userTimeSelectInteraction = timeControl;
        });

        if (this.isNativeTimeSelect(timeControl)) {
            timeControl.addEventListener('change', () => {
                this.handleTimeSelectChange(reasonSelect, timeControl);
            });
            return;
        }

        if (this.isMuteDurationListboxControl(timeControl)) {
            const observer = new MutationObserver(() => {
                this.handleListboxButtonChange(reasonSelect, timeControl);
            });
            observer.observe(timeControl, {
                characterData: true,
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['aria-expanded']
            });
        }
    }

    handleListboxButtonChange(reasonSelect, timeControl) {
        if (this.isProgrammaticSelectUpdate) {
            return;
        }

        const expanded = timeControl.getAttribute('aria-expanded') === 'true';
        const currentValue = this.getTimeControlValue(timeControl);

        if (this.userTimeSelectInteraction === timeControl) {
            if (expanded) {
                return;
            }

            this.userTimeSelectInteraction = null;
            const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
            if (currentValue && currentValue !== desired) {
                this.rememberDesiredDuration(reasonSelect, currentValue);
                this.setUserDurationOverride(reasonSelect, true);
            }
            return;
        }

        if (this.hasUserDurationOverride(reasonSelect)) {
            return;
        }
    }

    handleTimeSelectChange(reasonSelect, timeControl) {
        if (this.isProgrammaticSelectUpdate) {
            return;
        }

        const dialog = reasonSelect.closest('[role="dialog"]');
        const currentTimeControl = dialog?.querySelector('#mute-time') || timeControl;

        if (this.userTimeSelectInteraction === currentTimeControl) {
            this.userTimeSelectInteraction = null;
            const value = this.getTimeControlValue(currentTimeControl);
            this.rememberDesiredDuration(reasonSelect, value);
            this.setUserDurationOverride(reasonSelect, true);
            return;
        }

        if (this.hasUserDurationOverride(reasonSelect)) {
            return;
        }
    }

    observeMuteTimeOptions(reasonSelect, timeControl) {
        if (this.boundMuteTimeObservers.has(timeControl)) {
            return;
        }

        this.boundMuteTimeObservers.add(timeControl);

        const observer = new MutationObserver(() => {
            if (
                this.isProgrammaticSelectUpdate
                || this.isDurationRestoreSuppressed()
                || this.hasUserDurationOverride(reasonSelect)
                || this.isUserInteractingWithTimeControl(timeControl)
            ) {
                return;
            }

            const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
            const current = this.getTimeControlValue(timeControl);
            if (desired != null && current === String(desired)) {
                return;
            }

            this.scheduleDurationRestore(reasonSelect, timeControl);
        });

        observer.observe(timeControl, { childList: true, subtree: true, attributes: true });

        if (this.isMuteDurationListboxControl(timeControl) && this.document.body && !this.listboxBodyObserver) {
            this.listboxBodyObserver = new MutationObserver(mutations => {
                if (this.isProgrammaticSelectUpdate || this.isDurationRestoreSuppressed()) {
                    return;
                }

                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes || []) {
                        if (
                            node.nodeType === 1
                            && (
                                node.matches?.('[role="listbox"]')
                                || node.querySelector?.('[role="listbox"]')
                            )
                        ) {
                            const dialog = this.document.querySelector('[role="dialog"]');
                            const muteReason = dialog?.querySelector('#mute-reason');
                            const muteTime = dialog?.querySelector('#mute-time');
                            if (
                                !muteReason
                                || !muteTime
                                || this.hasUserDurationOverride(muteReason)
                                || this.isUserInteractingWithTimeControl(muteTime)
                            ) {
                                return;
                            }

                            const desired = this.desiredDurationByReasonSelect.get(muteReason);
                            const current = this.getTimeControlValue(muteTime);
                            if (desired != null && current === String(desired)) {
                                return;
                            }

                            this.scheduleDurationRestore(muteReason, muteTime);
                            return;
                        }
                    }
                }
            });
            this.listboxBodyObserver.observe(this.document.body, { childList: true, subtree: true });
            console.log('[Helper] PunishmentService: listboxBodyObserver init');
        }
    }

    handleReasonChange(event) {
        const reasonSelect = event.currentTarget;
        if (this.isProgrammaticSelectUpdate) {
            return;
        }

        const dialog = reasonSelect.closest('[role="dialog"]');
        if (!dialog) {
            return;
        }

        const isMute = reasonSelect.id === 'mute-reason';
        const timeControl = dialog.querySelector(isMute ? '#mute-time' : '#ban-time');
        if (!timeControl) {
            return;
        }

        this.clearUserDurationOverride(reasonSelect);
        this.clearDurationRestore(reasonSelect);
        this.applyDuration(reasonSelect, timeControl, isMute ? 'mute' : 'ban');
    }

    applyDuration(reasonSelect, timeControl, type) {
        if (this.isMuteDurationListboxControl(timeControl)) {
            void this.applyMuteListboxDuration(reasonSelect, timeControl);
            return;
        }

        const reasonValue = reasonSelect.value;
        const reasonLabel = this.getReasonLabel(reasonSelect);

        const targetValue = this.resolveTimeOptionValue({
            reasonValue,
            reasonLabel,
            timeControl,
            type
        });

        if (targetValue == null) {
            return;
        }

        if (this.setSelectValue(timeControl, targetValue)) {
            this.rememberDesiredDuration(reasonSelect, targetValue);
        } else if (this.getTimeControlValue(timeControl) === String(targetValue)) {
            this.rememberDesiredDuration(reasonSelect, targetValue);
        }
    }

    async applyMuteListboxDuration(reasonSelect, timeControl) {
        if (!this.enabled || !reasonSelect?.isConnected || !timeControl?.isConnected) {
            return false;
        }

        if (this.hasUserDurationOverride(reasonSelect)
            || this.isUserInteractingWithTimeControl(timeControl)
            || this.isProgrammaticSelectUpdate) {
            return false;
        }

        const reasonValue = reasonSelect.value;
        const reasonLabel = this.getReasonLabel(reasonSelect);
        const defaultDuration = this.getDefaultDuration('mute', reasonValue);

        this.clearDurationRestore(reasonSelect);
        this.isProgrammaticSelectUpdate = true;

        try {
            const listbox = await this.waitForDurationListbox(timeControl);
            if (!listbox) {
                return false;
            }

            // User may have opened the list while we were waiting for the portal.
            if (this.isUserInteractingWithTimeControl(timeControl)) {
                return false;
            }

            const x2Option = this.findX2ListboxOption(reasonLabel, listbox);
            let option = x2Option;
            let desired = null;

            if (x2Option) {
                const seconds = this.parseDurationLabelToSeconds(this.getOptionPrimaryText(x2Option));
                desired = seconds != null
                    ? String(seconds)
                    : `x2:${this.normalizePunishmentReason(reasonLabel)}`;
            } else {
                if (defaultDuration == null) {
                    this.closeMuteDurationListbox(timeControl);
                    return false;
                }
                option = this.findDurationListboxOptionBySeconds(Number(defaultDuration), listbox);
                desired = String(defaultDuration);
            }

            if (!option || desired == null) {
                this.closeMuteDurationListbox(timeControl);
                return false;
            }

            const alreadySelected = x2Option
                ? x2Option.getAttribute('aria-selected') === 'true'
                : this.getTimeControlValue(timeControl) === desired;

            if (alreadySelected && this.getTimeControlValue(timeControl) === desired) {
                this.rememberDesiredDuration(reasonSelect, desired);
                this.clearDurationRestore(reasonSelect);
                this.suppressDurationRestore();
                // We opened the listbox to inspect options — close it (user is not interacting).
                this.closeMuteDurationListbox(timeControl);
                return false;
            }

            option.click();
            this.rememberDesiredDuration(reasonSelect, desired);
            this.clearDurationRestore(reasonSelect);
            this.suppressDurationRestore();
            await this.ensureMuteDurationListboxClosed(timeControl);
            return true;
        } finally {
            this.endProgrammaticSelectUpdate();
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

    findDurationListbox() {
        return this.document.querySelector('[role="listbox"]');
    }

    getDurationOptions(listbox = this.findDurationListbox()) {
        if (!listbox) {
            return [];
        }

        return Array.from(listbox.querySelectorAll('[role="option"]'));
    }

    getOptionPrimaryText(optionEl) {
        if (!optionEl) {
            return '';
        }

        const clone = optionEl.cloneNode(true);
        clone.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
        return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }

    getOptionSearchText(optionEl) {
        if (!optionEl) {
            return '';
        }

        const ariaLabel = optionEl.getAttribute?.('aria-label') || '';
        const sibling = optionEl.parentElement?.querySelector('[aria-hidden="true"]');
        const siblingText = sibling?.textContent || '';
        return `${ariaLabel} ${optionEl.textContent || ''} ${siblingText}`;
    }

    isX2Option(optionEl) {
        return /X2/i.test(this.getOptionSearchText(optionEl));
    }

    extractX2ReasonFromOption(optionEl) {
        const searchText = this.getOptionSearchText(optionEl);
        const ariaMatch = searchText.match(/X2\s+(.+?)\s+\d+/i)
            || searchText.match(/X2\s+([^\d(]+)/i);
        if (ariaMatch?.[1]) {
            return ariaMatch[1].trim();
        }

        const sibling = optionEl.parentElement?.querySelector('[aria-hidden="true"]');
        if (sibling) {
            const spans = Array.from(sibling.querySelectorAll('span'));
            const x2Index = spans.findIndex(span => /X2/i.test(span.textContent || ''));
            if (x2Index >= 0 && spans[x2Index + 1]) {
                return (spans[x2Index + 1].textContent || '').trim();
            }
        }

        const legacyMatch = searchText.match(/—\s*(.+?)\s+X2/i);
        return legacyMatch?.[1]?.trim() || null;
    }

    parseDurationLabelToSeconds(label) {
        const text = String(label || '').trim();
        if (!text) {
            return null;
        }

        if (/навсегда/i.test(text)) {
            return 0;
        }

        if (this.utils?.parseDurationToMinutes) {
            const minutes = this.utils.parseDurationToMinutes(text);
            if (minutes > 0) {
                return minutes * 60;
            }
        }

        const normalized = text.toLowerCase();
        let totalMinutes = 0;
        const unitRegex = /(\d+)\s*(день|дня|дней|д\.|час|часа|часов|ч\.|мин|минут|м\.)/gi;
        let match;
        while ((match = unitRegex.exec(normalized)) !== null) {
            const value = parseInt(match[1], 10);
            const unit = match[2];
            if (unit.startsWith('д')) totalMinutes += value * 24 * 60;
            else if (unit.startsWith('ч')) totalMinutes += value * 60;
            else totalMinutes += value;
        }

        return totalMinutes > 0 ? totalMinutes * 60 : null;
    }

    openMuteDurationListbox(button) {
        if (!button) {
            return this.findDurationListbox();
        }

        if (button.getAttribute('aria-expanded') === 'true') {
            return this.findDurationListbox();
        }

        button.click();
        return this.findDurationListbox();
    }

    closeMuteDurationListbox(button) {
        if (!button || !this.isMuteDurationListboxControl(button)) {
            return;
        }

        if (button.getAttribute('aria-expanded') === 'true') {
            button.click();
        }
    }

    isMuteDurationListboxOpen(button) {
        if (button?.getAttribute('aria-expanded') === 'true') {
            return true;
        }

        return Boolean(this.findDurationListbox());
    }

    async ensureMuteDurationListboxClosed(button, attempts = 3) {
        if (!button || !this.isMuteDurationListboxControl(button)) {
            return;
        }

        for (let i = 0; i < attempts; i++) {
            await new Promise(resolve => setTimeout(resolve, 50));

            if (!this.isMuteDurationListboxOpen(button)) {
                return;
            }

            this.closeMuteDurationListbox(button);
        }
    }

    waitForDurationListbox(button, attempts = 8) {
        return new Promise(resolve => {
            if (button && button.getAttribute('aria-expanded') !== 'true') {
                button.click();
            }

            const tryFind = remaining => {
                const listbox = this.findDurationListbox();
                if (listbox || remaining <= 0) {
                    resolve(listbox || null);
                    return;
                }

                setTimeout(() => tryFind(remaining - 1), 50);
            };

            tryFind(attempts);
        });
    }

    findX2ListboxOption(reasonLabel, listbox) {
        if (!reasonLabel || !listbox) {
            return null;
        }

        const normalizedReason = this.normalizePunishmentReason(reasonLabel);

        for (const option of this.getDurationOptions(listbox)) {
            if (!this.isX2Option(option)) {
                continue;
            }

            const x2Reason = this.extractX2ReasonFromOption(option);
            if (x2Reason && this.normalizePunishmentReason(x2Reason) === normalizedReason) {
                return option;
            }
        }

        return null;
    }

    findDurationListboxOptionBySeconds(seconds, listbox) {
        if (seconds == null || !listbox) {
            return null;
        }

        const target = Number(seconds);

        for (const option of this.getDurationOptions(listbox)) {
            if (this.isX2Option(option) && target !== 0) {
                // Prefer non-X2 matches for config defaults; X2 handled separately.
                continue;
            }

            const primary = this.getOptionPrimaryText(option);
            const parsed = this.parseDurationLabelToSeconds(primary);
            if (parsed != null && parsed === target) {
                return option;
            }
        }

        // Fallback: allow matching X2 primary duration text if no plain option.
        for (const option of this.getDurationOptions(listbox)) {
            const primary = this.getOptionPrimaryText(option);
            const parsed = this.parseDurationLabelToSeconds(primary);
            if (parsed != null && parsed === target) {
                return option;
            }
        }

        return null;
    }

    findX2TimeOption(timeControl, reasonLabel) {
        if (!timeControl || !reasonLabel) {
            return null;
        }

        if (this.isMuteDurationListboxControl(timeControl)) {
            const listbox = this.findDurationListbox();
            const option = this.findX2ListboxOption(reasonLabel, listbox);
            if (!option) {
                return null;
            }

            const seconds = this.parseDurationLabelToSeconds(this.getOptionPrimaryText(option));
            return seconds != null ? String(seconds) : `x2:${this.normalizePunishmentReason(reasonLabel)}`;
        }

        if (!this.isNativeTimeSelect(timeControl)) {
            return null;
        }

        const normalizedReason = this.normalizePunishmentReason(reasonLabel);

        for (const option of timeControl.options) {
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
        if (!select || value == null || select.tagName !== 'SELECT') {
            return false;
        }

        return Array.from(select.options).some(option => option.value === String(value));
    }

    hasTimeControlOption(timeControl, value) {
        if (!timeControl || value == null) {
            return false;
        }

        if (this.isNativeTimeSelect(timeControl)) {
            return Array.from(timeControl.options).some(option => option.value === String(value));
        }

        if (!this.isMuteDurationListboxControl(timeControl)) {
            return false;
        }

        const listbox = this.findDurationListbox();
        if (!listbox) {
            // Option may appear after open; treat known numeric desired as available.
            return /^-?\d+$/.test(String(value)) || String(value).startsWith('x2:');
        }

        if (String(value).startsWith('x2:')) {
            const reasonKey = String(value).slice(3);
            return this.getDurationOptions(listbox).some(option => {
                if (!this.isX2Option(option)) return false;
                const x2Reason = this.extractX2ReasonFromOption(option);
                return x2Reason && this.normalizePunishmentReason(x2Reason) === reasonKey;
            });
        }

        return Boolean(this.findDurationListboxOptionBySeconds(Number(value), listbox));
    }

    getTimeControlValue(timeControl) {
        if (!timeControl) {
            return '';
        }

        if (this.isNativeTimeSelect(timeControl)) {
            return String(timeControl.value || '');
        }

        if (this.isMuteDurationListboxControl(timeControl)) {
            const label = this.getOptionPrimaryText(timeControl);
            const seconds = this.parseDurationLabelToSeconds(label);
            return seconds != null ? String(seconds) : label;
        }

        return '';
    }

    resolveTimeOptionValue({ reasonValue, reasonLabel, timeControl, type }) {
        const x2Value = this.findX2TimeOption(timeControl, reasonLabel);
        if (x2Value != null) {
            return x2Value;
        }

        const defaultDuration = this.getDefaultDuration(type, reasonValue);
        if (defaultDuration == null) {
            return null;
        }

        if (this.isMuteDurationListboxControl(timeControl)) {
            return String(defaultDuration);
        }

        if (!this.hasSelectOption(timeControl, defaultDuration)) {
            return null;
        }

        return String(defaultDuration);
    }

    async setMuteDurationByValue(button, value) {
        if (!button || value == null) {
            return false;
        }

        if (this.isUserInteractingWithTimeControl(button) || this.isProgrammaticSelectUpdate) {
            return false;
        }

        const dialog = button.closest('[role="dialog"]');
        const reasonSelect = dialog?.querySelector('#mute-reason');
        if (reasonSelect && this.hasUserDurationOverride(reasonSelect)) {
            return false;
        }

        const nextValue = String(value);
        const current = this.getTimeControlValue(button);
        if (current === nextValue) {
            return false;
        }

        if (reasonSelect) {
            this.clearDurationRestore(reasonSelect);
        }
        this.isProgrammaticSelectUpdate = true;

        try {
            let listbox = this.findDurationListbox();
            if (!listbox || button.getAttribute('aria-expanded') !== 'true') {
                listbox = await this.waitForDurationListbox(button);
            }

            if (!listbox) {
                return false;
            }

            if (this.isUserInteractingWithTimeControl(button)) {
                return false;
            }

            const reasonLabel = reasonSelect ? this.getReasonLabel(reasonSelect) : '';

            let option = null;

            if (nextValue.startsWith('x2:')) {
                const reasonKey = nextValue.slice(3);
                option = this.getDurationOptions(listbox).find(opt => {
                    if (!this.isX2Option(opt)) {
                        return false;
                    }
                    const x2Reason = this.extractX2ReasonFromOption(opt);
                    return x2Reason && this.normalizePunishmentReason(x2Reason) === reasonKey;
                }) || null;
            } else {
                const x2Option = this.findX2ListboxOption(reasonLabel, listbox);
                const x2Seconds = x2Option
                    ? this.parseDurationLabelToSeconds(this.getOptionPrimaryText(x2Option))
                    : null;

                if (x2Option && x2Seconds != null && String(x2Seconds) === nextValue) {
                    option = x2Option;
                } else {
                    option = this.findDurationListboxOptionBySeconds(Number(nextValue), listbox);
                }
            }

            if (!option) {
                this.closeMuteDurationListbox(button);
                return false;
            }

            option.click();
            if (reasonSelect) {
                this.clearDurationRestore(reasonSelect);
            }
            this.suppressDurationRestore();
            await this.ensureMuteDurationListboxClosed(button);
            return true;
        } finally {
            this.endProgrammaticSelectUpdate();
        }
    }

    setTimeControlValue(timeControl, value) {
        if (!timeControl || value == null) {
            return false;
        }

        if (this.isMuteDurationListboxControl(timeControl)) {
            // Fire-and-forget async open+click; callers treat truthy attempt as applied when already matching.
            const current = this.getTimeControlValue(timeControl);
            if (current === String(value)) {
                return false;
            }

            void this.setMuteDurationByValue(timeControl, value);
            return true;
        }

        return this.setSelectValue(timeControl, value);
    }

    setSelectValue(select, value) {
        if (!select || value == null) {
            return false;
        }

        if (select.tagName !== 'SELECT') {
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
