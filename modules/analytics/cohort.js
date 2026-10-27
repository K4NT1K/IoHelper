import {isGeneralModeratorRole} from '../shared/moderators.js';
const required = {
    tickets: ['tickets'], reports: ['reports'], bans: ['bans'], mutes: ['mutes'],
    complaints: ['tickets', 'reports'], punishments: ['bans', 'mutes'],
    perActiveDay: ['tickets', 'reports', 'bans', 'mutes'],
    punishmentsPer100Complaints: ['tickets', 'reports', 'bans', 'mutes']
};
export function metricValue(profile, metric) {
    if (!isGeneralModeratorRole(profile.className)) return null;
    if (!required[metric] || required[metric].some(k => !profile.coverage?.[k]?.available || profile.coverage[k].partial)) return null;
    const value = metric === 'punishments' ? (profile.totals.bans == null || profile.totals.mutes == null ? null : profile.totals.bans + profile.totals.mutes)
        : metric === 'perActiveDay' ? profile.perActiveDay
            : metric === 'punishmentsPer100Complaints' ? (profile.totals.complaints > 0 && Number.isFinite(profile.totals.bans) && Number.isFinite(profile.totals.mutes)
                ? (profile.totals.bans + profile.totals.mutes) / profile.totals.complaints * 100 : null) : profile.totals[metric];
    return Number.isFinite(value) && value >= 0 ? value : null;
}
export function rankProfiles(profiles, metric) {
    let previous = null, rank = 0;
    return profiles.map(profile => ({profile, value: metricValue(profile, metric)})).filter(x => x.value != null)
        .sort((a, b) => b.value - a.value || a.profile.steamId.localeCompare(b.profile.steamId)).map((entry, i) => {
            if (entry.value !== previous) rank = i + 1;
            previous = entry.value;
            return {...entry, rank};
        });
}
/** Sequential, resumable collection. A failed source is never represented as zero. */
export async function runCohort(state, {collect, save, onProgress, isCurrent, pause = () => new Promise(resolve => setTimeout(resolve, 750))}) {
    const finished = new Set(state.finishedIds || []);
    let failures = 0;
    state.status = 'running';
    for (const member of state.members) {
        if (finished.has(member.steamId)) continue;
        if (!isCurrent()) {state.status = 'cancelled'; break;}
        try {
            const profile = await collect(member);
            if (!isCurrent()) {state.status = 'cancelled'; break;}
            const previous = state.profiles.findIndex(p => p.steamId === member.steamId);
            if (previous >= 0) state.profiles[previous] = profile; else state.profiles.push(profile);
            const incomplete = ['tickets', 'reports', 'bans', 'mutes'].filter(k => !profile.coverage?.[k]?.available || profile.coverage[k].partial || !Number.isFinite(profile.totals[k]));
            if (incomplete.length) {
                state.failed.push({steamId: member.steamId, name: member.name, error: 'Неполные данные: ' + incomplete.join(', ')});
                failures++;
            } else failures = 0;
        } catch (error) {
            if (!isCurrent()) {state.status = 'cancelled'; break;}
            state.failed.push({steamId: member.steamId, name: member.name, error: String(error.message || error).slice(0, 300)});
            failures++;
        }
        finished.add(member.steamId); state.finishedIds = [...finished]; state.completed = finished.size; state.updatedAt = Date.now();
        if (failures >= 3) state.status = 'failed';
        await save(state); onProgress(state);
        if (state.status === 'failed') break;
        if (state.completed < state.total) await pause();
    }
    if (state.status === 'running') state.status = isCurrent() ? 'complete' : 'cancelled';
    state.updatedAt = Date.now(); await save(state); onProgress(state);
    return state;
}
