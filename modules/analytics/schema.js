// Only these fields cross the MAIN -> isolated world boundary. Never read headers.
const bounded = (v, n = 160) => String(v ?? '').slice(0, n);
const rows = value => Array.isArray(value) ? value.slice(0, 100000).filter(r=>r && typeof r === 'object') : null;
export function safeAvatarUrl(value) {
    const text=String(value||'').trim();
    if(/^[a-f0-9]{40}$/i.test(text))return `https://avatars.steamstatic.com/${text}_full.jpg`;
    if(text.length>1000)return '';
    try {
        const url=new URL(text);
        const trusted=['steamstatic.com','cybershoke.net','cybershoke.ru'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host));
        return url.protocol==='https:' && !url.username && !url.password && trusted ? url.href : '';
    }catch{return '';}
}
export function requestDescriptor(url, body) {
    const path = new URL(url, 'https://io.cybershoke.net').pathname;
    let payload = {};
    try {payload = typeof body === 'string' ? JSON.parse(body) : body || {};} catch {
        payload = Object.fromEntries(new URLSearchParams(String(body)));
    }
    if (body instanceof URLSearchParams) payload = Object.fromEntries(body);
    if (path === '/api/moderation/postprofile') return {kind: 'profile', steamId: bounded(payload.profiledata?.steamid64), format: bounded(payload.profiledata?.format_date)};
    const list = path.match(/^\/api\/moderation\/profile\/(7656119\d{10})\/list\/(bans|comms)$/);
    if (list) return {kind: list[2] === 'bans' ? 'bans' : 'mutes', steamId: list[1], start: bounded(payload.date_start), end: bounded(payload.date_end)};
    if (path === '/api/moderation/profile/prime/closed/list') return {kind: 'shifts', steamId: bounded(payload.data?.steamid64), start: Number(payload.data?.unixtimeFrom), end: Number(payload.data?.unixtimeTo)};
    return null;
}
export function sanitizeResponse(kind, raw) {
    if (!raw || typeof raw !== 'object') return null;
    // Some deployments wrap their response in {data: ...}; profile itself also has a data identity object.
    const value = raw.history_tickets != null || Array.isArray(raw) || raw.prime_list != null ? raw : raw.data ?? raw;
    if (kind === 'profile') {
        if (!value || !rows(value.history_tickets) || !rows(value.history_reports)) return null;
        const daily = list => rows(list).map(r => ({date: `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`, count: Math.max(0, Number(r.count) || 0)})).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
        return {name: bounded(value.data?.name), className:typeof value.data?.class_name==='string'?bounded(value.data.class_name,100).trim():'', avatar:safeAvatarUrl(value.data?.avatar), tickets: daily(value.history_tickets), reports: daily(value.history_reports)};
    }
    if (kind === 'bans' || kind === 'mutes') {
        const list = rows(value);
        if (!list) return null;
        return {items: list.map(r => ({id: bounded(r.bid, 40), created: Number(r.created), reason: bounded(r.reason), removed: Boolean(Number(r.RemovedOn) > 0 || (r.RemoveType && r.RemoveType !== '0'))})), truncated: value.length >= 100000};
    }
    if (kind === 'shifts') {
        const list = rows(value?.prime_list);
        return list ? {items: list.map(r => ({start: Number(r.unixtime_on_prime), end: Number(r.unixtime_out_prime)})).filter(r => r.end > r.start)} : null;
    }
    if (kind === 'roster') {
        // This endpoint is a complete day array. Reject rather than silently dropping malformed rows.
        if (!Array.isArray(value) || value.length>10000 || value.some(r=>!r || typeof r!=='object' || Array.isArray(r)
            || !/^7656119\d{10}$/.test(r.steamid64) || typeof r.name!=='string' || !r.name.trim() || r.name.length>160
            || typeof r.class!=='string' || !r.class.trim() || r.class.length>100
            || !Number.isInteger(r.week_day) || r.week_day<0 || r.week_day>6)) return null;
        return {members:value.map(r=>({steamId:r.steamid64,name:r.name.trim(),className:r.class.trim(),day:r.week_day}))};
    }
    return null;
}
