class ConfigService {

    static LOCAL_KEY = "helperConfig";

    static DEFAULT_CONFIG_URL = "https://raw.githubusercontent.com/K4NT1K/CYBERSHOKE/refs/heads/main/IoHelper/config.json";

    static async load(chrome) {

        const local = await chrome.storage.local.get([this.LOCAL_KEY]);

        let config = local[this.LOCAL_KEY];

        try {

            const response = await fetch(this.DEFAULT_CONFIG_URL, {
                cache: "no-cache"
            });

            if (response.ok) {

                const remote = await response.json();

                await chrome.storage.local.set({
                    [this.LOCAL_KEY]: remote
                });

                console.log("[IO HELPER] Config updated from server");

                return remote;
            }

        } catch (e) {
            console.log("[IO HELPER] Github unavailable");
        }

        if (config) {
            console.log("[IO HELPER] Using cached config");
            return config;
        }

        const fallback = await fetch(chrome.runtime.getURL("config.json")).then(r => r.json());

        await chrome.storage.local.set({
            [this.LOCAL_KEY]: fallback
        });

        console.log("[IO HELPER] Using bundled config");

        return fallback;
    }
}

window.ConfigService = ConfigService;