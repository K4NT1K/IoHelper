import {markIoh} from '../shared/dom.js';
import {PLAYER_PROFILE_LINK_SELECTOR, steamIdFromPlayerProfileUrl} from '../shared/playerProfile.js';
import {flattenModeratorGroup} from '../shared/moderators.js';
import {punishmentActive} from '../native/model.js';

export const NativeTicketMethods = {
    getNativeTicket(scope = null) {
        if (!this.nativeData) return null;
        scope ||= this.getAutoConnectScope?.() || this.document.body;
        const headings = [...(scope?.querySelectorAll?.('h3') || [])];
        const matches = headings.map(h => (h.textContent || '').match(/Результат рассмотрения (тикета|репорта) #(\d+)/i)).filter(Boolean);
        // A body containing several SPA panels is deliberately ambiguous.
        if (matches.length !== 1) return null;
        const match = matches[0];
        const ticket = this.nativeData.tickets.get(`${match[1].toLowerCase() === 'тикета' ? 'ticket' : 'report'}:${match[2]}`);
        if (!ticket) return null;
        const field = this.findInfoFieldScoped('Нарушитель', scope);
        const link = field?.querySelector(PLAYER_PROFILE_LINK_SELECTOR);
        if (link && steamIdFromPlayerProfileUrl(link.href) !== ticket.suspectId) return null;
        return ticket;
    },

    getNativeRowTicket(row) {
        if (!this.nativeData || !row?.querySelectorAll) return null;
        const links = [...row.querySelectorAll(PLAYER_PROFILE_LINK_SELECTOR)];
        const ids = links.map(x => steamIdFromPlayerProfileUrl(x.href)).filter(Boolean);
        if (ids.length < 2) return null;
        const fiberKey = Object.keys(row).find(k => k.startsWith('__reactFiber$'));
        let fiber = fiberKey ? row[fiberKey] : null;
        for (let i = 0; fiber && i < 4; i++, fiber = fiber.return) {
            if (!/^\d{1,12}$/.test(String(fiber.key || ''))) continue;
            const found = this.nativeData.queueTickets().filter(t => t.id === Number(fiber.key)
                && t.senderId === ids[0] && t.suspectId === ids[1]);
            if (found.length === 1) return found[0];
        }
        const link = row.querySelector('a[href^="steam://connect/"]');
        const original = link?.dataset.iohOriginalServerIp || link?.href?.replace(/^steam:\/\/connect\//i, '').toLowerCase();
        const candidates = this.nativeData.queueTickets().filter(t => t.senderId === ids[0] && t.suspectId === ids[1]
            && (!original || t.complaintServer === original));
        const saved = candidates.find(t => t.key === row.dataset.iohNativeTicket);
        if (saved) return saved;
        candidates.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        // When two indistinguishable native rows have no stable key, don't guess an identity.
        const ticket = candidates.length === 1 ? candidates[0] : null;
        if (ticket) row.dataset.iohNativeTicket = ticket.key;
        return ticket || null;
    },

    nativePlayer(id) {
        const p = this.nativeData?.player(id);
        if (!p) return null;
        const result = {...p, fetchedAt: p.updatedAt};
        const newer = (a, b) => p.stamps[a] > p.stamps[b] || p.stamps[a] === p.stamps[b] && (p.orders[a] || 0) >= (p.orders[b] || 0);
        if (p.bans && newer('bans', 'isBanned')) result.isBanned = p.bans.some(x => punishmentActive(x));
        if (p.mutes && newer('mutes', 'isMuted')) result.isMuted = p.mutes.some(x => punishmentActive(x));
        if (p.serverIp) result.serverLabel ||= this.nativeData.servers.get(p.serverIp);
        return result;
    },

    nativeAutoConnectDecision({analysisFallback = false} = {}) {
        const scope = this.getAutoConnectScope(), t = this.getNativeTicket(scope);
        if (!this.settings.features?.autoConnectServer || !t || !this.scopeHasInProgressStatus(scope)) return {allowed: false, reason: 'Нет доступной собственной жалобы'};
        const p = this.nativePlayer(t.suspectId);
        if (!p?.serverIp) return {allowed: false, reason: 'Текущий сервер не подтверждён сайтом'};
        if (!this.canAutoConnectAfterAnalysis(scope)) return {allowed: false, reason: 'Ожидание разрешающего анализа'};
        const reasonAllowed = (this.settings.autoConnectReasons || ['Читерство', 'Багоюз']).some(r => t.reason?.toLowerCase().includes(r.toLowerCase()));
        const allowed = analysisFallback || reasonAllowed || this.complaintTextMatchesAutoconnectTrigger(t.message);
        return {allowed, reason: allowed ? 'Подтверждённые данные сайта' : 'Категория не разрешает подключение'};
    },

    nativeHistory(scope, resource) {
        const ticket = this.getNativeTicket(scope);
        const history = ticket && this.nativeData.history(ticket.suspectId, resource);
        const player = ticket && this.nativePlayer(ticket.suspectId);
        const items = history?.items || player?.[resource];
        const knownActive = player?.[resource === 'bans' ? 'isBanned' : 'isMuted'] === true;
        return {nativeHistory: true, resource, items: items || [], ready: Boolean(items), steamId: ticket?.suspectId,
            revision: history?.revision || 0, active: ticket ? this.nativeData.active(ticket.suspectId, resource) || (knownActive ? {nativeStatus: true, kind: resource} : null) : null};
    },

    nativeHistoryBlocks(scope) {
        const t = this.getNativeTicket(scope);
        return {ban: this.nativeHistory(scope, 'bans'), mute: this.nativeHistory(scope, 'mutes'),
            warning: {nativeHistory: true, items: t?.warnings || [], ready: Boolean(t && Object.hasOwn(t, 'warnings'))},
            chat: this.getBlockByHeaderScoped('История Чата', scope), offenderSteamId: t?.suspectId || 'unknown'};
    },

    nativeAnalysisReady(scope) {
        const t = this.getNativeTicket(scope);
        if (!t) return false;
        const p = this.nativePlayer(t.suspectId);
        if (p?.isBanned || p?.isMuted) return true;
        return Boolean(this.nativeData.history(t.suspectId, 'chats') && this.nativeData.history(t.suspectId, 'mutes')
            && this.nativeData.history(t.suspectId, 'bans') && Object.hasOwn(t, 'warnings')
            && typeof p?.isBanned === 'boolean' && typeof p?.isMuted === 'boolean');
    },

    nativeMessages(scope) {
        const t = this.getNativeTicket(scope);
        const messages = t && this.nativeData.history(t.suspectId, 'chats')?.items;
        if (!messages) return [];
        const now = Date.now(), anchor = t.chatAnchor || (t.endedAt && t.endedAt <= now ? t.endedAt : now);
        // Preserve both the site's display window and the extension's existing 24h check.
        return messages.filter(m => m.timeMs >= anchor - 86400000 && m.timeMs <= anchor
            && m.timeMs >= now - 86400000 && m.timeMs <= now);
    },

    nativeAnalysisSignature(scope) {
        const t = this.getNativeTicket(scope); if (!t) return 'pending';
        const p = this.nativePlayer(t.suspectId);
        return JSON.stringify([t.key, t.chatAnchor, t.endedAt, t.warnings,
            this.nativeMessages(scope), p?.isBanned, p?.isMuted,
            (this.nativeData.history(t.suspectId, 'mutes')?.items || p?.mutes)?.filter(m => m.created >= Date.now() - 30 * 86400000)]);
    },

    bindNativeMessageRows(scope) {
        const t = this.getNativeTicket(scope);
        const messages = t && this.nativeData.history(t.suspectId, 'chats')?.items;
        const block = this.getBlockByHeaderScoped('История Чата', scope);
        const bindings = new Map();
        if (!messages || !block) return bindings;
        const used = new Set();
        for (const row of block.querySelectorAll('tbody tr')) {
            const cells = row.querySelectorAll('td'); if (cells.length < 2) continue;
            const stamp = row.querySelector('[data-2gnyztty]')?.getAttribute('data-2gnyztty');
            const timeText = cells[0]?.innerText || cells[0]?.textContent || '';
            const text = this.utils.extractMessageText(cells[cells.length - 1]);
            const message = messages.find(m => !used.has(m.id) && (stamp === m.id || stamp === String(m.timeMs / 1000)
                || m.text === text && Math.abs((this.utils.parseTimeToMs(timeText) || 0) - m.timeMs) < 1000));
            if (message) { bindings.set(message.id, row); used.add(message.id); }
        }
        return bindings;
    },

    setNativeModerators(moderators) {
        this.nativeModerators = new Set(['Tier', 'Movement', 'Hns', 'Jail'].flatMap(k => Object.keys(flattenModeratorGroup(moderators?.[k]))));
    },

    renderNativeParticipant(link, id) {
        if (!link || !id) return false;
        const moderator = Boolean(this.nativeModerators?.has(id) || this.nativeData.player(id)?.isModerator);
        // Existing renderer scopes ownership to this participant's cell/field.
        this.applyOffenderModeratorHighlight(null, link, moderator);
        return moderator;
    },

    renderNativeQueue() {
        if (!this.nativeData) return;
        for (const table of this.findComplaintQueueTables()) for (const row of table.querySelectorAll('tbody tr')) {
            const t = this.getNativeRowTicket(row); if (!t) continue;
            const links = [...row.querySelectorAll(PLAYER_PROFILE_LINK_SELECTOR)];
            const sender = links.find(l => steamIdFromPlayerProfileUrl(l.href) === t.senderId);
            const suspect = links.find(l => steamIdFromPlayerProfileUrl(l.href) === t.suspectId && l !== sender) || links[1];
            const p = this.nativePlayer(t.suspectId) || {};
            const senderMod = this.renderNativeParticipant(sender, t.senderId);
            const suspectMod = this.renderNativeParticipant(suspect, t.suspectId);
            if (this.settings.features?.trackOffenderServer) {
                const link = row.querySelector('a[href^="steam://connect/"]');
                if (link && Object.hasOwn(p, 'serverIp')) {
                    link.dataset.iohOriginalServerIp = t.complaintServer || '';
                    this.applyOffenderServerStatus(link, t.suspectId, t.complaintServer, p);
                }
                this.applyOffenderPunishmentHighlight(row, p);
                this.applyOffenderPunishmentActionLabel(row, p);
                this.applyOffenderVipBadge(suspect, p.vipName);
                this.applyOffenderProfileVerification(suspect, p.profileVerified, null);
            }
            row.classList.toggle('ioh-highlighted-moderator', senderMod || suspectMod
                || Boolean(this.settings.features?.trackOffenderServer && p.profileVerified));
        }
    },

    syncNativeTicketViews() {
        if (!this.nativeData) return;
        for (const textarea of this.document.querySelectorAll('textarea[placeholder*="Опишите детали закрытия"]')) {
            const scope = this.getTicketScopeRoot(textarea), t = this.getNativeTicket(scope); if (!t) continue;
            for (const [label, id] of [['Отправитель', t.senderId], ['Нарушитель', t.suspectId]]) {
                const field = this.findInfoFieldScoped(label, scope);
                const link = [...(field?.querySelectorAll(PLAYER_PROFILE_LINK_SELECTOR) || [])].find(l => steamIdFromPlayerProfileUrl(l.href) === id);
                this.renderNativeParticipant(link, id);
            }
            this.renderNativeContext(scope, t);
        }
        this.renderNativeQueue();
        this.syncOpenTicketOffenderTracking();
    },

    renderNativeContext(scope, ticket) {
        scope.querySelector('#ioh-native-context')?.remove();
        const bypass = this.nativeData.bypasses.get(ticket.suspectId);
        const field = this.findInfoFieldScoped('Обход блокировки', scope)
            || this.findInfoFieldScoped('Обход бана', scope)
            || this.findInfoFieldScoped('Обход блокировки:', scope);
        const previous = scope.querySelector('.ioh-bypass-count');
        if (!field || bypass?.checked !== true || !Number.isFinite(bypass.bannedAccounts)) {previous?.remove(); return;}
        const host = field.querySelector(':scope > div') || field;
        let node = previous;
        if (!node || !field.contains(node)) {
            node?.remove(); node = this.document.createElement('span'); markIoh(node); node.className = 'ioh-bypass-count'; host.append(node);
        }
        const text = String(bypass.bannedAccounts);
        if (node.textContent !== text) node.textContent = text;
        node.title = `Заблокированных аккаунтов: ${bypass.bannedAccounts}`;
        node.setAttribute('aria-label', node.title);
    },

    consumeNativeEvent(event) {
        if (!this.nativeData) return;
        const closeReasonPlayers = new Set([...(this._closeReasonSessions?.values() || [])].map(s => s.steamId));
        for (const id of closeReasonPlayers) {
            const p = this.nativePlayer(id);
            if (p) this.onCloseReasonPunishmentData(id, p);
        }
        if (event.kind === 'account') {
            this.syncNativePermissions();
        }
        if (event.kind === 'action') {
            const attempt = [...(this._nativePunishmentAttempts?.values() || [])].filter(a => a.steamId === event.payload.steamId
                && (a.type === 'ban' ? 'bans' : 'mutes') === event.payload.resource && a.at <= event.startedAt)
                .sort((a, b) => b.at - a.at)[0];
            if (attempt) {
                this._nativePunishmentAttempts.delete(attempt.attemptToken);
                const t = this.getNativeTicket(attempt.scope);
                if (t && t.id === Number(attempt.ticketId) && t.suspectId === attempt.steamId && this.document.contains(attempt.scope)) {
                    if (event.payload.success) {
                        const key = attempt.type === 'ban' ? 'isBanned' : 'isMuted';
                        this.nativeData.mergePlayer(attempt.steamId, {[key]: true}, event);
                        const current = this.nativePlayer(attempt.steamId);
                        this.onCloseReasonPunishmentData(attempt.steamId, {...current, scope: attempt.scope, ticketId: attempt.ticketId});
                        const session = this._punishmentFeedbackSessions?.get(attempt.scope);
                        if (current?.[key] && session) session.nativeConfirmed = {type: attempt.type, startedAt: event.startedAt, sequence: event.sequence};
                        if (!current?.[key]) {
                            this.cancelTicketPunishmentFeedbackIntent(attempt.attemptToken);
                            this.cancelCloseReasonPunishmentIntent(attempt.attemptToken);
                        }
                    } else {
                        this.cancelTicketPunishmentFeedbackIntent(attempt.attemptToken);
                        this.cancelCloseReasonPunishmentIntent(attempt.attemptToken);
                    }
                }
            }
        }
        // Connect only on an incoming presence event, never on a periodic task or list server field.
        const presenceIds = new Set();
        if (event.source !== 'tracker' && event.kind === 'player' && Object.hasOwn(event.payload, 'serverIp')) presenceIds.add(event.payload.steamId);
        if (event.kind === 'ticket' && event.payload.presence) presenceIds.add(event.payload.suspectId);
        if (event.kind === 'serverPlayers' && event.payload.endpoint) event.payload.players.forEach(p => presenceIds.add(p.steamId));
        this.syncOpenTicketOffenderTracking();
        for (const session of this._openTicketTrackingSessions.values()) {
            if (!presenceIds.has(session.steamId)) continue;
            const p = this.nativePlayer(session.steamId); if (!p || !Object.hasOwn(p, 'serverIp')) continue;
            const old = session.lastServer;
            session.lastServer = p.serverIp;
            if (p.serverIp === null) { session.waitingForReturn = true; session.pendingServer = null; this.markOffenderOffline(session.steamId); }
            else {
                const t = this.getNativeTicket(session.scope);
                this.clearOffenderOffline(session.steamId);
                if (p.serverIp !== t?.complaintServer) this.markOffenderRelocated(session.steamId, p.serverIp);
                else this.clearOffenderRelocated(session.steamId);
                if (session.waitingForReturn || old && old !== p.serverIp || old === undefined && p.serverIp !== t?.complaintServer) session.pendingServer = p.serverIp;
                if (session.pendingServer === p.serverIp) {
                    const already = this.isAlreadyOnRequestedServer(p.serverIp);
                    const connected = !already && this.connectToTrackedOffenderServer(session, p.serverIp);
                    if (already || connected) {session.pendingServer = null; this.announceOffenderTrackerResult?.(session, connected);}
                }
                session.waitingForReturn = false;
            }
        }
        this.syncNativeTicketViews();
        this.syncCloseReasonSelection(); this.syncTicketPunishmentFeedback();
        this.syncOffenderTrackerStatus?.();
    },
    rememberNativePunishmentIntent(intent) {
        if (!this.nativeData || !intent.attemptToken || this._nativePunishmentAttempts?.has(intent.attemptToken)) return;
        this._nativePunishmentAttempts ||= new Map();
        this._nativePunishmentAttempts.set(intent.attemptToken, {...intent, at: Date.now()});
        while (this._nativePunishmentAttempts.size > 40) this._nativePunishmentAttempts.delete(this._nativePunishmentAttempts.keys().next().value);
    },
    syncNativePermissions() {
        const account = this.nativeData?.account;
        const has = name => account?.groups.some(g => g.split(':')[0] === name);
        this.canIssueBan = Boolean(account && (/z/.test(account.flags) || has('web.users.bans.set')));
        this.canIssueMute = Boolean(account && (/z/.test(account.flags) || has('web.users.comms.set')));
        this._permissionsHydrated = Boolean(account);
    }
};
