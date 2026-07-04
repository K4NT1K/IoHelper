(function () {
    'use strict';

    chrome.storage.local.get(['scriptEnabled', 'helperSettings'], (result) => {
        const isEnabled = result.scriptEnabled !== false;
        if (!isEnabled || typeof App === 'undefined') {
            return;
        }

        (async () => {
            const config = await ConfigService.load(chrome);

            config.settings = {
                ...config.settings,
                ...(result.helperSettings || {})
            };

            config.settings.features = {
                ...config.settings.features,
                ...(result.helperSettings?.features || {})
            };

            const app = new App({
                window,
                document,
                chrome,
                config
            });

            app.start();

        })();
    });
})();
