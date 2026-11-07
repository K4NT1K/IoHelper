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
      const daily = (list2) => rows(list2).map((r) => ({ date: `${r.year}-${String(r.month).padStart(2, "0")}-${String(r.day).padStart(2, "0")}`, count: Math.max(0, Number(r.count) || 0) })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
      return { name: bounded(value.data?.name), className: typeof value.data?.class_name === "string" ? bounded(value.data.class_name, 100).trim() : "", avatar: safeAvatarUrl(value.data?.avatar), tickets: daily(value.history_tickets), reports: daily(value.history_reports) };
    }
    if (kind === "bans" || kind === "mutes") {
      const list2 = rows(value);
      if (!list2) return null;
      return { items: list2.map((r) => ({ id: bounded(r.bid, 40), created: Number(r.created), reason: bounded(r.reason), removed: Boolean(Number(r.RemovedOn) > 0 || r.RemoveType && r.RemoveType !== "0") })), truncated: value.length >= 1e5 };
    }
    if (kind === "shifts") {
      const list2 = rows(value?.prime_list);
      return list2 ? { items: list2.map((r) => ({ start: Number(r.unixtime_on_prime), end: Number(r.unixtime_out_prime) })).filter((r) => r.end > r.start) } : null;
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
  function readOperation(kind, steamId2, now = Date.now()) {
    if (!parseSteamId(steamId2)) throw new Error("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 SteamID64");
    const start = dayStart(HISTORY_START), end = Math.floor(now / 1e3);
    if (kind === "profile") return { path: "/moderation/postprofile", body: { profiledata: { steamid64: steamId2, format_date: "day" } } };
    if (kind === "bans" || kind === "mutes") return {
      path: `/moderation/profile/${steamId2}/list/${kind === "bans" ? "bans" : "comms"}`,
      body: new URLSearchParams({ date_start: String(start), date_end: String(end) }),
      form: true
    };
    if (kind === "shifts") return { path: "/moderation/profile/prime/closed/list", body: { data: { steamid64: steamId2, unixtimeFrom: start, unixtimeTo: end, zeroVisibility: "hidden" } } };
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
  async function findNativeClient({ document: document2, origin, fetchText, importModule, signal, onModule }) {
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
          onModule?.(module);
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
  async function collectNativeProfile({ client, steamId: steamId2, range, signal, progress = () => {
  }, now = Date.now() }) {
    if (!parseSteamId(steamId2) || !validateRange(range)) throw new Error("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u043F\u0440\u043E\u0444\u0438\u043B\u044C \u0438\u043B\u0438 \u043F\u0435\u0440\u0438\u043E\u0434");
    const today = dayKey(now / 1e3);
    const result = { steamId: steamId2, fetchedAt: now, coverage: {}, tickets: [], reports: [], bans: [], mutes: [], shifts: [] };
    const labels = { profile: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0437\u0430\u043A\u0440\u044B\u0442\u044B\u0445 \u0436\u0430\u043B\u043E\u0431", bans: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0431\u0430\u043D\u043E\u0432", mutes: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043C\u0443\u0442\u043E\u0432", shifts: "\u0420\u0430\u0431\u043E\u0447\u0435\u0435 \u0432\u0440\u0435\u043C\u044F" };
    for (const kind of ["profile", "bans", "mutes", "shifts"]) {
      progress(labels[kind]);
      try {
        const data = await nativeRead(client, readOperation(kind, steamId2, now), signal, progress, kind);
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
      for (const { steamId: steamId2, name, className } of data.members) {
        const previous = members.get(steamId2);
        const known = previous || union.get(steamId2);
        if (known && (known.name !== name || known.className !== className)) throw new Error("\u0421\u0430\u0439\u0442 \u0432\u0435\u0440\u043D\u0443\u043B \u043F\u0440\u043E\u0442\u0438\u0432\u043E\u0440\u0435\u0447\u0438\u0432\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u0430");
        members.set(steamId2, { steamId: steamId2, name, className });
        union.set(steamId2, { steamId: steamId2, name, className });
      }
      days.push({ day, members: [...members.values()] });
    }
    return { days, fetchedAt: now };
  }

  // modules/native/model.js
  var CHANNEL = "ioh-native-data-v1";
  var requestTime = (view) => view?.performance?.timeOrigin && typeof view.performance.now === "function" ? view.performance.timeOrigin + view.performance.now() : Date.now();
  var steamId = (value) => /^\d{17}$/.test(String(value || "")) ? String(value) : null;
  var record = (value) => value && typeof value === "object" && !Array.isArray(value);
  var own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  var str = (value, max = 4e3) => typeof value === "string" ? value.slice(0, max) : "";
  var number = (value) => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  var bool = (value) => value === true || value === 1 || value === "1" ? true : value === false || value === 0 || value === "0" ? false : void 0;
  var list = (value) => Array.isArray(value) && value.length <= 1e4 ? value : null;
  function messageKey(message) {
    const source = JSON.stringify([message.timeMs, message.text, message.channel, message.mode, message.num]);
    let a = 2166136261, b = 5381;
    for (let i = 0; i < source.length; i++) {
      const c = source.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619);
      b = Math.imul(b, 33) ^ c;
    }
    return `${message.timeMs}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
  }
  function siteTime(value) {
    if (value == null || value === "") return null;
    if (/^\d+(?:\.\d+)?$/.test(String(value))) {
      const n2 = Number(value);
      return n2 > 1e12 ? n2 : n2 * 1e3;
    }
    const s = String(value).replace(" ", "T");
    const n = Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(s) ? s + "+03:00" : s);
    return Number.isFinite(n) ? n : null;
  }
  var REASONS = {
    ReasonPlayer_Cheating: "\u0427\u0438\u0442\u0435\u0440\u0441\u0442\u0432\u043E",
    ReasonPlayer_BugAbuse: "\u0411\u0430\u0433\u043E\u044E\u0437",
    ReasonPlayer_Bug: "\u0411\u0430\u0433\u043E\u044E\u0437",
    ReasonPlayer_Monitoring: "\u041C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433",
    ReasonPlayer_Rules: "\u041D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0435 \u043F\u0440\u0430\u0432\u0438\u043B",
    ReasonPlayer_RulesViolation: "\u041D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0435 \u043F\u0440\u0430\u0432\u0438\u043B",
    ReasonPlayer_ViolatingRules: "\u041D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0435 \u043F\u0440\u0430\u0432\u0438\u043B",
    ReasonPlayer_Bugs: "\u0411\u0430\u0433\u043E\u044E\u0437",
    ReasonPlayer_Spam: "\u0421\u043F\u0430\u043C",
    ReasonPlayer_Begging: "\u041F\u043E\u043F\u0440\u043E\u0448\u0430\u0439\u043D\u0438\u0447\u0435\u0441\u0442\u0432\u043E",
    Reason_Mute_Toxic: "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C",
    Reason_Mute_Insult: "\u041E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u0435",
    Reason_Mute_Trolling: "\u0422\u0440\u043E\u043B\u043B\u0438\u043D\u0433/\u043F\u0440\u043E\u0432\u043E\u043A\u0430\u0446\u0438\u044F",
    Reason_Mute_Spam: "\u0421\u043F\u0430\u043C \u0432 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D/\u0447\u0430\u0442",
    Reason_Mute_Racism: "\u0420\u0430\u0441\u0438\u0437\u043C / \u0434\u0438\u0441\u043A\u0440\u0438\u043C\u0438\u043D\u0430\u0446\u0438\u044F",
    Reason_Mute_Rasism: "\u0420\u0430\u0441\u0438\u0437\u043C / \u0434\u0438\u0441\u043A\u0440\u0438\u043C\u0438\u043D\u0430\u0446\u0438\u044F",
    Reason_Mute_Monitoring: "\u041C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433",
    Reason_Ban_Cheat: "\u0427\u0438\u0442\u0435\u0440\u0441\u0442\u0432\u043E"
  };
  var reasonLabel = (value) => REASONS[value] || str(value, 200);
  function endpoint(ip, port) {
    if (typeof ip !== "string" || !/^[a-z0-9.:[\]-]+$/i.test(ip) || ip === "0.0.0.0") return null;
    const n = number(port);
    return n > 0 && n <= 65535 ? `${ip.toLowerCase()}:${n}` : null;
  }
  function bodyObject(value) {
    try {
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return Object.fromEntries(new URLSearchParams(value));
        }
      }
      if (value instanceof URLSearchParams) return Object.fromEntries(value);
      return record(value) ? value : {};
    } catch {
      return {};
    }
  }
  function describeRequest(config, origin) {
    try {
      let base = config.baseURL || origin + "/";
      if (!base.endsWith("/")) base += "/";
      const url = /^https?:\/\//.test(config.url || "") ? new URL(config.url) : new URL(String(config.url || "").replace(/^\//, ""), base);
      if (!["io.cybershoke.net", "io.cybershoke.ru", "cybershoke.net", "cybershoke.ru", "www.cybershoke.net", "www.cybershoke.ru"].includes(url.hostname) || url.protocol !== "https:") return null;
      const method = String(config.method || "get").toUpperCase();
      const path = url.pathname.replace(/\/$/, "");
      const body = bodyObject(config.data), data = record(body.data) ? body.data : body;
      let m;
      if (method === "GET" && (m = path.match(/^\/api\/(ticket|reports)\/list$/))) return { kind: "queue", entity: m[1] === "ticket" ? "ticket" : "report", key: path + ":game:" + str(String(config.params?.game ?? url.searchParams.get("game") ?? "all"), 20), complete: !url.search && !config.params };
      if (method === "GET" && (m = path.match(/^\/api\/(ticket|reports)\/get\/(\d+)$/))) return { kind: "ticket", entity: m[1] === "ticket" ? "ticket" : "report", id: Number(m[2]), key: path };
      if (method === "POST" && path === "/api/user/data" && !url.hostname.startsWith("io.")) {
        const id = steamId(data.steamid64);
        return id ? { kind: "player", steamId: id, key: "player:" + id } : null;
      }
      if (method === "POST" && (m = path.match(/^\/api\/ticket\/(bans|mutes|chats|tickets)\/history$/))) {
        const id = steamId(data.steamid64);
        const complete = Object.keys(data).every((k) => k === "steamid64") && !url.search && (!config.params || Object.keys(config.params).length === 0) && (body === data || Object.keys(body).every((k) => k === "data"));
        return id ? { kind: "history", resource: m[1], steamId: id, key: path + ":" + id, complete } : null;
      }
      if (method === "GET" && path === "/api/admin/data/login") return { kind: "account", key: path };
      if (method === "GET" && (m = path.match(/^\/api\/user\/(\d{17})\/bans\/bypasses\/status$/))) return { kind: "bypass", steamId: m[1], key: path };
      if (method === "POST" && path === "/api/servers/players") return { kind: "serverPlayers", steamId: steamId(data.steamid64), requestedEndpoint: endpoint(data.server_ip, data.server_port), key: path + ":" + (steamId(data.steamid64) || endpoint(data.server_ip, data.server_port) || "self") };
      if (method === "GET" && path === "/api/servers/list") return { kind: "servers", key: path };
      if (method === "POST" && (m = path.match(/^\/api\/user\/(\d{17})\/set\/(ban|comm|mute)$/))) return { kind: "action", steamId: m[1], resource: m[2] === "ban" ? "bans" : "mutes", key: path };
      return null;
    } catch {
      return null;
    }
  }
  function normalizePunishment(value, kind) {
    if (!record(value)) return null;
    const created = siteTime(value.created ?? value.timestamp ?? value.unixtime_from);
    const length = number(value.length ?? value.unixtime_length);
    const ends = siteTime(value.ends ?? value.end) ?? (created && length > 0 ? created + length * 1e3 : null);
    if (!created || length == null || length < 0) return null;
    return {
      nativePunishment: true,
      id: String(value.bid ?? value.id ?? `${kind}:${created}`),
      kind,
      created,
      ends,
      length,
      reason: reasonLabel(value.reason),
      reasonCode: str(value.reason, 200),
      removed: value.RemoveType === "U" || value.is_lifted === true || Number(value.RemovedOn) > 0,
      expired: value.RemoveType === "E",
      permanent: value.is_permanent === true || length === 0,
      admin: str(value.admin_name ?? value.admin, 100),
      type: number(value.type)
    };
  }
  function punishmentActive(p, now = Date.now()) {
    return Boolean(p && !p.removed && !p.expired && (p.permanent || p.ends > now));
  }
  function notice(v) {
    const timeMs = siteTime(v?.unixtime);
    return timeMs && typeof v.text === "string" ? { timeMs, text: str(v.text), adminId: steamId(v.steamid64_admin) } : null;
  }
  function complaint(v, entity) {
    if (!record(v) || !Number.isSafeInteger(Number(v.id)) || Number(v.id) <= 0 || !steamId(v.steamid64_suspect)) return null;
    const result = { key: `${entity}:${v.id}`, entity, id: Number(v.id), suspectId: steamId(v.steamid64_suspect), senderId: steamId(v.steamid64_sender) };
    const strings = { message: "message", reasonCode: "reason", mode: "mode", category: "server_category", suspectCountry: "country_suspect", senderCountry: "country_sender" };
    for (const [key, source] of Object.entries(strings)) if (own(v, source)) result[key] = str(v[source]);
    if (own(v, "reason")) result.reason = reasonLabel(v.reason);
    for (const [key, source] of Object.entries({ status: "status", result: "result", playtime: "playtime_suspect", kills: "kills", deaths: "deaths", headshots: "headshots", cs2Hours: "cs2_hours_suspect", complaints: "complaints_count" })) if (own(v, source)) result[key] = number(v[source]);
    if (own(v, "server_ip")) result.complaintServer = endpoint(v.server_ip, v.server_port);
    if (own(v, "steamid64_admin")) result.adminId = steamId(v.steamid64_admin);
    if (own(v, "timestamp") || own(v, "timestamp_unixtime")) result.createdAt = siteTime(v.timestamp_unixtime ?? v.timestamp);
    if (own(v, "start_timestamp")) result.startedAt = siteTime(v.start_timestamp);
    if (own(v, "end_timestamp") || own(v, "end_unixtime")) result.endedAt = siteTime(v.end_unixtime ?? v.end_timestamp);
    if (own(v, "complaint_unixtime")) result.chatAnchor = siteTime(v.complaint_unixtime);
    if (Array.isArray(v.suspect_notice)) result.warnings = v.suspect_notice.slice(0, 3e3).map(notice).filter(Boolean);
    if (Array.isArray(v.suspect_connect) && v.suspect_connect.length) {
      const latest = [...v.suspect_connect].sort((a, b) => Number(b.unixtime_connect) - Number(a.unixtime_connect))[0];
      const online = bool(latest.is_online) ?? latest.unixtime_disconnect == null;
      result.presence = { serverIp: online ? endpoint(latest.server_ip, latest.server_port) : null, lastconnect: number(latest.unixtime_disconnect ?? latest.unixtime_connect) };
    }
    return result;
  }
  function player(v, id) {
    if (!record(v)) return null;
    const data = record(v.result) ? v.result : record(v.data) ? v.data : v;
    if (!record(data.basic) && !record(data.cybershoke)) return null;
    if (data.basic?.steamid64 && steamId(data.basic.steamid64) !== id) return null;
    const p = { steamId: id };
    const b = data.basic || {}, global = data.cybershoke?.global || {};
    if (own(b, "country") && (b.country == null || /^[a-z]{2}$/i.test(b.country))) p.country = b.country?.toLowerCase() || null;
    if (own(b, "vip_name")) p.vipName = str(b.vip_name, 60);
    for (const [key, source2] of Object.entries({ profileVerified: "profile", isModerator: "moderation" })) {
      const value = bool(b.verification?.[source2]);
      if (value !== void 0) p[key] = value;
    }
    if (own(global, "playtime")) p.playtime = number(global.playtime);
    if (own(global, "lastconnect")) p.lastconnect = number(global.lastconnect);
    if (own(data, "server") && (data.server === null || record(data.server))) p.serverIp = data.server ? endpoint(data.server.server_ip, data.server.server_port) : null;
    if (data.server?.mode) p.serverLabel = [str(data.server.mode, 80), data.server.num ? "#" + data.server.num : "", str(data.server.category, 100)].filter(Boolean).join(" ");
    if (list(b.bans_list)) {
      for (const [kind, type] of [["bans", 4], ["mutes", 3]]) {
        const rows2 = b.bans_list.filter((x) => Number(x.type) === type).map((x) => normalizePunishment(x, kind));
        if (rows2.some((x) => !x)) continue;
        p[kind] = rows2;
        p[kind === "bans" ? "isBanned" : "isMuted"] = p[kind].some((x) => punishmentActive(x));
      }
    }
    const source = [b.connect, data.connect, data, b].find((x) => own(x, "faceit"));
    const f = source?.faceit;
    if (record(f)) {
      const profile = record(f.profile) ? f.profile : f;
      const elo = number(profile.elo ?? profile.faceit_elo), level = number(profile.level ?? profile.skill_level);
      if (f.hide === true || own(f, "name") && !f.name) p.faceit = null;
      else if (f.error || f.exists === false) p.faceit = null;
      else if (own(f, "name") || elo != null || level != null) p.faceit = {
        elo: elo != null && elo >= 0 ? elo : null,
        level: Number.isInteger(level) && level >= 1 && level <= 10 ? level : null
      };
    } else if (source && f === null) p.faceit = null;
    return p;
  }
  function normalizeResponse(descriptor, raw, { startedAt = Date.now(), receivedAt = Date.now(), sequence = 0, status = 200 } = {}) {
    if (descriptor?.kind === "action" && status >= 400) {
      return {
        version: 1,
        kind: "action",
        key: descriptor.key,
        startedAt,
        receivedAt,
        sequence,
        payload: { steamId: descriptor.steamId, resource: descriptor.resource, success: false }
      };
    }
    if (!descriptor || status < 200 || status >= 300 || !record(raw) && !Array.isArray(raw)) return null;
    if (raw?.result === "error" || raw?.success === false) {
      if (descriptor.kind !== "action") return null;
    }
    const d = descriptor;
    let payload;
    if (d.kind === "queue") {
      const a = list(raw) || list(raw.tickets) || list(raw.reports);
      if (!a) return null;
      const items = a.map((v) => complaint(v, d.entity));
      if (items.some((x) => !x)) return null;
      payload = { entity: d.entity, items, complete: d.complete };
    } else if (d.kind === "ticket") {
      const v = raw.json ?? raw;
      payload = complaint(v, d.entity);
      if (!payload || payload.id !== d.id) return null;
      if (!own(v, "start_timestamp")) payload.startedAt = null;
      if (!own(v, "end_timestamp") && !own(v, "end_unixtime")) payload.endedAt = null;
    } else if (d.kind === "player") payload = player(raw, d.steamId);
    else if (d.kind === "history") {
      const a = list(raw) || list(raw.data);
      if (!a || !d.complete) return null;
      let items;
      if (d.resource === "bans" || d.resource === "mutes") items = a.map((v) => normalizePunishment(v, d.resource));
      else if (d.resource === "chats") {
        const occurrences = /* @__PURE__ */ new Map();
        items = a.map((v) => {
          const timeMs = siteTime(v.unixtime ?? v.timestamp_unixtime), text = v.msg ?? v.message;
          if (!timeMs || typeof text !== "string" || v.steamid64 && steamId(v.steamid64) !== d.steamId) return null;
          const message = { timeMs, text: str(text), author: str(v.name, 100), channel: v.type === 1 || v.type === "team" ? "team" : "all", mode: str(v.mode, 80), num: number(v.num ?? v.server_num) };
          const base = v.id == null ? messageKey(message) : String(v.id).slice(0, 100);
          const count = occurrences.get(base) || 0;
          occurrences.set(base, count + 1);
          return { ...message, id: `${base}:${count}` };
        });
      } else items = a.map((v) => ({ id: number(v.id), timeMs: siteTime(v.unixtime ?? v.timestamp_unixtime), reason: reasonLabel(v.reason), result: number(v.result), status: number(v.status) }));
      if (items.some((x) => !x)) return null;
      payload = { steamId: d.steamId, resource: d.resource, items };
    } else if (d.kind === "account") {
      const a = raw["admin-data"];
      if (!record(a) || !steamId(a.steamid64)) return null;
      let groups = a.access_group;
      if (typeof groups === "string") {
        try {
          groups = JSON.parse(groups);
        } catch {
          return null;
        }
      }
      payload = { steamId: steamId(a.steamid64), groups: Array.isArray(groups) ? groups.filter((x) => typeof x === "string").slice(0, 500) : [], flags: str(a.access_abc, 200) };
    } else if (d.kind === "bypass") {
      const v = raw.data;
      if (raw.result !== "success" || !record(v)) return null;
      payload = { steamId: d.steamId, checked: bool(v.checked), hasBypass: bool(v.has_bypass), bannedAccounts: number(v.banned_accounts), isPublicIp: bool(v.is_public_ip) };
    } else if (d.kind === "servers") {
      const a = list(raw.all_servers);
      if (!a) return null;
      payload = a.map((v) => ({ endpoint: endpoint(v.ip, v.port), label: [str(v.mode, 80), v.num ? "#" + v.num : "", str(v.category, 100)].filter(Boolean).join(" ") })).filter((v) => v.endpoint);
    } else if (d.kind === "serverPlayers") {
      if (!list(raw.players)) return null;
      const s = raw.serverInfo ?? raw.server;
      payload = {
        steamId: d.steamId,
        endpoint: record(s) ? endpoint(s.server_ip ?? s.ip, s.server_port ?? s.port) : null,
        players: raw.players.map((v) => ({ steamId: steamId(v.steamid64), isModerator: bool(v.is_moderator) })).filter((v) => v.steamId)
      };
    } else if (d.kind === "action") {
      const success = bool(raw.success) ?? (raw.result === "success" || raw.results?.[0]?.status === "success" ? true : raw.result === "error" || raw.results?.[0]?.status === "error" ? false : void 0);
      if (success === void 0) return null;
      payload = { steamId: d.steamId, resource: d.resource, success };
    }
    return payload == null ? null : { version: 1, kind: d.kind, key: d.key, startedAt, receivedAt, sequence, payload };
  }
  function normalizeFailure(descriptor, { startedAt = Date.now(), receivedAt = Date.now(), sequence = 0, status = 0 } = {}) {
    if (!descriptor || descriptor.kind === "action" || descriptor.complete === false) return null;
    return {
      version: 1,
      kind: "resourceError",
      key: descriptor.key,
      startedAt,
      receivedAt,
      sequence,
      payload: { resource: descriptor.kind, steamId: descriptor.steamId || null, status: Number.isInteger(status) ? status : 0 }
    };
  }

  // modules/native/Bootstrap.js
  function observeNativeBootstrap(document2, receive) {
    for (const root of document2.querySelectorAll("#app, #root")) {
      const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
      const container = key && root[key];
      const queue = [container?.stateNode?.current || container], seen = /* @__PURE__ */ new Set();
      for (let i = 0; i < queue.length && i < 300; i++) {
        const fiber = queue[i];
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        for (const name of ["client", "value"]) {
          const client = fiber.memoizedProps?.[name];
          if (typeof client?.getQueryCache !== "function" || typeof client?.getQueryState !== "function") continue;
          const cache = client.getQueryCache();
          if (typeof cache?.subscribe !== "function") continue;
          let lastUpdate = 0;
          const read = () => {
            const state = client.getQueryState(["auth", "me"]);
            if (state?.status !== "success" || !state.data || !Number.isFinite(state.dataUpdatedAt) || state.dataUpdatedAt <= lastUpdate) return;
            lastUpdate = state.dataUpdatedAt;
            receive(state.data, state.dataUpdatedAt);
          };
          const safeRead = () => {
            try {
              read();
            } catch {
            }
          };
          const unsubscribe = cache.subscribe((event) => {
            const k = event?.query?.queryKey;
            if (Array.isArray(k) && k.length === 2 && k[0] === "auth" && k[1] === "me") safeRead();
          });
          safeRead();
          return unsubscribe;
        }
        if (fiber.child) queue.push(fiber.child);
        if (fiber.sibling) queue.push(fiber.sibling);
      }
    }
    return null;
  }

  // modules/native/Observer.js
  function installNativeObserver({ window: window2, document: document2, fetchText, importModule }) {
    let enabled = false, nonce = null, generation = 0, sequence = 0, controller = null;
    let discovery = null, domObserver = null, attemptedEntry = "", replayBytes = 0, retryAt = 0, attempts = 0;
    let bootstrapCleanup = null;
    const clients = /* @__PURE__ */ new Map(), requests = /* @__PURE__ */ new WeakMap(), replay = /* @__PURE__ */ new Map();
    const post = (type, extra = {}) => window2.postMessage({ channel: CHANNEL, type, nonce, ...extra }, window2.location.origin);
    const publish = (event) => {
      if (!event) return;
      const previous = replay.get(event.key)?.event;
      if (previous && (previous.startedAt > event.startedAt || previous.startedAt === event.startedAt && previous.sequence >= event.sequence)) return;
      const bytes = JSON.stringify(event).length * 2;
      if (bytes > 2 * 1024 * 1024) return;
      replayBytes -= replay.get(event.key)?.bytes || 0;
      replay.delete(event.key);
      replay.set(event.key, { event, bytes });
      replayBytes += bytes;
      while (replay.size > 80 || replayBytes > 8 * 1024 * 1024) {
        const oldest = replay.keys().next().value;
        replayBytes -= replay.get(oldest).bytes;
        replay.delete(oldest);
      }
      post("data", { event });
    };
    const observe = (client) => {
      if (!enabled || clients.has(client) || typeof client?.post !== "function" || !client.interceptors?.response?.use) return;
      let base;
      try {
        base = new URL(client.defaults?.baseURL || "", window2.location.origin);
      } catch {
        return;
      }
      if (!["io.cybershoke.net", "io.cybershoke.ru", "cybershoke.net", "cybershoke.ru"].includes(base.hostname) || base.pathname.replace(/\/$/, "") !== "/api") return;
      const requestId = client.interceptors.request.use((config) => {
        requests.set(config, { startedAt: requestTime(window2), sequence: ++sequence, generation });
        return config;
      });
      const capture = (response, error = false) => {
        try {
          if (!enabled || !response?.config) return;
          const d = describeRequest(response.config, window2.location.origin);
          const stamp = requests.get(response.config);
          if (!stamp || stamp.generation !== generation) return;
          const context = { ...stamp, receivedAt: Date.now(), status: response.status };
          const event = normalizeResponse(d, response.data, context) || normalizeFailure(d, context);
          if (!event || error && event.kind !== "action" && event.kind !== "resourceError") return;
          publish(event);
        } catch {
        }
      };
      const responseId = client.interceptors.response.use((response) => {
        capture(response);
        return response;
      }, (error) => {
        capture(error?.response || error?._orig?.response || { config: error?.config || error?._orig?.config, status: 0 }, true);
        return Promise.reject(error);
      });
      clients.set(client, { requestId, responseId });
    };
    const discover = () => {
      if (enabled && !bootstrapCleanup) {
        const version2 = generation;
        bootstrapCleanup = observeNativeBootstrap(document2, (raw, receivedAt) => {
          if (!enabled || version2 !== generation) return;
          publish(normalizeResponse(
            { kind: "account", key: "/api/admin/data/login" },
            raw,
            { startedAt: 0, receivedAt, sequence: ++sequence }
          ));
        });
      }
      if (clients.size && bootstrapCleanup) domObserver?.disconnect();
      if (!enabled || discovery || clients.size || Date.now() < retryAt || attempts >= 3) return;
      const entry = [...document2.querySelectorAll('script[type="module"][src]')].map((s) => s.src).join("|");
      if (!entry || entry === attemptedEntry) return;
      attemptedEntry = entry;
      attempts++;
      const version = generation;
      controller = new AbortController();
      discovery = findNativeClient({
        document: document2,
        origin: window2.location.origin,
        fetchText,
        importModule,
        signal: controller.signal,
        onModule: (module) => {
          if (enabled && generation === version) Object.values(module).forEach(observe);
        }
      }).then((client) => {
        if (enabled && generation === version) observe(client);
      }).catch(() => {
        if (version === generation) {
          attemptedEntry = "";
          retryAt = Date.now() + 5e3;
        }
      }).finally(() => {
        discovery = null;
        if (clients.size && bootstrapCleanup) domObserver?.disconnect();
        else if (enabled && version !== generation) discover();
      });
    };
    const stop = () => {
      enabled = false;
      generation++;
      controller?.abort();
      domObserver?.disconnect();
      bootstrapCleanup?.();
      bootstrapCleanup = null;
      for (const [c, ids] of clients) {
        c.interceptors.request.eject(ids.requestId);
        c.interceptors.response.eject(ids.responseId);
      }
      clients.clear();
      replay.clear();
      replayBytes = 0;
      attemptedEntry = "";
      retryAt = 0;
      attempts = 0;
    };
    const listener = (event) => {
      if (event.source !== window2 || event.origin !== window2.location.origin || event.data?.channel !== CHANNEL) return;
      const m = event.data;
      if (m.type === "start" && /^[a-f0-9-]{16,64}$/i.test(m.nonce || "")) {
        nonce = m.nonce;
        if (!enabled) {
          enabled = true;
          domObserver = new window2.MutationObserver(discover);
          domObserver.observe(document2, { childList: true, subtree: true });
          discover();
        }
        for (const value of replay.values()) post("data", { event: value.event });
      } else if (m.type === "stop" && m.nonce === nonce) stop();
    };
    window2.addEventListener("message", listener);
    const hide = (event) => {
      if (!event.persisted) {
        stop();
        window2.removeEventListener("message", listener);
        window2.removeEventListener("pagehide", hide);
      }
    };
    window2.addEventListener("pagehide", hide);
    post("ready");
    return stop;
  }

  // modules/native/QueueChatClient.js
  var QUEUE_CHAT_CHANNEL = "ioh-queue-chat-v1";
  var QUEUE_CHAT_LIMIT = 1e3;
  var QUEUE_CHAT_TIMEOUT = 15e3;
  var QUEUE_CHAT_MAX_INFLIGHT = 8;
  var validSteamId = (id) => typeof id === "string" && /^\d{17}$/.test(id);
  var codes = /* @__PURE__ */ new Set(["ABORTED", "TIMEOUT", "RATE_LIMIT", "UNAVAILABLE", "INVALID_RESPONSE", "BUSY"]);
  var queueChatError = (code) => Object.assign(new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0447\u0430\u0442\u0430: " + (codes.has(code) ? code : "UNAVAILABLE")), { code: codes.has(code) ? code : "UNAVAILABLE" });
  function normalizeQueueChatResponse(raw, steamId2, { now = Date.now() } = {}) {
    const source = Array.isArray(raw) ? raw : raw?.messages;
    if (!validSteamId(steamId2) || !Array.isArray(source) || source.length > 1e4) throw queueChatError("INVALID_RESPONSE");
    const messages = [];
    for (const row of source) {
      if (row?.steamid64 !== steamId2 || typeof row.msg !== "string" || !row.msg.trim()) continue;
      if (typeof row.unixtime !== "number" && typeof row.unixtime !== "string" || String(row.unixtime).trim() === "") continue;
      const timeMs = Number(row.unixtime) * 1e3;
      if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs < now - 864e5 || timeMs > now) continue;
      messages.push({ timeMs, text: row.msg.slice(0, 2e4), channel: row.type === 1 || row.type === "1" ? "team" : "all" });
    }
    return messages;
  }

  // modules/native/QueueChatBridge.js
  function installQueueChatBridge({ window: window2, document: document2, fetchText, importModule }) {
    if (!/^https:\/\/io\.cybershoke\.(net|ru)$/.test(window2.location.origin) || window2.__iohQueueChatBridgeV1) return;
    window2.__iohQueueChatBridgeV1 = true;
    const pending = /* @__PURE__ */ new Map();
    const origin = window2.location.origin;
    let client = null, stopped = false;
    const emit = (request, type, extra = {}) => window2.postMessage({ channel: QUEUE_CHAT_CHANNEL, type, nonce: request.nonce, steamId: request.steamId, ...extra }, origin);
    const finish = (request, type, extra) => {
      if (pending.get(request.nonce) !== request) return;
      pending.delete(request.nonce);
      clearTimeout(request.timer);
      if (type && !stopped) emit(request, type, extra);
    };
    const listener = (event) => {
      if (stopped || event.source !== window2 || event.origin !== origin || event.data?.channel !== QUEUE_CHAT_CHANNEL) return;
      const { type, nonce, steamId: steamId2 } = event.data;
      if (typeof nonce !== "string" || !/^[a-f0-9-]{16,64}$/i.test(nonce)) return;
      if (type === "cancel") {
        const request2 = pending.get(nonce);
        if (request2) {
          finish(request2);
          request2.controller.abort();
        }
        return;
      }
      if (type !== "read" || typeof steamId2 !== "string" || !/^\d{17}$/.test(steamId2) || pending.has(nonce)) return;
      const request = { nonce, steamId: steamId2, controller: new AbortController(), timer: null };
      if (pending.size >= QUEUE_CHAT_MAX_INFLIGHT) {
        emit(request, "error", { code: "BUSY" });
        return;
      }
      pending.set(nonce, request);
      request.timer = setTimeout(() => {
        finish(request, "error", { code: "TIMEOUT" });
        request.controller.abort();
      }, QUEUE_CHAT_TIMEOUT);
      const run = async () => {
        if (!client) client = await findNativeClient({ document: document2, origin, fetchText, importModule, signal: request.controller.signal });
        if (request.controller.signal.aborted || stopped) return;
        const response = await client.post("/chat/list", {
          // The live API's numeric created filter hides even recent messages.
          // Read the player's bounded history and enforce the 24h window locally.
          data: { steamid64_user: steamId2 },
          other: { limit: QUEUE_CHAT_LIMIT, name_type: true }
        }, { signal: request.controller.signal, timeout: QUEUE_CHAT_TIMEOUT });
        if (request.controller.signal.aborted || stopped) return;
        if (!(response.status >= 200 && response.status < 300)) {
          finish(request, "error", { code: response.status === 429 ? "RATE_LIMIT" : "UNAVAILABLE" });
          return;
        }
        const messages = normalizeQueueChatResponse(response.data, steamId2);
        finish(request, "result", { messages });
      };
      void run().catch((error) => {
        const status = error?.response?.status ?? error?._orig?.response?.status;
        finish(request, "error", { code: status === 429 ? "RATE_LIMIT" : error?.code === "INVALID_RESPONSE" ? "INVALID_RESPONSE" : "UNAVAILABLE" });
      });
    };
    const stop = () => {
      stopped = true;
      for (const request of [...pending.values()]) {
        finish(request);
        request.controller.abort();
      }
      window2.removeEventListener("message", listener);
      window2.removeEventListener("pagehide", stop);
      delete window2.__iohQueueChatBridgeV1;
    };
    window2.addEventListener("message", listener);
    window2.addEventListener("pagehide", stop);
    return stop;
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
      const { nonce, type, steamId: steamId2, range } = event.data;
      if (!/^[a-f0-9-]{16,64}$/.test(nonce || "")) return;
      if (type === "cancel") {
        if (active?.nonce === nonce) active.controller.abort();
        return;
      }
      if (type !== "roster" && (type !== "collect" || !parseSteamId(steamId2) || !validateRange(range))) return;
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
        const result = type === "roster" ? await collectNativeRoster(options) : await collectNativeProfile({ ...options, steamId: steamId2, range });
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
    const dependencies = {
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
    };
    installNativeObserver(dependencies);
    installNativeReadBridge(dependencies);
    installQueueChatBridge(dependencies);
  }
})();
//# sourceMappingURL=siteBridge.js.map
