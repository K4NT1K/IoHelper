import {mergeSettings} from './shared/settings.js';
import {validModeratorGroup} from './shared/moderators.js';

export class ConfigService {
    static LOCAL_KEY = 'helperConfig';
    static FETCHED_AT_KEY = 'helperConfigFetchedAt';
    static META_KEY = 'helperConfigMeta';
    static FETCH_TTL_MS = 60 * 60 * 1000;
    static TIMEOUT_MS = 8000;
    static DEFAULT_CONFIG_URL = 'https://raw.githubusercontent.com/K4NT1K/IoHelper/refs/heads/main/config.json';
    static inflight = null;
    static supports(config, version) {
        if (!config.minimumExtensionVersion) return true;
        const required = String(config.minimumExtensionVersion).split('.').map(Number);
        const current = String(version).split('.').map(Number);
        for (let i = 0; i < Math.max(current.length, required.length); i++) {
            const diff = (current[i] || 0) - (required[i] || 0);
            if (diff) return diff > 0;
        }
        return true;
    }

    static isValid(config) {
        const record = value => value && typeof value === 'object' && !Array.isArray(value);
        if (!record(config) || !record(config.settings) || !Array.isArray(config.muteRules)) return false;
        if (config.schemaVersion != null && config.schemaVersion !== 1) return false;
        if (config.minimumExtensionVersion != null && !/^\d+(?:\.\d+){0,3}$/.test(config.minimumExtensionVersion)) return false;
        if (config.settings.features != null && (!record(config.settings.features)
            || Object.values(config.settings.features).some(v => typeof v !== 'boolean'))) return false;
        for (const key of ['reasonTriggers', 'reasonTriggersAutoconnect', 'autoConnectReasons', 'offenderVipStatuses']) {
            if (config.settings[key] != null && (!Array.isArray(config.settings[key]) || config.settings[key].some(v => typeof v !== 'string'))) return false;
        }
        for (const key of ['newAccountHours', 'headshotPercentage', 'trackOffenderInterval', 'trackOffenderIntervalWhileReviewing']) {
            if (config.settings[key] != null && (typeof config.settings[key] !== 'number' || !Number.isFinite(config.settings[key]) || config.settings[key] < 0)) return false;
        }
        if (config.muteRules.some(rule => !record(rule) || typeof rule.name !== 'string'
            || !Array.isArray(rule.keywords) || rule.keywords.some(k => typeof k !== 'string')
            || ['severity', 'duration', 'priority'].some(k => rule[k] != null && !Number.isFinite(rule[k])))) return false;
        if (config.muteExceptions != null && (!record(config.muteExceptions)
            || Object.values(config.muteExceptions).some(v => !Array.isArray(v) || v.some(x => typeof x !== 'string')))) return false;
        if (config.spamRules != null && (!record(config.spamRules)
            || Object.values(config.spamRules).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0))) return false;
        if (config.templates != null && (!record(config.templates) || Object.values(config.templates).some(list => !Array.isArray(list)
            || list.some(item => !record(item) || typeof item.name !== 'string' || typeof item.text !== 'string')))) return false;
        return config.moderators == null || (record(config.moderators) && Object.values(config.moderators).every(validModeratorGroup));
    }

    static normalize(config) {
        return {...config, settings: mergeSettings(config.settings)};
    }

    static async readJson(url) {
        const controller = new AbortController();
        let timer;
        try {
            return await Promise.race([
                (async () => {
                    const response = await fetch(url, {cache: 'no-cache', signal: controller.signal});
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const config = await response.json();
                    if (!this.isValid(config)) throw new Error('Неверная структура конфигурации');
                    return config;
                })(),
                new Promise((_, reject) => {timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error('Таймаут загрузки конфигурации'));
                }, this.TIMEOUT_MS);})
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    static async load(chrome, {force = false} = {}) {
        const stored = await chrome.storage.local.get([this.LOCAL_KEY, this.FETCHED_AT_KEY, this.META_KEY]);
        const cached = stored[this.LOCAL_KEY];
        if (!force && this.isValid(cached) && Date.now() - (stored[this.META_KEY]?.checkedAt || stored[this.FETCHED_AT_KEY] || 0) < this.FETCH_TTL_MS) {
            if(!stored[this.META_KEY]) await chrome.storage.local.set({[this.META_KEY]: {source:'cache',revision:await this.revision(cached),checkedAt:stored[this.FETCHED_AT_KEY]}});
            return this.normalize(cached);
        }
        if (!this.inflight) this.inflight = this.refresh(chrome, cached).finally(() => {this.inflight = null;});
        return this.inflight;
    }

    static async refresh(chrome, cached) {
        try {
            const config = await this.readJson(this.DEFAULT_CONFIG_URL);
            if (!this.supports(config, chrome.runtime.getManifest?.().version || '0')) throw new Error('Для нового конфига требуется обновить расширение до ' + config.minimumExtensionVersion);
            const revision = await this.revision(config);
            const changed = !this.isValid(cached) || await this.revision(cached) !== revision;
            await chrome.storage.local.set({...(changed ? {[this.LOCAL_KEY]: config} : {}), [this.FETCHED_AT_KEY]: Date.now(),
                [this.META_KEY]: {source: 'github', revision, checkedAt: Date.now(), error: null}});
            return this.normalize(config);
        } catch (error) {
            const previous = await chrome.storage.local.get(this.META_KEY);
            await chrome.storage.local.set({[this.META_KEY]: {...previous[this.META_KEY], checkedAt: Date.now(), error: error.message}});
            if (this.isValid(cached)) return this.normalize(cached);
        }
        const bundled = await this.readJson(chrome.runtime.getURL('config.json'));
        await chrome.storage.local.set({[this.LOCAL_KEY]: bundled,
            [this.META_KEY]: {source: 'bundled', revision: await this.revision(bundled), checkedAt: Date.now(), error: 'GitHub недоступен; используется встроенная копия'}});
        return this.normalize(bundled);
    }

    static async revision(config) {
        const bytes = new TextEncoder().encode(JSON.stringify(config));
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(hash)).slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join('');
    }

    static async getForClient(chrome) {
        try {
            const response = await chrome.runtime.sendMessage({action: 'getHelperConfig'});
            if (response?.success && this.isValid(response.config)) return {...this.normalize(response.config), iohRevision: response.revision};
        } catch { /* Extension just reloaded, use a bounded local fallback. */ }
        const {helperConfig} = await chrome.storage.local.get('helperConfig');
        if (this.isValid(helperConfig)) return this.normalize(helperConfig);
        return this.normalize(await this.readJson(chrome.runtime.getURL('config.json')));
    }
}
