// Only the fields consumed by IoHelper cross the MAIN/isolated boundary.
export const CHANNEL = 'ioh-native-data-v1';
export const requestTime = view => view?.performance?.timeOrigin && typeof view.performance.now === 'function'
    ? view.performance.timeOrigin + view.performance.now() : Date.now();
export const steamId = value => /^\d{17}$/.test(String(value || '')) ? String(value) : null;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const str = (value, max = 4000) => typeof value === 'string' ? value.slice(0, max) : '';
const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const bool = value => value === true || value === 1 || value === '1' ? true : value === false || value === 0 || value === '0' ? false : undefined;
const list = value => Array.isArray(value) && value.length <= 10000 ? value : null;
function messageKey(message) {
    const source = JSON.stringify([message.timeMs, message.text, message.channel, message.mode, message.num]);
    let a = 2166136261, b = 5381;
    for (let i = 0; i < source.length; i++) { const c = source.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b, 33) ^ c; }
    return `${message.timeMs}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
}
export function siteTime(value) {
    if (value == null || value === '') return null;
    if (/^\d+(?:\.\d+)?$/.test(String(value))) {
        const n = Number(value); return n > 1e12 ? n : n * 1000;
    }
    const s = String(value).replace(' ', 'T');
    const n = Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(s) ? s + '+03:00' : s);
    return Number.isFinite(n) ? n : null;
}
export const REASONS = {
    ReasonPlayer_Cheating: 'Читерство', ReasonPlayer_BugAbuse: 'Багоюз', ReasonPlayer_Bug: 'Багоюз',
    ReasonPlayer_Monitoring: 'Мониторинг', ReasonPlayer_Rules: 'Нарушение правил',
    ReasonPlayer_RulesViolation: 'Нарушение правил', ReasonPlayer_ViolatingRules: 'Нарушение правил', ReasonPlayer_Bugs: 'Багоюз', ReasonPlayer_Spam: 'Спам', ReasonPlayer_Begging: 'Попрошайничество',
    Reason_Mute_Toxic: 'Токсичность', Reason_Mute_Insult: 'Оскорбление',
    Reason_Mute_Trolling: 'Троллинг/провокация', Reason_Mute_Spam: 'Спам в микрофон/чат',
    Reason_Mute_Racism: 'Расизм / дискриминация', Reason_Mute_Rasism: 'Расизм / дискриминация', Reason_Mute_Monitoring: 'Мониторинг', Reason_Ban_Cheat: 'Читерство'
};
export const reasonLabel = value => REASONS[value] || str(value, 200);
function endpoint(ip, port) {
    if (typeof ip !== 'string' || !/^[a-z0-9.:[\]-]+$/i.test(ip) || ip === '0.0.0.0') return null;
    const n = number(port); return n > 0 && n <= 65535 ? `${ip.toLowerCase()}:${n}` : null;
}
function bodyObject(value) {
    try {
        if (typeof value === 'string') {
            try { return JSON.parse(value); } catch { return Object.fromEntries(new URLSearchParams(value)); }
        }
        if (value instanceof URLSearchParams) return Object.fromEntries(value);
        return record(value) ? value : {};
    } catch { return {}; }
}
export function describeRequest(config, origin) {
    try {
        let base = config.baseURL || origin + '/';
        if (!base.endsWith('/')) base += '/';
        const url = /^https?:\/\//.test(config.url || '') ? new URL(config.url) : new URL(String(config.url || '').replace(/^\//, ''), base);
        if (!['io.cybershoke.net', 'io.cybershoke.ru', 'cybershoke.net', 'cybershoke.ru', 'www.cybershoke.net', 'www.cybershoke.ru'].includes(url.hostname) || url.protocol !== 'https:') return null;
        const method = String(config.method || 'get').toUpperCase();
        const path = url.pathname.replace(/\/$/, '');
        const body = bodyObject(config.data), data = record(body.data) ? body.data : body;
        let m;
        if (method === 'GET' && (m = path.match(/^\/api\/(ticket|reports)\/list$/))) return {kind: 'queue', entity: m[1] === 'ticket' ? 'ticket' : 'report', key: path + ':game:' + str(String(config.params?.game ?? url.searchParams.get('game') ?? 'all'), 20), complete: !url.search && !config.params};
        if (method === 'GET' && (m = path.match(/^\/api\/(ticket|reports)\/get\/(\d+)$/))) return {kind: 'ticket', entity: m[1] === 'ticket' ? 'ticket' : 'report', id: Number(m[2]), key: path};
        if (method === 'POST' && path === '/api/user/data' && !url.hostname.startsWith('io.')) {
            const id = steamId(data.steamid64); return id ? {kind: 'player', steamId: id, key: 'player:' + id} : null;
        }
        if (method === 'POST' && (m = path.match(/^\/api\/ticket\/(bans|mutes|chats|tickets)\/history$/))) {
            const id = steamId(data.steamid64);
            const complete = Object.keys(data).every(k => k === 'steamid64') && !url.search
                && (!config.params || Object.keys(config.params).length === 0)
                && (body === data || Object.keys(body).every(k => k === 'data'));
            return id ? {kind: 'history', resource: m[1], steamId: id, key: path + ':' + id, complete} : null;
        }
        if (method === 'GET' && path === '/api/admin/data/login') return {kind: 'account', key: path};
        if (method === 'GET' && (m = path.match(/^\/api\/user\/(\d{17})\/bans\/bypasses\/status$/))) return {kind: 'bypass', steamId: m[1], key: path};
        if (method === 'POST' && path === '/api/servers/players') return {kind: 'serverPlayers', steamId: steamId(data.steamid64), requestedEndpoint: endpoint(data.server_ip, data.server_port), key: path + ':' + (steamId(data.steamid64) || endpoint(data.server_ip, data.server_port) || 'self')};
        if (method === 'GET' && path === '/api/servers/list') return {kind: 'servers', key: path};
        if (method === 'POST' && (m = path.match(/^\/api\/user\/(\d{17})\/set\/(ban|comm|mute)$/))) return {kind: 'action', steamId: m[1], resource: m[2] === 'ban' ? 'bans' : 'mutes', key: path};
        return null;
    } catch { return null; }
}
export function normalizePunishment(value, kind) {
    if (!record(value)) return null;
    const created = siteTime(value.created ?? value.timestamp ?? value.unixtime_from);
    const length = number(value.length ?? value.unixtime_length);
    const ends = siteTime(value.ends ?? value.end) ?? (created && length > 0 ? created + length * 1000 : null);
    if (!created || length == null || length < 0) return null;
    return {nativePunishment: true, id: String(value.bid ?? value.id ?? `${kind}:${created}`), kind,
        created, ends, length, reason: reasonLabel(value.reason), reasonCode: str(value.reason, 200),
        removed: value.RemoveType === 'U' || value.is_lifted === true || Number(value.RemovedOn) > 0,
        expired: value.RemoveType === 'E', permanent: value.is_permanent === true || length === 0,
        admin: str(value.admin_name ?? value.admin, 100), type: number(value.type)};
}
export function punishmentActive(p, now = Date.now()) {
    return Boolean(p && !p.removed && !p.expired && (p.permanent || p.ends > now));
}
function notice(v) {
    const timeMs = siteTime(v?.unixtime); return timeMs && typeof v.text === 'string' ? {timeMs, text: str(v.text), adminId: steamId(v.steamid64_admin)} : null;
}
function complaint(v, entity) {
    if (!record(v) || !Number.isSafeInteger(Number(v.id)) || Number(v.id) <= 0 || !steamId(v.steamid64_suspect)) return null;
    const result = {key: `${entity}:${v.id}`, entity, id: Number(v.id), suspectId: steamId(v.steamid64_suspect), senderId: steamId(v.steamid64_sender)};
    const strings = {message: 'message', reasonCode: 'reason', mode: 'mode', category: 'server_category', suspectCountry: 'country_suspect', senderCountry: 'country_sender'};
    for (const [key, source] of Object.entries(strings)) if (own(v, source)) result[key] = str(v[source]);
    if (own(v, 'reason')) result.reason = reasonLabel(v.reason);
    for (const [key, source] of Object.entries({status: 'status', result: 'result', playtime: 'playtime_suspect', kills: 'kills', deaths: 'deaths', headshots: 'headshots', cs2Hours: 'cs2_hours_suspect', complaints: 'complaints_count'})) if (own(v, source)) result[key] = number(v[source]);
    if (own(v, 'server_ip')) result.complaintServer = endpoint(v.server_ip, v.server_port);
    if (own(v, 'steamid64_admin')) result.adminId = steamId(v.steamid64_admin);
    if (own(v, 'timestamp') || own(v, 'timestamp_unixtime')) result.createdAt = siteTime(v.timestamp_unixtime ?? v.timestamp);
    if (own(v, 'start_timestamp')) result.startedAt = siteTime(v.start_timestamp);
    if (own(v, 'end_timestamp') || own(v, 'end_unixtime')) result.endedAt = siteTime(v.end_unixtime ?? v.end_timestamp);
    if (own(v, 'complaint_unixtime')) result.chatAnchor = siteTime(v.complaint_unixtime);
    if (Array.isArray(v.suspect_notice)) result.warnings = v.suspect_notice.slice(0, 3000).map(notice).filter(Boolean);
    if (Array.isArray(v.suspect_connect) && v.suspect_connect.length) {
        const latest = [...v.suspect_connect].sort((a, b) => Number(b.unixtime_connect) - Number(a.unixtime_connect))[0];
        const online = bool(latest.is_online) ?? (latest.unixtime_disconnect == null);
        result.presence = {serverIp: online ? endpoint(latest.server_ip, latest.server_port) : null, lastconnect: number(latest.unixtime_disconnect ?? latest.unixtime_connect)};
    }
    return result;
}
function player(v, id) {
    if (!record(v)) return null;
    const data = record(v.result) ? v.result : record(v.data) ? v.data : v;
    if (!record(data.basic) && !record(data.cybershoke)) return null;
    if (data.basic?.steamid64 && steamId(data.basic.steamid64) !== id) return null;
    const p = {steamId: id};
    const b = data.basic || {}, global = data.cybershoke?.global || {};
    if (own(b, 'country') && (b.country == null || /^[a-z]{2}$/i.test(b.country))) p.country = b.country?.toLowerCase() || null;
    if (own(b, 'vip_name')) p.vipName = str(b.vip_name, 60);
    for (const [key, source] of Object.entries({profileVerified: 'profile', isModerator: 'moderation'})) {
        const value = bool(b.verification?.[source]); if (value !== undefined) p[key] = value;
    }
    if (own(global, 'playtime')) p.playtime = number(global.playtime);
    if (own(global, 'lastconnect')) p.lastconnect = number(global.lastconnect);
    if (own(data, 'server') && (data.server === null || record(data.server))) p.serverIp = data.server ? endpoint(data.server.server_ip, data.server.server_port) : null;
    if (data.server?.mode) p.serverLabel = [str(data.server.mode, 80), data.server.num ? '#' + data.server.num : '', str(data.server.category, 100)].filter(Boolean).join(' ');
    if (list(b.bans_list)) {
        for (const [kind, type] of [['bans', 4], ['mutes', 3]]) {
            const rows = b.bans_list.filter(x => Number(x.type) === type).map(x => normalizePunishment(x, kind));
            if (rows.some(x => !x)) continue;
            p[kind] = rows;
            p[kind === 'bans' ? 'isBanned' : 'isMuted'] = p[kind].some(x => punishmentActive(x));
        }
    }
    const source = [b.connect, data.connect, data, b].find(x => own(x, 'faceit'));
    const f = source?.faceit;
    if (record(f)) {
        const profile = record(f.profile) ? f.profile : f;
        const elo = number(profile.elo ?? profile.faceit_elo), level = number(profile.level ?? profile.skill_level);
        if (f.hide === true || own(f, 'name') && !f.name) p.faceit = null;
        else if (f.error || f.exists === false) p.faceit = null;
        else if (own(f, 'name') || elo != null || level != null) p.faceit = {
            elo: elo != null && elo >= 0 ? elo : null,
            level: Number.isInteger(level) && level >= 1 && level <= 10 ? level : null
        };
    } else if (source && f === null) p.faceit = null;
    return p;
}
export function normalizeResponse(descriptor, raw, {startedAt = Date.now(), receivedAt = Date.now(), sequence = 0, status = 200} = {}) {
    if (descriptor?.kind === 'action' && status >= 400) {
        return {version: 1, kind: 'action', key: descriptor.key, startedAt, receivedAt, sequence,
            payload: {steamId: descriptor.steamId, resource: descriptor.resource, success: false}};
    }
    if (!descriptor || status < 200 || status >= 300 || !record(raw) && !Array.isArray(raw)) return null;
    if (raw?.result === 'error' || raw?.success === false) {
        if (descriptor.kind !== 'action') return null;
    }
    const d = descriptor; let payload;
    if (d.kind === 'queue') {
        const a = list(raw) || list(raw.tickets) || list(raw.reports); if (!a) return null;
        const items = a.map(v => complaint(v, d.entity)); if (items.some(x => !x)) return null;
        payload = {entity: d.entity, items, complete: d.complete};
    } else if (d.kind === 'ticket') {
        const v = raw.json ?? raw; payload = complaint(v, d.entity);
        if (!payload || payload.id !== d.id) return null;
        // Report detail omits suspect_notice; the site's report view treats it as
        // an empty warning history. Queue patches alone still cannot define it.
        if (d.entity === 'report' && !own(v, 'suspect_notice')) payload.warnings = [];
        // Unlike list patches, a complete detail defines whether a timer exists.
        if (!own(v, 'start_timestamp')) payload.startedAt = null;
        if (!own(v, 'end_timestamp') && !own(v, 'end_unixtime')) payload.endedAt = null;
    } else if (d.kind === 'player') payload = player(raw, d.steamId);
    else if (d.kind === 'history') {
        const a = list(raw) || list(raw.data); if (!a || !d.complete) return null;
        let items;
        if (d.resource === 'bans' || d.resource === 'mutes') items = a.map(v => normalizePunishment(v, d.resource));
        else if (d.resource === 'chats') {
            const occurrences = new Map();
            items = a.map(v => {
            const timeMs = siteTime(v.unixtime ?? v.timestamp_unixtime), text = v.msg ?? v.message;
            if (!timeMs || typeof text !== 'string' || v.steamid64 && steamId(v.steamid64) !== d.steamId) return null;
            const message = {timeMs, text: str(text), author: str(v.name, 100), channel: v.type === 1 || v.type === 'team' ? 'team' : 'all', mode: str(v.mode, 80), num: number(v.num ?? v.server_num)};
            const base = v.id == null ? messageKey(message) : String(v.id).slice(0, 100);
            const count = occurrences.get(base) || 0; occurrences.set(base, count + 1);
            return {...message, id: `${base}:${count}`};
            });
        }
        else items = a.map(v => ({id: number(v.id), timeMs: siteTime(v.unixtime ?? v.timestamp_unixtime), reason: reasonLabel(v.reason), result: number(v.result), status: number(v.status)}));
        if (items.some(x => !x)) return null;
        payload = {steamId: d.steamId, resource: d.resource, items};
    } else if (d.kind === 'account') {
        const a = raw['admin-data']; if (!record(a) || !steamId(a.steamid64)) return null;
        let groups = a.access_group;
        if (typeof groups === 'string') { try { groups = JSON.parse(groups); } catch { return null; } }
        payload = {steamId: steamId(a.steamid64), groups: Array.isArray(groups) ? groups.filter(x => typeof x === 'string').slice(0, 500) : [], flags: str(a.access_abc, 200)};
    } else if (d.kind === 'bypass') {
        const v = raw.data; if (raw.result !== 'success' || !record(v)) return null;
        payload = {steamId: d.steamId, checked: bool(v.checked), hasBypass: bool(v.has_bypass), bannedAccounts: number(v.banned_accounts), isPublicIp: bool(v.is_public_ip)};
    } else if (d.kind === 'servers') {
        const a = list(raw.all_servers); if (!a) return null;
        payload = a.map(v => ({endpoint: endpoint(v.ip, v.port), label: [str(v.mode, 80), v.num ? '#' + v.num : '', str(v.category, 100)].filter(Boolean).join(' ')})).filter(v => v.endpoint);
    } else if (d.kind === 'serverPlayers') {
        if (!list(raw.players)) return null;
        const s = raw.serverInfo ?? raw.server;
        payload = {steamId: d.steamId, endpoint: record(s) ? endpoint(s.server_ip ?? s.ip, s.server_port ?? s.port) : null,
            players: raw.players.map(v => ({steamId: steamId(v.steamid64), isModerator: bool(v.is_moderator)})).filter(v => v.steamId)};
    } else if (d.kind === 'action') {
        const success = bool(raw.success) ?? (raw.result === 'success' || raw.results?.[0]?.status === 'success' ? true : raw.result === 'error' || raw.results?.[0]?.status === 'error' ? false : undefined);
        if (success === undefined) return null;
        payload = {steamId: d.steamId, resource: d.resource, success};
    }
    return payload == null ? null : {version: 1, kind: d.kind, key: d.key, startedAt, receivedAt, sequence, payload};
}

export function normalizeFailure(descriptor, {startedAt = Date.now(), receivedAt = Date.now(), sequence = 0, status = 0} = {}) {
    if (!descriptor || descriptor.kind === 'action' || descriptor.complete === false) return null;
    return {version: 1, kind: 'resourceError', key: descriptor.key, startedAt, receivedAt, sequence,
        payload: {resource: descriptor.kind, steamId: descriptor.steamId || null, status: Number.isInteger(status) ? status : 0}};
}
