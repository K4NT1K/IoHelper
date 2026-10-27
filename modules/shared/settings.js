// Shared by bootstrap, App and popup. Saved false/0 values are intentional overrides.
export const DEFAULT_FEATURES = Object.freeze({
    highlightComplaintTriggers: true, highlightNewAccounts: true, highlightHighHs: true,
    highlightDuplicateServers: false, processTicketRules: true, translateText: true,
    showSteamAccountCreationDate: true, showCybershokePlaytime: true, showOffenderCountry: true,
    showFaceitElo: true, trackOffenderServer: true, showOffenderVipBadge: true,
    autoConnectServer: false, scanSchedulePage: false, squareTickets: false
});

export function mergeSettings(base = {}, overrides = {}) {
    const result = {
        newAccountHours: 7, headshotPercentage: 95, trackOffenderInterval: 5,
        trackOffenderIntervalWhileReviewing: 30, trackOpenTicketOfflineInterval: 5,
        reasonTriggers: [], reasonTriggersAutoconnect: [], autoConnectReasons: [],
        offenderVipStatuses: [], ...base, ...overrides,
        features: {...DEFAULT_FEATURES, ...base.features, ...overrides.features}
    };
    delete result.features.autoPunishmentDuration;
    return result;
}

// Preserve legacy explicit values; new edits only override the fields actually changed.
export function editedOverrides(base, previous, next, saved = {}) {
    const result = structuredClone(saved);
    const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    for(const [key,value] of Object.entries(next)) {
        if(key === 'features') {
            result.features = {...result.features};
            for(const [flag,enabled] of Object.entries(value)) if(!equal(previous.features?.[flag],enabled)) {
                if(equal(base.features?.[flag],enabled)) delete result.features[flag];
                else result.features[flag]=enabled;
            }
            if(!Object.keys(result.features).length) delete result.features;
        } else if(!equal(previous[key],value)) {
            if(equal(base[key],value)) delete result[key];
            else result[key]=value;
        }
    }
    delete result.autoPunishmentDuration;
    return result;
}
