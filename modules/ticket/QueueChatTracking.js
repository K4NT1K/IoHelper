import {requestQueueChat} from '../native/QueueChatClient.js';
import {analyzeQueueChatMessages} from './QueueChatAnalysis.js';
import {steamIdFromPlayerProfileUrl} from '../shared/playerProfile.js';

export const QueueChatTrackingMethods = {
    async fetchQueueChat(steamId) {
        this._queueChatInflight ||= new Map();
        if (this._queueChatInflight.has(steamId)) return this._queueChatInflight.get(steamId).promise;
        const controller = new AbortController();
        const entry = {controller};
        entry.promise = requestQueueChat({window, steamId, signal: controller.signal}).then(messages => {
            if (controller.signal.aborted) return null;
            this._queueChatCache ||= new Map();
            this._queueChatCache.delete(steamId);
            this._queueChatCache.set(steamId, {messages, fetchedAt: Date.now()});
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
        if (!cached.verdict || cached.rules !== this.rules || cached.exceptions !== this.muteExceptions
            || cached.spamRules !== this.spamRules || now >= cached.expiresAt) {
            cached.verdict = analyzeQueueChatMessages(this, cached.messages, {now});
            cached.rules = this.rules; cached.exceptions = this.muteExceptions; cached.spamRules = this.spamRules;
            const expirations = cached.messages.map(m => m.timeMs + 86400001).filter(time => time > now);
            cached.expiresAt = expirations.length ? Math.min(...expirations) : Infinity;
        }
        return cached.verdict;
    },

    stopQueueChatTracking() {
        for (const entry of this._queueChatInflight?.values() || []) entry.controller.abort();
        this._queueChatInflight?.clear();
        this._queueChatCache?.clear();
        this._offenderRowSnapshots = new WeakMap();
        for (const row of this.document.querySelectorAll('tr.ioh-highlighted-chat-mute')) {
            row.classList.remove('ioh-highlighted-chat-mute');
            this.restoreAllOffenderPunishmentActionLabels(row);
        }
    }
};
