export const PLAYER_PROFILE_LINK_SELECTOR = 'a[href*="cybershoke.net/"], a[href*="cybershoke.ru/"]';

/** Current /id/SteamID profiles and historical /SteamID profiles. */
export function steamIdFromPlayerProfileUrl(value) {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol)
            || !/^(?:www\.)?cybershoke\.(?:net|ru)$/.test(url.hostname)) return null;
        return url.pathname.match(/^\/(?:id\/)?(\d{17})\/?$/)?.[1] || null;
    } catch {
        return null;
    }
}
