import { ConfigService } from './modules/ConfigService.js';
import { App } from './modules/App.js';

chrome.storage.local.get(['scriptEnabled', 'helperSettings'], (result) => {
    const isEnabled = result.scriptEnabled !== false;
    if (!isEnabled) {
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

        if (result.helperSettings?.autoConnectReasons) {
            config.settings.autoConnectReasons = result.helperSettings.autoConnectReasons;
        }

        if (result.helperSettings?.offenderVipStatuses) {
            config.settings.offenderVipStatuses = result.helperSettings.offenderVipStatuses;
        }

        if (result.helperSettings?.reasonTriggersAutoconnect) {
            config.settings.reasonTriggersAutoconnect = result.helperSettings.reasonTriggersAutoconnect;
        }

        const app = new App({
            window,
            document,
            chrome,
            config
        });

        app.start();
    })();
});
