import {ConfigService} from './ConfigService.js';
import {flattenModeratorGroup, groupModeratorsByRole, isGeneralModeratorRole, validScheduleSnapshot, UNKNOWN_ROLE} from './shared/moderators.js';
export {validScheduleSnapshot} from './shared/moderators.js';

export const CONFIG_ALARM = 'ioh-config-hourly';
export const SCHEDULE_ALARM = 'ioh-schedule-daily';
export const SCHEDULE_TIMEOUT = 'ioh-schedule-timeout';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const SCHEDULE_TIMEOUT_MS = 120000;
export const SCHEDULE_ALGORITHM = 'worktime-api-v2';
export const isAdminUrl = value => {
    try {const url = new URL(value); return url.protocol === 'https:' && ['io.cybershoke.net', 'io.cybershoke.ru'].includes(url.hostname);} catch {return false;}
};
const sameDays = days => Array.isArray(days) && days.length === 7 && [...days].sort((a, b) => a - b).every((day, i) => day === i);

// Construct a complete replacement only after every fixed weekday has succeeded.
export function scheduleSnapshot(result, now = Date.now()) {
    if (!result || !Array.isArray(result.days) || result.days.length !== 7 || !sameDays(result.days.map(entry => entry?.day))) {
        throw new Error('API вернул неполную неделю; предыдущий список сохранён');
    }
    const union = new Map();
    for (const entry of result.days) {
        if (!Array.isArray(entry.members) || entry.members.length > 5000) throw new Error(`Не загружен день ${entry.day}; предыдущий список сохранён`);
        for (const raw of entry.members) {
            if (!raw || !/^\d{17}$/.test(raw.steamId) || typeof raw.name !== 'string' || !raw.name.trim()) {
                throw new Error('API вернул некорректного модератора; предыдущий список сохранён');
            }
            const className = String(raw.className || UNKNOWN_ROLE).trim().slice(0, 100) || UNKNOWN_ROLE;
            if (!isGeneralModeratorRole(className)) continue;
            const previous = union.get(raw.steamId);
            if (previous && previous.className !== className) throw new Error('API вернул разные должности одного модератора; предыдущий список сохранён');
            const member = {steamId: raw.steamId, name: raw.name.trim().slice(0, 160), className};
            if (typeof raw.avatar === 'string' && /^https:\/\//.test(raw.avatar)) member.avatar = raw.avatar.slice(0, 1000);
            union.set(member.steamId, member);
        }
    }
    const members = [...union.values()].sort((a, b) => a.steamId.localeCompare(b.steamId));
    if (!members.length) throw new Error('В расписании за семь дней не найдены модераторы; предыдущий список сохранён');
    const snapshot = {formatVersion: 2, Tier: groupModeratorsByRole(members), members, scannedAt: now,
        source: 'worktime-api', days: [0, 1, 2, 3, 4, 5, 6]};
    if (!validScheduleSnapshot(snapshot)) throw new Error('Некорректный состав расписания; предыдущий список сохранён');
    return snapshot;
}

export class BackgroundScheduler {
    constructor(chrome) {
        this.chrome = chrome;
        this.stateQueue = Promise.resolve();
        this.dailyPromise = null;
        this.cancelledRequests = new Set();
        chrome.tabs.onRemoved?.addListener(tabId => {void this.sourceClosed(tabId);});
    }

    serialize(operation) {
        const result = this.stateQueue.then(operation, operation);
        this.stateQueue = result.catch(() => {});
        return result;
    }

    start() {
        this.chrome.alarms.onAlarm.addListener(alarm => {
            if (alarm.name === CONFIG_ALARM) void ConfigService.load(this.chrome).catch(console.warn);
            if (alarm.name === SCHEDULE_ALARM) void this.runDaily().catch(console.warn);
            if (alarm.name === SCHEDULE_TIMEOUT) void this.expireScan().catch(console.warn);
        });
        this.chrome.runtime.onInstalled.addListener(() => void this.ensureAlarms());
        this.chrome.runtime.onStartup.addListener(() => void this.ensureAlarms());
        this.chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            if (changes.helperSettings || changes.scriptEnabled || changes.helperConfigMeta) void this.ensureAlarms();
            if (changes.helperSettings || changes.scriptEnabled) void (async () => {
                if (await this.enabled()) await this.runDaily();
                else await this.cancelCurrent('Сканирование выключено');
            })().catch(console.warn);
        });
        void this.ensureAlarms().catch(console.warn);
    }

    async enabled() {
        const data = await this.chrome.storage.local.get(['scriptEnabled', 'helperSettings', 'helperConfig']);
        return data.scriptEnabled !== false && (data.helperSettings?.features?.scanSchedulePage
            ?? data.helperConfig?.settings?.features?.scanSchedulePage ?? false);
    }

    async ensureAlarms() {
        const api = this.chrome;
        const {helperConfigMeta, iohScheduleState = {}} = await api.storage.local.get(['helperConfigMeta', 'iohScheduleState']);
        const configAlarm = await api.alarms.get(CONFIG_ALARM);
        const configWhen = Math.max(Date.now() + 60000, (helperConfigMeta?.checkedAt || 0) + ConfigService.FETCH_TTL_MS);
        if (configAlarm?.periodInMinutes !== 60 || (helperConfigMeta?.checkedAt && Math.abs(configAlarm.scheduledTime - configWhen) > 1000)) {
            await api.alarms.create(CONFIG_ALARM, {when: configWhen, periodInMinutes: 60});
        }
        if (await this.enabled()) {
            const alarm = await api.alarms.get(SCHEDULE_ALARM);
            const startedAt = iohScheduleState.algorithm === SCHEDULE_ALGORITHM ? iohScheduleState.lastStartedAt || 0 : 0;
            const nextAt = Math.max(Date.now() + 60000, startedAt + DAY_MS);
            if (alarm?.periodInMinutes !== 1440 || (startedAt && alarm.scheduledTime < nextAt - 1000)) {
                await api.alarms.create(SCHEDULE_ALARM, {when: nextAt, periodInMinutes: 1440});
            }
        } else await api.alarms.clear(SCHEDULE_ALARM);
        if (iohScheduleState.leaseUntil && iohScheduleState.leaseUntil < Date.now()) await this.expireScan();
    }

    senderAllowed(sender) {
        if (isAdminUrl(sender?.url) && sender.tab?.id) return true;
        try {
            const actual = new URL(sender?.url), expected = new URL(this.chrome.runtime.getURL('analytics.html'));
            return actual.origin === expected.origin && actual.protocol === expected.protocol && actual.host === expected.host
                && ['/analytics.html', '/popup.html'].includes(actual.pathname);
        } catch {return false;}
    }

    isAnalyticsSender(sender) {
        try {
            const actual = new URL(sender?.url), expected = new URL(this.chrome.runtime.getURL('analytics.html'));
            return actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname;
        } catch {return false;}
    }

    async requestDaily(sender, request = {}) {
        if (!this.senderAllowed(sender)) return {success: false, allowed: false};
        // Public entry points observe the same 24h guard; no manual bypass or UI scan.
        const manual = this.isAnalyticsSender(sender);
        const clientRequestId = manual && /^[a-f0-9-]{16,64}$/.test(request.clientRequestId || '') ? request.clientRequestId : null;
        const outcome = await this.runDaily({manual, clientRequestId});
        const {iohScheduleState: state = {}} = await this.chrome.storage.local.get('iohScheduleState');
        const config = await this.getModeratorConfig(sender);
        return {success: true, allowed: false, source: 'worktime-api', status: outcome.status || state.status || 'pending', state,
            snapshot: config.snapshot, nextAt: state.lastStartedAt ? state.lastStartedAt + DAY_MS : 0};
    }

    async getModeratorConfig(sender) {
        if (!this.senderAllowed(sender)) return {success: false};
        const {helperConfig = {}, helperScheduleModerators, iohScheduleState} = await this.chrome.storage.local.get(['helperConfig', 'helperScheduleModerators', 'iohScheduleState']);
        const current = validScheduleSnapshot(helperScheduleModerators) ? helperScheduleModerators : null;
        const moderators = {...(helperConfig.moderators || {}), ...(current ? {Tier: current.Tier} : {})};
        return {success: true, moderators,
            snapshot: current ? {formatVersion: current.formatVersion, source: current.source, scannedAt: current.scannedAt,
                days: current.days, members: current.members || [], count: current.members?.length ?? Object.keys(flattenModeratorGroup(current.Tier)).length} : {source: 'config', scannedAt: null},
            scheduleState: iohScheduleState || {status: 'pending'}};
    }

    runDaily(options = {}) {
        if (this.dailyPromise) return this.dailyPromise;
        this.pendingClientRequestId = options.clientRequestId || null;
        this.dailyPromise = this.runNativeSchedule(options).finally(() => {this.dailyPromise = null; this.pendingClientRequestId = null;});
        return this.dailyPromise;
    }

    async runNativeSchedule({manual = false, clientRequestId = null} = {}) {
        if (!manual && !await this.enabled()) return {success: false, status: 'disabled'};
        if (clientRequestId && this.cancelledRequests.has(clientRequestId)) return {success: false, status: 'cancelled'};
        const {iohScheduleState: previous = {}} = await this.chrome.storage.local.get('iohScheduleState');
        if (previous.algorithm === SCHEDULE_ALGORITHM && ((previous.lastStartedAt && Date.now() - previous.lastStartedAt < DAY_MS) || previous.leaseUntil > Date.now())) {
            return {success: true, status: previous.status, nextAt: previous.lastStartedAt + DAY_MS};
        }
        const candidates = (await this.chrome.tabs.query({url: ['https://io.cybershoke.net/*', 'https://io.cybershoke.ru/*']}))
            .filter(tab => isAdminUrl(tab.url) && !tab.discarded)
            .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
        let source;
        let busy = false;
        for (const tab of candidates.slice(0, 12)) try {
            const pong = await this.chrome.tabs.sendMessage(tab.id, {action: 'analyticsPing'});
            if (pong?.success && pong.scheduleNative === 1) {
                if (pong.busy) {busy = true; continue;}
                source = tab; break;
            }
        } catch { /* Older content scripts need the user's regular page refresh. */ }
        if (!source) {
            await this.serialize(async () => {
                const {iohScheduleState: state = {}} = await this.chrome.storage.local.get('iohScheduleState');
                await this.chrome.storage.local.set({iohScheduleState: {...state, status: 'pending', error: busy
                    ? 'Ожидается завершение статистики в админке' : candidates.length
                        ? 'Обновите открытую админку для подключения к API расписания' : 'Ожидается открытие авторизованной админки'}});
            });
            return {success: false, status: 'pending'};
        }
        const runId = crypto.randomUUID();
        const claimed = await this.serialize(async () => {
            if ((!manual && !await this.enabled()) || (clientRequestId && this.cancelledRequests.has(clientRequestId))) return false;
            const {iohScheduleState: state = {}} = await this.chrome.storage.local.get('iohScheduleState');
            if (state.algorithm === SCHEDULE_ALGORITHM && ((state.lastStartedAt && Date.now() - state.lastStartedAt < DAY_MS) || state.leaseUntil > Date.now())) return false;
            await this.chrome.storage.local.set({iohScheduleState: {status: 'running', algorithm: SCHEDULE_ALGORITHM, source: 'worktime-api', runId, nonce: runId,
                sourceTabId: source.id, origin: new URL(source.url).origin, manual, clientRequestId, lastStartedAt: Date.now(),
                lastCompletedAt: state.lastCompletedAt, count: state.count || 0, leaseUntil: Date.now() + SCHEDULE_TIMEOUT_MS, error: null}});
            await this.chrome.alarms.create(SCHEDULE_TIMEOUT, {when: Date.now() + SCHEDULE_TIMEOUT_MS});
            return true;
        });
        if (!claimed) return {success: false, status: 'skipped'};
        let timeout;
        try {
            const dispatched = await this.serialize(async () => {
                const {iohScheduleState: state} = await this.chrome.storage.local.get('iohScheduleState');
                if (state?.runId !== runId || state.status !== 'running' || (clientRequestId && this.cancelledRequests.has(clientRequestId))) return null;
                return {response: this.chrome.tabs.sendMessage(source.id, {action: 'scheduleCollectNative', nonce: runId})};
            });
            if (!dispatched) return {success: false, status: 'cancelled'};
            const response = await Promise.race([dispatched.response, new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('API расписания не ответил за две минуты; предыдущий список сохранён')), SCHEDULE_TIMEOUT_MS);
            })]);
            if (response?.code === 'BUSY') return await this.restorePending(runId, previous, 'Ожидается завершение статистики в админке');
            if (!response?.success) throw new Error(response?.error || 'Не удалось прочитать расписание через клиент сайта');
            const snapshot = scheduleSnapshot(response.result);
            return await this.serialize(async () => {
                const stored = await this.chrome.storage.local.get(['iohScheduleState', 'helperScheduleModerators', 'helperConfig']);
                const state = stored.iohScheduleState;
                if (state?.runId !== runId || state.status !== 'running' || (!state.manual && !await this.enabled())) return {success: false, status: 'cancelled'};
                const old = flattenModeratorGroup(stored.helperScheduleModerators?.Tier || stored.helperConfig?.moderators?.Tier || {});
                const fresh = flattenModeratorGroup(snapshot.Tier);
                await this.chrome.storage.local.set({helperScheduleModerators: snapshot, iohScheduleState: {...state,
                    status: 'complete', leaseUntil: 0, lastCompletedAt: snapshot.scannedAt, count: snapshot.members.length, error: null}});
                await this.chrome.alarms.clear(SCHEDULE_TIMEOUT);
                await this.ensureAlarms();
                console.log('[IO HELPER] Состав модераторов обновлён через API', {count: snapshot.members.length,
                    roles: Object.keys(snapshot.Tier).length, added: Object.keys(fresh).filter(id => !old[id]).length,
                    removed: Object.keys(old).filter(id => !fresh[id]).length});
                return {success: true, status: 'complete', count: snapshot.members.length};
            });
        } catch (error) {
            await this.failRun(runId, error.message || 'Ошибка API расписания');
            await this.stopNative({sourceTabId: source.id, nonce: runId});
            return {success: false, status: 'failed', error: error.message};
        } finally {clearTimeout(timeout);}
    }

    async restorePending(runId, previous, error) {
        return this.serialize(async () => {
            const {iohScheduleState: state = {}} = await this.chrome.storage.local.get('iohScheduleState');
            if (state.runId !== runId || state.status !== 'running') return {success: false, status: 'cancelled'};
            await this.chrome.storage.local.set({iohScheduleState: {...state, status: 'pending', leaseUntil: 0,
                lastStartedAt: previous.algorithm === SCHEDULE_ALGORITHM ? previous.lastStartedAt || 0 : 0, error}});
            await this.chrome.alarms.clear(SCHEDULE_TIMEOUT);
            return {success: false, status: 'pending'};
        });
    }

    async failRun(runId, error, status = 'failed') {
        return this.serialize(async () => {
            const {iohScheduleState: state = {}} = await this.chrome.storage.local.get('iohScheduleState');
            if (state.runId !== runId || state.status !== 'running') return;
            await this.chrome.storage.local.set({iohScheduleState: {...state, status, leaseUntil: 0, error: String(error).slice(0, 300)}});
            await this.chrome.alarms.clear(SCHEDULE_TIMEOUT);
        });
    }

    async stopNative(state) {
        if (state.sourceTabId && state.nonce) try {
            await this.chrome.tabs.sendMessage(state.sourceTabId, {action: 'scheduleCancelNative', nonce: state.nonce});
        } catch { /* Source tab may already be closed. */ }
    }

    async cancelRequest(request, sender) {
        if (!this.senderAllowed(sender)) return {success: false};
        const {iohScheduleState: state = {}} = await this.chrome.storage.local.get('iohScheduleState');
        if (this.isAnalyticsSender(sender)) {
            const id = request.clientRequestId;
            const ownRequest = id && /^[a-f0-9-]{16,64}$/.test(id)
                && (id === this.pendingClientRequestId || id === state.clientRequestId);
            const ownRun = request.runId && request.runId === state.runId && state.manual;
            if (!ownRequest && !ownRun) return {success: false};
            if (ownRequest) {
                this.cancelledRequests.add(id);
                while (this.cancelledRequests.size > 100) this.cancelledRequests.delete(this.cancelledRequests.values().next().value);
            }
            if (ownRun || (state.clientRequestId === id && state.status === 'running')) {
                await this.failRun(state.runId, 'Сбор состава отменён', 'cancelled');
                await this.stopNative(state);
            }
            return {success: true};
        }
        if (await this.enabled()) return {success: false};
        await this.cancelCurrent('Сканирование выключено');
        return {success: true};
    }

    async cancelCurrent(reason) {
        const {iohScheduleState: state = {}} = await this.chrome.storage.local.get('iohScheduleState');
        if (state.status !== 'running' || state.manual) return;
        await this.failRun(state.runId, reason, 'cancelled');
        await this.stopNative(state);
    }

    async expireScan() {
        const {iohScheduleState: state = {}} = await this.chrome.storage.local.get('iohScheduleState');
        if (!state.leaseUntil || state.leaseUntil > Date.now()) return;
        await this.failRun(state.runId, 'API расписания не ответил за две минуты; предыдущий список сохранён');
        await this.stopNative(state);
    }

    async sourceClosed(tabId) {
        const {iohScheduleState: state = {}} = await this.chrome.storage.local.get('iohScheduleState');
        if (state.sourceTabId === tabId && state.status === 'running') await this.failRun(state.runId, 'Исходная вкладка админки была закрыта');
    }

    async applied(request, sender) {
        if (!isAdminUrl(sender.url) || !sender.tab?.id) return;
        const {iohAppliedConfigs = {}} = await this.chrome.storage.session.get('iohAppliedConfigs');
        iohAppliedConfigs[sender.tab.id] = {revision: String(request.revision || ''), appliedAt: Date.now()};
        const entries = Object.entries(iohAppliedConfigs).sort((a, b) => b[1].appliedAt - a[1].appliedAt).slice(0, 50);
        await this.chrome.storage.session.set({iohAppliedConfigs: Object.fromEntries(entries)});
    }
}
