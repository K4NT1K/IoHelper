(() => {
  // modules/ServerConnectionMemory.js
  function normalizeServerEndpoint(value) {
    const text = String(value || "").trim().replace(/^steam:\/\/connect\//i, "");
    const endpoint = text.split(/[/?#]/, 1)[0].toLowerCase();
    const match = endpoint.match(/^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\]):(\d{1,10})$/i);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return null;
    return `${match[1]}:${Number(match[2])}`;
  }
  function serverEndpointFromConnectUrl(value) {
    const url = String(value || "").trim();
    if (/^steam:\/\/connect\//i.test(url)) return normalizeServerEndpoint(url);
    const launch = url.match(/^steam:\/\/(?:rungameid|run)\/[1-9]\d*\/\/(.*)$/i);
    if (!launch) return null;
    let options;
    try {
      options = decodeURIComponent(launch[1]);
    } catch {
      return null;
    }
    const command = options.match(/^\+connect\s+(?:"([^"]+)"|([^\s;"+]+))(?=\s|;|$)/i);
    return command ? normalizeServerEndpoint(command[1] || command[2]) : null;
  }
  function validRecord(record) {
    return record && normalizeServerEndpoint(record.endpoint) === record.endpoint && Number.isSafeInteger(record.revision) && record.revision > 0;
  }
  var ServerConnectionMemory = class {
    constructor({ document: document2, chrome: chrome2 }) {
      this.document = document2;
      this.chrome = chrome2;
      this.record = null;
      this.optimistic = null;
      this.writeVersion = 0;
      this.alive = false;
      this.onClick = (event) => {
        if (event.button > 1 || this.automaticClick) return;
        const link = event.target?.closest?.("a[href]");
        const endpoint = serverEndpointFromConnectUrl(link?.href);
        if (endpoint) this.remember(endpoint, "manual");
      };
      this.onMessage = (message) => {
        if (message.action === "serverConnectionChanged") this.accept(message.record);
      };
    }
    get endpoint() {
      return this.optimistic?.endpoint || this.record?.endpoint || null;
    }
    accept(record) {
      if (this.alive && validRecord(record) && record.revision > (this.record?.revision || 0)) {
        this.record = record;
        if (this.optimistic && !this.optimistic.pending) this.optimistic = null;
      }
    }
    async start() {
      if (this.alive) return;
      this.alive = true;
      this.document.addEventListener("click", this.onClick, true);
      this.document.addEventListener("auxclick", this.onClick, true);
      this.chrome?.runtime?.onMessage?.addListener(this.onMessage);
      await this.refresh();
    }
    async refresh() {
      const version = this.writeVersion;
      try {
        const response = await this.chrome?.runtime?.sendMessage({ action: "getServerConnection" });
        if (response?.success && version === this.writeVersion) this.accept(response.record);
      } catch {
      }
    }
    remember(value, source = "auto") {
      const endpoint = normalizeServerEndpoint(value);
      if (!this.alive || !endpoint) return;
      const version = ++this.writeVersion;
      this.optimistic = { endpoint, pending: true };
      console.log(`[Helper] \u0417\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043E \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (${source === "manual" ? "\u0432\u0440\u0443\u0447\u043D\u0443\u044E" : "\u0430\u0432\u0442\u043E"}):`, endpoint);
      void (async () => {
        try {
          const response = await this.chrome?.runtime?.sendMessage({ action: "rememberServerConnection", endpoint, source });
          if (!this.alive) return;
          if (response?.success) {
            this.accept(response.record);
            if (version === this.writeVersion) this.optimistic = null;
          }
        } catch {
        } finally {
          if (this.alive && version === this.writeVersion && this.optimistic) this.optimistic.pending = false;
        }
      })();
    }
    clickAutomatically(link, endpoint) {
      this.remember(endpoint, "auto");
      this.automaticClick = true;
      try {
        link.click();
      } finally {
        this.automaticClick = false;
      }
    }
    stop() {
      this.alive = false;
      this.document.removeEventListener("click", this.onClick, true);
      this.document.removeEventListener("auxclick", this.onClick, true);
      this.chrome?.runtime?.onMessage?.removeListener(this.onMessage);
    }
  };

  // modules/PublicServerConnections.js
  async function startPublicServerConnections({ document: document2, window: window2, chrome: chrome2 }) {
    const memory = new ServerConnectionMemory({ document: document2, chrome: chrome2 });
    let closed = false;
    const onHide = (event) => {
      if (event.persisted) return;
      closed = true;
      memory.stop();
      window2.removeEventListener("pagehide", onHide);
      window2.removeEventListener("pageshow", onShow);
    };
    const onShow = (event) => {
      if (event.persisted) void memory.refresh();
    };
    window2.addEventListener("pagehide", onHide);
    window2.addEventListener("pageshow", onShow);
    try {
      const { scriptEnabled } = await chrome2.storage.local.get("scriptEnabled");
      if (closed) return null;
      if (scriptEnabled === false) {
        onHide({ persisted: false });
        return null;
      }
      await memory.start();
      return closed ? null : memory;
    } catch {
      onHide({ persisted: false });
      return null;
    }
  }

  // public-connect.js
  void startPublicServerConnections({ document, window, chrome });
})();
//# sourceMappingURL=publicConnect.js.map
