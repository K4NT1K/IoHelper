import {requestQueueChat, queueChatError} from '../native/QueueChatClient.js';
import {analyzeQueueChatMessages} from './QueueChatAnalysis.js';
import {steamIdFromPlayerProfileUrl} from '../shared/playerProfile.js';

const retryable = new Set(['RATE_LIMIT', 'TIMEOUT', 'UNAVAILABLE', 'INVALID_RESPONSE', 'BUSY']);
function retryDelay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {reject(queueChatError('ABORTED')); return;}
        const cancel = () => {clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(queueChatError('ABORTED'));};
        const timer = setTimeout(() => {signal.removeEventListener('abort', cancel); resolve();}, ms);
        signal.addEventListener('abort', cancel, {once: true});
    });
}

export const QueueChatTrackingMethods = {
    pruneQueueChatCache() {
        if (!this._queueChatCache?.size) return;
        const now = Date.now();
        const queued = new Set((this.nativeData?.queueTickets?.() || []).map(ticket => ticket.suspectId));
        for (const [id, cached] of this._queueChatCache) {
            if (!queued.has(id) && now - (cached.lastUsedAt ?? cached.fetchedAt) >= 10 * 60 * 1000) this._queueChatCache.delete(id);
        }
    },

    async fetchQueueChat(steamId) {
        this._queueChatInflight ||= new Map();
        if (this._queueChatInflight.has(steamId)) return this._queueChatInflight.get(steamId).promise;
        const controller = new AbortController();
        const entry = {controller};
        const read = async () => {
            for (let attempt = 0; ; attempt++) {
                try {return await requestQueueChat({window, steamId, signal: controller.signal});}
                catch (error) {
                    if (controller.signal.aborted || attempt >= 1 || !retryable.has(error.code)) throw error;
                    if (error.code === 'RATE_LIMIT') this.globalServerCooldown = Date.now() + 660;
                    await retryDelay(Math.max(700, (this.globalServerCooldown || 0) - Date.now()), controller.signal);
                }
            }
        };
        entry.promise = read().then(messages => {
            if (controller.signal.aborted) return null;
            this._queueChatCache ||= new Map();
            this._queueChatCache.delete(steamId);
            this._queueChatCache.set(steamId, {messages, fetchedAt: Date.now(), lastUsedAt: Date.now()});
            this.pruneQueueChatCache();
            if (this._queueChatCache.size > 256) this._queueChatCache.delete(this._queueChatCache.keys().next().value);
            return messages;
        }).catch(error => {
            if (!controller.signal.aborted) this._queueChatCache?.delete(steamId);
            if (error.code === 'RATE_LIMIT') this.globalServerCooldown = Date.now() + 660;
            return null;
        }).finally(() => {
            if (this._queueChatInflight.get(steamId) === entry) this._queueChatInflight.delete(steamId);
        });
        this._queueChatInflight.set(steamId, entry);
        return entry.promise;
    },

    getQueueChatVerdict(row) {
        if (!this.settings.features?.trackOffenderServer
            || !this.isMuteHighlightComplaintReason(this.getComplaintReasonFromRow(row))) return null;
        const id = this.nativeData ? this.getNativeRowTicket(row)?.suspectId
            : steamIdFromPlayerProfileUrl(row.querySelector('td:nth-child(4) a[href*="cybershoke."]')?.href);
        const cached = this._queueChatCache?.get(id);
        if (!cached) return null;
        const now = Date.now();
        cached.lastUsedAt = now;
        // Keep verdicts of current rows when a long session visits many players.
        this._queueChatCache.delete(id); this._queueChatCache.set(id, cached);
        if (!cached.verdict || cached.rules !== this.rules || cached.exceptions !== this.muteExceptions
            || cached.spamRules !== this.spamRules || now >= cached.expiresAt) {
            cached.messages = cached.messages.filter(message => message.timeMs >= now - 86400000 && message.timeMs <= now);
            cached.verdict = analyzeQueueChatMessages(this, cached.messages, {now});
            cached.rules = this.rules; cached.exceptions = this.muteExceptions; cached.spamRules = this.spamRules;
            const expirations = cached.messages.map(m => m.timeMs + 86400001).filter(time => time > now);
            cached.expiresAt = expirations.length ? Math.min(...expirations) : Infinity;
        }
        return cached.verdict;
    },

    stopQueueChatTracking({preserveCache = false} = {}) {
        for (const entry of this._queueChatInflight?.values() || []) entry.controller.abort();
        this._queueChatInflight?.clear();
        // SPA navigation restarts requests, not the completed per-player verdicts.
        if (preserveCache) return;
        this._queueChatCache?.clear();
        this._offenderRowSnapshots = new WeakMap();
        for (const row of this.document.querySelectorAll('tr.ioh-highlighted-chat-mute')) {
            row.classList.remove('ioh-highlighted-chat-mute');
            this.restoreAllOffenderPunishmentActionLabels(row);
        }
    }
};
