(function () {
    'use strict';

    const DEFAULT_HELPER_SETTINGS = {
        features: {
            scanSchedulePage: true,
            highlightComplaintTriggers: true,
            highlightNewAccounts: true,
            processTicketRules: true,
            manageEmptyBlocks: true,
            translateText: true
        },
        newAccountHours: 7,
        serverRefreshInterval: 30,
        complaintTriggers: typeof COMPLAINT_TRIGGERS !== 'undefined' ? COMPLAINT_TRIGGERS : []
    };

    function mergeSettings(storedSettings) {
        return {
            features: {
                ...DEFAULT_HELPER_SETTINGS.features,
                ...((storedSettings && storedSettings.features) || {})
            },
            newAccountHours: storedSettings?.newAccountHours ?? DEFAULT_HELPER_SETTINGS.newAccountHours,
            serverRefreshInterval: storedSettings?.serverRefreshInterval ?? DEFAULT_HELPER_SETTINGS.serverRefreshInterval,
            complaintTriggers: Array.isArray(storedSettings?.complaintTriggers) ? storedSettings.complaintTriggers : DEFAULT_HELPER_SETTINGS.complaintTriggers
        };
    }

    chrome.storage.local.get(['scriptEnabled', 'helperSettings'], (result) => {
        const isEnabled = result.scriptEnabled !== false;
        if (!isEnabled || typeof App === 'undefined') {
            return;
        }

        const settings = mergeSettings(result.helperSettings);
        const app = new App({
            window,
            document,
            chrome,
            settings,
            rules: typeof CYBERSHOKE_MUT_RULES !== 'undefined' ? CYBERSHOKE_MUT_RULES : [],
            templates: {
                ticket: typeof TEMPLATES_TICKET !== 'undefined' ? TEMPLATES_TICKET : {},
                notif: typeof TEMPLATES_NOTIF !== 'undefined' ? TEMPLATES_NOTIF : {}
            },
            complaintTriggers: settings.complaintTriggers
        });

        app.start();
    });
})();
