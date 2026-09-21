import { markIoh } from '../shared/dom.js';

export const OffenderProfileMethods = {
    clearSteamAccountCreationDate() {
        this.document.querySelectorAll('.ioh-account-created').forEach(node => node.remove());
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

        const faceitNode = field.parentNode.querySelector('.ioh-faceit-elo');
        if (faceitNode) {
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

        const accountNode = field.parentNode.querySelector('.ioh-account-created');
        if (accountNode) {
            accountNode.insertAdjacentElement('afterend', node);
        } else {
            field.insertAdjacentElement('afterend', node);
        }

        return valueDiv;
    },

    getOffenderFieldContext() {
        const ticketTextarea = this.findVisibleTicketResolutionTextarea()
            || this.document.querySelector('textarea[placeholder*="Опишите детали закрытия"]');
        if (!ticketTextarea) {
            return null;
        }

        const scope = this.getTicketScopeRoot(ticketTextarea);
        const offenderField = this.findInfoFieldScoped('Нарушитель', scope) || this.findInfoField('Нарушитель');
        const offenderSteamId = this.extractSteamIdFromField(offenderField);

        if (!offenderField || !offenderSteamId) {
            return null;
        }

        return {offenderField, offenderSteamId};
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

    extractSkillLevelFromFastmm(faceitProfile, elo, faceitMissing = false) {
        if (faceitMissing) {
            return {skillLevel: null, rankIconUrl: null};
        }

        let skillLevel = null;
        const level = Number(faceitProfile?.level);
        if (Number.isFinite(level) && level >= 1 && level <= 10) {
            skillLevel = String(level);
        }

        if (!skillLevel && elo) {
            const fromElo = this.faceitEloToSkillLevel(Number(elo));
            if (fromElo != null) {
                skillLevel = String(fromElo);
            }
        }

        const rankIconUrl = skillLevel
            ? `https://mobile.fastmm.win/img/rank/faceit/level${skillLevel}.png`
            : null;

        return {skillLevel, rankIconUrl};
    },

    extractOffenderProfileData(data, source = 'fastmm') {
        const payload = data && typeof data === 'object' ? data : {};
        const steamProfile = payload.steam?.profile || null;
        const faceitPayload = payload.faceit || null;
        const faceitProfile = faceitPayload?.profile || null;

        const creationDate = this.formatSteamCreationDate(steamProfile?.timecreated);

        const eloRaw = faceitProfile?.elo;
        const elo = eloRaw != null && String(eloRaw).trim() !== ''
            ? String(eloRaw).trim()
            : null;

        let faceitMissing = Boolean(faceitPayload?.error) || !faceitProfile || !elo;

        const {skillLevel, rankIconUrl} = this.extractSkillLevelFromFastmm(
            faceitProfile,
            elo,
            faceitMissing
        );

        return {
            creationDate,
            elo: faceitMissing ? null : elo,
            skillLevel: faceitMissing ? null : skillLevel,
            rankIconUrl: faceitMissing ? null : rankIconUrl,
            faceitMissing,
            source
        };
    },

    faceitEloToSkillLevel(elo) {
        if (!Number.isFinite(elo) || elo <= 0) return null;
        if (elo < 801) return 1;
        if (elo < 951) return 2;
        if (elo < 1101) return 3;
        if (elo < 1251) return 4;
        if (elo < 1401) return 5;
        if (elo < 1551) return 6;
        if (elo < 1701) return 7;
        if (elo < 1851) return 8;
        if (elo < 2001) return 9;
        return 10;
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

    renderFaceitEloValue(valueNode, profileData) {
        if (!valueNode) return;

        valueNode.textContent = '';
        valueNode.classList.remove('ioh-account-value--error');

        if (!profileData?.elo) {
            valueNode.textContent = '—';
            return;
        }

        if (profileData.rankIconUrl) {
            const img = this.document.createElement('img');
            img.className = 'ioh-faceit-rank';
            img.src = profileData.rankIconUrl;
            img.alt = profileData.skillLevel
                ? `FaceIt level ${profileData.skillLevel} icon`
                : 'FaceIt level icon';
            img.width = 22;
            img.height = 22;
            valueNode.appendChild(img);
        }

        const eloText = this.document.createElement('span');
        eloText.textContent = `${profileData.elo} Elo`;
        valueNode.appendChild(eloText);
    },

    renderProfileFieldError(valueNode, containerNode, steamId, reloadFn) {
        valueNode.textContent = '';
        valueNode.classList.add('ioh-account-value--error');

        const errorSpan = this.document.createElement('span');
        errorSpan.className = 'ioh-account-error';
        errorSpan.textContent = 'Ошибка загрузки';

        const retryBtn = this.document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'ioh-account-retry';
        retryBtn.title = 'Повторить';
        retryBtn.textContent = '⟳';
        retryBtn.addEventListener('click', () => {
            valueNode.classList.remove('ioh-account-value--error');
            containerNode.dataset.loaded = 'false';
            this.offenderProfileCache.delete(steamId);
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
            valueNode.classList.remove('ioh-account-value--error');
            // Successful fetch: missing date means hidden/unavailable profile data, not a network error.
            valueNode.textContent = profileData.creationDate ? profileData.creationDate : 'Профиль скрыт';
            containerNode.dataset.loaded = 'true';
        } catch (error) {
            this.renderProfileFieldError(
                valueNode,
                containerNode,
                steamId,
                (opts) => this.loadSteamAccountCreationDate(containerNode, steamId, opts)
            );
            containerNode.dataset.loaded = 'true';
        }
    },

    async loadFaceitElo(containerNode, steamId, {force = false} = {}) {
        const valueNode = containerNode.querySelector('.ioh-faceit-value');
        if (!valueNode) return;

        if (!force && containerNode.dataset.steamId === steamId && containerNode.dataset.loaded === 'true') {
            return;
        }

        containerNode.dataset.steamId = steamId;
        containerNode.dataset.loaded = 'false';
        valueNode.textContent = 'Загрузка...';

        try {
            const profileData = await this.fetchOffenderProfile(steamId, {force});
            // Successful fetch with no Faceit / no ELO → dash via renderFaceitEloValue.
            this.renderFaceitEloValue(valueNode, profileData);
            containerNode.dataset.loaded = 'true';
        } catch (error) {
            this.renderProfileFieldError(
                valueNode,
                containerNode,
                steamId,
                (opts) => this.loadFaceitElo(containerNode, steamId, opts)
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
        if (!context) {
            this.clearFaceitElo();
            return;
        }

        const valueNode = this.ensureFaceitEloNode(context.offenderField);
        const containerNode = valueNode.closest('.ioh-faceit-elo');
        await this.loadFaceitElo(containerNode, context.offenderSteamId);
    },
};
