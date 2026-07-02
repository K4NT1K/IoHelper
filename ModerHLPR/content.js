(function () {
    'use strict';

    chrome.storage.local.get(['scriptEnabled'], (result) => {
        const isEnabled = result.scriptEnabled !== false;
        if (!isEnabled || typeof App === 'undefined') {
            return;
        }

        const app = new App({
            window,
            document,
            chrome,
            rules: typeof CYBERSHOKE_MUT_RULES !== 'undefined' ? CYBERSHOKE_MUT_RULES : [],
            templates: {
                ticket: typeof TEMPLATES_TICKET !== 'undefined' ? TEMPLATES_TICKET : {},
                notif: typeof TEMPLATES_NOTIF !== 'undefined' ? TEMPLATES_NOTIF : {}
            },
            complaintTriggers: typeof COMPLAINT_TRIGGERS !== 'undefined' ? COMPLAINT_TRIGGERS : []
        });

        app.start();
    });
})();