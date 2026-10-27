(() => {
  // modules/analytics/model.js
  var HISTORY_START = "2019-01-01";
  var parseSteamId = (value) => {
    const text = String(value || "").trim();
    const match = text.match(/^(?:https:\/\/io\.cybershoke\.(?:net|ru)\/moderator\/profile\/)?(7656119\d{10})(?:[/?#].*)?$/);
    return match?.[1] || null;
  };
  var dayKey = (seconds) => new Date(Number(seconds) * 1e3 + 108e5).toISOString().slice(0, 10);
  var dayStart = (date) => Date.parse(date + "T00:00:00+03:00") / 1e3;
  function validateRange(range) {
    return range && /^\d{4}-\d{2}-\d{2}$/.test(range.start) && /^\d{4}-\d{2}-\d{2}$/.test(range.end) && Number.isFinite(dayStart(range.start)) && Number.isFinite(dayStart(range.end)) && dayKey(dayStart(range.start)) === range.start && dayKey(dayStart(range.end)) === range.end && range.start >= HISTORY_START && range.start <= range.end && range.end <= dayKey(Date.now() / 1e3);
  }

  // modules/analytics/schema.js
  var bounded = (v, n = 160) => String(v ?? "").slice(0, n);
  var rows = (value) => Array.isArray(value) ? value.slice(0, 1e5).filter((r) => r && typeof r === "object") : null;
  function safeAvatarUrl(value) {
    const text = String(value || "").trim();
    if (/^[a-f0-9]{40}$/i.test(text)) return `https://avatars.steamstatic.com/${text}_full.jpg`;
    if (text.length > 1e3) return "";
    try {
      const url = new URL(text);
      const trusted = ["steamstatic.com", "cybershoke.net", "cybershoke.ru"].some((host) => url.hostname === host || url.hostname.endsWith("." + host));
      return url.protocol === "https:" && !url.username && !url.password && trusted ? url.href : "";
    } catch {
      return "";
    }
  }
  function sanitizeResponse(kind, raw) {
    if (!raw || typeof raw !== "object") return null;
    const value = raw.history_tickets != null || Array.isArray(raw) || raw.prime_list != null ? raw : raw.data ?? raw;
    if (kind === "profile") {
      if (!value || !rows(value.history_tickets) || !rows(value.history_reports)) return null;
      const daily = (list) => rows(list).map((r) => ({ date: `${r.year}-${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")}`, count: Math.max(0, Number(r.count) || 0) })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
      return { name: bounded(value.data?.name), className: typeof value.data?.class_name === "string" ? bounded(value.data.class_name, 100).trim() : "", avatar: safeAvatarUrl(value.data?.avatar), tickets: daily(value.history_tickets), reports: daily(value.history_reports) };
    }
    if (kind === "bans" || kind === "mutes") {
      const list = rows(value);
      if (!list) return null;
      return { items: list.map((r) => ({ id: bounded(r.bid, 40), created: Number(r.created), reason: bounded(r.reason), removed: Boolean(Number(r.RemovedOn) > 0 || r.RemoveType && r.RemoveType !== "0") })), truncated: value.length >= 1e5 };
    }
    if (kind === "shifts") {
      const list = rows(value?.prime_list);
      return list ? { items: list.map((r) => ({ start: Number(r.unixtime_on_prime), end: Number(r.unixtime_out_prime) })).filter((r) => r.end > r.start) } : null;
    }
    if (kind === "roster") {
      if (!Array.isArray(value) || value.length > 1e4 || value.some((r) => !r || typeof r !== "object" || Array.isArray(r) || !/^7656119\d{10}$/.test(r.steamid64) || typeof r.name !== "string" || !r.name.trim() || r.name.length > 160 || typeof r.class !== "string" || !r.class.trim() || r.class.length > 100 || !Number.isInteger(r.week_day) || r.week_day < 0 || r.week_day > 6)) return null;
      return { members: value.map((r) => ({ steamId: r.steamid64, name: r.name.trim(), className: r.class.trim(), day: r.week_day })) };
    }
    return null;
  }

  // modules/analytics/NativeApi.js
  var NATIVE_READ_TIMEOUT = 15e3;
  var sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("\u0421\u0431\u043E\u0440 \u043E\u0442\u043C\u0435\u043D\u0451\u043D"));
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new Error("\u0421\u0431\u043E\u0440 \u043E\u0442\u043C\u0435\u043D\u0451\u043D"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
  function readOperation(kind, steamId, now = Date.now()) {
    if (!parseSteamId(steamId)) throw new Error("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 SteamID64");
    const start = dayStart(HISTORY_START), end = Math.floor(now / 1e3);
    if (kind === "profile") return { path: "/moderation/postprofile", body: { profiledata: { steamid64: steamId, format_date: "day" } } };
    if (kind === "bans" || kind === "mutes") return {
      path: `/moderation/profile/${steamId}/list/${kind === "bans" ? "bans" : "comms"}`,
      body: new URLSearchParams({ date_start: String(start), date_end: String(end) }),
      form: true
    };
    if (kind === "shifts") return { path: "/moderation/profile/prime/closed/list", body: { data: { steamid64: steamId, unixtimeFrom: start, unixtimeTo: end, zeroVisibility: "hidden" } } };
    throw new Error("\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F");
  }
  function rosterDayOperation(day) {
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0434\u0435\u043D\u044C \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F");
    return { method: "GET", path: `/moderation/worktime/${day}` };
  }
  function clientExports(source) {
    const symbols = [...source.matchAll(/\b([\w$]+)\.interceptors\.request\.use\s*\(/g)].map((m) => m[1]);
    const tail = source.match(/export\s*\{([^}]+)\}/g)?.join(",") || "";
    return symbols.flatMap((symbol) => {
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const alias = tail.match(new RegExp("(?:^|[,{\\s])" + escaped + "\\s+as\\s+([\\w$]+)"));
      return alias ? [alias[1]] : tail.match(new RegExp("(?:^|[,{\\s])" + escaped + "(?:[,}\\s]|$)")) ? [symbol] : [];
    });
  }
  async function findNativeClient({ document: document2, origin, fetchText, importModule, signal }) {
    const entries = [...document2.querySelectorAll('script[type="module"][src]')].map((s) => s.src).filter((src) => {
      try {
        const url = new URL(src);
        return url.origin === origin && /\.js$/.test(url.pathname);
      } catch {
        return false;
      }
    });
    for (const entry of entries) {
      if (signal?.aborted) throw new Error("\u0421\u0431\u043E\u0440 \u043E\u0442\u043C\u0435\u043D\u0451\u043D");
      const source = await fetchText(entry, signal);
      const dependencies = [...source.matchAll(/\bfrom\s*["']([^"']+\.js)["']/g)].map((m) => new URL(m[1], entry).href);
      const candidates = [entry, ...new Set(dependencies)].filter((url) => new URL(url).origin === origin).slice(0, 40);
      for (let i = 0; i < candidates.length; i += 4) {
        const batch = await Promise.all(candidates.slice(i, i + 4).map(async (url) => {
          try {
            const text = url === entry ? source : await fetchText(url, signal);
            return { url, exports: clientExports(text) };
          } catch (error) {
            if (signal?.aborted) throw error;
            return { url, exports: [] };
          }
        }));
        for (const candidate of batch) if (candidate.exports.length) {
          const module = await importModule(candidate.url);
          for (const key of candidate.exports) {
            const client = module[key];
            if (typeof client?.post !== "function" || !client?.interceptors) continue;
            const base = new URL(client.defaults?.baseURL || "", origin);
            if (base.origin === origin && base.pathname.replace(/\/$/, "") === "/api") return client;
          }
        }
      }
    }
    throw new Error("\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0448\u0442\u0430\u0442\u043D\u044B\u0439 \u043A\u043B\u0438\u0435\u043D\u0442 API. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0430\u0434\u043C\u0438\u043D\u043A\u0438 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u0441\u0431\u043E\u0440.");
  }
  async function nativeRead(client, operation, signal, progress, kind) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new Error("\u0421\u0431\u043E\u0440 \u043E\u0442\u043C\u0435\u043D\u0451\u043D");
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(cancel, NATIVE_READ_TIMEOUT);
      try {
        const options = {
          signal: controller.signal,
          timeout: NATIVE_READ_TIMEOUT,
          ...operation.form ? { headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {}
        };
        const response = operation.method === "GET" ? await client.get(operation.path, options) : await client.post(operation.path, operation.body, options);
        if (response.status < 200 || response.status >= 300) throw Object.assign(new Error("\u0414\u0430\u043D\u043D\u044B\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B"), { status: response.status });
        const data = sanitizeResponse(kind, response.data);
        if (!data) throw new Error("\u0421\u0430\u0439\u0442 \u043D\u0435 \u043F\u0440\u0435\u0434\u043E\u0441\u0442\u0430\u0432\u0438\u043B \u0434\u0430\u043D\u043D\u044B\u0435 \u044D\u0442\u043E\u0433\u043E \u0440\u0430\u0437\u0434\u0435\u043B\u0430");
        return data;
      } catch (error) {
        if (signal.aborted) throw new Error("\u0421\u0431\u043E\u0440 \u043E\u0442\u043C\u0435\u043D\u0451\u043D");
        const status = error.status || error.response?.status || error._orig?.response?.status;
        if (status === 429 && attempt < 2) {
          const headers = error.response?.headers || error._orig?.response?.headers;
          const retry = Number(headers?.get?.("Retry-After") ?? headers?.["retry-after"]) || 0;
          progress("\u0421\u0430\u0439\u0442 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0438\u043B \u0447\u0430\u0441\u0442\u043E\u0442\u0443 \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432. \u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u043F\u0435\u0440\u0435\u0434 \u043F\u043E\u0432\u0442\u043E\u0440\u043E\u043C\u2026");
          await sleep(Math.min(15e3, Math.max(1500 * 2 ** attempt, retry * 1e3)), signal);
          continue;
        }
        if (controller.signal.aborted) throw new Error("\u0421\u0430\u0439\u0442 \u043D\u0435 \u043E\u0442\u0432\u0435\u0442\u0438\u043B \u0437\u0430 15 \u0441\u0435\u043A\u0443\u043D\u0434");
        if (status === 401 || status === 403) throw new Error("\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0430 \u043A \u0434\u0430\u043D\u043D\u044B\u043C \u0440\u0430\u0437\u0434\u0435\u043B\u0430 \u0438\u043B\u0438 \u0441\u0435\u0441\u0441\u0438\u044F \u0438\u0441\u0442\u0435\u043A\u043B\u0430");
        if (status) throw new Error(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0440\u0430\u0437\u0434\u0435\u043B: HTTP ${status}`);
        throw new Error(error.message === "\u0421\u0430\u0439\u0442 \u043D\u0435 \u043F\u0440\u0435\u0434\u043E\u0441\u0442\u0430\u0432\u0438\u043B \u0434\u0430\u043D\u043D\u044B\u0435 \u044D\u0442\u043E\u0433\u043E \u0440\u0430\u0437\u0434\u0435\u043B\u0430" ? error.message : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 \u0440\u0430\u0437\u0434\u0435\u043B\u0430");
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
      }
    }
  }
  async function collectNativeProfile({ client, steamId, range, signal, progress = () => {
  }, now = Date.now() }) {
    if (!parseSteamId(steamId) || !validateRange(range)) throw new Error("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u043F\u0440\u043E\u0444\u0438\u043B\u044C \u0438\u043B\u0438 \u043F\u0435\u0440\u0438\u043E\u0434");
    const today = dayKey(now / 1e3);
    const result = { steamId, fetchedAt: now, coverage: {}, tickets: [], reports: [], bans: [], mutes: [], shifts: [] };
    const labels = { profile: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0437\u0430\u043A\u0440\u044B\u0442\u044B\u0445 \u0436\u0430\u043B\u043E\u0431", bans: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0431\u0430\u043D\u043E\u0432", mutes: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043C\u0443\u0442\u043E\u0432", shifts: "\u0420\u0430\u0431\u043E\u0447\u0435\u0435 \u0432\u0440\u0435\u043C\u044F" };
    for (const kind of ["profile", "bans", "mutes", "shifts"]) {
      progress(labels[kind]);
      try {
        const data = await nativeRead(client, readOperation(kind, steamId, now), signal, progress, kind);
        if (signal.aborted) throw new Error("\u0421\u0431\u043E\u0440 \u043E\u0442\u043C\u0435\u043D\u0451\u043D");
        if (kind === "profile") {
          Object.assign(result, data);
          for (const metric of ["tickets", "reports"]) result.coverage[metric] = { available: true, scope: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F, \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430\u044F API \u0441\u0430\u0439\u0442\u0430", start: HISTORY_START, end: today };
        } else {
          result[kind] = data.items;
          result.coverage[kind] = { available: true, start: HISTORY_START, end: today, count: data.items.length, partial: !!data.truncated, scope: "\u041F\u0440\u044F\u043C\u043E\u0439 \u043E\u0442\u0432\u0435\u0442 API \u0441\u0430\u0439\u0442\u0430" };
          if (kind === "shifts") {
            const valid = data.items.filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end));
            result.coverage.shifts = {
              available: true,
              partial: true,
              sourceLimited: true,
              count: data.items.length,
              start: valid.length ? dayKey(Math.min(...valid.map((item) => item.start))) : null,
              end: valid.length ? dayKey(Math.max(...valid.map((item) => item.end))) : null,
              scope: "\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u044B\u0435 \u0441\u0435\u0441\u0441\u0438\u0438 API; \u043F\u043E\u043B\u043D\u043E\u0442\u0430 \u043F\u0435\u0440\u0438\u043E\u0434\u0430 \u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430"
            };
          }
        }
      } catch (error) {
        if (signal.aborted) throw new Error("\u0421\u0431\u043E\u0440 \u043E\u0442\u043C\u0435\u043D\u0451\u043D");
        const unavailable = { available: false, error: error.message };
        if (kind === "profile") result.coverage.tickets = result.coverage.reports = unavailable;
        else result.coverage[kind] = unavailable;
      }
    }
    if (!Object.values(result.coverage).some((item) => item.available)) throw new Error("\u0421\u0430\u0439\u0442 \u043D\u0435 \u043F\u0440\u0435\u0434\u043E\u0441\u0442\u0430\u0432\u0438\u043B \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0432\u0445\u043E\u0434 \u0438 \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u043F\u0440\u043E\u0444\u0438\u043B\u044E.");
    return result;
  }
  async function collectNativeRoster({ client, signal, progress = () => {
  }, now = Date.now() }) {
    const days = [], union = /* @__PURE__ */ new Map();
    for (let day = 0; day < 7; day++) {
      progress(`\u0420\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435: \u0434\u0435\u043D\u044C ${day + 1} \u0438\u0437 7`);
      const data = await nativeRead(client, rosterDayOperation(day), signal, progress, "roster");
      if (signal.aborted) throw new Error("\u0421\u0431\u043E\u0440 \u043E\u0442\u043C\u0435\u043D\u0451\u043D");
      if (data.members.some((member) => member.day !== day)) throw new Error("\u0421\u0430\u0439\u0442 \u0432\u0435\u0440\u043D\u0443\u043B \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0434\u043D\u044F");
      const members = /* @__PURE__ */ new Map();
      for (const { steamId, name, className } of data.members) {
        const previous = members.get(steamId);
        const known = previous || union.get(steamId);
        if (known && (known.name !== name || known.className !== className)) throw new Error("\u0421\u0430\u0439\u0442 \u0432\u0435\u0440\u043D\u0443\u043B \u043F\u0440\u043E\u0442\u0438\u0432\u043E\u0440\u0435\u0447\u0438\u0432\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u0430");
        members.set(steamId, { steamId, name, className });
        union.set(steamId, { steamId, name, className });
      }
      days.push({ day, members: [...members.values()] });
    }
    return { days, fetchedAt: now };
  }

  // modules/analytics/SiteReadBridge.js
  function installNativeReadBridge({ window: window2, document: document2, fetchText, importModule }) {
    if (window2.__iohNativeReadBridgeV2) return;
    window2.__iohNativeReadBridgeV2 = true;
    let active = null, clientPromise = null, configRequest = null;
    const emit = (nonce, type, extra = {}) => window2.postMessage({ channel: "ioh-analytics-response-v2", nonce, type, ...extra }, window2.location.origin);
    const configExport = () => {
      if (configRequest) return configRequest.promise;
      const nonce = window2.crypto.randomUUID();
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const timer = setTimeout(() => {
        if (configRequest?.nonce !== nonce) return;
        configRequest = null;
        reject(new Error("\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u043D\u0435 \u043E\u0442\u0432\u0435\u0442\u0438\u043B\u043E. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0430\u0434\u043C\u0438\u043D\u043A\u0438."));
      }, 5e3);
      configRequest = { nonce, promise, timer, resolve, reject };
      window2.postMessage({ channel: "ioh-moderator-config-request-v1", nonce }, window2.location.origin);
      return promise;
    };
    window2.ioHelperModerators = configExport;
    const listener = (event) => {
      if (event.source !== window2 || event.origin !== window2.location.origin) return;
      if (event.data?.channel === "ioh-moderator-config-response-v1") {
        if (!configRequest || event.data.nonce !== configRequest.nonce) return;
        const request = configRequest;
        configRequest = null;
        clearTimeout(request.timer);
        const response = event.data.response;
        if (response?.success) request.resolve(response);
        else request.reject(new Error(String(response?.error || "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u0432").slice(0, 300)));
        return;
      }
      if (event.data?.channel !== "ioh-analytics-request-v2") return;
      const { nonce, type, steamId, range } = event.data;
      if (!/^[a-f0-9-]{16,64}$/.test(nonce || "")) return;
      if (type === "cancel") {
        if (active?.nonce === nonce) active.controller.abort();
        return;
      }
      if (type !== "roster" && (type !== "collect" || !parseSteamId(steamId) || !validateRange(range))) return;
      if (active) {
        emit(nonce, "error", { error: "\u0412 \u044D\u0442\u043E\u0439 \u0432\u043A\u043B\u0430\u0434\u043A\u0435 \u0443\u0436\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F \u0441\u0431\u043E\u0440", code: "BUSY" });
        return;
      }
      const controller = new AbortController();
      active = { nonce, controller };
      const run = async () => {
        if (!clientPromise) clientPromise = findNativeClient({ document: document2, origin: window2.location.origin, fetchText, importModule, signal: controller.signal }).catch((error) => {
          clientPromise = null;
          throw error;
        });
        const client = await clientPromise;
        if (controller.signal.aborted) return;
        const options = { client, signal: controller.signal, progress: (stage) => emit(nonce, "progress", { stage }) };
        const result = type === "roster" ? await collectNativeRoster(options) : await collectNativeProfile({ ...options, steamId, range });
        if (!controller.signal.aborted) emit(nonce, "result", { result });
      };
      void run().catch((error) => {
        if (!controller.signal.aborted) emit(nonce, "error", { error: error.message || "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443" });
      }).finally(() => {
        if (active?.nonce === nonce) active = null;
      });
    };
    window2.addEventListener("message", listener);
    window2.addEventListener("pagehide", () => {
      active?.controller.abort();
      window2.removeEventListener("message", listener);
      if (configRequest) {
        clearTimeout(configRequest.timer);
        configRequest.reject(new Error("\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0430\u0434\u043C\u0438\u043D\u043A\u0438 \u0431\u044B\u043B\u0430 \u0437\u0430\u043A\u0440\u044B\u0442\u0430"));
        configRequest = null;
      }
      if (window2.ioHelperModerators === configExport) delete window2.ioHelperModerators;
    }, { once: true });
  }
  if (typeof window !== "undefined" && ["io.cybershoke.net", "io.cybershoke.ru"].includes(window.location.hostname)) {
    const nativeFetch = window.fetch.bind(window);
    installNativeReadBridge({
      window,
      document,
      fetchText: async (url, signal) => {
        const response = await nativeFetch(url, { signal, cache: "force-cache" });
        if (!response.ok) throw new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442 \u0441\u0430\u0439\u0442\u0430");
        return response.text();
      },
      importModule: (url) => import(
        /* @vite-ignore */
        url
      )
    });
  }
})();
//# sourceMappingURL=siteBridge.js.map
