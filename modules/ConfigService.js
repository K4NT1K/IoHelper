class ConfigService {

    static LOCAL_KEY = "helperConfig";
    static FETCHED_AT_KEY = "helperConfigFetchedAt";
    static FETCH_TTL_MS = 3364000;

    static DEFAULT_CONFIG_URL = "https://raw.githubusercontent.com/K4NT1K/CYBERSHOKE/refs/heads/main/IoHelper/config.json";

    static async load(chrome) {

        const local = await chrome.storage.local.get([
            this.LOCAL_KEY,
            this.FETCHED_AT_KEY
        ]);

        let config = local[this.LOCAL_KEY];
        const fetchedAt = local[this.FETCHED_AT_KEY] || 0;
        const isStale = Date.now() - fetchedAt > this.FETCH_TTL_MS;

        if (config && !isStale) {
            return config;
        }

        try {

            const response = await fetch(this.DEFAULT_CONFIG_URL);

            if (response.ok) {

                const remote = await response.json();

                await chrome.storage.local.set({
                    [this.LOCAL_KEY]: remote,
                    [this.FETCHED_AT_KEY]: Date.now()
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
            [this.LOCAL_KEY]: fallback,
            [this.FETCHED_AT_KEY]: Date.now()
        });

        console.log("[IO HELPER] Using bundled config");

        return fallback;
    }
}

window.ConfigService = ConfigService;
