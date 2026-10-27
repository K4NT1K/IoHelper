import { ConfigService } from './modules/ConfigService.js';
import { App } from './modules/App.js';
import {startAnalyticsCollector} from './modules/analytics/Collector.js';

chrome.storage.local.get(['scriptEnabled', 'helperSettings'], (result) => {
    if (startAnalyticsCollector(chrome, window, document)) return;
    const isEnabled = result.scriptEnabled !== false;
    if (!isEnabled) {
        return;
    }

    (async () => {
        const config = await ConfigService.getForClient(chrome);

        const app = new App({
            window,
            document,
            chrome,
            config,
            settingsOverrides: result.helperSettings || {}
        });

        app.start();
    })();
});
