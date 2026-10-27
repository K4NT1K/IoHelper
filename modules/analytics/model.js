export const MOSCOW = 'Europe/Moscow';
export const HISTORY_START = '2019-01-01';
export const parseSteamId = value => {
    const text = String(value || '').trim();
    const match = text.match(/^(?:https:\/\/io\.cybershoke\.(?:net|ru)\/moderator\/profile\/)?(7656119\d{10})(?:[/?#].*)?$/);
    return match?.[1] || null;
};
export const dayKey = seconds => new Date(Number(seconds) * 1000 + 10800000).toISOString().slice(0, 10);
export const dayStart = date => Date.parse(date + 'T00:00:00+03:00') / 1000;
export function localDateTime(seconds) {
    const date = new Date(seconds * 1000), pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function dateRange(days = 30, now = Date.now()) {
    const end = dayKey(now / 1000);
    return {start: dayKey(dayStart(end) - (days - 1) * 86400), end};
}
export function validateRange(range) {
    return range && /^\d{4}-\d{2}-\d{2}$/.test(range.start) && /^\d{4}-\d{2}-\d{2}$/.test(range.end)
        && Number.isFinite(dayStart(range.start)) && Number.isFinite(dayStart(range.end))
        && dayKey(dayStart(range.start)) === range.start && dayKey(dayStart(range.end)) === range.end
        && range.start >= HISTORY_START && range.start <= range.end && range.end <= dayKey(Date.now() / 1000);
}
const count = value => Math.max(0, Number(value) || 0);
export function profileRatios(totals,coverage={}) {
    const complete=key=>coverage[key]?.available===true&&!coverage[key].partial;
    const completeComplaints=complete('tickets')&&complete('reports');
    const punishments=complete('bans')&&complete('mutes')&&totals.bans!=null&&totals.mutes!=null?totals.bans+totals.mutes:null;
    const per100=(numerator,denominator,valid)=>valid&&Number.isFinite(numerator)&&Number.isFinite(denominator)&&denominator>0?numerator/denominator*100:null;
    return {
        bansPer100Tickets:per100(totals.bans,totals.tickets,complete('bans')&&complete('tickets')),
        mutesPer100Tickets:per100(totals.mutes,totals.tickets,complete('mutes')&&complete('tickets')),
        punishmentsPer100Tickets:per100(punishments,totals.tickets,complete('tickets')),
        bansPer100Complaints:per100(totals.bans,totals.complaints,complete('bans')&&completeComplaints),
        mutesPer100Complaints:per100(totals.mutes,totals.complaints,complete('mutes')&&completeComplaints),
        punishmentsPer100Complaints:per100(punishments,totals.complaints,completeComplaints),
        bansShare:per100(totals.bans,punishments,complete('bans')),
        mutesShare:per100(totals.mutes,punishments,complete('mutes'))
    };
}
export function aggregateProfile(source, range, includeRemoved = true) {
    const map = new Map();
    const row = date => {
        if (date < range.start || date > range.end) return null;
        if (!map.has(date)) map.set(date, {date, tickets: 0, reports: 0, bans: 0, mutes: 0, seconds: 0});
        return map.get(date);
    };
    const coverage = source.coverage || {};
    // Career reference is independent of the selected display period and removed filter.
    let firstPunishmentAt = null;
    const historyStart = dayStart(HISTORY_START), fetchedAt = Math.floor((source.fetchedAt || Date.now()) / 1000);
    for (const kind of ['bans', 'mutes']) for (const item of source[kind] || []) {
        if (!item.id || !Number.isFinite(item.created) || item.created < historyStart || item.created > fetchedAt) continue;
        if (firstPunishmentAt === null || item.created < firstPunishmentAt) firstPunishmentAt = item.created;
    }
    const firstPunishmentComplete = ['bans', 'mutes'].every(key => coverage[key]?.available === true && !coverage[key].partial
        && coverage[key].start <= HISTORY_START);
    for (const metric of ['tickets', 'reports']) for (const item of source[metric] || []) {
        const entry = row(item.date);
        if (entry) entry[metric] += count(item.count);
    }
    const reasons = {bans: Object.create(null), mutes: Object.create(null)};
    const removed = {bans: 0, mutes: 0};
    for (const metric of ['bans', 'mutes']) {
        const seen = new Set();
        for (const item of source[metric] || []) {
            if (!item.id || seen.has(item.id) || !Number.isFinite(item.created)) continue;
            seen.add(item.id);
            const entry = row(dayKey(item.created));
            if (!entry) continue;
            if (item.removed) removed[metric]++;
            if (item.removed && !includeRemoved) continue;
            entry[metric]++;
            const reason = item.reason || 'Без причины';
            reasons[metric][reason] = (reasons[metric][reason] || 0) + 1;
        }
    }
    // Split a closed shift at Moscow midnight. AFK is a separate, unavailable metric here.
    const shifts = (source.shifts || []).filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start).sort((a,b)=>a.start-b.start);
    const merged = [];
    for (const shift of shifts) {
        const previous = merged.at(-1);
        if (previous && shift.start <= previous.end) previous.end = Math.max(previous.end, shift.end);
        else merged.push({...shift});
    }
    for (const shift of merged) {
        let at = Math.max(Number(shift.start), dayStart(range.start));
        const end = Math.min(Number(shift.end), dayStart(range.end) + 86400);
        if (!Number.isFinite(at) || !Number.isFinite(end) || end <= at) continue;
        while (at < end) {
            const date = dayKey(at);
            const next = Math.min(end, dayStart(date) + 86400);
            row(date).seconds += next - at;
            at = next;
        }
    }
    const days = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    days.forEach(item => {item.complaints = item.tickets + item.reports; item.actions = item.complaints + item.bans + item.mutes;});
    const totals = Object.fromEntries(['tickets', 'reports', 'bans', 'mutes', 'complaints', 'actions', 'seconds'].map(k => [k, days.reduce((sum, d) => sum + d[k], 0)]));
    const available = metric => coverage[metric]?.available === true;
    for (const metric of ['tickets', 'reports', 'bans', 'mutes']) if (!available(metric)) totals[metric] = null;
    if (totals.tickets == null || totals.reports == null) totals.complaints = null;
    if (!available('shifts')) totals.seconds = null;
    const activeDays = days.filter(d => d.actions > 0).length;
    const hours = totals.seconds == null ? null : totals.seconds / 3600;
    const hoursComplete = available('shifts') && !coverage.shifts.partial
        && coverage.shifts.start <= range.start && coverage.shifts.end >= range.end;
    return {steamId: source.steamId, name: source.name || source.steamId, avatar:source.avatar||'', className:String(source.className || '').trim().slice(0,100),
        firstPunishmentAt, firstPunishmentComplete, fetchedAt: source.fetchedAt, range, days, totals, reasons, removed, coverage, activeDays,ratios:profileRatios(totals,coverage),
        perActiveDay: activeDays && totals.complaints != null ? totals.complaints / activeDays : null,
        hours, perHour: hoursComplete && hours > 0 && totals.complaints != null ? totals.complaints / hours : null};
}
export function rankDays(days, metric) {
    let rank = 0, previous = null;
    return days.filter(d => d[metric] > 0).sort((a, b) => b[metric] - a[metric] || a.date.localeCompare(b.date)).map((d, i) => {
        if (d[metric] !== previous) rank = i + 1;
        previous = d[metric];
        return {...d, rank};
    });
}
export function groupDays(days, unit, metric) {
    const groups = new Map();
    for (const day of days) {
        let key = day.date;
        if (unit === 'month') key = key.slice(0, 7);
        if (unit === 'week') {
            const t = dayStart(key), weekday = new Date(t * 1000 + 10800000).getUTCDay();
            key = dayKey(t - ((weekday + 6) % 7) * 86400);
        }
        groups.set(key, (groups.get(key) || 0) + day[metric]);
    }
    return [...groups].sort((a, b) => a[0].localeCompare(b[0]));
}
