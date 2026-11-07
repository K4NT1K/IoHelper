import {punishmentActive} from './model.js';

export class NativeDataStore {
    constructor() {
        this.resources = new Map(); this.tickets = new Map(); this.players = new Map();
        this.queues = new Map(); this.histories = new Map(); this.bypasses = new Map();
        this.servers = new Map(); this.listeners = new Set(); this.revision = 0; this.account = null;
        this.sizes = new WeakMap();
    }
    retain(map, key, value, limit, byteLimit = 8 * 1024 * 1024) {
        let budget = this.sizes.get(map);
        if (!budget) { budget = {total: 0, keys: new Map()}; this.sizes.set(map, budget); }
        const bytes = JSON.stringify(value).length * 2;
        budget.total -= budget.keys.get(key) || 0;
        budget.keys.delete(key); map.delete(key);
        budget.keys.set(key, bytes); budget.total += bytes; map.set(key, value);
        while (map.size > limit || budget.total > byteLimit) {
            const oldest = map.keys().next().value;
            budget.total -= budget.keys.get(oldest) || 0; budget.keys.delete(oldest); map.delete(oldest);
        }
    }
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    mergePlayer(id, patch, event) {
        if (!id) return;
        const p = this.players.get(id) || {steamId: id, stamps: {}, orders: {}};
        for (const [key, value] of Object.entries(patch)) {
            if (key === 'steamId' || value === undefined) continue;
            if (key === 'playtime' && value == null && Number.isFinite(p.playtime)) continue;
            if ((p.stamps[key] ?? -1) > event.startedAt || p.stamps[key] === event.startedAt && p.orders[key] > event.sequence) continue;
            p[key] = value; p.stamps[key] = event.startedAt;
            p.orders[key] = event.sequence;
            if (key === 'serverIp') p.presenceAt = event.receivedAt;
        }
        p.updatedAt = event.receivedAt; this.retain(this.players, id, p, 1500);
    }
    mergeTicket(p, event) {
        this._queueTicketsCache = null;
        const previous = this.tickets.get(p.key);
        const t = previous || {key: p.key, stamps: {}, orders: {}};
        for (const [key, value] of Object.entries(p)) {
            if (key === 'playtime' && value == null && Number.isFinite(t.playtime)) continue;
            if (value === undefined || (t.stamps[key] ?? -1) > event.startedAt
                || t.stamps[key] === event.startedAt && t.orders[key] > event.sequence) continue;
            t[key] = value; t.stamps[key] = event.startedAt; t.orders[key] = event.sequence;
        }
        t.updatedAt = Math.max(t.updatedAt || 0, event.receivedAt);
        this.retain(this.tickets, p.key, t, 500, 4 * 1024 * 1024);
        const profile = {};
        if (Object.hasOwn(p, 'playtime')) profile.playtime = p.playtime;
        if (p.suspectCountry) profile.country = p.suspectCountry;
        this.mergePlayer(p.suspectId, profile, event);
        if (p.senderCountry) this.mergePlayer(p.senderId, {country: p.senderCountry}, event);
        if (p.presence) this.mergePlayer(p.suspectId, p.presence, event);
    }
    apply(event) {
        if (event?.version !== 1 || !Number.isFinite(event.startedAt) || !Number.isFinite(event.receivedAt)
            || !Number.isSafeInteger(event.sequence) || event.sequence < 0 || typeof event.key !== 'string') return false;
        const p = event.payload;
        const retained = event.kind === 'history' ? this.history(p?.steamId, p?.resource)
            : event.kind === 'queue' ? this.queues.get(event.key)
            : event.kind === 'bypass' ? this.bypasses.get(p?.steamId)
            : event.kind === 'account' ? this.accountStamp : event.kind === 'servers' ? this.serverStamp : null;
        const previous = this.resources.get(event.key) || retained;
        if (previous && (previous.startedAt > event.startedAt || previous.startedAt === event.startedAt && previous.sequence >= event.sequence)) return false;
        if (!p || !['queue', 'ticket', 'player', 'history', 'account', 'bypass', 'servers', 'serverPlayers', 'action', 'resourceError'].includes(event.kind)) return false;
        if (JSON.stringify(event).length > 1024 * 1024) return false;
        this.retain(this.resources, event.key, event, 160);
        if (event.kind === 'queue') {
            this._queueTicketsCache = null;
            this.queues.set(event.key, {entity: p.entity, keys: p.items.map(x => x.key), startedAt: event.startedAt, sequence: event.sequence});
            while (this.queues.size > 32) this.queues.delete(this.queues.keys().next().value);
            p.items.forEach(t => this.mergeTicket(t, event));
        } else if (event.kind === 'ticket') this.mergeTicket(p, event);
        else if (event.kind === 'player') this.mergePlayer(p.steamId, p, event);
        else if (event.kind === 'history') {
            const key = p.steamId + ':' + p.resource;
            this.retain(this.histories, key, {...p, revision: this.revision + 1, startedAt: event.startedAt, sequence: event.sequence, receivedAt: event.receivedAt}, 240);
            if (p.resource === 'bans' || p.resource === 'mutes') this.mergePlayer(p.steamId, {[p.resource]: p.items, [p.resource === 'bans' ? 'isBanned' : 'isMuted']: p.items.some(x => punishmentActive(x))}, event);
        } else if (event.kind === 'account') { this.account = p; this.accountStamp = {startedAt: event.startedAt, sequence: event.sequence}; }
        else if (event.kind === 'bypass') { this.bypasses.delete(p.steamId); this.bypasses.set(p.steamId, {...p, startedAt: event.startedAt, sequence: event.sequence}); while (this.bypasses.size > 500) this.bypasses.delete(this.bypasses.keys().next().value); }
        else if (event.kind === 'servers') { this.servers = new Map(p.map(x => [x.endpoint, x.label])); this.serverStamp = {startedAt: event.startedAt, sequence: event.sequence}; }
        else if (event.kind === 'serverPlayers') {
            // An absent roster is not proof that the suspect is offline.
            for (const x of p.players) {
                const patch = {}; if (x.isModerator !== undefined) patch.isModerator = x.isModerator;
                if (p.endpoint) patch.serverIp = p.endpoint;
                this.mergePlayer(x.steamId, patch, event);
            }
        }
        this.revision++;
        for (const listener of this.listeners) {
            try { listener(event); } catch (error) { console.error('[IoHelper] Native data consumer failed', error?.message || 'unknown'); }
        }
        return true;
    }
    player(id) { return this.players.get(id) || null; }
    resourceState(key) { const event = this.resources.get(key); return !event ? 'unknown' : event.kind === 'resourceError' ? 'error' : 'ready'; }
    history(id, kind) { return this.histories.get(id + ':' + kind) || null; }
    active(id, kind) {
        const p = this.player(id), rows = p?.[kind];
        const key = kind === 'bans' ? 'isBanned' : 'isMuted';
        if (p && (p.stamps[key] > p.stamps[kind]
            || p.stamps[key] === p.stamps[kind] && p.orders[key] > p.orders[kind])) return null;
        return rows?.find(x => punishmentActive(x)) || null;
    }
    queueTickets() {
        if (this._queueTicketsCache) return this._queueTicketsCache;
        const keys = new Set([...this.queues.values()].flatMap(q => q.keys));
        this._queueTicketsCache = [...keys].map(k => this.tickets.get(k)).filter(Boolean);
        return this._queueTicketsCache;
    }
    clear() {
        this._queueTicketsCache = null;
        for (const map of [this.resources, this.tickets, this.players, this.queues, this.histories, this.bypasses, this.servers]) map.clear();
        this.account = null; this.accountStamp = null; this.serverStamp = null; this.revision++;
        this.sizes = new WeakMap();
    }
}
