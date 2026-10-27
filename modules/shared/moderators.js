const record = value => value && typeof value === 'object' && !Array.isArray(value);
const steamId = value => /^\d{17}$/.test(value);
export const UNKNOWN_ROLE = 'Должность не указана';
export const CONFIG_ROLES = ['Senior Moderator', 'Advanced', 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'New moderator'];
export function configRoleName(value) {
    const role = String(value || '').trim().slice(0, 100);
    const tier = role.match(/^(?:moderator\s*)?tier\s*([1-5])$/i);
    if (tier) return 'Tier ' + tier[1];
    if (/^(?:moderator\s+new|new\s+moderator)$/i.test(role)) return 'New moderator';
    if (/^senior\s+moderator$/i.test(role)) return 'Senior Moderator';
    if (/^advanced$/i.test(role)) return 'Advanced';
    return role || UNKNOWN_ROLE;
}
export function isGeneralModeratorRole(value) {
    return !/(?:jail|\bhns\b|hide\s*(?:and|&)\s*seek|movement|джайл|джейл|движени)/i.test(String(value || ''));
}
/** Accept both historical SteamID→name groups and current role→SteamID→name groups. */
export function moderatorEntries(group) {
    if (!record(group)) return [];
    const entries = [];
    for (const [key, value] of Object.entries(group)) {
        if (steamId(key) && typeof value === 'string') entries.push({steamId: key, name: value, className: ''});
        else if (!steamId(key) && record(value)) for (const [id, name] of Object.entries(value)) {
            if (steamId(id) && typeof name === 'string') entries.push({steamId: id, name, className: key});
        }
    }
    return entries;
}
export const flattenModeratorGroup = group => Object.fromEntries(moderatorEntries(group).map(m => [m.steamId, m.name]));
export function groupModeratorsByRole(members) {
    const result = Object.create(null);
    for (const member of members) {
        if (!steamId(member.steamId) || typeof member.name !== 'string') continue;
        const role = configRoleName(member.className);
        result[role] ||= Object.create(null); result[role][member.steamId] = member.name;
    }
    return Object.fromEntries([...CONFIG_ROLES, ...Object.keys(result).filter(role => !CONFIG_ROLES.includes(role)).sort()]
        .filter(role => result[role]).map(role => [role, Object.fromEntries(Object.entries(result[role]).sort(([a], [b]) => a.localeCompare(b)))]));
}
export function validModeratorGroup(group) {
    if (!record(group)) return false;
    return Object.entries(group).every(([key, value]) => steamId(key) ? typeof value === 'string'
        : key.length > 0 && key.length <= 100 && record(value) && Object.entries(value).every(([id, name]) => steamId(id) && typeof name === 'string'));
}
export function validScheduleSnapshot(snapshot) {
    if (!snapshot || snapshot.formatVersion !== 2 || snapshot.source !== 'worktime-api'
        || !Number.isFinite(snapshot.scannedAt) || snapshot.scannedAt <= 0
        || !Array.isArray(snapshot.days) || snapshot.days.length !== 7
        || new Set(snapshot.days).size !== 7 || snapshot.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)
        || !validModeratorGroup(snapshot.Tier) || !Array.isArray(snapshot.members) || !snapshot.members.length || snapshot.members.length > 5000) return false;
    const entries = moderatorEntries(snapshot.Tier), byId = new Map(entries.map(member => [member.steamId, member]));
    if (entries.length !== byId.size || byId.size !== snapshot.members.length) return false;
    const seen = new Set();
    return snapshot.members.every(member => {
        if (!member || !steamId(member.steamId) || seen.has(member.steamId) || typeof member.name !== 'string'
            || typeof member.className !== 'string' || !member.className.trim() || !isGeneralModeratorRole(member.className)) return false;
        seen.add(member.steamId);
        const grouped = byId.get(member.steamId);
        return grouped?.name === member.name && grouped.className === configRoleName(member.className);
    });
}
