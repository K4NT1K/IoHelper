import { markIoh } from '../shared/dom.js';
import {createFaceitLevelIcon} from '../shared/faceitIcons.js';

export const OffenderProfileMethods = {
    clearSteamAccountCreationDate() {
        this.document.querySelectorAll('.ioh-account-created').forEach(node => node.remove());
    },

    clearCybershokePlaytime() {
        this.document.querySelectorAll('.ioh-cybershoke-playtime').forEach(node => node.remove());
    },

    clearOffenderCountry() {
        this.document.querySelectorAll('.ioh-offender-country').forEach(node => node.remove());
    },

    clearFaceitElo() {
        this.document.querySelectorAll('.ioh-faceit-elo').forEach(node => node.remove());
    },

    ensureSteamAccountCreationNode(field) {
        let node = field.parentNode.querySelector('.ioh-account-created');
        if (node) {
            return node.querySelector('.ioh-account-value');
        }

        node = this.document.createElement('div');
        node.className = field.className + ' ioh-account-created';
        markIoh(node);

        const labelSpan = this.document.createElement('span');
        const originalSpan = field.querySelector('span');
        labelSpan.className = originalSpan ? originalSpan.className : '';
        labelSpan.textContent = 'Создан';

        const valueDiv = this.document.createElement('div');
        const originalDiv = field.querySelector('div');
        valueDiv.className = (originalDiv ? originalDiv.className : '') + ' ioh-account-value';

        node.appendChild(labelSpan);
        node.appendChild(valueDiv);

        const playtimeNode = field.parentNode.querySelector('.ioh-cybershoke-playtime');
        const faceitNode = field.parentNode.querySelector('.ioh-faceit-elo');
        if (playtimeNode) {
            playtimeNode.insertAdjacentElement('beforebegin', node);
        } else if (faceitNode) {
            faceitNode.insertAdjacentElement('beforebegin', node);
        } else {
            field.insertAdjacentElement('afterend', node);
        }

        return valueDiv;
    },

    ensureFaceitEloNode(field) {
        let node = field.parentNode.querySelector('.ioh-faceit-elo');
        if (node) {
            return node.querySelector('.ioh-faceit-value');
        }

        node = this.document.createElement('div');
        node.className = field.className + ' ioh-faceit-elo';
        markIoh(node);

        const labelSpan = this.document.createElement('span');
        const originalSpan = field.querySelector('span');
        labelSpan.className = originalSpan ? originalSpan.className : '';
        labelSpan.textContent = 'Faceit';

        const valueDiv = this.document.createElement('div');
        const originalDiv = field.querySelector('div');
        valueDiv.className = (originalDiv ? originalDiv.className : '') + ' ioh-faceit-value';

        node.appendChild(labelSpan);
        node.appendChild(valueDiv);

        const playtimeNode = field.parentNode.querySelector('.ioh-cybershoke-playtime');
        const accountNode = field.parentNode.querySelector('.ioh-account-created');
        if (playtimeNode) {
            playtimeNode.insertAdjacentElement('afterend', node);
        } else if (accountNode) {
            accountNode.insertAdjacentElement('afterend', node);
        } else {
            field.insertAdjacentElement('afterend', node);
        }

        return valueDiv;
    },

    ensureCybershokePlaytimeNode(field) {
        let node = field.parentNode.querySelector('.ioh-cybershoke-playtime');
        if (node) {
            return node.querySelector('.ioh-cybershoke-value');
        }

        node = this.document.createElement('div');
        node.className = field.className + ' ioh-cybershoke-playtime';
        markIoh(node);

        const labelSpan = this.document.createElement('span');
        const originalSpan = field.querySelector('span');
        labelSpan.className = originalSpan ? originalSpan.className : '';
        labelSpan.textContent = 'CYBERSHOKE';

        const valueDiv = this.document.createElement('div');
        const originalDiv = field.querySelector('div');
        valueDiv.className = (originalDiv ? originalDiv.className : '') + ' ioh-cybershoke-value';

        node.appendChild(labelSpan);
        node.appendChild(valueDiv);

        const faceitNode = field.parentNode.querySelector('.ioh-faceit-elo');
        const accountNode = field.parentNode.querySelector('.ioh-account-created');
        if (faceitNode) {
            faceitNode.insertAdjacentElement('beforebegin', node);
        } else if (accountNode) {
            accountNode.insertAdjacentElement('afterend', node);
        } else {
            field.insertAdjacentElement('afterend', node);
        }

        return valueDiv;
    },

    findOffenderNickElement(field) {
        const valueBlock = this.findFieldValueBlock(field);
        if (!valueBlock) {
            return null;
        }

        const buttons = Array.from(valueBlock.querySelectorAll('button'));
        const nickButton = buttons.find((btn) => {
            const text = (btn.textContent || '').trim();
            return text && !/^\d{17,18}$/.test(text);
        });
        if (nickButton) {
            return nickButton;
        }

        const profileLink = valueBlock.querySelector(
            'a[href*="cybershoke.net/"], a[href*="/moderator/profile/"]'
        );
        if (!profileLink) {
            return null;
        }

        // Nick is usually a sibling/ancestor node above the steamid link row.
        const linkRow = profileLink.parentElement;
        if (linkRow?.previousElementSibling) {
            const prev = linkRow.previousElementSibling;
            const prevButton = prev.querySelector?.('button') || (prev.tagName === 'BUTTON' ? prev : null);
            if (prevButton) {
                return prevButton;
            }
            return prev;
        }

        return null;
    },

    ensureOffenderCountryNode(field) {
        const valueBlock = this.findFieldValueBlock(field);
        const existing = valueBlock?.querySelector('.ioh-offender-country')
            || field.parentNode.querySelector('.ioh-offender-country');
        if (existing) {
            return existing;
        }

        const node = this.document.createElement('span');
        node.className = 'ioh-offender-country';
        node.hidden = true;
        markIoh(node);

        const nick = this.findOffenderNickElement(field);
        if (nick?.parentNode) {
            let insertAfter = nick;
            let next = nick.nextElementSibling;
            while (
                next
                && (
                    next.classList.contains('ioh-admin-icon')
                    || next.classList.contains('ioh-moderator-badge')
                    || next.classList.contains('ioh-profile-verified')
                    || next.classList.contains('ioh-vip-badge')
                    || next.classList.contains('ioh-punishment-icon')
                )
            ) {
                insertAfter = next;
                next = next.nextElementSibling;
            }
            insertAfter.insertAdjacentElement('afterend', node);
            return node;
        }

        const profileLink = valueBlock?.querySelector(
            'a[href*="cybershoke.net/"], a[href*="/moderator/profile/"]'
        );
        if (profileLink) {
            profileLink.insertAdjacentElement('afterend', node);
        } else if (valueBlock) {
            valueBlock.appendChild(node);
        } else {
            field.appendChild(node);
        }

        return node;
    },

    getOffenderFieldContext() {
        const ticketTextarea = this.findVisibleTicketResolutionTextarea()
            || this.document.querySelector('textarea[placeholder*="Опишите детали закрытия"]');
        if (!ticketTextarea) {
            return null;
        }

        const scope = this.getTicketScopeRoot(ticketTextarea);
        const offenderField = this.findInfoFieldScoped('Нарушитель', scope) || this.findInfoField('Нарушитель');
        const offenderSteamId = this.nativeData ? this.getNativeTicket(scope)?.suspectId : this.extractSteamIdFromField(offenderField);

        if (!offenderField || !offenderSteamId) {
            return null;
        }

        return {offenderField, offenderSteamId, scope};
    },

    formatSteamCreationDate(timecreated) {
        const timestamp = Number(timecreated);
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return null;
        }

        return new Date(timestamp * 1000).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    },

    formatCybershokePlaytime(playtime) {
        const seconds = Number(playtime);
        if (!Number.isFinite(seconds) || seconds < 0) {
            return '0ч';
        }

        return `${Math.floor(seconds / 3600)}ч`;
    },

    formatCountryTooltip(country) {
        const code = String(country || '').trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(code)) {
            return code || '';
        }

        try {
            const names = new Intl.DisplayNames(['ru'], {type: 'region'});
            const name = names.of(code);
            return name ? `${code} ${name}` : code;
        } catch {
            return code;
        }
    },

    extractOffenderProfileData(data, source = 'fastmm') {
        return {creationDate: this.formatSteamCreationDate(data?.steam?.profile?.timecreated), source};
    },

    fetchOffenderProfile(steamId, {force = false} = {}) {
        if (!force && this.offenderProfileCache.has(steamId)) {
            return Promise.resolve(this.offenderProfileCache.get(steamId));
        }

        if (!force && this.offenderProfileInflight.has(steamId)) {
            return this.offenderProfileInflight.get(steamId);
        }

        const requestPromise = new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {action: 'fetchOffenderProfile', steamId},
                (response) => {
                    if (chrome.runtime.lastError) {
                        return reject(chrome.runtime.lastError);
                    }
                    if (!(response && response.success)) {
                        return reject(new Error(response ? response.error : 'Unknown error'));
                    }

                    const profileData = this.extractOffenderProfileData(
                        response.data,
                        response.source || 'fastmm'
                    );
                    this.offenderProfileCache.set(steamId, profileData);
                    resolve(profileData);
                }
            );
        }).finally(() => {
            this.offenderProfileInflight.delete(steamId);
        });

        this.offenderProfileInflight.set(steamId, requestPromise);
        return requestPromise;
    },

    renderCybershokePlaytimeValue(valueNode, data) {
        if (!valueNode) {
            return;
        }

        valueNode.classList.remove('ioh-account-value--error');
        valueNode.textContent = this.formatCybershokePlaytime(data?.playtime);
    },

    renderOffenderCountryValue(containerNode, data) {
        if (!containerNode) {
            return;
        }

        containerNode.textContent = '';
        containerNode.classList.remove('ioh-account-value--error');
        delete containerNode.dataset.countryLabel;

        const country = data?.country;
        if (!country) {
            containerNode.hidden = true;
            return;
        }

        containerNode.hidden = false;
        containerNode.dataset.countryLabel = this.formatCountryTooltip(country);

        const img = this.document.createElement('img');
        markIoh(img);
        img.className = 'ioh-offender-flag';
        img.alt = country;
        img.width = 16;
        img.height = 16;
        img.src = `https://cloud.cybershoke.net/img/flags/${country}.svg`;
        img.style.flexShrink = '0';
        containerNode.appendChild(img);
    },

    renderProfileFieldError(valueNode, containerNode, steamId, reloadFn, cacheMap = this.offenderProfileCache) {
        valueNode.textContent = '';
        valueNode.classList.add('ioh-account-value--error');

        const errorSpan = this.document.createElement('span');
        markIoh(errorSpan);
        errorSpan.className = 'ioh-account-error';
        errorSpan.textContent = 'Ошибка загрузки';

        const retryBtn = this.document.createElement('button');
        markIoh(retryBtn);
        retryBtn.type = 'button';
        retryBtn.className = 'ioh-account-retry';
        retryBtn.title = 'Повторить';
        retryBtn.textContent = '⟳';
        retryBtn.addEventListener('click', () => {
            valueNode.classList.remove('ioh-account-value--error');
            containerNode.dataset.loaded = 'false';
            cacheMap.delete(steamId);
            reloadFn({force: true});
        });

        valueNode.appendChild(errorSpan);
        valueNode.appendChild(retryBtn);
    },

    async loadSteamAccountCreationDate(containerNode, steamId, {force = false} = {}) {
        const valueNode = containerNode.querySelector('.ioh-account-value');
        if (!valueNode) return;

        if (!force && containerNode.dataset.steamId === steamId && containerNode.dataset.loaded === 'true') {
            return;
        }

        containerNode.dataset.steamId = steamId;
        containerNode.dataset.loaded = 'false';
        valueNode.textContent = 'Загрузка...';

        try {
            const profileData = await this.fetchOffenderProfile(steamId, {force});
            if (!containerNode.isConnected || containerNode.dataset.steamId !== steamId) return;
            valueNode.classList.remove('ioh-account-value--error');
            // Successful fetch: missing date means hidden/unavailable profile data, not a network error.
            valueNode.textContent = profileData.creationDate ? profileData.creationDate : 'Профиль скрыт';
            containerNode.dataset.loaded = 'true';
        } catch (error) {
            if (!containerNode.isConnected || containerNode.dataset.steamId !== steamId) return;
            this.renderProfileFieldError(
                valueNode,
                containerNode,
                steamId,
                (opts) => this.loadSteamAccountCreationDate(containerNode, steamId, opts)
            );
            containerNode.dataset.loaded = 'true';
        }
    },

    async renderSteamAccountCreationDate() {
        const context = this.getOffenderFieldContext();
        if (!context) {
            this.clearSteamAccountCreationDate();
            return;
        }

        const valueNode = this.ensureSteamAccountCreationNode(context.offenderField);
        const containerNode = valueNode.closest('.ioh-account-created');
        await this.loadSteamAccountCreationDate(containerNode, context.offenderSteamId);
    },

    async renderFaceitElo() {
        const context = this.getOffenderFieldContext();
        if (!context) { this.clearFaceitElo(); return; }
        const faceit = this.nativeData?.player(context.offenderSteamId)?.faceit;
        if (!faceit) { this.clearFaceitElo(); return; }
        const value = this.ensureFaceitEloNode(context.offenderField);
        const signature = `${context.offenderSteamId}:${faceit.elo}:${faceit.level}`;
        if (value.dataset.iohFaceitValue === signature) return;
        value.dataset.iohFaceitValue = signature;
        value.replaceChildren();
        const badge = createFaceitLevelIcon(this.document, faceit.level);
        const label = this.document.createElement('span'); markIoh(label); label.textContent = faceit.elo == null ? 'Без рейтинга' : `${faceit.elo} Elo`;
        value.append(badge, label);
    },

    async renderOffenderProjectInfo({force = false} = {}) {
        const showPlaytime = this.settings?.features?.showCybershokePlaytime;
        const showCountry = this.settings?.features?.showOffenderCountry;

        if (!showPlaytime) {
            this.clearCybershokePlaytime();
        }
        if (!showCountry) {
            this.clearOffenderCountry();
        }
        if (!showPlaytime && !showCountry) {
            return;
        }

        const context = this.getOffenderFieldContext();
        if (!context) {
            this.clearCybershokePlaytime();
            this.clearOffenderCountry();
            return;
        }

        const {offenderField, offenderSteamId} = context;
        if (this.nativeData) {
            const data = this.nativePlayer(offenderSteamId);
            const playtime = this.nativePlaytime(offenderSteamId, this.getNativeTicket(context.scope));
            this._nativeProfileLoads ||= new Map();
            if (playtime == null && !this._nativeProfileLoads.has(offenderSteamId)) {
                this._nativeProfileLoads.set(offenderSteamId, 'pending');
                void this.fetchParsedUserData(offenderSteamId).then(() => this._nativeProfileLoads.set(offenderSteamId,
                    this.nativePlaytime(offenderSteamId, this.getNativeTicket(context.scope)) == null ? 'error' : 'ready'),
                    () => this._nativeProfileLoads.set(offenderSteamId, 'error')).finally(() => {
                    if (!this._pageClosed && this.getOffenderFieldContext()?.offenderSteamId === offenderSteamId) void this.renderOffenderProjectInfo();
                });
            }
            if (showPlaytime) {
                const value = this.ensureCybershokePlaytimeNode(offenderField);
                value.classList.remove('ioh-account-value--error');
                value.textContent = playtime != null ? this.formatCybershokePlaytime(playtime)
                    : this._nativeProfileLoads.get(offenderSteamId) === 'pending' ? 'Загрузка...' : 'Нет данных';
                if (playtime == null && this._nativeProfileLoads.get(offenderSteamId) === 'error') this.renderProfileFieldError(value,
                    value.closest('.ioh-cybershoke-playtime'), offenderSteamId, () => this.renderOffenderProjectInfo(), this._nativeProfileLoads);
            }
            if (showCountry) this.renderOffenderCountryValue(this.ensureOffenderCountryNode(offenderField), data);
            return;
        }
        const playtimeValue = showPlaytime ? this.ensureCybershokePlaytimeNode(offenderField) : null;
        const playtimeContainer = playtimeValue?.closest('.ioh-cybershoke-playtime') || null;
        const countryContainer = showCountry ? this.ensureOffenderCountryNode(offenderField) : null;

        if (!playtimeValue && !countryContainer) {
            return;
        }

        const nodesReady = (!playtimeContainer || (
            playtimeContainer.dataset.steamId === offenderSteamId && playtimeContainer.dataset.loaded === 'true'
        )) && (!countryContainer || (
            countryContainer.dataset.steamId === offenderSteamId && countryContainer.dataset.loaded === 'true'
        ));

        if (!force && nodesReady) {
            return;
        }

        const applyData = (data) => {
            if (playtimeValue) {
                this.renderCybershokePlaytimeValue(playtimeValue, data);
                playtimeContainer.dataset.steamId = offenderSteamId;
                playtimeContainer.dataset.loaded = 'true';
            }
            if (countryContainer) {
                this.renderOffenderCountryValue(countryContainer, data);
                countryContainer.dataset.steamId = offenderSteamId;
                countryContainer.dataset.loaded = 'true';
            }
        };

        const cached = !force
            ? (this.offenderProjectCache.get(offenderSteamId)
                || this.offenderTicketProjectCache.get(offenderSteamId))
            : null;
        if (cached) {
            applyData(cached);
            return;
        }

        if (playtimeValue) {
            playtimeContainer.dataset.steamId = offenderSteamId;
            playtimeContainer.dataset.loaded = 'false';
            playtimeValue.classList.remove('ioh-account-value--error');
            playtimeValue.textContent = 'Загрузка...';
        }
        if (countryContainer) {
            countryContainer.dataset.steamId = offenderSteamId;
            countryContainer.dataset.loaded = 'false';
            countryContainer.classList.remove('ioh-account-value--error');
            delete countryContainer.dataset.countryLabel;
            if (showPlaytime) {
                countryContainer.textContent = '';
                countryContainer.hidden = true;
            } else {
                countryContainer.hidden = false;
                countryContainer.textContent = 'Загрузка...';
            }
        }

        try {
            const data = await this.getOffenderProjectData(offenderSteamId, {force});
            applyData(data);
        } catch (error) {
            const reloadFn = (opts) => this.renderOffenderProjectInfo(opts);
            if (playtimeValue) {
                this.renderProfileFieldError(
                    playtimeValue,
                    playtimeContainer,
                    offenderSteamId,
                    reloadFn,
                    this.offenderTicketProjectCache
                );
                playtimeContainer.dataset.loaded = 'true';
            }
            if (countryContainer) {
                countryContainer.hidden = false;
                this.renderProfileFieldError(
                    countryContainer,
                    countryContainer,
                    offenderSteamId,
                    reloadFn,
                    this.offenderTicketProjectCache
                );
                countryContainer.dataset.loaded = 'true';
            }
        }
    },
};
