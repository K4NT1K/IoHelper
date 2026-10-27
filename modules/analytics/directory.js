import {parseSteamId} from './model.js';
import {moderatorEntries, isGeneralModeratorRole} from '../shared/moderators.js';
export const MODERATOR_GROUPS = ['Tier'];
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ru').trim();
export function buildDirectory(config = {}, schedule = {}) {
    const members = new Map();
    const add = (id, name, category, source, className = '') => {
        if (!parseSteamId(id) || !isGeneralModeratorRole(className)) return;
        const label = typeof name === 'string' ? name.trim().slice(0, 100) : id;
        const member = members.get(id) || {steamId: id, name: label || id, className, aliases: [], categories: [], sources: []};
        if (label && !member.aliases.includes(label)) member.aliases.push(label);
        if (!member.categories.includes(category)) member.categories.push(category);
        if (!member.sources.includes(source)) member.sources.push(source);
        if (source === 'schedule') {if (label) member.name = label; if (className) member.className = className;}
        members.set(id, member);
    };
    for (const category of MODERATOR_GROUPS) {
        for (const member of moderatorEntries(config.moderators?.[category])) add(member.steamId, member.name, category, 'config', member.className);
        for (const member of moderatorEntries(schedule[category])) add(member.steamId, member.name, category, 'schedule', member.className);
    }
    for (const member of Array.isArray(schedule.members) ? schedule.members : []) add(member.steamId, member.name, 'Tier', 'schedule', member.className);
    return [...members.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.steamId.localeCompare(b.steamId));
}
export const filterDirectory = (members, source = 'all') => members.filter(m => source === 'all' || m.sources.includes(source));
export function searchDirectory(members, query, limit = 8) {
    const term = normalize(query);
    const score = member => {
        const names = [member.name, ...(member.aliases || [])].map(normalize);
        if (!term) return 5;
        if (member.steamId === term || names.includes(term)) return 0;
        if (names.some(n => n.startsWith(term))) return 1;
        if (names.some(n => n.includes(term))) return 2;
        if (member.steamId.includes(term)) return 3;
        return Infinity;
    };
    return members.map(member => ({member, score: score(member)})).filter(x => Number.isFinite(x.score))
        .sort((a, b) => a.score - b.score || a.member.name.localeCompare(b.member.name, 'ru')).slice(0, limit).map(x => x.member);
}
export function resolveModerator(value, selectedId, members) {
    const id = parseSteamId(value);
    if (id) return id;
    if (selectedId && members.some(m => m.steamId === selectedId)) return selectedId;
    const matches = members.filter(m => [m.name, ...(m.aliases || [])].some(name => normalize(name) === normalize(value)));
    return matches.length === 1 ? matches[0].steamId : null;
}
