(() => {
  // modules/shared/settings.js
  var DEFAULT_FEATURES = Object.freeze({
    highlightComplaintTriggers: true,
    highlightNewAccounts: true,
    highlightHighHs: true,
    highlightDuplicateServers: false,
    processTicketRules: true,
    translateText: true,
    showSteamAccountCreationDate: true,
    showCybershokePlaytime: true,
    showOffenderCountry: true,
    showFaceitElo: true,
    trackOffenderServer: true,
    showOffenderVipBadge: true,
    autoConnectServer: false,
    autoSelectCloseReason: false,
    scanSchedulePage: false,
    squareTickets: false
  });
  function mergeSettings(base = {}, overrides = {}) {
    const result = {
      newAccountHours: 7,
      headshotPercentage: 95,
      closeReasonEvidenceMinutes: 3,
      trackOffenderInterval: 5,
      trackOffenderIntervalWhileReviewing: 30,
      trackOpenTicketOfflineInterval: 5,
      reasonTriggers: [],
      reasonTriggersAutoconnect: [],
      autoConnectReasons: [],
      offenderVipStatuses: [],
      ...base,
      ...overrides,
      features: { ...DEFAULT_FEATURES, ...base.features, ...overrides.features }
    };
    delete result.features.autoPunishmentDuration;
    return result;
  }

  // modules/shared/moderators.js
  var record = (value) => value && typeof value === "object" && !Array.isArray(value);
  var steamId = (value) => /^\d{17}$/.test(value);
  function moderatorEntries(group) {
    if (!record(group)) return [];
    const entries = [];
    for (const [key, value] of Object.entries(group)) {
      if (steamId(key) && typeof value === "string") entries.push({ steamId: key, name: value, className: "" });
      else if (!steamId(key) && record(value)) for (const [id, name] of Object.entries(value)) {
        if (steamId(id) && typeof name === "string") entries.push({ steamId: id, name, className: key });
      }
    }
    return entries;
  }
  var flattenModeratorGroup = (group) => Object.fromEntries(moderatorEntries(group).map((m) => [m.steamId, m.name]));
  function validModeratorGroup(group) {
    if (!record(group)) return false;
    return Object.entries(group).every(([key, value]) => steamId(key) ? typeof value === "string" : key.length > 0 && key.length <= 100 && record(value) && Object.entries(value).every(([id, name]) => steamId(id) && typeof name === "string"));
  }

  // modules/ConfigService.js
  var ConfigService = class {
    static LOCAL_KEY = "helperConfig";
    static FETCHED_AT_KEY = "helperConfigFetchedAt";
    static META_KEY = "helperConfigMeta";
    static FETCH_TTL_MS = 60 * 60 * 1e3;
    static TIMEOUT_MS = 8e3;
    static DEFAULT_CONFIG_URL = "https://raw.githubusercontent.com/K4NT1K/IoHelper/refs/heads/main/config.json";
    static inflight = null;
    static supports(config, version) {
      if (!config.minimumExtensionVersion) return true;
      const required = String(config.minimumExtensionVersion).split(".").map(Number);
      const current = String(version).split(".").map(Number);
      for (let i = 0; i < Math.max(current.length, required.length); i++) {
        const diff = (current[i] || 0) - (required[i] || 0);
        if (diff) return diff > 0;
      }
      return true;
    }
    static isValid(config) {
      const record3 = (value) => value && typeof value === "object" && !Array.isArray(value);
      if (!record3(config) || !record3(config.settings) || !Array.isArray(config.muteRules)) return false;
      if (config.schemaVersion != null && config.schemaVersion !== 1) return false;
      if (config.minimumExtensionVersion != null && !/^\d+(?:\.\d+){0,3}$/.test(config.minimumExtensionVersion)) return false;
      if (config.settings.features != null && (!record3(config.settings.features) || Object.values(config.settings.features).some((v) => typeof v !== "boolean"))) return false;
      for (const key of ["reasonTriggers", "reasonTriggersAutoconnect", "autoConnectReasons", "offenderVipStatuses"]) {
        if (config.settings[key] != null && (!Array.isArray(config.settings[key]) || config.settings[key].some((v) => typeof v !== "string"))) return false;
      }
      for (const key of ["newAccountHours", "headshotPercentage", "trackOffenderInterval", "trackOffenderIntervalWhileReviewing", "trackOpenTicketOfflineInterval"]) {
        if (config.settings[key] != null && (typeof config.settings[key] !== "number" || !Number.isFinite(config.settings[key]) || config.settings[key] < 0)) return false;
      }
      if (config.muteRules.some((rule) => !record3(rule) || typeof rule.name !== "string" || !Array.isArray(rule.keywords) || rule.keywords.some((k) => typeof k !== "string") || ["severity", "duration", "priority"].some((k) => rule[k] != null && !Number.isFinite(rule[k])))) return false;
      if (config.muteExceptions != null && (!record3(config.muteExceptions) || Object.values(config.muteExceptions).some((v) => !Array.isArray(v) || v.some((x) => typeof x !== "string")))) return false;
      if (config.spamRules != null && (!record3(config.spamRules) || Object.values(config.spamRules).some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0))) return false;
      if (config.templates != null && (!record3(config.templates) || Object.values(config.templates).some((list2) => !Array.isArray(list2) || list2.some((item) => !record3(item) || typeof item.name !== "string" || typeof item.text !== "string")))) return false;
      return config.moderators == null || record3(config.moderators) && Object.values(config.moderators).every(validModeratorGroup);
    }
    static normalize(config) {
      return { ...config, settings: mergeSettings(config.settings) };
    }
    static async readJson(url) {
      const controller = new AbortController();
      let timer;
      try {
        return await Promise.race([
          (async () => {
            const response = await fetch(url, { cache: "no-cache", signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const config = await response.json();
            if (!this.isValid(config)) throw new Error("\u041D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 \u043A\u043E\u043D\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438");
            return config;
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("\u0422\u0430\u0439\u043C\u0430\u0443\u0442 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u043A\u043E\u043D\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438"));
            }, this.TIMEOUT_MS);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    static async load(chrome2, { force = false } = {}) {
      const stored = await chrome2.storage.local.get([this.LOCAL_KEY, this.FETCHED_AT_KEY, this.META_KEY]);
      const cached = stored[this.LOCAL_KEY];
      if (!force && this.isValid(cached) && Date.now() - (stored[this.META_KEY]?.checkedAt || stored[this.FETCHED_AT_KEY] || 0) < this.FETCH_TTL_MS) {
        if (!stored[this.META_KEY]) await chrome2.storage.local.set({ [this.META_KEY]: { source: "cache", revision: await this.revision(cached), checkedAt: stored[this.FETCHED_AT_KEY] } });
        return this.normalize(cached);
      }
      if (!this.inflight) this.inflight = this.refresh(chrome2, cached).finally(() => {
        this.inflight = null;
      });
      return this.inflight;
    }
    static async refresh(chrome2, cached) {
      try {
        const config = await this.readJson(this.DEFAULT_CONFIG_URL);
        if (!this.supports(config, chrome2.runtime.getManifest?.().version || "0")) throw new Error("\u0414\u043B\u044F \u043D\u043E\u0432\u043E\u0433\u043E \u043A\u043E\u043D\u0444\u0438\u0433\u0430 \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0434\u043E " + config.minimumExtensionVersion);
        const revision = await this.revision(config);
        const changed = !this.isValid(cached) || await this.revision(cached) !== revision;
        await chrome2.storage.local.set({
          ...changed ? { [this.LOCAL_KEY]: config } : {},
          [this.FETCHED_AT_KEY]: Date.now(),
          [this.META_KEY]: { source: "github", revision, checkedAt: Date.now(), error: null }
        });
        return this.normalize(config);
      } catch (error) {
        const previous = await chrome2.storage.local.get(this.META_KEY);
        await chrome2.storage.local.set({ [this.META_KEY]: { ...previous[this.META_KEY], checkedAt: Date.now(), error: error.message } });
        if (this.isValid(cached)) return this.normalize(cached);
      }
      const bundled = await this.readJson(chrome2.runtime.getURL("config.json"));
      await chrome2.storage.local.set({
        [this.LOCAL_KEY]: bundled,
        [this.META_KEY]: { source: "bundled", revision: await this.revision(bundled), checkedAt: Date.now(), error: "GitHub \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D; \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u0430\u044F \u043A\u043E\u043F\u0438\u044F" }
      });
      return this.normalize(bundled);
    }
    static async revision(config) {
      const bytes = new TextEncoder().encode(JSON.stringify(config));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hash)).slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
    }
    static async getForClient(chrome2) {
      try {
        const response = await chrome2.runtime.sendMessage({ action: "getHelperConfig" });
        if (response?.success && this.isValid(response.config)) return { ...this.normalize(response.config), iohRevision: response.revision };
      } catch {
      }
      const { helperConfig } = await chrome2.storage.local.get("helperConfig");
      if (this.isValid(helperConfig)) return this.normalize(helperConfig);
      return this.normalize(await this.readJson(chrome2.runtime.getURL("config.json")));
    }
  };

  // modules/Utils.js
  var Utils = class {
    constructor({ document: document2 }) {
      this.document = document2;
    }
    escapeHtml(text) {
      return String(text).replace(/[&<>"']/g, (match) => {
        const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
        return map[match];
      });
    }
    detectLanguage(text) {
      const russianRegex = /[а-яёА-ЯЁ]/;
      return russianRegex.test(text);
    }
    isMessageWithin24Hours(messageTimestampText) {
      if (!messageTimestampText) return true;
      try {
        const parts = messageTimestampText.trim().split(/\s+/);
        if (parts.length < 2) return true;
        const dateParts = parts[0].split(".");
        const timeParts = parts[1].split(":");
        if (dateParts.length === 3 && timeParts.length === 3) {
          const messageDate = new Date(
            parseInt(dateParts[2], 10),
            parseInt(dateParts[1], 10) - 1,
            parseInt(dateParts[0], 10),
            parseInt(timeParts[0], 10),
            parseInt(timeParts[1], 10),
            parseInt(timeParts[2], 10)
          );
          return (/* @__PURE__ */ new Date() - messageDate) / (1e3 * 60 * 60) <= 24;
        }
        return true;
      } catch (e) {
        return true;
      }
    }
    extractMainTextNode(messageCell) {
      for (const node of messageCell.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0) {
          return node;
        }
      }
      return null;
    }
    extractMessageText(messageCell) {
      const node = this.extractMainTextNode(messageCell);
      if (messageCell.classList.contains("ioh-translated") && node?.nodeValue === messageCell.dataset.translatedText) {
        return Array.from(messageCell.childNodes).map((child) => child === node ? messageCell.dataset.mhlprOriginalText : child.textContent).join("").trim();
      }
      return messageCell.textContent.trim();
    }
    formatDuration(minutes) {
      if (minutes >= 1440) {
        const days = Math.round(minutes / 1440);
        if (days === 1) return "1 \u0434\u0435\u043D\u044C";
        if (days >= 2 && days <= 4) return `${days} \u0434\u043D\u044F`;
        return `${days} \u0434\u043D\u0435\u0439`;
      }
      if (minutes >= 60) {
        const hours = Math.round(minutes / 60);
        if (hours === 1) return "1 \u0447\u0430\u0441";
        if (hours >= 2 && hours <= 4) return `${hours} \u0447\u0430\u0441\u0430`;
        return `${hours} \u0447\u0430\u0441\u043E\u0432`;
      }
      return `${minutes} \u043C\u0438\u043D.`;
    }
    parseDurationToMinutes(durationStr) {
      if (!durationStr) return 0;
      const text = durationStr.toLowerCase().trim();
      let total = 0;
      const unitRegex = /(\d+)\s*(день|дня|дней|д\.|час|часа|часов|ч\.|мин|минут|м\.)/gi;
      let match;
      while ((match = unitRegex.exec(text)) !== null) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        if (unit.startsWith("\u0434")) total += value * 24 * 60;
        else if (unit.startsWith("\u0447") || unit.startsWith("\u0447\u0430\u0441")) total += value * 60;
        else total += value;
      }
      if (total > 0) return total;
      return parseInt(text.match(/\d+/)?.[0] || 0, 10);
    }
    parseTimeToMs(timeStr) {
      if (!timeStr) return null;
      const parts = timeStr.trim().split(/\s+/);
      const timePart = parts.length > 1 ? parts[1] : parts[0];
      const t = timePart.split(":");
      if (t.length >= 2) {
        const d = /* @__PURE__ */ new Date();
        if (parts.length > 1 && parts[0].includes(".")) {
          const dp = parts[0].split(".");
          return new Date(parseInt(dp[2], 10), parseInt(dp[1], 10) - 1, parseInt(dp[0], 10), parseInt(t[0], 10), parseInt(t[1], 10), t[2] ? parseInt(t[2], 10) : 0).getTime();
        }
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), parseInt(t[0], 10), parseInt(t[1], 10), t[2] ? parseInt(t[2], 10) : 0).getTime();
      }
      return null;
    }
    containsTrigger(text, trigger, exceptions = []) {
      let sanitizedText = text;
      exceptions.forEach((ex) => {
        const escapedEx = ex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        sanitizedText = sanitizedText.replace(new RegExp(escapedEx, "giu"), "");
      });
      const escapedTrigger = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(escapedTrigger, "iu").test(sanitizedText);
    }
    extractTriggerWord(text, trigger, exceptions = []) {
      const triggerLower = String(trigger).toLowerCase();
      const words = String(text).match(/\S+/g);
      if (!words) {
        return trigger;
      }
      for (const word of words) {
        if (this.containsTrigger(word.toLowerCase(), triggerLower, exceptions)) {
          return word;
        }
      }
      return trigger;
    }
    parseComplaintCell(container) {
      if (!container) {
        return { category: "", playerText: "" };
      }
      const wrapper = container.querySelector(":scope > div") || container;
      const categoryEl = wrapper.querySelector(":scope > div");
      const playerEl = wrapper.querySelector(":scope > span");
      if (categoryEl) {
        return {
          category: categoryEl.textContent?.trim() || "",
          playerText: playerEl?.textContent?.trim() || ""
        };
      }
      const directSpan = wrapper.querySelector(":scope > span");
      if (directSpan) {
        return {
          category: directSpan.textContent?.trim() || "",
          playerText: ""
        };
      }
      return { category: "", playerText: "" };
    }
    formatLastConnectStatus(lastconnectUnix) {
      if (lastconnectUnix == null || lastconnectUnix === "") {
        return "\u041D\u0435 \u0432 \u0438\u0433\u0440\u0435";
      }
      const seconds = Number(lastconnectUnix);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return "\u041D\u0435 \u0432 \u0438\u0433\u0440\u0435";
      }
      const diffMs = Date.now() - seconds * 1e3;
      if (diffMs < 60 * 1e3) {
        return "\u0412 \u0438\u0433\u0440\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E";
      }
      const diffMin = Math.floor(diffMs / (60 * 1e3));
      if (diffMin < 60) {
        return `\u0412 \u0438\u0433\u0440\u0435 ${diffMin} \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434`;
      }
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) {
        if (diffHours === 1) {
          return "\u0412 \u0438\u0433\u0440\u0435 1 \u0447 \u043D\u0430\u0437\u0430\u0434";
        }
        if (diffHours >= 2 && diffHours <= 4) {
          return `\u0412 \u0438\u0433\u0440\u0435 ${diffHours} \u0447 \u043D\u0430\u0437\u0430\u0434`;
        }
        return `\u0412 \u0438\u0433\u0440\u0435 ${diffHours} \u0447 \u043D\u0430\u0437\u0430\u0434`;
      }
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) {
        return "\u0412 \u0438\u0433\u0440\u0435 1 \u0434\u043D \u043D\u0430\u0437\u0430\u0434";
      }
      if (diffDays >= 2 && diffDays <= 4) {
        return `\u0412 \u0438\u0433\u0440\u0435 ${diffDays} \u0434\u043D \u043D\u0430\u0437\u0430\u0434`;
      }
      return `\u0412 \u0438\u0433\u0440\u0435 ${diffDays} \u0434\u043D \u043D\u0430\u0437\u0430\u0434`;
    }
  };

  // modules/shared/dom.js
  function markIoh(el) {
    if (el && el.nodeType === 1) {
      el.setAttribute("data-ioh", "1");
    }
    return el;
  }
  function isIohNode(node) {
    if (!node) {
      return false;
    }
    if (node.nodeType === 1) {
      return Boolean(node.closest?.("[data-ioh]"));
    }
    return Boolean(node.parentElement?.closest?.("[data-ioh]"));
  }
  function scheduleIdle(fn) {
    if (typeof requestIdleCallback === "function") {
      return requestIdleCallback(() => fn(), { timeout: 200 });
    }
    return setTimeout(fn, 0);
  }

  // modules/BadgeService.js
  var BadgeService = class {
    constructor({ document: document2 }) {
      this.document = document2;
      this.translateCache = /* @__PURE__ */ new Map();
      this.translateInflight = /* @__PURE__ */ new Map();
      this.builtInTranslators = /* @__PURE__ */ new Map();
      this.languageDetectorPromise = null;
    }
    updateInfoBadge(elementId, variant, innerHTML, targetTextarea) {
      let badge = this.document.getElementById(elementId);
      if (!badge) {
        badge = this.document.createElement("div");
        badge.id = elementId;
        markIoh(badge);
      }
      if (targetTextarea?.parentNode && badge.parentNode !== targetTextarea.parentNode) {
        targetTextarea.parentNode.insertBefore(badge, targetTextarea);
      } else if (!badge.parentNode && targetTextarea?.parentNode) {
        targetTextarea.parentNode.insertBefore(badge, targetTextarea);
      }
      const nextClass = `ioh-info-badge ioh-info-badge--${variant}`;
      if (badge.className === nextClass && badge.innerHTML === innerHTML) {
        this.wireOverflowTooltips(badge);
        return;
      }
      this.hideTriggerTooltip();
      this.document.querySelectorAll("body > .ioh-punishment-preview-tooltip__panel").forEach((panel) => {
        panel.remove();
      });
      badge.className = nextClass;
      badge.innerHTML = innerHTML;
      this.wireOverflowTooltips(badge);
    }
    wireOverflowTooltips(root) {
      if (!root) {
        return;
      }
      this.wireTriggerTooltips(root);
      root.querySelectorAll(".ioh-punishment-preview-tooltip").forEach((host) => {
        const panel = host.querySelector(":scope > .ioh-punishment-preview-tooltip__panel");
        if (!panel || host.dataset.iohTipBound === "1") {
          return;
        }
        host.dataset.iohTipBound = "1";
        const placePanel = () => {
          const rect = host.getBoundingClientRect();
          const gap = 10;
          const maxWidth = Math.min(720, window.innerWidth - 16);
          panel.style.position = "fixed";
          panel.style.zIndex = "2147483646";
          panel.style.width = "max-content";
          panel.style.maxWidth = `${maxWidth}px`;
          panel.style.transform = "none";
          panel.style.pointerEvents = "none";
          let left = Math.max(8, rect.left);
          panel.style.left = `${left}px`;
          panel.style.right = "auto";
          panel.style.top = "auto";
          panel.style.bottom = `${Math.max(8, window.innerHeight - rect.top + gap)}px`;
          if (panel.parentElement !== this.document.body) {
            this.document.body.appendChild(panel);
          }
          const panelRect = panel.getBoundingClientRect();
          if (panelRect.right > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - 8 - panelRect.width);
            panel.style.left = `${left}px`;
          }
          if (panelRect.top < 8) {
            panel.style.bottom = "auto";
            panel.style.top = `${Math.min(window.innerHeight - panelRect.height - 8, rect.bottom + gap)}px`;
          }
          panel.classList.add("ioh-punishment-preview-tooltip__panel--open");
        };
        const hidePanel = () => {
          panel.classList.remove("ioh-punishment-preview-tooltip__panel--open");
          panel.style.pointerEvents = "none";
          if (panel.parentElement === this.document.body) {
            host.appendChild(panel);
          }
        };
        host.addEventListener("mouseenter", placePanel);
        host.addEventListener("focus", placePanel);
        host.addEventListener("mouseleave", hidePanel);
        host.addEventListener("blur", hidePanel);
      });
    }
    hideTriggerTooltip() {
      this._triggerTooltipCleanup?.();
      this._triggerTooltipCleanup = null;
    }
    wireTriggerTooltips(root) {
      if (!root.addEventListener) return;
      this._triggerTooltipRoots ||= /* @__PURE__ */ new WeakSet();
      if (this._triggerTooltipRoots.has(root)) return;
      this._triggerTooltipRoots.add(root);
      const selector = ".ioh-trigger-tooltip[data-full-msg]:not(.ioh-more-triggers)";
      const show = (event) => {
        const host = event.target.closest?.(selector);
        if (!host || !root.contains(host) || host.contains(event.relatedTarget)) return;
        this.hideTriggerTooltip();
        const panel = this.document.createElement("div");
        markIoh(panel);
        panel.className = "ioh-trigger-tooltip__panel";
        panel.setAttribute("role", "tooltip");
        panel.textContent = host.dataset.fullMsg;
        const view = this.document.defaultView;
        const margin = 8, gap = 10;
        panel.style.maxWidth = `${Math.max(1, Math.min(280, view.innerWidth - margin * 2))}px`;
        panel.style.maxHeight = `${Math.max(1, view.innerHeight - margin * 2)}px`;
        this.document.body.appendChild(panel);
        const rect = host.getBoundingClientRect(), size = panel.getBoundingClientRect();
        panel.style.left = `${Math.max(margin, Math.min(
          rect.left + rect.width / 2 - size.width / 2,
          view.innerWidth - size.width - margin
        ))}px`;
        const above = rect.top - size.height - gap;
        panel.style.top = `${Math.max(margin, above >= margin ? above : Math.min(rect.bottom + gap, view.innerHeight - size.height - margin))}px`;
        const hide2 = () => this.hideTriggerTooltip();
        view.addEventListener("scroll", hide2, true);
        view.addEventListener("resize", hide2);
        this._triggerTooltipCleanup = () => {
          panel.remove();
          view.removeEventListener("scroll", hide2, true);
          view.removeEventListener("resize", hide2);
        };
      };
      const hide = (event) => {
        const host = event.target.closest?.(selector);
        if (host && !host.contains(event.relatedTarget)) this.hideTriggerTooltip();
      };
      root.addEventListener("mouseover", show);
      root.addEventListener("focusin", show);
      root.addEventListener("mouseout", hide);
      root.addEventListener("focusout", hide);
    }
    async detectSourceLanguage(text) {
      if (!("LanguageDetector" in self)) {
        return "en";
      }
      try {
        if (!this.languageDetectorPromise) {
          this.languageDetectorPromise = LanguageDetector.create();
        }
        const detector = await this.languageDetectorPromise;
        const detections = await detector.detect(text);
        const best = detections?.[0]?.detectedLanguage;
        if (best && best !== "und") {
          return best;
        }
      } catch {
        this.languageDetectorPromise = null;
      }
      return "en";
    }
    async translateWithBuiltIn(text, targetLang) {
      if (!("Translator" in self)) {
        return null;
      }
      try {
        const sourceLanguage = await this.detectSourceLanguage(text);
        if (sourceLanguage === targetLang) {
          return text;
        }
        const pairKey = `${sourceLanguage}->${targetLang}`;
        let translator = this.builtInTranslators.get(pairKey);
        if (!translator) {
          const options = { sourceLanguage, targetLanguage: targetLang };
          const availability = await Translator.availability(options);
          if (availability === "unavailable") {
            return null;
          }
          translator = await Translator.create({
            ...options,
            monitor(m) {
              m.addEventListener("downloadprogress", () => {
              });
            }
          });
          this.builtInTranslators.set(pairKey, translator);
        }
        const translated = await translator.translate(text);
        return translated || null;
      } catch (err) {
        console.log("Built-in translator unavailable: ", err?.message || err);
        return null;
      }
    }
    async translateViaBackground(text, targetLang) {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            {
              action: "translateText",
              text,
              targetLang
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.log("Translate api error: ", chrome.runtime.lastError);
                resolve(null);
                return;
              }
              if (!(response && response.success && response.translated)) {
                console.log("Translate api error: ", response?.error || "empty translate response");
                resolve(null);
                return;
              }
              resolve(response.translated);
            }
          );
        } catch (err) {
          console.log("Translate api error: ", err);
          resolve(null);
        }
      });
    }
    async translateText(text, targetLang = "RU") {
      const normalizedText = String(text || "").trim();
      if (!normalizedText) {
        return null;
      }
      const lang = String(targetLang || "RU").toLowerCase();
      const cacheKey = `${lang}::${normalizedText}`;
      if (this.translateCache.has(cacheKey)) {
        return { translated: this.translateCache.get(cacheKey) };
      }
      if (this.translateInflight.has(cacheKey)) {
        return this.translateInflight.get(cacheKey);
      }
      const requestPromise = (async () => {
        let translated = await this.translateWithBuiltIn(normalizedText, lang);
        if (!translated) {
          translated = await this.translateViaBackground(normalizedText, lang);
        }
        if (!translated) {
          return null;
        }
        this.translateCache.set(cacheKey, translated);
        return { translated };
      })().finally(() => {
        this.translateInflight.delete(cacheKey);
      });
      this.translateInflight.set(cacheKey, requestPromise);
      return requestPromise;
    }
  };

  // modules/PanelService.js
  var PanelService = class {
    constructor({ document: document2 }) {
      this.document = document2;
    }
    buildCommentText(name, clickCount, defaultText) {
      if (clickCount === 1) {
        return defaultText;
      }
      if (clickCount >= 2) {
        const action = ["\u041F\u0440\u0435\u043F\u044F\u0442\u0441\u0442\u0432\u0438\u0435", "\u041D\u0438\u043A"].includes(name) ? "\u0411\u0430\u043D" : "\u041C\u0443\u0442";
        return defaultText.replace("\u041F\u0440\u0435\u0434", action);
      }
      return defaultText;
    }
    readTrackedMessages(target) {
      try {
        return JSON.parse(target.dataset.iohTrackedMessages || "{}");
      } catch (error) {
        return {};
      }
    }
    writeTrackedMessages(target, trackedMessages) {
      target.dataset.iohTrackedMessages = JSON.stringify(trackedMessages);
    }
    removeTrackedMessage(textValue, messageToRemove, { inline = false } = {}) {
      if (!messageToRemove) {
        return textValue;
      }
      if (inline) {
        let result = textValue;
        const candidates = [
          `. ${messageToRemove}`,
          ` ${messageToRemove}`,
          messageToRemove
        ];
        for (const candidate of candidates) {
          const index = result.lastIndexOf(candidate);
          if (index !== -1) {
            result = `${result.slice(0, index)}${result.slice(index + candidate.length)}`;
            break;
          }
        }
        return result.replace(/\s{2,}/g, " ").replace(/\s+\./g, ".").trim();
      }
      const lines = textValue.split("\n");
      const lineIndex = lines.lastIndexOf(messageToRemove);
      if (lineIndex === -1) {
        return textValue;
      }
      lines.splice(lineIndex, 1);
      return lines.join("\n");
    }
    normalizeTextareaValue(textValue, { inline = false } = {}) {
      if (inline) {
        return String(textValue || "").replace(/\s+/g, " ").trim();
      }
      return textValue.split("\n").map((line) => line.trimEnd()).filter((line, index, lines) => line.length > 0 || index > 0 && index < lines.length - 1).join("\n").trim();
    }
    applyTrackedMessage(target, messageKey2, nextMessage, { inline = false } = {}) {
      const trackedMessages = this.readTrackedMessages(target);
      const previousMessage = trackedMessages[messageKey2];
      let nextValue = this.removeTrackedMessage(target.value, previousMessage, { inline });
      if (nextMessage) {
        const trimmedValue = nextValue.trim();
        if (inline) {
          nextValue = trimmedValue ? `${trimmedValue}. ${nextMessage}` : nextMessage;
        } else {
          nextValue = trimmedValue ? `${trimmedValue}
${nextMessage}` : nextMessage;
        }
        trackedMessages[messageKey2] = nextMessage;
      } else {
        delete trackedMessages[messageKey2];
      }
      target.value = this.normalizeTextareaValue(nextValue, { inline });
      this.writeTrackedMessages(target, trackedMessages);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }
    createPanel(templates, target, panelId) {
      if (typeof templates === "undefined" || templates === null) {
        return this.document.createElement("div");
      }
      const panel = this.document.createElement("div");
      panel.id = panelId;
      panel.className = "ioh-panel";
      markIoh(panel);
      const inline = panelId === "mod-notif-panel";
      const ticket = panelId === "mod-ticket-panel";
      const entries = this.normalizeTemplateEntries(templates);
      if (ticket) {
        for (let i = entries.length - 1; i >= 0; i--) if (entries[i][0] === "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C") entries.splice(i, 1);
        entries.unshift(["\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C", "\u041C\u0443\u0442 \u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C"]);
      }
      entries.forEach(([name, text]) => {
        const btn = this.document.createElement("button");
        btn.type = "button";
        markIoh(btn);
        btn.className = "ioh-panel-btn";
        const icon = this.document.createElement("span");
        markIoh(icon);
        icon.className = "ioh-panel-btn-icon";
        icon.setAttribute("aria-hidden", "true");
        const label = this.document.createElement("span");
        markIoh(label);
        label.innerText = name;
        btn.append(icon, label);
        let clickCount = 0;
        let clickTimer = null;
        btn.onclick = (e) => {
          e.preventDefault();
          if (ticket && name === "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C") {
            this.applyTrackedMessage(target, `${panelId}:${name}`, "\u041C\u0443\u0442 \u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C", { inline });
            return;
          }
          clickCount++;
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            if (panel.isConnected === false || target.isConnected === false) return;
            const comment = this.buildCommentText(name, clickCount, text);
            this.applyTrackedMessage(target, `${panelId}:${name}`, comment, { inline });
            clickCount = 0;
          }, 250);
        };
        panel.appendChild(btn);
      });
      return panel;
    }
    normalizeTemplateEntries(templates) {
      if (Array.isArray(templates)) {
        return templates.map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const name = item.name ?? item.label;
          const text = item.text ?? item.value;
          if (!name || text == null) {
            return null;
          }
          return [String(name), String(text)];
        }).filter(Boolean);
      }
      if (typeof templates === "object") {
        const preferredOrder = [
          "\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435",
          "\u041E\u0441\u043A",
          "\u041F\u0440\u043E\u0432\u043E\u043A\u0430\u0446\u0438\u044F",
          "\u041E\u0431\u0445\u043E\u0434",
          "\u041F\u0440\u0435\u043F\u044F\u0442\u0441\u0442\u0432\u0438\u0435",
          "\u041C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433",
          "\u041D\u0438\u043A",
          "\u0420\u0430\u0441\u0438\u0437\u043C",
          "\u0421\u043F\u0430\u043C"
        ];
        const entries = [];
        const used = /* @__PURE__ */ new Set();
        for (const name of preferredOrder) {
          if (Object.prototype.hasOwnProperty.call(templates, name)) {
            entries.push([name, templates[name]]);
            used.add(name);
          }
        }
        for (const [name, text] of Object.entries(templates)) {
          if (!used.has(name)) {
            entries.push([name, text]);
          }
        }
        return entries;
      }
      return [];
    }
  };

  // modules/MessageService.js
  var MessageService = class _MessageService {
    static CYBERSHOKE_HOURS_RE = /CYBERSHOKE:\s*(\d+)ч/i;
    static DUPLICATE_SERVER_COLOR_COUNT = 7;
    constructor({ document: document2, utils, badgeService, settings }) {
      this.document = document2;
      this.utils = utils;
      this.badgeService = badgeService;
      this.settings = settings;
      this.ticketService = null;
      this.hoursWatchObservers = /* @__PURE__ */ new WeakMap();
      this.HOURS_WATCH_TTL_MS = 3e4;
      this.translationBindings = /* @__PURE__ */ new Map();
    }
    decorateMessageCell(messageCell, originalText = null, nativeContext = null) {
      if (this.ticketService?.nativeData && originalText == null) return;
      const previous = this.translationBindings.get(messageCell);
      const sourceMatches = !nativeContext || previous?.nativeId === nativeContext.id && previous.source === originalText && previous.scope === nativeContext.scope && previous.ticketKey === nativeContext.ticketKey && previous.steamId === nativeContext.steamId;
      const reuseTranslated = sourceMatches && previous?.applied && previous.node?.nodeValue === previous.translated && messageCell.contains(previous.node);
      let textNode = reuseTranslated ? previous.node : this.utils.extractMainTextNode(messageCell);
      if (nativeContext && !reuseTranslated && textNode?.nodeValue.trim() !== originalText.trim()) textNode = null;
      if (nativeContext && !textNode) {
        const walker = this.document.createTreeWalker?.(messageCell, 4);
        while (walker) {
          const candidate = walker.nextNode();
          if (!candidate) break;
          if (candidate.nodeValue.trim() === originalText.trim()) {
            textNode = candidate;
            break;
          }
        }
      }
      if (!textNode) {
        if (previous) this.releaseTranslation(messageCell, previous);
        return;
      }
      if (sourceMatches && previous?.node === textNode && (textNode.nodeValue === previous.original || previous.applied && textNode.nodeValue === previous.translated)) return;
      if (previous) this.releaseTranslation(messageCell, previous);
      const source = originalText ?? textNode.nodeValue;
      if (this.utils.detectLanguage(source) || !new RegExp("\\p{L}", "u").test(source)) return;
      const binding = {
        node: textNode,
        original: textNode.nodeValue,
        source,
        translated: null,
        applied: false,
        pending: false,
        nativeId: nativeContext?.id,
        scope: nativeContext?.scope,
        ticketKey: nativeContext?.ticketKey,
        steamId: nativeContext?.steamId
      };
      this.translationBindings.set(messageCell, binding);
      messageCell.dataset.mhlprHoverReady = "true";
      messageCell.dataset.mhlprOriginalText = binding.original;
      messageCell.classList.add("ioh-chat-message");
      const identityCurrent = () => !nativeContext || this.ticketService.getNativeTicket(nativeContext.scope)?.key === nativeContext.ticketKey && this.ticketService.getNativeTicket(nativeContext.scope)?.suspectId === nativeContext.steamId && this.ticketService.nativeData.history(nativeContext.steamId, "chats")?.items.some((m) => m.id === nativeContext.id && m.text === source);
      const current = () => this.translationBindings.get(messageCell) === binding && messageCell.isConnected && messageCell.contains(textNode) && this.settings.features?.translateText !== false && identityCurrent();
      binding.enter = async () => {
        if (textNode.nodeValue !== binding.original && !(binding.applied && textNode.nodeValue === binding.translated)) {
          if (nativeContext) {
            this.releaseTranslation(messageCell, binding);
            return;
          }
          this.decorateMessageCell(messageCell);
          return this.translationBindings.get(messageCell)?.enter();
        }
        if (binding.pending || !current()) return;
        try {
          if (!binding.translated) {
            binding.pending = true;
            messageCell.classList.add("ioh-loading");
            const result = await this.badgeService.translateText(binding.source, "RU");
            if (!current() || textNode.nodeValue !== binding.original) return;
            binding.translated = result?.translated || null;
          }
          if (!current() || !messageCell.matches(":hover") || !binding.translated) return;
          textNode.nodeValue = binding.translated;
          messageCell.dataset.translatedText = binding.translated;
          binding.applied = true;
          messageCell.classList.add("ioh-translated");
        } catch {
        } finally {
          binding.pending = false;
          if (this.translationBindings.get(messageCell) === binding) messageCell.classList.remove("ioh-loading");
        }
      };
      binding.leave = () => {
        if (binding.applied && textNode.nodeValue === binding.translated && identityCurrent()) textNode.nodeValue = binding.original;
        binding.applied = false;
        messageCell.classList.remove("ioh-translated");
      };
      messageCell.addEventListener("mouseenter", binding.enter);
      messageCell.addEventListener("mouseleave", binding.leave);
    }
    releaseTranslation(cell, binding) {
      binding.leave();
      cell.removeEventListener("mouseenter", binding.enter);
      cell.removeEventListener("mouseleave", binding.leave);
      cell.classList.remove("ioh-chat-message", "ioh-loading", "ioh-translated");
      for (const key of ["mhlprHoverReady", "mhlprOriginalText", "translatedText", "isTranslating"]) delete cell.dataset[key];
      this.translationBindings.delete(cell);
    }
    _findChatHistoryBlock() {
      for (const header of this.document.querySelectorAll("h3, h2")) {
        const text = header.textContent || "";
        if (text.includes("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430") && !text.includes("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0422\u0438\u043A\u0435\u0442\u043E\u0432")) {
          const block = header.closest('section, article, [role="tabpanel"], .card') || header.parentElement;
          if (block) {
            return block;
          }
        }
      }
      return null;
    }
    _isComplaintQueuePage() {
      const href = window.location.href;
      return href.includes("/support/tickets") || href.includes("/support/reports");
    }
    _getComplaintQueueRows() {
      if (!this._isComplaintQueuePage()) {
        return [];
      }
      return this.document.querySelectorAll("table tbody tr");
    }
    processChatMessages() {
      for (const [cell, binding] of this.translationBindings) {
        if (!cell.isConnected) this.releaseTranslation(cell, binding);
      }
      if (this.ticketService?.nativeData) {
        for (const textarea of this.document.querySelectorAll('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]')) {
          const scope2 = this.ticketService.getTicketScopeRoot(textarea);
          const t = this.ticketService.getNativeTicket(scope2);
          if (!t) continue;
          const messages = this.ticketService.nativeData.history(t.suspectId, "chats")?.items || [];
          for (const [id, row] of this.ticketService.bindNativeMessageRows(scope2)) {
            const message = messages.find((m) => m.id === id), cell = row.querySelector("td:last-child");
            if (cell && message) this.decorateNativeMessageCell(cell, message, scope2);
          }
        }
        return;
      }
      const scope = this.document.body;
      const chatHistoryBlock = this.ticketService?.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scope) || this.ticketService?.getHistorySectionCard("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scope) || this._findChatHistoryBlock();
      if (!chatHistoryBlock) return;
      const rows = Array.from(chatHistoryBlock.querySelectorAll("tbody tr, tr")).filter((row) => row.querySelector("td"));
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) this.decorateMessageCell(cells[cells.length - 1]);
      });
    }
    decorateNativeMessageCell(cell, message, scope) {
      const ticket = this.ticketService.getNativeTicket(scope);
      if (!ticket) return;
      this.decorateMessageCell(cell, message.text, { id: message.id, scope, ticketKey: ticket.key, steamId: ticket.suspectId });
    }
    highlightComplaintTriggers(targetRow) {
      if (this.ticketService?.nativeData) {
        for (const row of targetRow ? [targetRow] : this._getComplaintQueueRows()) {
          const t = this.ticketService.getNativeRowTicket(row);
          if (!t || t.message == null) continue;
          const cell = row.querySelectorAll("td")[5];
          const node = [...cell?.querySelectorAll("span") || []].find((n) => n.textContent === t.message);
          if (!node || node.dataset.iohNativeMessage === t.message) continue;
          node.dataset.iohNativeMessage = t.message;
          const triggers = (this.settings.reasonTriggers || []).filter(Boolean).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          if (!triggers.length) continue;
          const regex = new RegExp(triggers.join("|"), "gi");
          const fragment = this.document.createDocumentFragment();
          let pos = 0;
          for (const match of t.message.matchAll(regex)) {
            fragment.append(this.document.createTextNode(t.message.slice(pos, match.index)));
            const span = this.document.createElement("span");
            markIoh(span);
            span.className = "ioh-complaint-trigger";
            span.textContent = match[0];
            fragment.append(span);
            pos = match.index + match[0].length;
          }
          fragment.append(this.document.createTextNode(t.message.slice(pos)));
          node.replaceChildren(fragment);
        }
        return;
      }
      const rows = targetRow ? [targetRow] : this._getComplaintQueueRows();
      rows.forEach((row) => {
        if (row.querySelector("th") || row.dataset.triggersChecked) return;
        const cells = row.querySelectorAll("td");
        const reportCell = cells[5];
        if (!reportCell) return;
        const { playerText } = this.utils.parseComplaintCell(reportCell);
        const playerEl = reportCell.querySelector(":scope > div > span") || reportCell.querySelector("span");
        if (!playerEl || !playerText) {
          return;
        }
        let html = playerEl.innerHTML;
        let changed = false;
        this.settings.reasonTriggers.forEach((trigger) => {
          if (!trigger) return;
          const escapedTrigger = trigger.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
          const regex = new RegExp(`(${escapedTrigger})`, "gi");
          if (regex.test(html)) {
            html = html.replace(regex, '<span class="ioh-complaint-trigger" data-ioh="1">$1</span>');
            changed = true;
          }
        });
        if (changed) {
          playerEl.innerHTML = html;
        }
        row.dataset.triggersChecked = "true";
      });
    }
    clearComplaintTriggerHighlights() {
      this.document.querySelectorAll("[data-ioh-native-message]").forEach((n) => delete n.dataset.iohNativeMessage);
      this.document.querySelectorAll(".ioh-complaint-trigger").forEach((span) => {
        span.replaceWith(this.document.createTextNode(span.textContent || ""));
      });
      this.document.querySelectorAll("tr[data-triggers-checked]").forEach((row) => {
        delete row.dataset.triggersChecked;
      });
    }
    releaseHoursWatch(row) {
      const entry = this.hoursWatchObservers.get(row);
      if (!entry) {
        return;
      }
      entry.observer.disconnect();
      clearTimeout(entry.timeoutId);
      this.hoursWatchObservers.delete(row);
    }
    releaseAllHoursWatches() {
      if (this.hoursWatchObservers.size) {
        console.log(`[Helper] MessageService: hoursWatch observers teardown (${this.hoursWatchObservers.size})`);
      }
      this.document.querySelectorAll("table tbody tr").forEach((row) => this.releaseHoursWatch(row));
    }
    ensureHoursWatch(row) {
      if (!row?.closest?.("tbody") || this.hoursWatchObservers.has(row)) {
        return;
      }
      const observer = new MutationObserver(() => {
        if (!_MessageService.CYBERSHOKE_HOURS_RE.test(row.innerText || "")) {
          return;
        }
        this.releaseHoursWatch(row);
        this.highlightNewAccounts(row);
      });
      const timeoutId = setTimeout(() => this.releaseHoursWatch(row), this.HOURS_WATCH_TTL_MS);
      this.hoursWatchObservers.set(row, { observer, timeoutId });
      observer.observe(row, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
    _clearRowHoursState(row) {
      delete row.dataset.iohNewAccountHours;
    }
    _setRowHoursState(row, hours) {
      row.dataset.iohNewAccountHours = String(hours);
    }
    _clearRowHoursHighlight(row) {
      row.querySelectorAll(".ioh-new-account-hours").forEach((span) => {
        span.classList.remove("ioh-new-account-hours");
      });
      this._clearRowHoursState(row);
    }
    _markHoursHighlight(span) {
      if (span.classList.contains("ioh-new-account-hours")) {
        return;
      }
      span.classList.add("ioh-new-account-hours");
      markIoh(span);
    }
    _applyRowHoursHighlight(row) {
      row.querySelectorAll("div").forEach((div) => {
        if (!div.innerText.includes("CYBERSHOKE:")) {
          return;
        }
        const existingSpan = div.querySelector(".cs-hours-span");
        if (existingSpan) {
          this._markHoursHighlight(existingSpan);
          return;
        }
        const html = div.innerHTML;
        const newHtml = html.replace(/(CYBERSHOKE:\s*)(\d+ч)/i, (fullMatch, prefix, hoursText) => {
          if (fullMatch.includes("ioh-new-account-hours")) {
            return fullMatch;
          }
          return `${prefix}<span class="cs-hours-span ioh-new-account-hours" data-ioh="1">${hoursText}</span>`;
        });
        if (newHtml !== html) {
          div.innerHTML = newHtml;
        }
      });
    }
    highlightNewAccounts(row) {
      if (this.ticketService?.nativeData) {
        const t = this.ticketService.getNativeRowTicket(row);
        if (!t || t.playtime == null) return;
        this.releaseHoursWatch(row);
        const hours2 = Math.round(t.playtime / 3600);
        if (hours2 > this.settings.newAccountHours) this._clearRowHoursHighlight(row);
        else {
          this._setRowHoursState(row, hours2);
          this._applyRowHoursHighlight(row);
        }
        return;
      }
      if (!row?.querySelector) {
        return;
      }
      const match = (row.innerText || "").match(_MessageService.CYBERSHOKE_HOURS_RE);
      if (!match) {
        this.ensureHoursWatch(row);
        return;
      }
      this.releaseHoursWatch(row);
      const hours = parseInt(match[1], 10);
      if (hours > this.settings.newAccountHours) {
        this._clearRowHoursHighlight(row);
        return;
      }
      this._setRowHoursState(row, hours);
      this._applyRowHoursHighlight(row);
    }
    syncNewAccountHighlights() {
      const apply = () => {
        this._getComplaintQueueRows().forEach((row) => this.highlightNewAccounts(row));
      };
      apply();
      requestAnimationFrame(apply);
      setTimeout(apply, 150);
    }
    clearNewAccountHighlights() {
      this.document.querySelectorAll(".ioh-new-account-hours").forEach((span) => {
        span.classList.remove("ioh-new-account-hours");
      });
      this.document.querySelectorAll("tr[data-ioh-new-account-hours]").forEach((row) => {
        delete row.dataset.iohNewAccountHours;
      });
      this.releaseAllHoursWatches();
    }
    reapplyNewAccountHighlights() {
      this.clearNewAccountHighlights();
      if (this._isComplaintQueuePage()) {
        this.syncNewAccountHighlights();
        return;
      }
      this.document.querySelectorAll("table tbody tr").forEach((row) => {
        this.highlightNewAccounts(row);
      });
    }
    highlightHighHs(row) {
      if (!row?.querySelectorAll) return;
      if (this.ticketService?.nativeData) {
        const t = this.ticketService.getNativeRowTicket(row);
        const serverCell2 = row.querySelector('a[href^="steam://connect/"]')?.closest("td") || row.querySelectorAll("td")[1];
        const isHeadshotsOnly2 = /HSDM/i.test([t?.mode, t?.category, serverCell2?.textContent].filter(Boolean).join(" "));
        const hs = t?.kills > 0 && t.headshots != null ? Math.round(t.headshots / t.kills * 100) : NaN;
        const configured2 = this.settings.headshotPercentage;
        const threshold2 = configured2 !== null && configured2 !== "" && Number.isFinite(Number(configured2)) ? Math.min(100, Math.max(0, Number(configured2))) : 95;
        row.querySelectorAll("span").forEach((span) => {
          const highlight = /^\s*HS:/.test(span.textContent || "") && !isHeadshotsOnly2 && hs >= threshold2 && hs <= 100;
          if (span.classList.contains("ioh-high-hs") !== highlight) span.classList.toggle("ioh-high-hs", highlight);
        });
        return;
      }
      const serverCell = row.querySelector('a[href^="steam://connect/"]')?.closest("td") || row.querySelectorAll("td")[1];
      const isHeadshotsOnly = /HSDM/i.test(serverCell?.textContent || "");
      const configured = this.settings.headshotPercentage;
      const threshold = configured !== null && configured !== "" && Number.isFinite(Number(configured)) ? Math.min(100, Math.max(0, Number(configured))) : 95;
      row.querySelectorAll("span").forEach((span) => {
        const match = (span.textContent || "").match(/^\s*HS:\s*(\d+(?:[.,]\d+)?)\s*%\s*$/i);
        const value = match ? Number(match[1].replace(",", ".")) : NaN;
        const highlight = !isHeadshotsOnly && value >= threshold && value <= 100;
        if (span.classList.contains("ioh-high-hs") !== highlight) {
          span.classList.toggle("ioh-high-hs", highlight);
        }
      });
    }
    clearHighHsHighlights() {
      this.document.querySelectorAll(".ioh-high-hs").forEach((span) => {
        span.classList.remove("ioh-high-hs");
      });
    }
    highlightDuplicateServerIps() {
      this.clearDuplicateServerHighlights();
      const serverMap = /* @__PURE__ */ new Map();
      this.document.querySelectorAll("table tbody tr").forEach((row) => {
        if (row.querySelector("th")) {
          return;
        }
        const serverLink = row.querySelector('a[href^="steam://connect/"]');
        if (!serverLink) {
          return;
        }
        const serverIp = serverLink.textContent.trim();
        if (!serverIp) {
          return;
        }
        if (!serverMap.has(serverIp)) {
          serverMap.set(serverIp, []);
        }
        serverMap.get(serverIp).push(row);
      });
      let colorIndex = 0;
      for (const rows of serverMap.values()) {
        if (rows.length < 2) {
          continue;
        }
        const dupColor = String(colorIndex % _MessageService.DUPLICATE_SERVER_COLOR_COUNT);
        colorIndex += 1;
        rows.forEach((row) => {
          row.classList.add("ioh-duplicate-server");
          row.dataset.iohDupColor = dupColor;
          row.dataset.duplicateServerChecked = "true";
        });
      }
    }
    clearDuplicateServerHighlights() {
      this.document.querySelectorAll(".ioh-duplicate-server, tr[data-duplicate-server-checked], tr[data-ioh-dup-color]").forEach((row) => {
        row.classList.remove("ioh-duplicate-server");
        delete row.dataset.iohDupColor;
        delete row.dataset.duplicateServerChecked;
      });
    }
    clearTranslationDecorations() {
      for (const [cell, binding] of this.translationBindings) this.releaseTranslation(cell, binding);
    }
  };

  // modules/SitePunishmentBridge.js
  var SitePunishmentBridge = class _SitePunishmentBridge {
    static PANELS = {
      mute: {
        sectionTitle: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043C\u0443\u0442\u0430\u043C\u0438",
        route: "/comms/list",
        inputSelector: "#mute-steamid64"
      },
      ban: {
        sectionTitle: "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0431\u0430\u043D\u0430\u043C\u0438",
        route: "/bans/list",
        inputSelector: "#ban-steamid64"
      }
    };
    constructor({ document: document2, ticketService }) {
      this.document = document2;
      this.ticketService = ticketService;
      this._returnContext = null;
      this._lastFailReason = null;
    }
    openMuteForm(steamId3) {
      return this.openForm("mute", steamId3);
    }
    openBanForm(steamId3) {
      return this.openForm("ban", steamId3);
    }
    _debugLog(reason, details = {}) {
      this.ticketService.debugPunishmentLog(reason, details);
    }
    async openForm(type, steamId3) {
      const origin = this.ticketService._closeReasonPunishmentOrigin;
      const originPath = this.document.defaultView?.location?.pathname || "";
      try {
        const opened = await this._openForm(type, steamId3);
        if (opened && origin?.type === type && origin.steamId === steamId3) {
          const input = this.document.querySelector(`[role="dialog"] ${_SitePunishmentBridge.PANELS[type].inputSelector}`);
          const dialog = input?.closest('[role="dialog"]');
          if (dialog) {
            const currentOrigin = this.recoverCloseReasonPunishmentOrigin(origin, originPath);
            if (currentOrigin) {
              this.ticketService._closeReasonPunishmentOrigins ||= /* @__PURE__ */ new WeakMap();
              this.ticketService._closeReasonPunishmentOrigins.set(dialog, currentOrigin);
            }
          }
        }
        return opened;
      } finally {
        if (this.ticketService._closeReasonPunishmentOrigin === origin) {
          this.ticketService._closeReasonPunishmentOrigin = null;
        }
      }
    }
    recoverCloseReasonPunishmentOrigin(origin, originPath) {
      if (!this.document.contains || this.document.contains(origin.scope)) return origin;
      const ticket = this.ticketService;
      const getContext = ticket.getTicketPunishmentFeedbackContext || ticket.getCloseReasonContext;
      const isEditable = ticket.isTicketPunishmentFeedbackContextEditable || ticket.isCloseReasonContextEditable;
      const currentPath = this.document.defaultView?.location?.pathname || "";
      const sourceTicketId = originPath.match(/^\/(?:support\/(?:ticket|report)|tickets?|reports?)\/(\d+)\/?$/i)?.[1];
      if (sourceTicketId !== String(origin.ticketId) || currentPath.replace(/\/$/, "") !== originPath.replace(/\/$/, "") || !getContext || !isEditable) return null;
      const candidates = /* @__PURE__ */ new Map();
      for (const textarea of this.document.querySelectorAll('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]')) {
        const context2 = getContext.call(ticket, textarea);
        if (!context2 || context2.ticketId !== String(origin.ticketId) || context2.steamId !== origin.steamId || !this.document.contains(context2.scope) || !isEditable.call(ticket, context2)) continue;
        const visible = ticket.isCloseReasonTextareaVisible ? ticket.isCloseReasonTextareaVisible(textarea, context2.scope) : ticket.isVisibleTicketTextarea?.(textarea);
        if (!visible || ticket.getOffenderSteamIdForScope(context2.scope) !== origin.steamId || ticket.extractTicketIdFromComplaintScope(context2.scope) !== String(origin.ticketId)) continue;
        candidates.set(textarea, context2);
      }
      if (candidates.size !== 1) return null;
      const context = candidates.values().next().value;
      ticket.transferCloseReasonComplaintScope?.(origin.scope, context);
      return { ...origin, scope: context.scope };
    }
    async _openForm(type, steamId3) {
      const hasPermission = type === "ban" ? this.ticketService.canIssueBan : this.ticketService.canIssueMute;
      if (!hasPermission) {
        return false;
      }
      this._lastFailReason = null;
      let opened = await this._trySilentOpen(type);
      if (!opened && !this.ticketService.isPanelReadyForType(type)) {
        opened = await this._runVisibleInitFlow(type);
      } else if (!opened) {
        this.ticketService.resetPanelReady(type);
        opened = await this._trySilentRemount(type);
      }
      if (!opened) {
        this._clearReturnContext();
        this.ticketService.handlePunishmentOpenFailure(type);
        const panel = _SitePunishmentBridge.PANELS[type];
        console.warn(`[IO Helper] \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0444\u043E\u0440\u043C\u0443 ${type === "ban" ? "\u0431\u0430\u043D\u0430" : "\u043C\u0443\u0442\u0430"} (${this._lastFailReason || "\u0444\u043E\u0440\u043C\u0430 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043B\u0430\u0441\u044C"}). \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \xAB${panel.sectionTitle}\xBB.`);
        this._debugLog(this._lastFailReason || "open_form_failed", { type });
        return false;
      }
      this.ticketService.markPanelReady(type);
      this.ticketService.recordPunishmentOpenSuccess();
      await this.ticketService.persistPanelReadyState();
      if (steamId3) {
        if (type === "ban") {
          this.ticketService.prefillBanFormSteamId(steamId3);
        } else {
          this.ticketService.prefillMuteFormSteamId(steamId3);
        }
      }
      return true;
    }
    async _runVisibleInitFlow(type) {
      return this._runManagementActivationFlow(type);
    }
    async _trySilentRemount(type) {
      return this._runManagementActivationFlow(type);
    }
    async _runManagementActivationFlow(type) {
      this._saveReturnContext(type);
      const returnContext = this._returnContext;
      this.ticketService.suppressPermissionScan();
      try {
        const activated = await this.ticketService.activateManagementPanel(type);
        if (!activated) {
          this._lastFailReason = "management_tab_not_created";
          this._debugLog("management_tab_not_created", { type });
          return false;
        }
        const hasIssueButton = await this._waitForIssueButton(type, 5e3);
        if (!hasIssueButton) {
          this._lastFailReason = "issue_button_not_found";
          this._debugLog("issue_button_not_found", { type });
          return false;
        }
        let opened = await this._tryLiveButtonClick(type, 5e3);
        if (!opened) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          opened = await this._tryLiveButtonClick(type, 5e3);
        }
        if (!opened) {
          this._lastFailReason = "dialog_not_opened";
          this._debugLog("dialog_not_opened", { type });
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
        const returned = await this._returnToTicketTab(returnContext, { closeManagementTab: false });
        if (!returned) {
          this._debugLog("return_to_ticket_failed", {
            type,
            tabLabel: returnContext.tabLabel,
            ticketId: returnContext.ticketId,
            pathname: returnContext.pathname
          });
        }
        if (!this._isTargetDialogOpen(type)) {
          const retried = await this._tryLiveButtonClick(type, 3e3);
          if (!retried) {
            this._lastFailReason = "dialog_closed_after_return";
            this._debugLog("dialog_closed_after_return", { type, returned });
            return false;
          }
        }
        return true;
      } finally {
        this.ticketService.releasePermissionScan();
      }
    }
    _saveReturnContext(type) {
      const tabContext = this.ticketService.collectReturnTabContext();
      this._returnContext = {
        ...tabContext,
        managementType: type || null
      };
    }
    _clearReturnContext() {
      this._returnContext = null;
    }
    async _returnToTicketTab(returnContext, options = {}) {
      const { closeManagementTab = false } = options;
      this.ticketService.suppressPermissionScan();
      let returned = false;
      try {
        returned = await this.ticketService.restoreSpaTabFromContext(returnContext);
        if (closeManagementTab && returnContext.managementType) {
          this.ticketService.closeManagementTab(returnContext.managementType);
        }
      } finally {
        this.ticketService.releasePermissionScan();
      }
      this._clearReturnContext();
      this.ticketService.refreshComplaintPunishmentButtons();
      return returned;
    }
    _findIssueButton(type) {
      return type === "ban" ? this.ticketService.findSiteIssueBanButton() : this.ticketService.findSiteIssueMuteButton();
    }
    async _trySilentOpen(type) {
      if (!this.ticketService.isPanelReadyForType(type)) {
        return false;
      }
      const handler = this.ticketService.getCachedIssueHandler(type);
      if (handler) {
        const cachedButton = this.ticketService.getLastKnownIssueButton(type);
        const sectionTitle = _SitePunishmentBridge.PANELS[type].sectionTitle;
        if (cachedButton?.isConnected && this.ticketService._isButtonInSection(cachedButton, sectionTitle) && this.ticketService.invokeCachedSiteHandler(handler, type, cachedButton) && await this._waitForDialogOpen(type, 3e3)) {
          return true;
        }
      }
      if (this.ticketService.isManagementPanelMounted(type)) {
        const button = this.ticketService.resolveIssueButtonForType(type);
        if (button && this.ticketService.dispatchElementClick(button) && await this._waitForDialogOpen(type, 3e3)) {
          return true;
        }
      }
      return false;
    }
    async _tryLiveButtonClick(type, timeoutMs = 2e3) {
      if (!this.ticketService.isManagementPanelActiveForType(type)) {
        return false;
      }
      const button = this._findIssueButton(type);
      if (!button) {
        return false;
      }
      this.ticketService._cacheIssueHandlerFromButton(button, type);
      if (!this.ticketService.dispatchElementClick(button)) {
        return false;
      }
      return this._waitForDialogOpen(type, timeoutMs);
    }
    _waitForIssueButton(type, timeoutMs) {
      const hasButton = () => this.ticketService.isManagementPanelActiveForType(type) && Boolean(this._findIssueButton(type));
      if (hasButton()) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        console.log("[Helper] SitePunishmentBridge: waitForIssueButton start");
        const observer = new MutationObserver(() => {
          if (hasButton()) {
            observer.disconnect();
            console.log("[Helper] SitePunishmentBridge: waitForIssueButton finish \u2014 found");
            resolve(true);
          } else if (Date.now() > deadline) {
            observer.disconnect();
            console.log("[Helper] SitePunishmentBridge: waitForIssueButton finish \u2014 timeout");
            resolve(false);
          }
        });
        observer.observe(this.document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-hidden", "class", "style"]
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(hasButton());
        }, timeoutMs + 50);
      });
    }
    _isTargetDialogOpen(type) {
      return this.ticketService.isTargetPunishmentDialogOpen(type);
    }
    _waitForDialogOpen(type, timeoutMs) {
      if (this._isTargetDialogOpen(type)) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        console.log("[Helper] SitePunishmentBridge: waitForDialogOpen start");
        const observer = new MutationObserver(() => {
          if (this._isTargetDialogOpen(type)) {
            observer.disconnect();
            console.log("[Helper] SitePunishmentBridge: waitForDialogOpen finish \u2014 open");
            resolve(true);
          } else if (Date.now() > deadline) {
            observer.disconnect();
            console.log("[Helper] SitePunishmentBridge: waitForDialogOpen finish \u2014 timeout");
            resolve(false);
          }
        });
        observer.observe(this.document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["data-state", "open"]
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(this._isTargetDialogOpen(type));
        }, timeoutMs + 50);
      });
    }
  };

  // modules/shared/RuleMatcher.js
  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function compileKeywordEntry(keyword, exceptions) {
    const trigger = String(keyword).toLowerCase();
    return {
      trigger,
      triggerRe: new RegExp(escapeRegExp(trigger), "iu"),
      exceptionRes: exceptions.map((ex) => new RegExp(escapeRegExp(ex), "giu"))
    };
  }
  function compileRuleMatcher(rules = [], muteExceptions = {}) {
    const exceptionMap = /* @__PURE__ */ new Map();
    for (const [key, values] of Object.entries(muteExceptions || {})) {
      exceptionMap.set(String(key).toLowerCase(), Array.isArray(values) ? values : []);
    }
    const compiledRules = (Array.isArray(rules) ? rules : []).map((rule) => {
      const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
      const compiledKeywords = keywords.map((keyword) => {
        const trigger = String(keyword).toLowerCase();
        const exceptions = [];
        for (const [exKey, exValues] of exceptionMap) {
          if (trigger.includes(exKey) || exKey.includes(trigger)) {
            exceptions.push(...exValues);
          }
        }
        return compileKeywordEntry(keyword, exceptions);
      });
      const alternation = compiledKeywords.map((entry) => escapeRegExp(entry.trigger)).filter(Boolean).join("|");
      return {
        rule,
        keywords: compiledKeywords,
        anyKeywordRe: alternation ? new RegExp(alternation, "iu") : null
      };
    });
    return {
      rules: compiledRules,
      getExceptions(keyword) {
        const trigger = String(keyword).toLowerCase();
        const exceptions = [];
        for (const [exKey, exValues] of exceptionMap) {
          if (trigger.includes(exKey) || exKey.includes(trigger)) {
            exceptions.push(...exValues);
          }
        }
        return exceptions;
      },
      contains(text, compiledKeyword) {
        let sanitized = text;
        for (const exceptionRe of compiledKeyword.exceptionRes) {
          sanitized = sanitized.replace(exceptionRe, "");
        }
        return compiledKeyword.triggerRe.test(sanitized);
      },
      extractWord(text, compiledKeyword) {
        const words = String(text).match(/\S+/g);
        if (!words) {
          return compiledKeyword.trigger;
        }
        for (const word of words) {
          if (this.contains(word.toLowerCase(), compiledKeyword)) {
            return word;
          }
        }
        return compiledKeyword.trigger;
      },
      matchStrongest(textLower, messageText, getSeverity) {
        const matched = [];
        for (const compiled of compiledRules) {
          if (!compiled.keywords.length) {
            continue;
          }
          if (compiled.anyKeywordRe && !compiled.anyKeywordRe.test(textLower)) {
            continue;
          }
          const hit = compiled.keywords.find((keyword) => this.contains(textLower, keyword));
          if (hit) {
            matched.push({
              rule: compiled.rule,
              keyword: hit.trigger,
              compiledKeyword: hit
            });
          }
        }
        if (!matched.length) {
          return null;
        }
        matched.sort(
          (a, b) => getSeverity(b.rule) - getSeverity(a.rule) || b.rule.duration - a.rule.duration
        );
        const strongest = matched[0];
        return {
          ...strongest,
          displayKeyword: this.extractWord(messageText, strongest.compiledKeyword)
        };
      }
    };
  }
  function detectSpamLinear(playerChatLog, spamRule, getSeverity, spamRules = {}) {
    const intervalSec = Number(spamRules.interval) || 3;
    const warningCount = Number(spamRules.warningCount) || 3;
    const violations = [];
    const flushRun = (run) => {
      if (run.length < warningCount) {
        return;
      }
      const first = run[0];
      violations.push({
        rows: run.map((msg) => msg.row),
        dupes: run.length,
        raw: first.raw,
        timeMs: first.time,
        severity: getSeverity(spamRule),
        duration: spamRule?.duration ?? 0
      });
    };
    for (const msgs of Object.values(playerChatLog)) {
      const sorted = [...msgs].sort((a, b) => a.time - b.time);
      let run = [];
      for (const current of sorted) {
        if (run.length === 0) {
          run = [current];
          continue;
        }
        const prev = run[run.length - 1];
        const sameText = current.text === prev.text;
        const gapSec = (current.time - prev.time) / 1e3;
        if (sameText && gapSec < intervalSec) {
          run.push(current);
          continue;
        }
        flushRun(run);
        run = [current];
      }
      flushRun(run);
    }
    return violations;
  }

  // modules/ticket/QueueChatAnalysis.js
  function scanChatMessages(service, messages, { triggerRows = null } = {}) {
    const allViolations = [];
    const ruleCounters = {};
    for (const rule of service.rules || []) ruleCounters[rule.name] = 0;
    const playerChatLog = /* @__PURE__ */ Object.create(null);
    const getSeverity = (rule) => service.getRuleSeverity(rule);
    const bindTrigger = (row) => {
      if (!triggerRows) return null;
      const id = crypto.randomUUID();
      triggerRows.set(id, row);
      return id;
    };
    for (const { messageText, authorText, timeMs, row } of messages) {
      if (!messageText) continue;
      const textLower = messageText.toLowerCase().trim();
      if (timeMs && textLower.length > 0) {
        (playerChatLog[authorText] ||= []).push({ time: timeMs, text: textLower, raw: messageText, row });
      }
      const strongest = service._ruleMatcher.matchStrongest(textLower, messageText, getSeverity);
      if (!strongest) continue;
      ruleCounters[strongest.rule.name] += 1;
      allViolations.push({
        id: bindTrigger(row),
        ruleName: strongest.rule.name,
        keyword: strongest.displayKeyword,
        fullMessage: messageText,
        severity: getSeverity(strongest.rule),
        duration: strongest.rule.duration,
        timeMs: timeMs || null
      });
    }
    const spamRule = (service.rules || []).find((rule) => rule.name === "\u0421\u043F\u0430\u043C \u0432 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D/\u0447\u0430\u0442");
    for (const spam of detectSpamLinear(playerChatLog, spamRule, getSeverity, service.spamRules)) {
      allViolations.push({
        id: bindTrigger(spam.rows),
        ruleName: "\u0421\u043F\u0430\u043C \u0432 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D/\u0447\u0430\u0442",
        keyword: `${spam.raw} (x${spam.dupes})`,
        fullMessage: spam.raw,
        severity: spam.severity,
        duration: spam.duration,
        timeMs: spam.timeMs || null
      });
      ruleCounters["\u0421\u043F\u0430\u043C \u0432 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D/\u0447\u0430\u0442"] = (ruleCounters["\u0421\u043F\u0430\u043C \u0432 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D/\u0447\u0430\u0442"] || 0) + spam.dupes;
    }
    return { allViolations, ruleCounters };
  }
  function analyzeQueueChatMessages(service, messages, { now = Date.now() } = {}) {
    const recent = (Array.isArray(messages) ? messages : []).filter(
      (message) => typeof message?.text === "string" && Number.isFinite(message.timeMs) && message.timeMs >= now - 864e5 && message.timeMs <= now
    ).map((message) => ({
      messageText: message.text,
      timeMs: message.timeMs,
      authorText: message.channel === "team" ? "\u041A\u043E\u043C\u0430\u043D\u0434\u0430" : "\u0412\u0441\u0435"
    }));
    const analysis = scanChatMessages(service, recent);
    const { allViolations, ruleCounters } = service.dropSoloTrollingViolation(analysis.allViolations, analysis.ruleCounters);
    if (!allViolations.length) return { kind: "none", reason: null, allViolations, ruleCounters };
    const mostSevere = service.findMostSeverePunishment(ruleCounters);
    if (!mostSevere) return { kind: "skip", reason: null, allViolations, ruleCounters };
    const { finalName, finalDurationStr } = service.calculateFinalPunishment(mostSevere.rule, mostSevere.count, ruleCounters);
    return {
      kind: finalDurationStr === "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435" ? "warning" : "mute",
      reason: finalName,
      allViolations,
      ruleCounters
    };
  }

  // modules/ticket/TicketScope.js
  var TicketScopeMethods = {
    getChatCacheKey(textarea) {
      const scope = this.getTicketScopeRoot(textarea);
      if (this.nativeData) return this.getNativeTicket(scope)?.key || "native:pending";
      const blocks = this.getHistoryBlocks(scope);
      const offenderId = blocks.offenderSteamId || "unknown";
      const scopeToken = scope?.getAttribute?.("aria-hidden") ?? scope?.className?.slice(0, 40) ?? "";
      const path = window.location.pathname || window.location.href;
      return `${path}|${offenderId}|${scopeToken}`;
    },
    getHistoryBlocks(scope, { force = false } = {}) {
      if (this.nativeData) return this.nativeHistoryBlocks(scope || this.getAutoConnectScope() || this.document.body);
      const root = scope || this.document.body;
      if (!this._scopeCache) {
        this._scopeCache = /* @__PURE__ */ new WeakMap();
      }
      const cached = force ? null : this._scopeCache.get(root);
      if (cached && this.isHistoryCacheValid(cached)) {
        return cached;
      }
      const next = {
        chat: this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", root),
        mute: this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041C\u0443\u0442\u043E\u0432", root),
        ban: this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0411\u0430\u043D\u043E\u0432", root) || this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0431\u0430\u043D\u043E\u0432", root),
        warning: this.getWarningHistoryBlockScoped(root),
        offenderSteamId: this.extractSteamIdFromField(
          this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", root)
        ) || "unknown"
      };
      if (next.chat) {
        this._scopeCache.set(root, next);
      }
      return next;
    },
    isHistoryCacheValid(cached) {
      if (!cached) {
        return false;
      }
      return [
        [cached.chat, ["\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430"]],
        [cached.mute, ["\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041C\u0443\u0442\u043E\u0432"]],
        [cached.ban, ["\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0411\u0430\u043D\u043E\u0432", "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0431\u0430\u043D\u043E\u0432"]],
        [cached.warning, ["\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439", "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439"]]
      ].every(([node, labels]) => this.isCachedHistoryNodeValid(node, labels));
    },
    isCachedHistoryNodeValid(node, labels) {
      if (!node) {
        return true;
      }
      if (!this.document.contains(node)) {
        return false;
      }
      const text = node.textContent || "";
      return labels.some((label) => text.includes(label));
    },
    invalidateHistoryCache(scope) {
      if (!this._scopeCache) {
        this._scopeCache = /* @__PURE__ */ new WeakMap();
        return;
      }
      if (scope) {
        this._scopeCache.delete(scope);
        return;
      }
      this._scopeCache = /* @__PURE__ */ new WeakMap();
    },
    getTicketScopeRoot(textarea) {
      if (!textarea) {
        return this.document.body;
      }
      let element = textarea.parentElement;
      while (element && element !== this.document.body) {
        if (element.hasAttribute?.("aria-hidden") || element.matches?.('section, article, main, [role="main"]')) {
          return element;
        }
        element = element.parentElement;
      }
      return textarea.closest('section, article, main, [role="main"]') || textarea.parentElement || this.document.body;
    },
    isVisibleTicketTextarea(textarea) {
      if (!textarea || !this.document.contains(textarea)) {
        return false;
      }
      let element = textarea;
      while (element) {
        if (element.getAttribute?.("aria-hidden") === "true") {
          return false;
        }
        const style = window.getComputedStyle?.(element);
        if (style?.display === "none" || style?.visibility === "hidden") {
          return false;
        }
        element = element.parentElement;
      }
      return textarea.getClientRects().length > 0;
    },
    findVisibleTicketResolutionTextarea() {
      const textareas = this.document.querySelectorAll('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]');
      for (const textarea of textareas) {
        if (this.isVisibleTicketTextarea(textarea)) {
          return textarea;
        }
      }
      return null;
    },
    isComplaintPage() {
      const path = window.location.pathname || "";
      return /\/support\/(ticket|report)\b|\/ticket\/|\/reports?\//i.test(path);
    },
    isOpenComplaintScope(scopeEl) {
      if (!scopeEl) {
        return false;
      }
      const hasOffender = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scopeEl);
      const hasPlayerInfo = Array.from(scopeEl.querySelectorAll("h3")).some(
        (header) => header.textContent.includes("\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u043E\u0431 \u0438\u0433\u0440\u043E\u043A\u0430\u0445")
      );
      return Boolean(hasOffender || hasPlayerInfo);
    },
    isActiveComplaintScope(scopeEl) {
      if (!scopeEl || !this.document.contains(scopeEl) || !this.isOpenComplaintScope(scopeEl)) {
        return false;
      }
      let element = scopeEl;
      while (element && element !== this.document.body) {
        const ariaHidden = element.getAttribute?.("aria-hidden");
        if (ariaHidden === "true") {
          return false;
        }
        if (ariaHidden === "false") {
          return true;
        }
        element = element.parentElement;
      }
      return true;
    },
    findActiveComplaintScope() {
      const hiddenFalsePanels = this.document.querySelectorAll('[aria-hidden="false"]');
      for (const panel of hiddenFalsePanels) {
        if (this.isOpenComplaintScope(panel)) {
          return panel;
        }
      }
      const structuralScopes = this.document.querySelectorAll('section, article, main, [role="main"]');
      for (const scope of structuralScopes) {
        if (this.isActiveComplaintScope(scope)) {
          return scope;
        }
      }
      return null;
    },
    isSitePunishmentDialogOpen() {
      return Boolean(this.document.querySelector('[role="dialog"][data-state="open"]'));
    },
    isTargetPunishmentDialogOpen(type) {
      const inputSelector = type === "ban" ? "#ban-steamid64" : "#mute-steamid64";
      return Boolean(this.document.querySelector(`[role="dialog"][data-state="open"] ${inputSelector}`));
    },
    getHistoryAccordionButton(textMatch, scopeEl) {
      const root = scopeEl || this.document.body;
      return Array.from(root.querySelectorAll("button[aria-expanded]")).find((button) => {
        const text = (button.textContent || "").replace(/\s+/g, " ");
        return text.includes(textMatch);
      }) || null;
    },
    findCardSurface(el) {
      let node = el;
      while (node && node !== this.document.body) {
        if (node.getAttribute?.("data-pet-surface") === "card") {
          return node;
        }
        if (node.attributes) {
          for (const attr of node.attributes) {
            if (attr.name.startsWith("data-") && attr.value === "card") {
              return node;
            }
          }
        }
        node = node.parentElement;
      }
      return null;
    },
    getHistorySectionCard(textMatch, scopeEl) {
      const accordion = this.getHistoryAccordionButton(textMatch, scopeEl);
      if (accordion) {
        return this.findCardSurface(accordion) || null;
      }
      const root = scopeEl || this.document.body;
      const header = Array.from(root.querySelectorAll("h3")).find(
        (h3) => (h3.textContent || "").includes(textMatch)
      );
      if (!header) {
        return null;
      }
      return this.findCardSurface(header) || null;
    },
    isChatHistoryEmptyScoped(scopeEl) {
      const accordion = this.getHistoryAccordionButton("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scopeEl);
      if (accordion) {
        const hasEmptyBadge = Array.from(accordion.querySelectorAll("span")).some((span) => (span.textContent || "").trim() === "\u041F\u0443\u0441\u0442\u043E");
        if (hasEmptyBadge) {
          return true;
        }
        const card = this.getHistorySectionCard("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scopeEl);
        const cardText = card?.innerText || "";
        if (cardText.includes("\u0427\u0430\u0442 \u043F\u0443\u0441\u0442")) {
          return true;
        }
        const rows2 = Array.from(card?.querySelectorAll("tbody tr, tr") || []).filter((row) => row.querySelector("td"));
        return rows2.length === 0;
      }
      const chatHistoryBlock = this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scopeEl);
      if (!chatHistoryBlock || chatHistoryBlock.style.display === "none") {
        return true;
      }
      if ((chatHistoryBlock.innerText || "").includes("\u0427\u0430\u0442 \u043F\u0443\u0441\u0442")) {
        return true;
      }
      const rows = Array.from(chatHistoryBlock.querySelectorAll("tbody tr, tr")).filter((row) => row.querySelector("td"));
      return rows.length === 0;
    },
    /**
     * Chat is "settled" only when we know the final empty/non-empty state:
     * explicit Пусто / «Чат пуст», or at least one message row.
     * Missing table / zero rows without empty markers = still loading.
     */
    isChatHistorySettledScoped(scopeEl) {
      if (this.nativeData) return this.nativeAnalysisReady(scopeEl);
      const accordion = this.getHistoryAccordionButton("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scopeEl);
      if (accordion) {
        const hasEmptyBadge = Array.from(accordion.querySelectorAll("span")).some((span) => (span.textContent || "").trim() === "\u041F\u0443\u0441\u0442\u043E");
        if (hasEmptyBadge) {
          return true;
        }
        const card = this.getHistorySectionCard("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scopeEl);
        if ((card?.innerText || "").includes("\u0427\u0430\u0442 \u043F\u0443\u0441\u0442")) {
          return true;
        }
        const rows2 = Array.from(card?.querySelectorAll("tbody tr, tr") || []).filter((row) => row.querySelector("td"));
        return rows2.length > 0;
      }
      const chatHistoryBlock = this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scopeEl);
      if (!chatHistoryBlock) {
        return false;
      }
      if ((chatHistoryBlock.innerText || "").includes("\u0427\u0430\u0442 \u043F\u0443\u0441\u0442")) {
        return true;
      }
      const rows = Array.from(chatHistoryBlock.querySelectorAll("tbody tr, tr")).filter((row) => row.querySelector("td"));
      return rows.length > 0;
    },
    async waitForSettledChatHistory(textarea, { timeoutMs = 3e3, pollMs = 120 } = {}) {
      if (this.nativeData) return this.nativeAnalysisReady(this.getTicketScopeRoot(textarea));
      if (!textarea || !this.document.contains(textarea)) {
        return false;
      }
      const scopeNow = this.getTicketScopeRoot(textarea);
      if (this.isChatHistorySettledScoped(scopeNow)) {
        return true;
      }
      return new Promise((resolve) => {
        let settled = false;
        const startedAt = Date.now();
        const observeRoot = this.getTicketScopeRoot(textarea) || this.document.body;
        const cleanup = () => {
          observer.disconnect();
          clearInterval(intervalId);
        };
        const finish = (ok) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(ok);
        };
        const check = () => {
          if (!this.document.contains(textarea)) {
            finish(false);
            return;
          }
          const scope = this.getTicketScopeRoot(textarea);
          if (this.isChatHistorySettledScoped(scope)) {
            this.invalidateHistoryCache(scope);
            finish(true);
            return;
          }
          if (Date.now() - startedAt >= timeoutMs) {
            console.log("[Helper] chat history: settle timeout");
            finish(false);
          }
        };
        const observer = new MutationObserver(() => check());
        observer.observe(observeRoot, { childList: true, subtree: true, characterData: true });
        const intervalId = setInterval(check, pollMs);
        check();
      });
    },
    HISTORY_SECTION_LABELS: [
      "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430",
      "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041C\u0443\u0442\u043E\u0432",
      "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0411\u0430\u043D\u043E\u0432",
      "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0431\u0430\u043D\u043E\u0432",
      "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439",
      "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439",
      "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0422\u0438\u043A\u0435\u0442\u043E\u0432"
    ],
    isHistoryAccordionEmpty(textMatch, scopeEl) {
      const accordion = this.getHistoryAccordionButton(textMatch, scopeEl);
      if (!accordion) {
        return false;
      }
      return Array.from(accordion.querySelectorAll("span")).some((span) => (span.textContent || "").trim() === "\u041F\u0443\u0441\u0442\u043E");
    },
    cardHasForeignHistoryHeader(node, textMatch) {
      if (!node) {
        return false;
      }
      const headers = [
        ...node.querySelectorAll("h3"),
        ...node.querySelectorAll("button[aria-expanded]")
      ];
      return headers.some((header) => {
        const text = header.textContent || "";
        return this.HISTORY_SECTION_LABELS.some(
          (label) => label !== textMatch && text.includes(label)
        );
      });
    },
    isDedicatedHistoryCard(node, textMatch) {
      if (!node) {
        return false;
      }
      const ownHeaders = [
        ...node.querySelectorAll("h3"),
        ...node.querySelectorAll("button[aria-expanded]")
      ];
      const hasOwnHeader = ownHeaders.some(
        (header) => (header.textContent || "").includes(textMatch)
      );
      if (!hasOwnHeader) {
        return false;
      }
      return !this.cardHasForeignHistoryHeader(node, textMatch);
    },
    getBlockByHeaderScoped(textMatch, scopeEl) {
      const root = scopeEl || this.document.body;
      if (this.isHistoryAccordionEmpty(textMatch, root)) {
        return null;
      }
      const headers = Array.from(root.querySelectorAll("h3"));
      const targetHeader = headers.find((h3) => (h3.textContent || "").includes(textMatch));
      if (targetHeader) {
        const headerCard = this.findCardSurface(targetHeader);
        if (headerCard?.querySelector("table") && this.isDedicatedHistoryCard(headerCard, textMatch)) {
          return headerCard;
        }
        let parent = targetHeader.parentElement;
        while (parent && parent !== this.document.body) {
          if (this.cardHasForeignHistoryHeader(parent, textMatch)) {
            break;
          }
          if (parent.querySelector("table") && this.isDedicatedHistoryCard(parent, textMatch)) {
            return parent;
          }
          parent = parent.parentElement;
        }
      }
      const card = this.getHistorySectionCard(textMatch, scopeEl);
      if (card?.querySelector("table") && this.isDedicatedHistoryCard(card, textMatch)) {
        return card;
      }
      return null;
    },
    getBlockByHeader(textMatch) {
      return this.getBlockByHeaderScoped(textMatch, this.document.body);
    },
    isExtensionUiElement(element) {
      return Boolean(
        element?.closest("[data-ioh], .ioh-analysis-row, .ioh-analysis-label, .ioh-analysis-value, #mod-ticket-panel, #mod-notif-panel, #helper-suggest-badge, #ioh-ticket-punishment-actions, #ioh-ticket-issue-mute, #ioh-ticket-issue-ban, .ioh-badge-row, .ioh-account-created, .ioh-cybershoke-playtime, .ioh-offender-country, .ioh-faceit-elo")
      );
    },
    _isElementVisible(element) {
      if (!element?.isConnected) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        return false;
      }
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
    },
    findInfoFieldScoped(labelText, scopeEl) {
      const root = scopeEl || this.document.body;
      const label = Array.from(root.querySelectorAll("span, div")).find((element) => !this.isExtensionUiElement(element) && element.textContent.trim() === labelText);
      return label?.parentElement || null;
    },
    findInfoField(labelText) {
      const label = Array.from(this.document.querySelectorAll("span, div")).find((element) => !this.isExtensionUiElement(element) && element.textContent.trim() === labelText);
      return label?.parentElement || null;
    },
    findInfoFieldByLabels(labelTexts, scope = null) {
      for (const labelText of labelTexts) {
        const field = scope ? this.findInfoFieldScoped(labelText, scope) : this.findInfoField(labelText);
        if (field) {
          return field;
        }
      }
      return null;
    },
    findFieldValueBlock(field) {
      if (!field) {
        return null;
      }
      return Array.from(field.children).find((child) => child.tagName === "DIV") || null;
    },
    extractSteamIdFromField(field) {
      const valueBlock = this.findFieldValueBlock(field);
      const profileLink = valueBlock?.querySelector('a[href*="cybershoke.net/"], a[href*="/moderator/profile/"]');
      const sourceText = `${profileLink?.href || ""} ${profileLink?.textContent || ""}`;
      const steamIdMatch = sourceText.match(/\d{17,18}/);
      return steamIdMatch ? steamIdMatch[0] : null;
    }
  };

  // modules/ticket/ChatAnalyzer.js
  var ChatAnalyzerMethods = {
    beginChatAnalysis(textarea) {
      this._chatAnalysisByScope ||= /* @__PURE__ */ new WeakMap();
      const scope = this.getTicketScopeRoot(textarea);
      const key = this.getChatCacheKey(textarea);
      const previous = this._chatAnalysisByScope.get(scope);
      const steamId3 = (this.nativeData ? this.getNativeTicket(scope)?.suspectId : this.extractSteamIdFromField(this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope))) || "unknown";
      const state = {
        scope,
        textarea,
        key,
        steamId: steamId3,
        generation: this._chatAnalysisGeneration || 0,
        completed: false,
        kind: previous?.key === key ? previous.kind : null,
        signature: previous?.key === key ? previous.signature : null
      };
      this._chatAnalysisByScope.set(scope, state);
      return state;
    },
    isChatAnalysisCurrent(state) {
      return this._chatAnalysisByScope?.get(state.scope) === state && state.generation === (this._chatAnalysisGeneration || 0) && this.document.contains(state.textarea) && this.isVisibleTicketTextarea(state.textarea) && this.getTicketScopeRoot(state.textarea) === state.scope && ((this.nativeData ? this.getNativeTicket(state.scope)?.suspectId : this.extractSteamIdFromField(this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", state.scope))) || "unknown") === state.steamId && this.getChatCacheKey(state.textarea) === state.key;
    },
    completeChatAnalysis(state, result) {
      if (!this.isChatAnalysisCurrent(state)) return null;
      const signature = this.chatSignatureByKey.get(state.key);
      const kind = result?.kind === "unchanged" ? state.signature === signature ? state.kind : null : result?.kind;
      state.completed = ["none", "warning", "mute", "skip"].includes(kind);
      state.kind = state.completed ? kind : null;
      state.signature = signature;
      if (this.nativeData) state.nativeSignature = this.nativeAnalysisSignature(state.scope);
      return state.completed ? { kind } : null;
    },
    invalidateChatAnalysis(textarea) {
      const scope = this.getTicketScopeRoot(textarea);
      const state = this._chatAnalysisByScope?.get(scope);
      if (state) this._chatAnalysisByScope.set(scope, { ...state, completed: false });
    },
    getCompletedChatAnalysis(scope) {
      const state = this._chatAnalysisByScope?.get(scope);
      if (!state?.completed || !this.document.contains(state.textarea) || this.getTicketScopeRoot(state.textarea) !== scope) return null;
      if (this.nativeData && state.nativeSignature !== this.nativeAnalysisSignature(scope)) return null;
      const steamId3 = (this.nativeData ? this.getNativeTicket(scope)?.suspectId : this.extractSteamIdFromField(this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope))) || "unknown";
      return state.steamId === steamId3 ? state : null;
    },
    resetChatAnalysisCache(textarea, { preserveCompleted = false } = {}) {
      if (textarea) {
        this._chatAnalysisByScope?.delete(this.getTicketScopeRoot(textarea));
        const key = this.getChatCacheKey(textarea);
        this.chatSignatureByKey.delete(key);
        this.activePunishmentBadgeByKey.delete(key);
        this.invalidateHistoryCache(this.getTicketScopeRoot(textarea));
        return;
      }
      this.chatSignatureByKey.clear();
      this._chatAnalysisGeneration = (this._chatAnalysisGeneration || 0) + 1;
      if (!preserveCompleted) this._chatAnalysisByScope = /* @__PURE__ */ new WeakMap();
      this.activePunishmentBadgeByKey.clear();
      this.invalidateHistoryCache();
      this.clearSuggestedMuteReason();
    },
    getRuleSeverity(rule) {
      return rule?.severity ?? rule?.duration ?? 0;
    },
    normalizeReason(reason) {
      return String(reason || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    },
    getColumnIndex(row, names, fallbackIndex) {
      const table = row.closest("table");
      const headers = Array.from(table?.querySelectorAll("thead th") || []).map((th) => th.innerText.trim().toLowerCase());
      const index = headers.findIndex((header) => names.some((name) => header.includes(name)));
      return index >= 0 ? index : fallbackIndex;
    },
    getChatRowData(row) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) return null;
      const timeIndex = this.getColumnIndex(row, ["\u0434\u0430\u0442\u0430", "\u0432\u0440\u0435\u043C\u044F"], 0);
      const messageIndex = this.getColumnIndex(row, ["\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435", "\u0442\u0435\u043A\u0441\u0442"], cells.length - 1);
      const authorIndex = this.getColumnIndex(row, ["\u0438\u0433\u0440\u043E\u043A", "\u043D\u0438\u043A", "\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C", "\u0430\u0432\u0442\u043E\u0440"], -1);
      const chatTypeIndex = this.getColumnIndex(row, ["\u0447\u0430\u0442", "\u0442\u0438\u043F"], Math.min(2, cells.length - 1));
      const messageCell = cells[messageIndex] || cells[cells.length - 1];
      return {
        timeText: cells[timeIndex]?.innerText?.trim() || "",
        authorText: authorIndex >= 0 ? cells[authorIndex]?.innerText?.trim() : cells[chatTypeIndex]?.innerText?.trim() || "Player",
        messageText: this.utils.extractMessageText(messageCell)
      };
    },
    parseDateCell(dateCell) {
      const spans = dateCell?.querySelectorAll("span");
      const dateText = spans && spans[0] ? (spans[0].textContent || spans[0].innerText || "").trim() : null;
      const timeText = spans && spans[1] ? (spans[1].textContent || spans[1].innerText || "").trim() : "00:00";
      if (!dateText) return null;
      const [d, m, y] = dateText.split(".").map(Number);
      const [hh = 0, mm = 0, ss = 0] = timeText.split(":").map(Number);
      if ([d, m, y, hh, mm, ss].some(Number.isNaN)) return null;
      return new Date(y, m - 1, d, hh, mm, ss);
    },
    getKeywordExceptions(keyword) {
      return this._ruleMatcher?.getExceptions(keyword) || [];
    }
  };

  // modules/ticket/Verdict.js
  var VerdictMethods = {
    findRecentMuteForReasons(muteHistoryBlock, reasonNames) {
      if (muteHistoryBlock?.nativeHistory) {
        const names = reasonNames.map((n) => this.normalizeReason(n));
        const p = muteHistoryBlock.items.filter((p2) => p2.created >= Date.now() - 30 * 864e5 && p2.length > 0 && names.includes(this.normalizeReason(p2.reason))).sort((a, b) => b.created - a.created)[0];
        return p ? { date: new Date(p.created), duration: p.length / 60 } : null;
      }
      if (!muteHistoryBlock) return null;
      const acceptedReasons = reasonNames.map((reason) => this.normalizeReason(reason)).filter(Boolean);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3);
      let latestMute = null;
      muteHistoryBlock.querySelectorAll("tbody tr").forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 6) return;
        const rowDate = this.parseDateCell(cells[1]);
        const reason = this.normalizeReason(cells[3]?.innerText);
        if (!rowDate || rowDate < thirtyDaysAgo || !acceptedReasons.includes(reason)) return;
        const duration = this.utils.parseDurationToMinutes(cells[5]?.innerText?.trim());
        if (duration <= 0) return;
        if (!latestMute || rowDate > latestMute.date) {
          latestMute = { date: rowDate, duration };
        }
      });
      return latestMute;
    },
    findMostSeverePunishment(ruleCounters) {
      let bestRule = null;
      let bestIsMute = -1;
      let bestScore = -1;
      if (!Array.isArray(this.rules) || this.rules.length === 0) {
        return null;
      }
      this.rules.forEach((rule) => {
        const count = ruleCounters[rule.name] || 0;
        if (count <= 0) {
          return;
        }
        const { finalDuration } = this.calculateFinalPunishment(rule, count, ruleCounters);
        const isMute = finalDuration > 0 ? 1 : 0;
        let score = this.getRuleSeverity(rule);
        if (rule.name === "\u041E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u0435" && count > 4) {
          const toxicityRule = this.rules.find((r) => r.name === "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C");
          score = this.getRuleSeverity(toxicityRule);
        }
        if (isMute > bestIsMute || isMute === bestIsMute && score > bestScore) {
          bestIsMute = isMute;
          bestScore = score;
          bestRule = { rule, count };
        }
      });
      return bestRule;
    },
    calculateFinalPunishment(rule, count, ruleCounters = {}) {
      let finalName = rule.name;
      let finalDuration = rule.duration;
      let finalDurationStr = this.utils.formatDuration(rule.duration);
      const toxicityCount = ruleCounters["\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C"] || 0;
      const insultCount = ruleCounters["\u041E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u0435"] || 0;
      const trollingCount = ruleCounters["\u0422\u0440\u043E\u043B\u043B\u0438\u043D\u0433/\u043F\u0440\u043E\u0432\u043E\u043A\u0430\u0446\u0438\u044F"] || 0;
      const toxicityRule = this.rules.find((r) => r.name === "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C");
      const winnerSeverity = this.getRuleSeverity(rule);
      const toxicitySeverity = this.getRuleSeverity(toxicityRule);
      if (winnerSeverity <= toxicitySeverity) {
        if (toxicityCount > 0 || rule.name === "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C") {
          finalName = "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C";
          finalDuration = toxicityRule?.duration ?? 720;
          finalDurationStr = this.utils.formatDuration(finalDuration);
          return { finalName, finalDuration, finalDurationStr };
        }
        if (insultCount > 2 && trollingCount > 2) {
          finalName = "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C";
          finalDuration = toxicityRule?.duration ?? 720;
          finalDurationStr = this.utils.formatDuration(finalDuration);
          return { finalName, finalDuration, finalDurationStr };
        }
        if (insultCount > 1 && trollingCount > 1) {
          finalName = "\u041E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u0435";
          finalDuration = this.rules.find((r) => r.name === "\u041E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u0435")?.duration ?? 360;
          finalDurationStr = this.utils.formatDuration(finalDuration);
          return { finalName, finalDuration, finalDurationStr };
        }
        if (insultCount > 0 && trollingCount > 2) {
          finalName = "\u0422\u0440\u043E\u043B\u043B\u0438\u043D\u0433/\u043F\u0440\u043E\u0432\u043E\u043A\u0430\u0446\u0438\u044F";
          finalDuration = this.rules.find((r) => r.name === "\u0422\u0440\u043E\u043B\u043B\u0438\u043D\u0433/\u043F\u0440\u043E\u0432\u043E\u043A\u0430\u0446\u0438\u044F")?.duration ?? 360;
          finalDurationStr = this.utils.formatDuration(finalDuration);
          return { finalName, finalDuration, finalDurationStr };
        }
      }
      if (rule.name === "\u041E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u0435") {
        if (count > 4) {
          finalName = "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C (\u041C\u043D\u043E\u0433\u043E\u043A\u0440\u0430\u0442\u043D\u044B\u0435 \u043E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u044F)";
          finalDuration = 720;
          finalDurationStr = "12 \u0447\u0430\u0441\u043E\u0432";
        } else if (count === 1) {
          finalDuration = 0;
          finalDurationStr = "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435";
        }
      } else if (rule.name === "\u0422\u0440\u043E\u043B\u043B\u0438\u043D\u0433/\u043F\u0440\u043E\u0432\u043E\u043A\u0430\u0446\u0438\u044F") {
        if (count === 2) {
          finalDuration = 0;
          finalDurationStr = "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435";
        }
      } else if (rule.name === "\u0421\u043F\u0430\u043C \u0432 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D/\u0447\u0430\u0442") {
        const muteCount = Number(this.spamRules?.muteCount) || 4;
        if (count < muteCount) {
          finalDuration = 0;
          finalDurationStr = "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435";
        }
      } else if (rule.name === "\u0420\u0430\u0441\u0438\u0437\u043C / \u0434\u0438\u0441\u043A\u0440\u0438\u043C\u0438\u043D\u0430\u0446\u0438\u044F" && count < 2) {
        finalDuration = 0;
        finalDurationStr = "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435";
      } else if (rule.name === "\u0420\u0435\u043A\u043B\u0430\u043C\u0430" && count < 2) {
        finalDuration = 0;
        finalDurationStr = "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435";
      }
      return { finalName, finalDuration, finalDurationStr };
    },
    getWarningHistoryBlockScoped(scope) {
      return this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439", scope) || this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439", scope);
    },
    parseWarningHistoryRows(warningHistoryBlock) {
      if (warningHistoryBlock?.nativeHistory) return warningHistoryBlock.items.map((w) => ({ date: new Date(w.timeMs), text: w.text }));
      if (!warningHistoryBlock) {
        return [];
      }
      const warnings = [];
      warningHistoryBlock.querySelectorAll("tbody tr, tr").forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 4) {
          return;
        }
        const dateIndex = this.getColumnIndex(row, ["\u0434\u0430\u0442\u0430"], 1);
        const textIndex = this.getColumnIndex(row, ["\u0442\u0435\u043A\u0441\u0442"], Math.min(3, cells.length - 1));
        const warningDate = this.parseDateCell(cells[dateIndex]);
        const warningText = (cells[textIndex]?.innerText || "").replace(/\s+/g, " ").trim();
        if (!warningDate || !warningText) {
          return;
        }
        warnings.push({ date: warningDate, text: warningText });
      });
      return warnings;
    },
    warningTextMatchesRule(text, ruleName) {
      const lowered = String(text || "").toLowerCase();
      const matchers = {
        "\u041E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u0435": [/оскорбл/i, /insult/i],
        "\u0422\u0440\u043E\u043B\u043B\u0438\u043D\u0433/\u043F\u0440\u043E\u0432\u043E\u043A\u0430\u0446\u0438\u044F": [/провоц/i, /provok/i],
        "\u0421\u043F\u0430\u043C \u0432 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D/\u0447\u0430\u0442": [/спам/i, /spam/i],
        "\u0420\u0430\u0441\u0438\u0437\u043C / \u0434\u0438\u0441\u043A\u0440\u0438\u043C\u0438\u043D\u0430\u0446\u0438\u044F": [/расист/i, /racist/i, /racism/i, /discriminat/i],
        "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C": [/токсич/i, /оскорбл/i, /toxic/i],
        "\u041C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433": [/монитор/i, /monitor/i],
        "\u041F\u0440\u0435\u043F\u044F\u0442\u0441\u0442\u0432\u0438\u0435": [/препятств/i]
      };
      const patterns = matchers[ruleName];
      if (!patterns) {
        return false;
      }
      return patterns.some((pattern) => pattern.test(lowered));
    },
    getWarningHistorySignaturePart(warningHistoryBlock) {
      if (warningHistoryBlock?.nativeHistory) return JSON.stringify(warningHistoryBlock.items);
      if (!warningHistoryBlock) {
        return "warn:0|";
      }
      const warnRows = Array.from(warningHistoryBlock.querySelectorAll("tbody tr, tr")).filter((row) => row.querySelector("td"));
      const lastWarn = warnRows[warnRows.length - 1];
      const warnTail = (lastWarn?.innerText || "").trim().slice(0, 220);
      return `warn:${warnRows.length}|${warnTail}`;
    },
    getCoveringWarningWithoutNewTriggers(warningHistoryBlock, allViolations) {
      const warnings = this.parseWarningHistoryRows(warningHistoryBlock);
      if (!warnings.length || !allViolations?.length) {
        return null;
      }
      let latestCoveringWarning = null;
      for (const warning of warnings) {
        const warningMs = warning.date.getTime();
        const coversSome = allViolations.some(
          (violation) => violation?.timeMs && violation.ruleName && warningMs > violation.timeMs && this.warningTextMatchesRule(warning.text, violation.ruleName)
        );
        if (coversSome && (!latestCoveringWarning || warningMs > latestCoveringWarning.date.getTime())) {
          latestCoveringWarning = warning;
        }
      }
      if (!latestCoveringWarning) {
        return null;
      }
      const latestCoveringWarningMs = latestCoveringWarning.date.getTime();
      const hasNewTriggersAfterWarning = allViolations.some(
        (violation) => violation?.timeMs && violation.timeMs > latestCoveringWarningMs
      );
      return hasNewTriggersAfterWarning ? null : latestCoveringWarning;
    }
  };

  // modules/ticket/AnalysisBadge.js
  var AnalysisBadgeMethods = {
    setSuggestedMuteReason(steamId3, label) {
      this.suggestedMuteReason = label ? { steamId: steamId3 || "", label } : null;
    },
    getSuggestedMuteReason(steamId3) {
      const entry = this.suggestedMuteReason;
      if (!entry?.label) {
        return null;
      }
      if (!entry.steamId || !steamId3 || entry.steamId === steamId3) {
        return entry.label;
      }
      return null;
    },
    clearSuggestedMuteReason() {
      this.suggestedMuteReason = null;
    },
    buildTriggerHtml(trigger) {
      return `<span
        class="ioh-trigger-tooltip ioh-trigger-link"
        data-trigger-id="${trigger.id}"
        data-full-msg="${this.utils.escapeHtml(trigger.fullMessage)}">
        ${this.utils.escapeHtml(trigger.keyword)}
    </span>`;
    },
    getTriggerSeparatorHtml() {
      return '<span class="ioh-trigger-separator">,</span> ';
    },
    buildVisibleTriggersHtml() {
      const sortedTriggers = this._sortedTriggers || [];
      const visible = sortedTriggers.slice(0, this._visibleTriggerCount);
      const separator = this.getTriggerSeparatorHtml();
      let html = visible.map((trigger) => this.buildTriggerHtml(trigger)).join(separator);
      if (sortedTriggers.length > this._visibleTriggerCount) {
        html += `${separator}<span class="ioh-trigger-tooltip ioh-more-triggers">\u0435\u0449\u0451</span>`;
      }
      return html;
    },
    revealMoreTriggers(button) {
      const all = this._sortedTriggers || [];
      const step = Number(this.settings?.moreTriggers) || 10;
      const from = this._visibleTriggerCount;
      const to = Math.min(from + step, all.length);
      const extra = all.slice(from, to);
      if (!extra.length) {
        this.removeMoreTriggersButton(button);
        return;
      }
      const separator = this.getTriggerSeparatorHtml();
      const html = extra.map((trigger) => this.buildTriggerHtml(trigger)).join(separator);
      button.insertAdjacentHTML("beforebegin", `${separator}${html}`);
      this._visibleTriggerCount = to;
      if (to >= all.length) {
        this.removeMoreTriggersButton(button);
      }
    },
    removeMoreTriggersButton(button) {
      const prev = button.previousElementSibling;
      if (prev?.classList.contains("ioh-trigger-separator")) {
        prev.remove();
      }
      button.remove();
    },
    cancelTriggerNavigation() {
      this.badgeService?.hideTriggerTooltip?.();
      this._triggerNavigationCancel?.();
      this._triggerNavigationCancel = null;
      clearTimeout(this._triggerHighlightTimer);
      this._triggerHighlightedRows?.forEach((row) => row.classList.remove("ioh-chat-highlight"));
      this._triggerHighlightedRows = null;
    },
    waitForNativeMessageRows(scope, textarea, messages) {
      const key = this.getNativeTicket(scope)?.key;
      return new Promise((resolve) => {
        let observer, timer, finished = false;
        const finish = (rows) => {
          if (finished) return;
          finished = true;
          observer?.disconnect();
          clearTimeout(timer);
          if (this._triggerNavigationCancel === cancel) this._triggerNavigationCancel = null;
          resolve(rows);
        };
        const cancel = () => finish([]);
        const check = () => {
          if (!this.document.contains(textarea) || !this.isVisibleTicketTextarea(textarea) || this.getTicketScopeRoot(textarea) !== scope || this.getNativeTicket(scope)?.key !== key) return finish([]);
          const bindings = this.bindNativeMessageRows(scope);
          const rows = messages.map((m) => bindings.get(m.id)).filter(Boolean);
          if (rows.length) finish(rows);
        };
        this._triggerNavigationCancel = cancel;
        observer = new MutationObserver(check);
        observer.observe(this.getHistorySectionCard("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scope) || scope, { childList: true, subtree: true });
        timer = setTimeout(() => finish([]), 2e3);
        const accordion = this.getHistoryAccordionButton("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scope);
        if (accordion?.getAttribute("aria-expanded") === "false") accordion.click();
        check();
      });
    },
    async handleTriggerClick(e) {
      const more = e.target.closest(".ioh-more-triggers");
      if (more) {
        this.revealMoreTriggers(more);
        return;
      }
      const trigger = e.target.closest(".ioh-trigger-link");
      if (!trigger) return;
      const target = this.triggerRows.get(trigger.dataset.triggerId);
      if (!target) return;
      this.cancelTriggerNavigation();
      let rows = Array.isArray(target) ? target : [target];
      if (this.nativeData) {
        const textarea = this.findVisibleTicketResolutionTextarea();
        const scope = textarea && this.getTicketScopeRoot(textarea);
        const binding = scope && this.bindNativeMessageRows(scope);
        const messages = rows;
        rows = messages.map((message) => binding?.get(message.id)).filter(Boolean);
        if (!rows.length && scope) rows = await this.waitForNativeMessageRows(scope, textarea, messages);
        if (!rows.length) return;
      }
      rows[0].scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      rows.forEach((row) => row.classList.add("ioh-chat-highlight"));
      this._triggerHighlightedRows = rows;
      this._triggerHighlightTimer = setTimeout(() => {
        rows.forEach((row) => row.classList.remove("ioh-chat-highlight"));
        this._triggerHighlightedRows = null;
      }, 1e3);
    },
    clearTicketRuleBadge() {
      this.cancelTriggerNavigation();
      this.stopActivePunishmentPreviews?.();
      this.document.getElementById("helper-suggest-badge")?.remove();
      this.activePunishmentBadgeByKey.clear();
      this._sortedTriggers = [];
      this._visibleTriggerCount = 0;
      this.clearSuggestedMuteReason();
    },
    getAnalysisIcons() {
      const icons = window.Icons || {};
      return {
        triggers: icons.loupe || "",
        reason: icons.bell || "",
        info: icons.info || "",
        punishment: icons.clock || "",
        chatError: icons.chat || "",
        done: icons.done || icons.shield || "",
        ban: icons.ban || "",
        mute: icons.mute || "",
        warning: icons.warning || ""
      };
    }
  };

  // modules/ticket/ActivePunishment.js
  var ActivePunishmentMethods = {
    getPunishmentPreviewBlock(record3, scope) {
      if (!(record3?.nativePunishment || record3?.nativeStatus) || !scope) return null;
      const label = record3.kind === "bans" ? "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0411\u0430\u043D\u043E\u0432" : record3.kind === "warnings" ? "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439" : "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041C\u0443\u0442\u043E\u0432";
      return this.getBlockByHeaderScoped(label, scope) || record3.kind === "warnings" && this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439", scope) || this.getBlockByHeaderScoped(label.toLowerCase().replace("\u0438\u0441\u0442\u043E\u0440\u0438\u044F", "\u0418\u0441\u0442\u043E\u0440\u0438\u044F"), scope);
    },
    findPunishmentPreviewRow(record3, scope) {
      const block = this.getPunishmentPreviewBlock(record3, scope);
      if (!block) return null;
      const rows = [...block.querySelectorAll("tbody tr")].filter((r) => !isIohNode(r));
      const byId = rows.filter((r) => [r.dataset?.bid, r.dataset?.id, r.getAttribute?.("data-punishment-id")].some((id) => id && String(id) === record3.id));
      if (byId.length === 1) return byId[0];
      const candidates = rows.filter((row) => {
        const cells = row.querySelectorAll("td");
        const date = this.parseDateCell(cells[this.getColumnIndex(row, ["\u0434\u0430\u0442\u0430"], 1)]);
        if (!date || !Number.isFinite(record3.created) || Math.abs(date.getTime() - record3.created) >= 6e4) return false;
        const text = (row.innerText || row.textContent || "").replace(/\s+/g, " ").trim();
        const reasonCell = cells[this.getColumnIndex(row, ["\u043F\u0440\u0438\u0447\u0438\u043D\u0430", "\u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F"], 2)];
        const reason = reasonCell?.firstElementChild?.firstElementChild?.textContent || reasonCell?.textContent;
        return record3.kind === "warnings" ? text.includes(record3.reason.replace(/\s+/g, " ").trim()) : this.normalizeReason(reason) === this.normalizeReason(record3.reason);
      });
      if (candidates.length === 1) return candidates[0];
      if (record3.kind === "warnings") return null;
      const active = rows.filter((row) => this.findActivePunishmentRow({ querySelectorAll: () => [row] }) === row);
      return active.length === 1 ? active[0] : null;
    },
    syncActivePunishmentPreview(textarea, record3, icon, message) {
      if (!this.nativeData || !(record3?.nativePunishment || record3?.nativeStatus)) return;
      const scope = this.getTicketScopeRoot(textarea), ticket = this.getNativeTicket(scope);
      if (!ticket) return;
      this._activePreviewSessions ||= /* @__PURE__ */ new Map();
      const identity = `${ticket.key}:${ticket.suspectId}:${record3.kind}:${record3.id}:${record3.created}`;
      const previous = this._activePreviewSessions.get(textarea);
      if (previous?.identity === identity) {
        previous.refresh();
        return;
      }
      this.releaseActivePunishmentPreview(textarea);
      const session = { identity, textarea, scope, record: record3, observer: null, html: null };
      const refresh = () => {
        const current = this.getNativeTicket(scope);
        if (!this.document.contains(textarea) || this.getTicketScopeRoot(textarea) !== scope || current?.key !== ticket.key || current?.suspectId !== ticket.suspectId) return this.releaseActivePunishmentPreview(textarea);
        if (!this.isVisibleTicketTextarea(textarea)) return;
        const badge = this.document.getElementById("helper-suggest-badge");
        if (!badge || badge.parentNode !== textarea.parentNode || !badge.textContent.includes(message.trim())) return;
        const html = this.buildActivePunishmentBadge(icon, message, record3, textarea);
        const table = this.getPunishmentPreviewBlock(record3, scope)?.querySelector("table");
        if (table && table !== session.table) {
          session.table = table;
          session.observer.observe(table, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["class", "style", "data-punishment-id", "data-id", "data-bid"]
          });
        }
        if (session.html === html) return;
        session.html = html;
        this.badgeService.updateInfoBadge("helper-suggest-badge", record3.kind === "bans" ? "accent" : "warning", html, textarea);
      };
      session.refresh = refresh;
      session.observer = new MutationObserver((mutations) => {
        if (!mutations.every((m) => isIohNode(m.target))) refresh();
      });
      session.observer.observe(scope, { childList: true, subtree: true });
      this._activePreviewSessions.set(textarea, session);
      refresh();
    },
    releaseActivePunishmentPreview(textarea) {
      this._activePreviewSessions?.get(textarea)?.observer.disconnect();
      this._activePreviewSessions?.delete(textarea);
    },
    stopActivePunishmentPreviews() {
      for (const textarea of this._activePreviewSessions?.keys() || []) this.releaseActivePunishmentPreview(textarea);
    },
    LIFTED_STATUS_RGB: "21, 141, 183",
    ACTIVE_STATUS_RGBS: ["234, 179, 8", "250, 204, 21", "255, 193, 7"],
    DURATION_TEXT_RE: /(\d+)\s*(день|дня|дней|д\.|час|часа|часов|ч\.|мин|минут|м\.)/i,
    findActivePunishmentRow(historyBlock) {
      if (historyBlock?.nativeHistory) return historyBlock.active;
      if (!historyBlock) {
        return null;
      }
      const punishmentRows = historyBlock.querySelectorAll("tbody tr");
      for (const punishmentRow of punishmentRows) {
        const cells = punishmentRow.querySelectorAll("td");
        if (cells.length < 5) {
          continue;
        }
        if (this.isLiftedPunishmentRow(punishmentRow, cells[0])) {
          continue;
        }
        if (this.hasActivePunishmentIndicator(punishmentRow, cells[0])) {
          return punishmentRow;
        }
        const dateIndex = this.getColumnIndex(punishmentRow, ["\u0434\u0430\u0442\u0430"], 1);
        const durationIndex = this.getColumnIndex(punishmentRow, ["\u0434\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C"], cells.length - 1);
        const dateCell = cells[dateIndex];
        const spans = dateCell?.querySelectorAll("span") || [];
        const dateText = spans[0]?.textContent?.trim() || spans[0]?.innerText?.trim();
        const timeText = spans[1]?.textContent?.trim() || spans[1]?.innerText?.trim();
        const durationText = cells[durationIndex]?.textContent?.trim() || cells[durationIndex]?.innerText?.trim();
        if (!this.isRealDurationText(durationText) || !dateText || !timeText) {
          continue;
        }
        const [d, m, y] = dateText.split(".").map(Number);
        const [hh, mm] = timeText.split(":").map(Number);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y) && !isNaN(hh) && !isNaN(mm)) {
          const punishmentStart = new Date(y, m - 1, d, hh, mm, 0);
          const durationMins = this.utils.parseDurationToMinutes(durationText);
          if (durationMins > 0) {
            const punishmentEnd = new Date(punishmentStart.getTime() + durationMins * 60 * 1e3);
            if (/* @__PURE__ */ new Date() < punishmentEnd) {
              return punishmentRow;
            }
          }
        }
      }
      return null;
    },
    getPunishmentStatusIndicator(row, firstCell) {
      return firstCell?.querySelector("span") || firstCell || null;
    },
    getPunishmentStatusMarkup(row, firstCell) {
      const indicator = this.getPunishmentStatusIndicator(row, firstCell);
      return `${row?.innerHTML || ""} ${indicator?.outerHTML || ""}`;
    },
    matchesRgb(value, rgb) {
      return (value || "").replace(/\s+/g, "").includes(rgb.replace(/\s+/g, ""));
    },
    isLiftedPunishmentRow(row, firstCell) {
      const markup = this.getPunishmentStatusMarkup(row, firstCell);
      if (/status-lifted|--color-status-lifted|color-status-lifted|#158db7/i.test(markup)) {
        return true;
      }
      const indicator = this.getPunishmentStatusIndicator(row, firstCell);
      if (!indicator || typeof window.getComputedStyle !== "function") {
        return false;
      }
      const style = window.getComputedStyle(indicator);
      const colorSources = [style.backgroundColor, style.color, style.borderColor];
      return colorSources.some((value) => this.matchesRgb(value, this.LIFTED_STATUS_RGB));
    },
    hasActivePunishmentIndicator(row, firstCell) {
      const markup = this.getPunishmentStatusMarkup(row, firstCell);
      if (/status-lifted|--color-status-lifted|color-status-lifted/i.test(markup)) {
        return false;
      }
      const hasActiveVar = markup.includes("--color-status-active") || /status-active/i.test(markup);
      const indicator = this.getPunishmentStatusIndicator(row, firstCell);
      if (!indicator || typeof window.getComputedStyle !== "function") {
        return hasActiveVar;
      }
      const computedBg = window.getComputedStyle(indicator).backgroundColor || "";
      const isYellowBg = this.ACTIVE_STATUS_RGBS.some((rgb) => this.matchesRgb(computedBg, rgb));
      return hasActiveVar || isYellowBg;
    },
    isRealDurationText(durationText) {
      return this.DURATION_TEXT_RE.test(String(durationText || ""));
    },
    hasActiveMute(muteHistoryBlock) {
      return Boolean(this.findActivePunishmentRow(muteHistoryBlock));
    },
    hasActiveBan(banHistoryBlock) {
      return Boolean(this.findActivePunishmentRow(banHistoryBlock));
    },
    buildPunishmentPreviewPanel(activeRow, scope = null) {
      if (activeRow?.nativePunishment || activeRow?.nativeStatus) {
        activeRow = this.findPunishmentPreviewRow(activeRow, scope);
      }
      if (!activeRow) {
        return "";
      }
      return `<span class="ioh-punishment-preview-tooltip__panel"><span class="ioh-punishment-preview-tooltip__panel-inner"><table><tbody>${activeRow.outerHTML}</tbody></table></span></span>`;
    },
    getPunishmentRowFingerprint(row) {
      if (row?.nativeStatus) return JSON.stringify(row);
      if (row?.nativePunishment) return JSON.stringify(row);
      return (row?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300);
    },
    shouldSkipActivePunishmentBadge(type, row, textarea) {
      const key = this.getChatCacheKey(textarea);
      const fingerprint = this.getPunishmentRowFingerprint(row);
      const prev = this.activePunishmentBadgeByKey.get(key);
      if (prev?.type === type && prev?.fingerprint === fingerprint) {
        return true;
      }
      this.activePunishmentBadgeByKey.set(key, { type, fingerprint });
      return false;
    },
    buildActivePunishmentBadge(icon, message, activeRow, textarea = null) {
      if (!activeRow) {
        return `<div class="ioh-badge-row"><span class="ioh-icon-box">${icon}</span><span><b>${message}</b></span></div>`;
      }
      const preview = this.buildPunishmentPreviewPanel(activeRow, textarea && this.getTicketScopeRoot?.(textarea));
      if (!preview && activeRow.kind === "warnings") return `<div class="ioh-badge-row ioh-warning-text-tooltip" data-full-msg="${this.utils.escapeHtml(activeRow.reason)}" title=""><span class="ioh-icon-box">${icon}</span><span><b>${message}</b></span></div>`;
      if (!preview) return `<div class="ioh-badge-row"><span class="ioh-icon-box">${icon}</span><span><b>${message}</b></span></div>`;
      return `<div class="ioh-badge-row ioh-punishment-preview-tooltip" tabindex="0"><span class="ioh-icon-box">${icon}</span><span><b>${message}</b></span>${preview}</div>`;
    }
  };

  // modules/ServerConnectionMemory.js
  function normalizeServerEndpoint(value) {
    const text = String(value || "").trim().replace(/^steam:\/\/connect\//i, "");
    const endpoint2 = text.split(/[/?#]/, 1)[0].toLowerCase();
    const match = endpoint2.match(/^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\]):(\d{1,10})$/i);
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
  function validRecord(record3) {
    return record3 && normalizeServerEndpoint(record3.endpoint) === record3.endpoint && Number.isSafeInteger(record3.revision) && record3.revision > 0;
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
        const endpoint2 = serverEndpointFromConnectUrl(link?.href);
        if (endpoint2) this.remember(endpoint2, "manual");
      };
      this.onMessage = (message) => {
        if (message.action === "serverConnectionChanged") this.accept(message.record);
      };
    }
    get endpoint() {
      return this.optimistic?.endpoint || this.record?.endpoint || null;
    }
    accept(record3) {
      if (this.alive && validRecord(record3) && record3.revision > (this.record?.revision || 0)) {
        this.record = record3;
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
      const endpoint2 = normalizeServerEndpoint(value);
      if (!this.alive || !endpoint2) return;
      const version = ++this.writeVersion;
      this.optimistic = { endpoint: endpoint2, pending: true };
      console.log(`[Helper] \u0417\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043E \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (${source === "manual" ? "\u0432\u0440\u0443\u0447\u043D\u0443\u044E" : "\u0430\u0432\u0442\u043E"}):`, endpoint2);
      void (async () => {
        try {
          const response = await this.chrome?.runtime?.sendMessage({ action: "rememberServerConnection", endpoint: endpoint2, source });
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
    clickAutomatically(link, endpoint2) {
      this.remember(endpoint2, "auto");
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

  // modules/ticket/AutoConnect.js
  var AutoConnectMethods = {
    clearAutoConnectedServers() {
      this.autoConnectedServerIps.clear();
      this._autoConnectSkipLoggedIps.clear();
      delete this.document.body.dataset.autoConnected;
      delete this.document.body.dataset.autoConnectedFor;
    },
    getAutoConnectTicketKey() {
      const scope = this.getAutoConnectScope();
      if (!scope || !this.isActiveComplaintScope(scope)) {
        return null;
      }
      if (this.nativeData) {
        const ticket = this.getNativeTicket(scope);
        return ticket ? `${ticket.key}|${ticket.suspectId}` : null;
      }
      const offenderId = this.extractSteamIdFromField(
        this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope)
      ) || "unknown";
      const path = window.location.pathname || window.location.href;
      return `${path}|${offenderId}`;
    },
    hasRecentlyAutoConnected(serverIp) {
      const normalized = normalizeServerEndpoint(serverIp);
      if (!normalized) {
        return false;
      }
      if (this.serverConnectionMemory?.endpoint) {
        return this.serverConnectionMemory.endpoint === normalized;
      }
      const expiresAt = this.autoConnectedServerIps.get(normalized);
      if (!expiresAt) {
        return false;
      }
      if (Date.now() >= expiresAt) {
        this.autoConnectedServerIps.delete(normalized);
        this._autoConnectSkipLoggedIps.delete(normalized);
        return false;
      }
      return true;
    },
    markAutoConnected(serverIp) {
      const normalized = String(serverIp || "").trim().toLowerCase();
      if (!normalized) {
        return;
      }
      this.autoConnectedServerIps.set(normalized, Date.now() + this.LEFT_OFFENDER_TTL_MS);
      this._autoConnectSkipLoggedIps.delete(normalized);
      this.document.body.dataset.autoConnectedFor = normalized;
    },
    logAutoConnectSkipOnce(serverIp, message, debug = null) {
      const normalized = String(serverIp || "").trim().toLowerCase() || "_none";
      if (this._autoConnectSkipLoggedIps.has(normalized)) {
        return;
      }
      this._autoConnectSkipLoggedIps.add(normalized);
      if (debug !== null && debug !== void 0 && debug !== "") {
        console.log(message, debug);
      } else {
        console.log(message);
      }
    },
    markOffenderOffline(steamId3) {
      if (!steamId3) return;
      this.offenderOffline.set(steamId3, Date.now() + this.LEFT_OFFENDER_TTL_MS);
      let tracked = false;
      for (const session of this._openTicketTrackingSessions?.values() || []) {
        if (session.steamId !== steamId3) continue;
        session.waitingForReturn = true;
        session.lastConnectedIp = null;
        tracked = true;
      }
      if (tracked) {
        this.syncOpenTicketOffenderTracking();
      }
    },
    clearOffenderOffline(steamId3) {
      if (!steamId3) return;
      this.offenderOffline.delete(steamId3);
    },
    isOffenderOffline(steamId3) {
      if (!steamId3) return false;
      const expiresAt = this.offenderOffline.get(steamId3);
      if (!expiresAt) return false;
      if (Date.now() >= expiresAt) {
        this.offenderOffline.delete(steamId3);
        return false;
      }
      return true;
    },
    markOffenderRelocated(steamId3, serverIp) {
      if (!steamId3 || !serverIp) return;
      this.offenderRelocated.set(steamId3, {
        serverIp: String(serverIp).trim().toLowerCase(),
        expiresAt: Date.now() + this.LEFT_OFFENDER_TTL_MS
      });
    },
    clearOffenderRelocated(steamId3) {
      if (!steamId3) return;
      this.offenderRelocated.delete(steamId3);
    },
    getOffenderRelocatedServer(steamId3) {
      if (!steamId3) return null;
      const entry = this.offenderRelocated.get(steamId3);
      if (!entry) return null;
      if (Date.now() >= entry.expiresAt) {
        this.offenderRelocated.delete(steamId3);
        return null;
      }
      return entry.serverIp;
    },
    getTicketComplaintParts(scope = null) {
      if (this.nativeData) {
        const t = this.getNativeTicket(scope);
        return { category: t?.reason || "", playerText: t?.message || "" };
      }
      const categoryField = this.findInfoFieldByLabels(["\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u0436\u0430\u043B\u043E\u0431\u044B", "\u041F\u0440\u0438\u0447\u0438\u043D\u0430"], scope);
      const valueBlock = this.findFieldValueBlock(categoryField);
      let category = valueBlock?.querySelector(":scope > span")?.textContent?.trim() || "";
      if (!category) {
        category = this.utils.parseComplaintCell(valueBlock || categoryField).category;
      }
      let playerText = this.getTicketPlayerMessageText(scope);
      if (!playerText) {
        playerText = this.utils.parseComplaintCell(valueBlock || categoryField).playerText;
      }
      return { category, playerText };
    },
    getTicketPlayerMessageText(scope = null) {
      if (this.nativeData) return this.getNativeTicket(scope)?.message || "";
      const messageField = this.findInfoFieldByLabels(["\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043E\u0442 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F"], scope);
      if (!messageField) {
        return "";
      }
      const paragraph = messageField.querySelector(":scope > p");
      if (paragraph) {
        return paragraph.textContent?.trim() || "";
      }
      const valueBlock = this.findFieldValueBlock(messageField);
      if (valueBlock) {
        return valueBlock.textContent?.trim() || "";
      }
      return "";
    },
    getTicketComplaintCategory(scope = null) {
      return this.getTicketComplaintParts(scope).category;
    },
    getPlayerComplaintText(scope = null) {
      return this.getTicketComplaintParts(scope).playerText;
    },
    complaintTextMatchesAutoconnectTrigger(text) {
      const haystack = String(text || "").toLowerCase();
      if (!haystack) return false;
      return (this.settings.reasonTriggersAutoconnect || []).some((trigger) => {
        if (!trigger) return false;
        return haystack.includes(String(trigger).toLowerCase());
      });
    },
    isVoiceFallbackCategory(category) {
      const reasons = this.settings.autoConnectVoiceFallbackReasons || ["\u041D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0435 \u043F\u0440\u0430\u0432\u0438\u043B", "\u0421\u043F\u0430\u043C", "\u041F\u043E\u043F\u0440\u043E\u0448\u0430\u0439\u043D\u0438\u0447\u0435\u0441\u0442\u0432\u043E"];
      const haystack = String(category || "").toLowerCase();
      if (!haystack) {
        return false;
      }
      return reasons.some((reason) => haystack.includes(String(reason).toLowerCase()));
    },
    canAutoConnectAfterAnalysis(scope) {
      if (!this.isVoiceFallbackCategory(this.getTicketComplaintCategory(scope))) return true;
      if (this.nativeData) {
        const t = this.getNativeTicket(scope), p = t && this.nativePlayer(t.suspectId);
        if (typeof p?.isBanned !== "boolean" || typeof p?.isMuted !== "boolean") return false;
      }
      if (this.complaintTextMatchesAutoconnectTrigger(this.getPlayerComplaintText(scope))) {
        return !this.hasActivePunishmentForVoiceFallback(null, scope);
      }
      if (!this.settings?.features?.processTicketRules) return false;
      const result = this.getCompletedChatAnalysis(scope);
      if (!result) return false;
      return (result.kind === "none" || result.kind === "warning") && !this.hasActivePunishmentForVoiceFallback(result.textarea);
    },
    getAutoConnectScope() {
      const visibleTextarea = this.findVisibleTicketResolutionTextarea();
      if (visibleTextarea) {
        return this.getTicketScopeRoot(visibleTextarea);
      }
      return this.findActiveComplaintScope();
    },
    scopeHasInProgressStatus(scope, { includeActivePanel = true } = {}) {
      if (this.nativeData) {
        const t = this.getNativeTicket(scope);
        return Boolean(t && t.status === 1 && !t.endedAt && t.adminId && t.adminId === this.nativeData.account?.steamId);
      }
      if (!scope) {
        return false;
      }
      const roots = [scope];
      const activePanel = includeActivePanel ? this.findActiveComplaintScope() : null;
      if (activePanel && activePanel !== scope) {
        roots.push(activePanel);
      }
      for (const root of roots) {
        const found = Array.from(root.querySelectorAll("span")).some((span) => {
          if (span.textContent.trim() !== "\u0412 \u0440\u0430\u0431\u043E\u0442\u0435") {
            return false;
          }
          let element = span.parentElement;
          while (element && element !== root) {
            if (element.getAttribute?.("aria-hidden") === "true") {
              return false;
            }
            element = element.parentElement;
          }
          return true;
        });
        if (found) {
          return true;
        }
      }
      return false;
    },
    shouldAutoConnectToServer({ analysisFallback = false } = {}) {
      if (this.nativeData) return this.nativeAutoConnectDecision({ analysisFallback });
      const allowedPaths = [
        "/reports/4",
        "/reports/5",
        "/ticket/1",
        "/ticket/2"
      ];
      const isAllowedPage = allowedPaths.some((path) => window.location.href.includes(path));
      if (!isAllowedPage) {
        return { allowed: false, reason: "\u041D\u0435 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u0442\u0438\u043A\u0435\u0442\u0430/\u0440\u0435\u043F\u043E\u0440\u0442\u0430" };
      }
      if (!this.settings?.features?.autoConnectServer) {
        return { allowed: false, reason: "\u0424\u0443\u043D\u043A\u0446\u0438\u044F \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u0430" };
      }
      const scope = this.getAutoConnectScope();
      if (!scope || !this.isActiveComplaintScope(scope)) {
        return { allowed: false, reason: "\u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0442\u0438\u043A\u0435\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" };
      }
      if (!this.scopeHasInProgressStatus(scope)) {
        return { allowed: false, reason: "\u0441\u0442\u0430\u0442\u0443\u0441 '\u0412 \u0440\u0430\u0431\u043E\u0442\u0435' \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u043C \u0442\u0438\u043A\u0435\u0442\u0435" };
      }
      const offenderField = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope);
      const offenderSteamId = this.extractSteamIdFromField(offenderField);
      const relocatedIp = offenderSteamId ? this.getOffenderRelocatedServer(offenderSteamId) : null;
      const ticketConnectLink = this.findTicketServerConnectLink(scope);
      const ticketServerIp = this.extractServerIpFromConnectLink(ticketConnectLink);
      const connectTarget = relocatedIp || ticketServerIp || null;
      const connectSource = relocatedIp ? "relocated-server" : ticketServerIp ? "ticket-server" : null;
      if (offenderSteamId && (this.isOffenderOffline(offenderSteamId) || !relocatedIp && this.ticketServerShowsOffenderLeft(scope))) {
        return {
          allowed: false,
          reason: "\u043D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C \u043D\u0435\u0434\u0430\u0432\u043D\u043E \u0432\u044B\u0448\u0435\u043B \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u0430",
          debug: { connectTarget, connectSource }
        };
      }
      const category = this.getTicketComplaintCategory();
      const playerText = this.getPlayerComplaintText();
      if (!this.canAutoConnectAfterAnalysis(scope)) {
        return { allowed: false, reason: "\u043D\u0435\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u043E\u0433\u043E \u0440\u0430\u0437\u0440\u0435\u0448\u0430\u044E\u0449\u0435\u0433\u043E \u0430\u043D\u0430\u043B\u0438\u0437\u0430 \u0447\u0430\u0442\u0430" };
      }
      if (analysisFallback) {
        return {
          allowed: true,
          reason: "voice-fallback \u043F\u043E\u0441\u043B\u0435 \u0430\u043D\u0430\u043B\u0438\u0437\u0430 \u0447\u0430\u0442\u0430",
          debug: { category, analysisFallback: true, connectTarget, connectSource }
        };
      }
      const allowedReasons = this.settings.autoConnectReasons || ["\u0427\u0438\u0442\u0435\u0440\u0441\u0442\u0432\u043E", "\u0411\u0430\u0433\u043E\u044E\u0437"];
      const reasonAllowed = allowedReasons.some(
        (reason) => category.toLowerCase().includes(String(reason).toLowerCase())
      );
      const triggerAllowed = this.complaintTextMatchesAutoconnectTrigger(playerText);
      if (!reasonAllowed && !triggerAllowed) {
        const playerPreview = playerText ? `${playerText.slice(0, 80)}${playerText.length > 80 ? "\u2026" : ""}` : "(\u043F\u0443\u0441\u0442\u043E)";
        return {
          allowed: false,
          reason: `\u043F\u0440\u0438\u0447\u0438\u043D\u0430 \xAB${category || "\u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430"}\xBB \u043D\u0435 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435 \u0438 \u0442\u0440\u0438\u0433\u0433\u0435\u0440\u044B \u0430\u0432\u0442\u043E\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B`,
          debug: { category, playerPreview, allowedReasons, connectTarget, connectSource }
        };
      }
      return {
        allowed: true,
        reason: reasonAllowed ? "\u043F\u0440\u0438\u0447\u0438\u043D\u0430 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435" : "\u043D\u0430\u0439\u0434\u0435\u043D \u0442\u0440\u0438\u0433\u0433\u0435\u0440 \u0432 \u0442\u0435\u043A\u0441\u0442\u0435 \u0436\u0430\u043B\u043E\u0431\u044B \u0438\u0433\u0440\u043E\u043A\u0430",
        debug: {
          category,
          playerText: playerText?.slice(0, 80),
          allowedReasons,
          connectTarget,
          connectSource
        }
      };
    },
    findTicketServerConnectLink(scope = null) {
      const root = scope || this.getAutoConnectScope() || this.document;
      const serverField = this.findInfoFieldScoped("\u0421\u0435\u0440\u0432\u0435\u0440", root);
      const valueBlock = this.findFieldValueBlock(serverField);
      const scopedLink = valueBlock?.querySelector('a[href^="steam://connect/"]');
      if (scopedLink) {
        return scopedLink;
      }
      for (const link of root.querySelectorAll('a[href^="steam://connect/"]')) {
        if (link.closest("table")) {
          continue;
        }
        return link;
      }
      return null;
    },
    extractServerIpFromConnectLink(link) {
      if (!link?.href) {
        return null;
      }
      return normalizeServerEndpoint(link.href);
    },
    isAlreadyOnRequestedServer(serverIp) {
      return !!this.serverConnectionMemory?.endpoint && this.serverConnectionMemory.endpoint === normalizeServerEndpoint(serverIp);
    },
    clickServerConnectLink(link, endpoint2) {
      if (this.serverConnectionMemory) this.serverConnectionMemory.clickAutomatically(link, endpoint2);
      else link.click();
    },
    connectToSteamServer(serverIp) {
      const normalized = normalizeServerEndpoint(serverIp);
      if (!normalized) {
        return false;
      }
      if (this.isAlreadyOnRequestedServer(normalized)) return false;
      const link = this.document.createElement("a");
      markIoh(link);
      link.href = `steam://connect/${normalized}`;
      link.style.display = "none";
      this.document.body.appendChild(link);
      this.clickServerConnectLink(link, normalized);
      link.remove();
      return true;
    },
    connectToTrackedOffenderServer(session, serverIp) {
      if (!this.isOpenTicketTrackingSessionCurrent(session)) {
        return false;
      }
      if (!this.canAutoConnectAfterAnalysis(session.scope)) return false;
      for (const tracked of this._openTicketTrackingSessions.values()) {
        if (tracked.steamId === session.steamId) tracked.lastConnectedIp = serverIp;
      }
      if (this.isAlreadyOnRequestedServer(serverIp)) {
        this.logAutoConnectSkipOnce(serverIp, "[Helper] \u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043E: \u044D\u0442\u043E\u0442 \u0441\u0435\u0440\u0432\u0435\u0440 \u0443\u0436\u0435 \u0432\u044B\u0431\u0440\u0430\u043D", serverIp);
        return false;
      }
      console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (\u0442\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0439 \u0436\u0430\u043B\u043E\u0431\u044B) \u043A \u0441\u0435\u0440\u0432\u0435\u0440\u0443:", serverIp);
      this.markAutoConnected(serverIp);
      return this.connectToSteamServer(serverIp);
    },
    connectToRelocatedServerForced() {
      if (!this.settings?.features?.autoConnectServer) {
        console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (\u0444\u043E\u0440\u0441-\u043F\u0435\u0440\u0435\u0435\u0437\u0434) \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: \u0444\u0443\u043D\u043A\u0446\u0438\u044F \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u0430");
        return false;
      }
      const scope = this.getAutoConnectScope();
      if (!scope || !this.isActiveComplaintScope(scope)) {
        console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (\u0444\u043E\u0440\u0441-\u043F\u0435\u0440\u0435\u0435\u0437\u0434) \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0442\u0438\u043A\u0435\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
        return false;
      }
      if (!this.scopeHasInProgressStatus(scope)) {
        console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (\u0444\u043E\u0440\u0441-\u043F\u0435\u0440\u0435\u0435\u0437\u0434) \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: \u0441\u0442\u0430\u0442\u0443\u0441 \xAB\u0412 \u0440\u0430\u0431\u043E\u0442\u0435\xBB \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
        return false;
      }
      if (!this.canAutoConnectAfterAnalysis(scope)) return false;
      const offenderField = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope);
      const offenderSteamId = this.extractSteamIdFromField(offenderField);
      const relocatedIp = offenderSteamId ? this.getOffenderRelocatedServer(offenderSteamId) : null;
      if (!relocatedIp) {
        console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (\u0444\u043E\u0440\u0441-\u043F\u0435\u0440\u0435\u0435\u0437\u0434) \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: IP \u043F\u0435\u0440\u0435\u0435\u0437\u0434\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
        return false;
      }
      if (this.isAlreadyOnRequestedServer(relocatedIp)) return false;
      console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (\u0444\u043E\u0440\u0441-\u043F\u0435\u0440\u0435\u0435\u0437\u0434) \u043A \u0441\u0435\u0440\u0432\u0435\u0440\u0443:", relocatedIp);
      this.markAutoConnected(relocatedIp);
      this.connectToSteamServer(relocatedIp);
      return true;
    },
    connectToCurrentServer({ forceRelocate = false, analysisFallback = false } = {}) {
      if (this.nativeData) {
        const t = this.getNativeTicket(this.getAutoConnectScope());
        const p = t && this.nativePlayer(t.suspectId);
        if (!p?.serverIp || !this.shouldAutoConnectToServer({ analysisFallback }).allowed) return false;
        if (this.hasRecentlyAutoConnected(p.serverIp)) return false;
        this.markAutoConnected(p.serverIp);
        return this.connectToSteamServer(p.serverIp);
      }
      if (forceRelocate) {
        return this.connectToRelocatedServerForced();
      }
      const logPrefix = analysisFallback ? "[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (voice-fallback)" : "[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435";
      const decision = this.shouldAutoConnectToServer({ analysisFallback });
      if (!decision.allowed) {
        console.log(`${logPrefix} \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: ${decision.reason}.`, decision.debug || "");
        return false;
      }
      const scope = this.getAutoConnectScope();
      const offenderField = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope);
      const offenderSteamId = this.extractSteamIdFromField(offenderField);
      const relocatedIp = offenderSteamId ? this.getOffenderRelocatedServer(offenderSteamId) : null;
      const connectLink = relocatedIp ? null : this.findTicketServerConnectLink(scope);
      const connectTarget = (relocatedIp || this.extractServerIpFromConnectLink(connectLink) || "").toLowerCase();
      if (connectTarget && this.hasRecentlyAutoConnected(connectTarget)) {
        this.logAutoConnectSkipOnce(
          connectTarget,
          `${logPrefix}: \u0441\u0435\u0440\u0432\u0435\u0440 \u0443\u0436\u0435 \u0432\u044B\u0431\u0440\u0430\u043D \u0438\u043B\u0438 \u043D\u0435\u0434\u0430\u0432\u043D\u043E \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D: ${connectTarget}`
        );
        return false;
      }
      if (relocatedIp) {
        console.log(`${logPrefix} \u043A \u0441\u0435\u0440\u0432\u0435\u0440\u0443 \u043F\u0435\u0440\u0435\u0435\u0437\u0434\u0430:`, relocatedIp, decision.debug || "");
        this.markAutoConnected(connectTarget || relocatedIp);
        this.connectToSteamServer(relocatedIp);
        return true;
      }
      if (connectLink) {
        console.log(`${logPrefix} \u043A \u0441\u0435\u0440\u0432\u0435\u0440\u0443 \u0442\u0438\u043A\u0435\u0442\u0430:`, connectLink.href, decision.debug || "");
        if (connectTarget) {
          this.markAutoConnected(connectTarget);
        }
        this.clickServerConnectLink(connectLink, connectTarget);
        return true;
      }
      console.log(`${logPrefix}: \u0441\u0441\u044B\u043B\u043A\u0430 steam:// \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430 \u0432 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0435 \u0442\u0438\u043A\u0435\u0442\u0430.`, decision.debug || "");
      return false;
    },
    hasActivePunishmentForVoiceFallback(textarea = null, scope = null) {
      scope ||= textarea ? this.getTicketScopeRoot(textarea) : this.getAutoConnectScope() || this.document.body;
      const blocks = this.getHistoryBlocks(scope, { force: true });
      if (this.findActivePunishmentRow(blocks.ban)) {
        return "ban";
      }
      if (this.findActivePunishmentRow(blocks.mute)) {
        return "mute";
      }
      return null;
    },
    async maybeAutoConnectAfterChatAnalysis(analysisResult, textarea = null) {
      if (!this.settings?.features?.autoConnectServer) {
        return false;
      }
      const category = this.getTicketComplaintCategory();
      if (!this.isVoiceFallbackCategory(category)) {
        return false;
      }
      const scope = textarea ? this.getTicketScopeRoot(textarea) : this.getAutoConnectScope();
      if (!textarea || !this.isVisibleTicketTextarea(textarea) || scope !== this.getAutoConnectScope() || !this.canAutoConnectAfterAnalysis(scope)) return false;
      const kind = analysisResult?.kind;
      if (kind !== "none" && kind !== "warning" && !this.complaintTextMatchesAutoconnectTrigger(this.getPlayerComplaintText(scope))) {
        return false;
      }
      const activePunishment = this.hasActivePunishmentForVoiceFallback(textarea);
      if (activePunishment) {
        console.log(
          `[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (voice-fallback) \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: \u0443 \u0438\u0433\u0440\u043E\u043A\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0439 ${activePunishment === "ban" ? "\u0431\u0430\u043D" : "\u043C\u0443\u0442"}`
        );
        return false;
      }
      console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (voice-fallback): \u0430\u043D\u0430\u043B\u0438\u0437", kind, "\u043F\u0440\u0438\u0447\u0438\u043D\u0430", category || "\u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430");
      return this.connectToCurrentServer({ analysisFallback: true });
    }
  };

  // modules/ticket/QueueCards.js
  var QueueCardsMethods = {
    findComplaintQueueTables() {
      const tables = Array.from(this.document.querySelectorAll("table"));
      return tables.filter((table) => this.isComplaintQueueTable(table));
    },
    isComplaintQueueTable(table) {
      const thTexts = Array.from(table.querySelectorAll("thead th")).map((th) => (th.textContent || "").trim());
      if (thTexts.length < 6) {
        return false;
      }
      const hasTime = thTexts.some((t) => t.includes("\u0412\u0440\u0435\u043C\u044F"));
      const hasServer = thTexts.some((t) => t.includes("\u0421\u0435\u0440\u0432\u0435\u0440"));
      const hasSender = thTexts.some((t) => t.includes("\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u0435\u043B\u044C"));
      const hasOffender = thTexts.some((t) => t.includes("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C"));
      const hasReason = thTexts.some((t) => t.includes("\u041F\u0440\u0438\u0447\u0438\u043D\u0430"));
      return hasTime && hasServer && hasSender && hasOffender && hasReason;
    },
    findTicketTablesForCards() {
      return this.findComplaintQueueTables();
    },
    renderSquareTicketCards() {
      const tables = this.findComplaintQueueTables();
      tables.forEach((table) => {
        const headerCells = Array.from(table.querySelectorAll("thead th"));
        const headerLabels = headerCells.map((th) => (th.textContent || "").trim());
        table.querySelectorAll("tbody tr").forEach((row) => {
          const cells = Array.from(row.querySelectorAll("td"));
          cells.forEach((cell, idx) => {
            const label = headerLabels[idx] || "";
            if (!label) return;
            if (cell.dataset.iohLabel === label) return;
            cell.dataset.iohLabel = label;
          });
        });
        table.classList.add("ioh-ticket-cards-enabled");
      });
    },
    clearSquareTicketCards() {
      this.document.querySelectorAll("table.ioh-ticket-cards-enabled").forEach((table) => {
        table.classList.remove("ioh-ticket-cards-enabled");
        table.querySelectorAll("td[data-ioh-label]").forEach((td) => {
          td.removeAttribute("data-ioh-label");
        });
      });
    }
  };

  // modules/ticket/PunishmentPanel.js
  var PunishmentPanelMethods = {
    _isExtensionPunishmentButton(button) {
      return button?.id === this.TICKET_MUTE_BUTTON_ID || button?.id === this.TICKET_BAN_BUTTON_ID || Boolean(button?.closest(`#${this.TICKET_PUNISHMENT_ACTIONS_ID}`));
    },
    async loadModeratorPermissions() {
      if (this.nativeData) {
        this.syncNativePermissions();
        return;
      }
      let permissions = null;
      if (this.chrome?.storage?.local) {
        try {
          const result = await this.chrome.storage.local.get(this.MODERATOR_PERMISSIONS_KEY);
          if (result[this.MODERATOR_PERMISSIONS_KEY]) {
            permissions = result[this.MODERATOR_PERMISSIONS_KEY];
          }
        } catch (error) {
        }
      }
      if (!permissions) {
        try {
          const sessionRaw = sessionStorage.getItem(this.MODERATOR_PERMISSIONS_KEY);
          if (sessionRaw) {
            permissions = JSON.parse(sessionRaw);
          }
        } catch (error) {
        }
      }
      this.canIssueMute = Boolean(permissions?.mute);
      this.canIssueBan = Boolean(permissions?.ban);
      this.mutePanelReady = Boolean(permissions?.mutePanelReady);
      this.banPanelReady = Boolean(permissions?.banPanelReady);
      this._permissionsHydrated = true;
    },
    isPunishmentDebugEnabled() {
      try {
        return localStorage.getItem("iohDebugPunishment") === "1";
      } catch (error) {
        return false;
      }
    },
    debugPunishmentLog(reason, details = {}) {
      if (!this.isPunishmentDebugEnabled()) {
        return;
      }
      console.warn(`[IO Helper][punishment] ${reason}`, details);
    },
    recordPunishmentOpenSuccess() {
      this._punishmentInitFailCount = 0;
    },
    handlePunishmentOpenFailure(type) {
      this.resetPanelReady(type);
      if (type === "ban") {
        this._cachedOpenBanHandler = null;
        this._cachedBanIssueButton = null;
      } else {
        this._cachedOpenMuteHandler = null;
        this._cachedMuteIssueButton = null;
      }
      this._punishmentInitFailCount += 1;
      if (this._punishmentInitFailCount < 2) {
        return;
      }
      this._punishmentInitFailCount = 0;
      if (type === "ban") {
        this.canIssueBan = false;
      } else {
        this.canIssueMute = false;
      }
      void this._persistModeratorPermissions();
      this.refreshComplaintPunishmentButtons();
    },
    async persistPanelReadyState() {
      await this._persistModeratorPermissions();
    },
    isPanelReadyForType(type) {
      return type === "ban" ? this.banPanelReady : this.mutePanelReady;
    },
    resetPanelReady(type) {
      if (type === "ban") {
        this.banPanelReady = false;
        this._cachedOpenBanHandler = null;
        this._cachedBanIssueButton = null;
        return;
      }
      this.mutePanelReady = false;
      this._cachedOpenMuteHandler = null;
      this._cachedMuteIssueButton = null;
    },
    getCachedIssueButton(type) {
      const button = type === "ban" ? this._cachedBanIssueButton : this._cachedMuteIssueButton;
      return button?.isConnected ? button : null;
    },
    getLastKnownIssueButton(type) {
      return type === "ban" ? this._cachedBanIssueButton : this._cachedMuteIssueButton;
    },
    getCachedIssueHandler(type) {
      const handler = type === "ban" ? this._cachedOpenBanHandler : this._cachedOpenMuteHandler;
      return typeof handler === "function" ? handler : null;
    },
    isManagementPanelMounted(type) {
      return Boolean(this.findSiteIssueButtonForType(type, { requireVisible: false }));
    },
    findSiteIssueButtonForType(type, options = {}) {
      return this.findSiteIssueButtonInSection(
        this.getManagementSectionTitleForType(type),
        options
      );
    },
    resolveIssueButtonForType(type) {
      const sectionTitle = this.getManagementSectionTitleForType(type);
      let button = this.getCachedIssueButton(type);
      if (!button?.isConnected || !this._isButtonInSection(button, sectionTitle)) {
        button = this.findSiteIssueButtonForType(type, { requireVisible: false });
      }
      if (!button || !this._isButtonInSection(button, sectionTitle)) {
        return null;
      }
      this._cacheIssueHandlerFromButton(button, type);
      return button;
    },
    markPanelReady(type) {
      if (type === "ban") {
        this.banPanelReady = true;
      } else {
        this.mutePanelReady = true;
      }
    },
    suppressPermissionScan() {
      this._permissionScanSuppressed += 1;
    },
    releasePermissionScan() {
      if (this._permissionScanSuppressed > 0) {
        this._permissionScanSuppressed -= 1;
      }
    },
    _handleManagementPanelVisibilityForScan() {
      const muteActive = this.isMuteManagementPanelActive();
      const banActive = this.isBanManagementPanelActive();
      if (this._permissionScanSuppressed > 0) {
        this._wasMutePanelActive = muteActive;
        this._wasBanPanelActive = banActive;
        return;
      }
      const shouldScan = muteActive && !this._wasMutePanelActive || banActive && !this._wasBanPanelActive;
      this._wasMutePanelActive = muteActive;
      this._wasBanPanelActive = banActive;
      if (shouldScan) {
        void this.scanModeratorPunishmentPermissions();
      }
    },
    _cancelPermissionRevoke(type) {
      const timerKey = type === "ban" ? "_banRevokeDebounceId" : "_muteRevokeDebounceId";
      if (this[timerKey]) {
        clearTimeout(this[timerKey]);
        this[timerKey] = null;
      }
    },
    _schedulePermissionRevoke(type) {
      const timerKey = type === "ban" ? "_banRevokeDebounceId" : "_muteRevokeDebounceId";
      this._cancelPermissionRevoke(type);
      this[timerKey] = setTimeout(() => {
        this[timerKey] = null;
        void this._tryRevokePermission(type);
      }, 500);
    },
    async _tryRevokePermission(type) {
      if (this._isUpdatingPunishmentButtons) {
        return;
      }
      const panelActive = type === "ban" ? this.isBanManagementPanelActive() : this.isMuteManagementPanelActive();
      const button = type === "ban" ? this.findSiteIssueBanButton() : this.findSiteIssueMuteButton();
      if (!panelActive || button) {
        return;
      }
      let changed = false;
      if (type === "ban" && this.canIssueBan) {
        this.canIssueBan = false;
        this.banPanelReady = false;
        this._cachedOpenBanHandler = null;
        this._cachedBanIssueButton = null;
        changed = true;
      } else if (type === "mute" && this.canIssueMute) {
        this.canIssueMute = false;
        this.mutePanelReady = false;
        this._cachedOpenMuteHandler = null;
        this._cachedMuteIssueButton = null;
        changed = true;
      }
      if (!changed) {
        return;
      }
      await this._persistModeratorPermissions();
      this.refreshComplaintPunishmentButtons();
    },
    async _persistModeratorPermissions() {
      const permissions = {
        mute: this.canIssueMute,
        ban: this.canIssueBan,
        mutePanelReady: this.mutePanelReady,
        banPanelReady: this.banPanelReady
      };
      try {
        sessionStorage.setItem(this.MODERATOR_PERMISSIONS_KEY, JSON.stringify(permissions));
      } catch (error) {
      }
      if (!this.chrome?.storage?.local) {
        return;
      }
      try {
        await this.chrome.storage.local.set({
          [this.MODERATOR_PERMISSIONS_KEY]: permissions
        });
      } catch (error) {
      }
    },
    isMuteManagementRoute() {
      return /\/comms\/list\b/i.test(window.location.pathname || "");
    },
    isBanManagementRoute() {
      return /\/bans\/list\b/i.test(window.location.pathname || "");
    },
    getManagementRouteForType(type) {
      return type === "ban" ? this.BAN_MANAGEMENT_ROUTE : this.MUTE_MANAGEMENT_ROUTE;
    },
    isMuteManagementPanelActive() {
      return this._isManagementPanelVisible("\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043C\u0443\u0442\u0430\u043C\u0438");
    },
    isBanManagementPanelActive() {
      return this._isManagementPanelVisible("\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0431\u0430\u043D\u0430\u043C\u0438");
    },
    isMuteManagementPage() {
      return this.isMuteManagementPanelActive();
    },
    isBanManagementPage() {
      return this.isBanManagementPanelActive();
    },
    getManagementSectionTitleForType(type) {
      return type === "ban" ? "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0431\u0430\u043D\u0430\u043C\u0438" : "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043C\u0443\u0442\u0430\u043C\u0438";
    },
    isManagementPanelActiveForType(type) {
      return type === "ban" ? this.isBanManagementPanelActive() : this.isMuteManagementPanelActive();
    },
    isManagementSpaTabOpen(type) {
      return Boolean(this.findSpaTabButton(this.getManagementSectionTitleForType(type)));
    },
    findAsideLauncherButton() {
      const aside = this.document.querySelector("aside");
      if (!aside) {
        return null;
      }
      const folderUse = aside.querySelector('use[href="#lc-folder"]');
      const button = folderUse?.closest("button");
      if (!button || this.isExtensionUiElement(button)) {
        return null;
      }
      return button;
    },
    getManagementLinkIconHref(type) {
      return type === "ban" ? "#lc-shield-off" : "#lc-mic-off";
    },
    findAsideManagementLink(type) {
      const route = this.getManagementRouteForType(type);
      const aside = this.document.querySelector("aside");
      if (!aside) {
        return null;
      }
      const byHref = aside.querySelector(
        `nav a.glass-fx[href="${route}"], nav a[class*="glass-fx"][href="${route}"], nav a[href="${route}"]`
      );
      if (byHref && !this.isExtensionUiElement(byHref)) {
        return byHref;
      }
      const iconHref = this.getManagementLinkIconHref(type);
      const byIcon = Array.from(aside.querySelectorAll("nav a")).find((link) => !this.isExtensionUiElement(link) && link.querySelector(`use[href="${iconHref}"]`));
      return byIcon || null;
    },
    isAsideManagementNavVisible() {
      const muteLink = this.findAsideManagementLink("mute");
      const banLink = this.findAsideManagementLink("ban");
      return [muteLink, banLink].some((link) => link && this._isElementVisible(link));
    },
    waitForAsideManagementNav(timeoutMs = 2e3) {
      if (this.isAsideManagementNavVisible()) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const observer = new MutationObserver(() => {
          if (this.isAsideManagementNavVisible()) {
            observer.disconnect();
            resolve(true);
          } else if (Date.now() > deadline) {
            observer.disconnect();
            resolve(false);
          }
        });
        observer.observe(this.document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-hidden", "class", "style", "data-state"]
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(this.isAsideManagementNavVisible());
        }, timeoutMs + 50);
      });
    },
    async openAsideManagementNav() {
      if (this.isAsideManagementNavVisible()) {
        return true;
      }
      const launcher = this.findAsideLauncherButton();
      if (!launcher) {
        this.debugPunishmentLog("aside_launcher_not_found");
        return false;
      }
      if (!this.dispatchElementClick(launcher)) {
        return false;
      }
      const opened = await this.waitForAsideManagementNav(5e3);
      if (!opened) {
        this.debugPunishmentLog("aside_nav_not_opened");
      }
      return opened;
    },
    waitForSpaTabExists(tabLabel, timeoutMs = 3e3) {
      if (this.findSpaTabButton(tabLabel)) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const observer = new MutationObserver(() => {
          if (this.findSpaTabButton(tabLabel)) {
            observer.disconnect();
            resolve(true);
          } else if (Date.now() > deadline) {
            observer.disconnect();
            resolve(false);
          }
        });
        observer.observe(this.document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-current", "aria-hidden", "class"]
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(Boolean(this.findSpaTabButton(tabLabel)));
        }, timeoutMs + 50);
      });
    },
    async openManagementTabViaAside(type) {
      const sectionTitle = this.getManagementSectionTitleForType(type);
      const navOpened = await this.openAsideManagementNav();
      if (!navOpened) {
        return false;
      }
      const link = this.findAsideManagementLink(type);
      if (!link || !this.dispatchElementClick(link)) {
        return false;
      }
      return this.waitForPanelActive(sectionTitle, 5e3);
    },
    findSpaTabCloseButton(tab) {
      if (!tab) {
        return null;
      }
      const closeUse = tab.querySelector('use[href="#lc-x"]');
      if (closeUse) {
        return closeUse.closest('span[role="button"]');
      }
      return Array.from(tab.querySelectorAll('span[role="button"]')).find((span) => span.querySelector("svg") && !span.querySelector('use[href="#lc-rotate-cw"]')) ?? null;
    },
    closeSpaTab(tabLabel) {
      const tab = this.findSpaTabButton(tabLabel);
      if (!tab) {
        return false;
      }
      const closeButton = this.findSpaTabCloseButton(tab);
      if (!closeButton) {
        return false;
      }
      return this.dispatchElementClick(closeButton);
    },
    closeManagementTab(type) {
      return this.closeSpaTab(this.getManagementSectionTitleForType(type));
    },
    findSpaTabButton(tabLabel) {
      if (!tabLabel) {
        return null;
      }
      const glassFxTabs = Array.from(this.document.querySelectorAll('nav button.glass-fx, nav button[class*="glass-fx"]'));
      for (const button of glassFxTabs) {
        if (this.isExtensionUiElement(button)) {
          continue;
        }
        const spans = Array.from(button.querySelectorAll("span"));
        if (spans.some((span) => span.textContent.trim() === tabLabel)) {
          return button;
        }
      }
      return Array.from(this.document.querySelectorAll("nav button")).find((button) => {
        if (this.isExtensionUiElement(button)) {
          return false;
        }
        return Array.from(button.querySelectorAll("span")).some((span) => span.textContent.trim() === tabLabel);
      }) || null;
    },
    _getAllSpaTabButtons() {
      return Array.from(this.document.querySelectorAll('nav button.glass-fx, nav button[class*="glass-fx"], nav button')).filter((button) => !this.isExtensionUiElement(button));
    },
    _getSpaTabLabelFromButton(button) {
      if (!button) {
        return null;
      }
      const labelSpan = Array.from(button.querySelectorAll("span")).find((span) => span.textContent.trim());
      return labelSpan ? labelSpan.textContent.trim() : null;
    },
    findSpaTabButtonFuzzy(tabLabel, options = {}) {
      const { isComplaintReturn = false } = options;
      if (!tabLabel) {
        return null;
      }
      const exact = this.findSpaTabButton(tabLabel);
      if (exact) {
        const exactLabel = this._getSpaTabLabelFromButton(exact);
        if (!isComplaintReturn || !this.isTicketListTabLabel(exactLabel)) {
          return exact;
        }
      }
      if (isComplaintReturn && tabLabel.toLowerCase() === "\u0442\u0438\u043A\u0435\u0442") {
        return this.findComplaintDetailSpaTab(null);
      }
      const normalizedLabel = tabLabel.toLowerCase();
      for (const button of this._getAllSpaTabButtons()) {
        const label = this._getSpaTabLabelFromButton(button);
        if (!label || this.isTicketListTabLabel(label)) {
          continue;
        }
        const normalized = label.toLowerCase();
        if (normalized === normalizedLabel) {
          return button;
        }
        if (normalized.startsWith(`${normalizedLabel} `) || normalized.startsWith(`${normalizedLabel}#`)) {
          return button;
        }
      }
      return null;
    },
    isTicketListTabLabel(label) {
      if (!label) {
        return false;
      }
      const normalized = label.toLowerCase().trim();
      return this.TICKET_LIST_TAB_LABELS.some((listLabel) => {
        const listNormalized = listLabel.toLowerCase();
        return normalized === listNormalized || normalized.includes(listNormalized);
      });
    },
    extractTicketIdFromComplaintScope(scopeEl) {
      if (this.nativeData) {
        const ticket = this.getNativeTicket(scopeEl);
        return ticket ? String(ticket.id) : null;
      }
      if (!scopeEl) {
        return null;
      }
      const headers = scopeEl.querySelectorAll("h3");
      for (const header of headers) {
        const text = header.textContent || "";
        const ticketMatch = text.match(/(?:тикет|ticket|жалоб|репорт|report)[^#]*#(\d+)/i);
        if (ticketMatch) {
          return ticketMatch[1];
        }
        const hashMatch = text.match(/#(\d+)/);
        if (hashMatch && /тикет|ticket|жалоб|репорт|report/i.test(text)) {
          return hashMatch[1];
        }
      }
      return null;
    },
    extractActiveComplaintTicketId() {
      const scope = this.findActiveComplaintScope() || this._lastPunishmentScope;
      return this.extractTicketIdFromComplaintScope(scope);
    },
    findSpaTabByTicketId(ticketId) {
      if (!ticketId) {
        return null;
      }
      const id = String(ticketId);
      return this._getAllSpaTabButtons().find((button) => {
        const label = this._getSpaTabLabelFromButton(button);
        return label && label.includes(`#${id}`);
      }) || null;
    },
    findComplaintDetailSpaTab(ticketId = null) {
      if (ticketId) {
        const byId = this.findSpaTabByTicketId(ticketId);
        if (byId) {
          return byId;
        }
      }
      return this._getAllSpaTabButtons().find((button) => {
        const label = this._getSpaTabLabelFromButton(button);
        if (!label || this.isTicketListTabLabel(label)) {
          return false;
        }
        const normalized = label.toLowerCase();
        return normalized === "\u0442\u0438\u043A\u0435\u0442" || /^тикет\s*#\d+/.test(normalized) || normalized.startsWith("\u0442\u0438\u043A\u0435\u0442 ") && !normalized.includes("\u0430\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0435");
      }) || null;
    },
    isComplaintDetailPath(pathname, ticketId = null) {
      const path = pathname || "";
      if (ticketId && path.includes(String(ticketId))) {
        return true;
      }
      return /\/(?:support\/(?:ticket|report)|tickets?|reports?)\/[\w-]+\/?$/i.test(path) && !/\/(?:support\/)?(?:tickets?|reports?)\/?$/i.test(path);
    },
    isComplaintScopeRestored() {
      return Boolean(this.findActiveComplaintScope());
    },
    waitForComplaintScopeRestored(timeoutMs = 3e3) {
      if (this.isComplaintScopeRestored()) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const observer = new MutationObserver(() => {
          if (this.isComplaintScopeRestored()) {
            observer.disconnect();
            resolve(true);
          } else if (Date.now() > deadline) {
            observer.disconnect();
            resolve(false);
          }
        });
        observer.observe(this.document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-hidden", "class", "style"]
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(this.isComplaintScopeRestored());
        }, timeoutMs + 50);
      });
    },
    findNonManagementSpaTab(excludeLabels = []) {
      const managementLabels = ["\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043C\u0443\u0442\u0430\u043C\u0438", "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0431\u0430\u043D\u0430\u043C\u0438"];
      const exclude = new Set([...managementLabels, ...excludeLabels].map((label) => label.toLowerCase()));
      return this._getAllSpaTabButtons().find((button) => {
        const label = this._getSpaTabLabelFromButton(button);
        return label && !exclude.has(label.toLowerCase()) && !this.isTicketListTabLabel(label);
      }) || null;
    },
    findActiveSpaTabButton() {
      return Array.from(this.document.querySelectorAll('nav button.glass-fx, nav button[class*="glass-fx"]')).find((button) => !this.isExtensionUiElement(button) && button.getAttribute("aria-current") === "page") || null;
    },
    collectSpaTabLabelCandidates() {
      const candidates = [];
      const activeTab = this.findActiveSpaTabButton();
      if (activeTab) {
        const label = this._getSpaTabLabelFromButton(activeTab);
        if (label) {
          candidates.push(label);
        }
      }
      const headerTitle = this.document.querySelector("header span");
      if (headerTitle && !this.isExtensionUiElement(headerTitle)) {
        const text = headerTitle.textContent.trim();
        if (text && !candidates.includes(text)) {
          candidates.push(text);
        }
      }
      return candidates;
    },
    collectReturnTabContext() {
      const complaintScope = this.findActiveComplaintScope() || this._lastPunishmentScope;
      const isComplaintReturn = Boolean(complaintScope && this.isOpenComplaintScope(complaintScope));
      const ticketId = isComplaintReturn ? this.extractTicketIdFromComplaintScope(complaintScope) : null;
      let activeTabButton = this.findActiveSpaTabButton();
      if (!activeTabButton && isComplaintReturn) {
        activeTabButton = this.findComplaintDetailSpaTab(ticketId);
      }
      const tabLabelCandidates = this.collectSpaTabLabelCandidates();
      if (ticketId) {
        const ticketTab = this.findSpaTabByTicketId(ticketId);
        if (ticketTab) {
          activeTabButton = ticketTab;
          const ticketTabLabel = this._getSpaTabLabelFromButton(ticketTab);
          if (ticketTabLabel && !tabLabelCandidates.includes(ticketTabLabel)) {
            tabLabelCandidates.unshift(ticketTabLabel);
          }
        }
      }
      const tabLabel = activeTabButton ? this._getSpaTabLabelFromButton(activeTabButton) : tabLabelCandidates[0] || null;
      return {
        pathname: window.location.pathname || "/",
        href: window.location.href,
        tabLabel,
        tabButton: activeTabButton,
        tabLabelCandidates,
        ticketId,
        isComplaintReturn
      };
    },
    isPathnameActive(pathname) {
      return Boolean(pathname && window.location.pathname === pathname);
    },
    navigateViaPushState(pathname) {
      const targetPath = pathname?.startsWith("/") ? pathname : `/${pathname || ""}`;
      if (!targetPath || window.location.pathname === targetPath) {
        return;
      }
      const targetUrl = `${window.location.origin}${targetPath}`;
      window.history.pushState(null, "", targetUrl);
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    },
    async restoreSpaTabFromContext(returnContext) {
      const {
        tabButton,
        tabLabel,
        tabLabelCandidates = [],
        pathname,
        ticketId,
        isComplaintReturn
      } = returnContext || {};
      const tryActivateTab = async (tab) => {
        if (!tab?.isConnected) {
          return false;
        }
        this.dispatchElementClick(tab);
        const activeLabel = this._getSpaTabLabelFromButton(tab);
        if (activeLabel) {
          await this.waitForSpaTabActive(activeLabel, 4e3);
        }
        if (isComplaintReturn) {
          return this.waitForComplaintScopeRestored(3e3);
        }
        return this.isPathnameActive(pathname) || (activeLabel ? this.isSpaTabActive(activeLabel) : false);
      };
      if (await tryActivateTab(tabButton)) {
        return true;
      }
      if (ticketId) {
        const ticketTab = this.findSpaTabByTicketId(ticketId);
        if (await tryActivateTab(ticketTab)) {
          return true;
        }
      }
      const labelsToTry = [...new Set([tabLabel, ...tabLabelCandidates].filter(Boolean))];
      for (const label of labelsToTry) {
        const tab = this.findSpaTabButton(label) || this.findSpaTabButtonFuzzy(label, { isComplaintReturn });
        if (await tryActivateTab(tab)) {
          return true;
        }
      }
      if (isComplaintReturn) {
        const complaintTab = this.findComplaintDetailSpaTab(ticketId);
        if (await tryActivateTab(complaintTab)) {
          return true;
        }
      } else {
        const tab = this.findNonManagementSpaTab(tabLabelCandidates);
        if (await tryActivateTab(tab)) {
          return true;
        }
      }
      const canUsePathFallback = pathname && (!isComplaintReturn || this.isComplaintDetailPath(pathname, ticketId));
      if (canUsePathFallback) {
        this.navigateViaPushState(pathname);
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (isComplaintReturn && this.isComplaintScopeRestored()) {
          return true;
        }
        if (this.isPathnameActive(pathname)) {
          return true;
        }
      }
      return false;
    },
    findActiveSpaTabLabel() {
      const currentTab = this.findActiveSpaTabButton();
      if (currentTab) {
        const label = this._getSpaTabLabelFromButton(currentTab);
        if (label) {
          return label;
        }
      }
      const headerTitle = this.document.querySelector("header span");
      if (headerTitle && !this.isExtensionUiElement(headerTitle)) {
        const text = headerTitle.textContent.trim();
        if (text) {
          return text;
        }
      }
      return null;
    },
    isSpaTabActive(tabLabel) {
      if (!tabLabel) {
        return false;
      }
      const tab = this.findSpaTabButton(tabLabel);
      if (tab?.getAttribute("aria-current") === "page") {
        return true;
      }
      const headerTitle = this.document.querySelector("header span");
      if (headerTitle && !this.isExtensionUiElement(headerTitle)) {
        return headerTitle.textContent.trim() === tabLabel;
      }
      return false;
    },
    waitForSpaTabActive(tabLabel, timeoutMs = 3e3) {
      if (this.isSpaTabActive(tabLabel)) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const observer = new MutationObserver(() => {
          if (this.isSpaTabActive(tabLabel)) {
            observer.disconnect();
            resolve(true);
          } else if (Date.now() > deadline) {
            observer.disconnect();
            resolve(false);
          }
        });
        observer.observe(this.document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-current", "aria-hidden", "class"]
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(this.isSpaTabActive(tabLabel));
        }, timeoutMs + 50);
      });
    },
    dispatchElementClick(element) {
      if (!element) {
        return false;
      }
      const handler = this.extractReactClickHandler(element);
      const event = {
        preventDefault() {
        },
        stopPropagation() {
        },
        nativeEvent: new MouseEvent("click", { bubbles: true }),
        currentTarget: element,
        target: element
      };
      if (typeof handler === "function") {
        try {
          handler(event);
          return true;
        } catch (error) {
        }
      }
      try {
        element.click();
        return true;
      } catch (error) {
        return false;
      }
    },
    waitForPanelActive(sectionTitle, timeoutMs = 3e3) {
      if (this._isManagementPanelVisible(sectionTitle)) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs;
        const observer = new MutationObserver(() => {
          if (this._isManagementPanelVisible(sectionTitle)) {
            observer.disconnect();
            resolve(true);
          } else if (Date.now() > deadline) {
            observer.disconnect();
            resolve(false);
          }
        });
        observer.observe(this.document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-hidden", "class", "style"]
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(this._isManagementPanelVisible(sectionTitle));
        }, timeoutMs + 50);
      });
    },
    getLastManagementOpenedViaAside() {
      return this._lastManagementOpenedViaAside;
    },
    async activateManagementPanel(type) {
      const sectionTitle = this.getManagementSectionTitleForType(type);
      this._lastManagementOpenedViaAside = false;
      if (this.isManagementPanelActiveForType(type)) {
        return true;
      }
      let tab = this.findSpaTabButton(sectionTitle);
      if (!tab) {
        const openedViaAside = await this.openManagementTabViaAside(type);
        if (this.isManagementPanelActiveForType(type)) {
          this._lastManagementOpenedViaAside = openedViaAside;
          return true;
        }
        if (!openedViaAside) {
          const route2 = this.getManagementRouteForType(type);
          this.navigateViaPushState(route2);
          const tabExists = await this.waitForSpaTabExists(sectionTitle, 5e3);
          if (!tabExists) {
            this.debugPunishmentLog("management_tab_not_created", { type, via: "pushState" });
            return false;
          }
        } else {
          this._lastManagementOpenedViaAside = true;
        }
        tab = this.findSpaTabButton(sectionTitle);
        if (!tab) {
          return false;
        }
      }
      if (!this.isManagementPanelActiveForType(type)) {
        if (!this.dispatchElementClick(tab)) {
          return false;
        }
        const activated = await this.waitForPanelActive(sectionTitle, 5e3);
        if (!activated) {
          return false;
        }
      }
      const route = this.getManagementRouteForType(type);
      const routePattern = route.replace(/^\//, "");
      if (!window.location.pathname.includes(routePattern)) {
        this.navigateViaPushState(route);
      }
      return true;
    },
    getManagementSectionHeaders(sectionTitle) {
      return Array.from(this.document.querySelectorAll("span, h1, h2, h3")).filter((element) => !this.isExtensionUiElement(element) && element.textContent.trim() === sectionTitle && !element.closest('nav, aside, button, a, [role="tab"], [role="dialog"]') && !element.closest('main > header, [role="main"] > header'));
    },
    _isManagementPanelVisible(sectionTitle) {
      const headers = this.getManagementSectionHeaders(sectionTitle);
      for (const header of headers) {
        let element = header;
        while (element && element !== this.document.body) {
          const ariaHidden = element.getAttribute?.("aria-hidden");
          if (ariaHidden === "true") {
            break;
          }
          if (ariaHidden === "false") {
            return true;
          }
          element = element.parentElement;
        }
        if (this.isStandaloneManagementHeader(header, sectionTitle)) return true;
      }
      return false;
    },
    isStandaloneManagementHeader(header, sectionTitle) {
      const route = sectionTitle === "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0431\u0430\u043D\u0430\u043C\u0438" ? this.BAN_MANAGEMENT_ROUTE : this.MUTE_MANAGEMENT_ROUTE;
      return window.location.pathname === route && !header.closest('[aria-hidden="true"]') && header.getClientRects().length > 0;
    },
    _getManagementPanelRoot(header) {
      let element = header.parentElement;
      let standaloneRoot = null;
      while (element && element !== this.document.body && !element.matches('main, [role="main"]')) {
        if (element.hasAttribute?.("aria-hidden")) {
          return element;
        }
        if (!standaloneRoot && Array.from(element.querySelectorAll("button")).some((button) => !this._isExtensionPunishmentButton(button) && button.textContent.trim() === "\u0412\u044B\u0434\u0430\u0442\u044C \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0443")) standaloneRoot = element;
        element = element.parentElement;
      }
      return standaloneRoot;
    },
    _isButtonInSection(button, sectionTitle) {
      if (!button) {
        return false;
      }
      const headers = this.getManagementSectionHeaders(sectionTitle);
      for (const header of headers) {
        const panelRoot = this._getManagementPanelRoot(header);
        if (panelRoot?.contains(button)) {
          return true;
        }
      }
      return false;
    },
    _isHeaderInVisiblePanel(header) {
      let element = header;
      while (element && element !== this.document.body) {
        const ariaHidden = element.getAttribute?.("aria-hidden");
        if (ariaHidden === "true") {
          return false;
        }
        if (ariaHidden === "false") {
          return true;
        }
        element = element.parentElement;
      }
      return this.isStandaloneManagementHeader(header, header.textContent.trim());
    },
    findSiteIssueButtonInSection(sectionTitle, { requireVisible = true } = {}) {
      const headers = this.getManagementSectionHeaders(sectionTitle);
      for (const header of headers) {
        if (requireVisible && !this._isHeaderInVisiblePanel(header)) {
          continue;
        }
        const panelRoot = this._getManagementPanelRoot(header);
        if (!panelRoot) {
          continue;
        }
        const button = Array.from(panelRoot.querySelectorAll("button")).find((candidate) => !this._isExtensionPunishmentButton(candidate) && candidate.textContent.trim() === "\u0412\u044B\u0434\u0430\u0442\u044C \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0443");
        if (button) {
          return button;
        }
      }
      return null;
    },
    findSiteIssueMuteButton() {
      return this.findSiteIssueButtonInSection("\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043C\u0443\u0442\u0430\u043C\u0438");
    },
    findSiteIssueBanButton() {
      return this.findSiteIssueButtonInSection("\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0431\u0430\u043D\u0430\u043C\u0438");
    },
    extractReactClickHandler(element) {
      if (!element) {
        return null;
      }
      const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
      if (propsKey && typeof element[propsKey]?.onClick === "function") {
        return element[propsKey].onClick;
      }
      const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$"));
      let fiber = fiberKey ? element[fiberKey] : null;
      while (fiber) {
        if (typeof fiber.memoizedProps?.onClick === "function") {
          return fiber.memoizedProps.onClick;
        }
        if (typeof fiber.pendingProps?.onClick === "function") {
          return fiber.pendingProps.onClick;
        }
        fiber = fiber.return;
      }
      return null;
    },
    _cacheIssueHandlerFromButton(button, type) {
      const sectionTitle = type === "ban" ? "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0431\u0430\u043D\u0430\u043C\u0438" : "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043C\u0443\u0442\u0430\u043C\u0438";
      if (!this._isButtonInSection(button, sectionTitle)) {
        return;
      }
      const handler = this.extractReactClickHandler(button);
      if (typeof handler !== "function") {
        return;
      }
      if (type === "ban") {
        this._cachedOpenBanHandler = handler;
        this._cachedBanIssueButton = button;
        return;
      }
      this._cachedOpenMuteHandler = handler;
      this._cachedMuteIssueButton = button;
    },
    async scanModeratorPunishmentPermissions() {
      if (this.nativeData) {
        this.syncNativePermissions();
        const mute = this.findSiteIssueMuteButton(), ban = this.findSiteIssueBanButton();
        if (mute) this._cacheIssueHandlerFromButton(mute, "mute");
        if (ban) this._cacheIssueHandlerFromButton(ban, "ban");
        return;
      }
      if (this._isUpdatingPunishmentButtons || this._permissionScanSuppressed > 0) {
        return;
      }
      const mutePanelActive = this.isMuteManagementPanelActive();
      const banPanelActive = this.isBanManagementPanelActive();
      if (!mutePanelActive && !banPanelActive) {
        return;
      }
      let changed = false;
      if (mutePanelActive) {
        const muteButton = this.findSiteIssueMuteButton();
        if (muteButton) {
          this._cancelPermissionRevoke("mute");
          this._cacheIssueHandlerFromButton(muteButton, "mute");
          if (!this.canIssueMute) {
            this.canIssueMute = true;
            changed = true;
          }
        } else if (this.canIssueMute) {
          this._schedulePermissionRevoke("mute");
        }
      }
      if (banPanelActive) {
        const banButton = this.findSiteIssueBanButton();
        if (banButton) {
          this._cancelPermissionRevoke("ban");
          this._cacheIssueHandlerFromButton(banButton, "ban");
          if (!this.canIssueBan) {
            this.canIssueBan = true;
            changed = true;
          }
        } else if (this.canIssueBan) {
          this._schedulePermissionRevoke("ban");
        }
      }
      if (changed) {
        await this._persistModeratorPermissions();
        this.refreshComplaintPunishmentButtons();
      }
    },
    initMuteIssueFeature() {
      if (this._punishmentPermissionObserver) {
        console.log("[Helper] punishmentPermissionObserver: skip \u2014 \u0443\u0436\u0435 \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D");
        return;
      }
      console.log("[Helper] punishmentPermissionObserver: init");
      this.loadModeratorPermissions().then(() => {
        this.refreshComplaintPunishmentButtons();
        setTimeout(() => this.refreshComplaintPunishmentButtons(), 500);
      });
      this._wasMutePanelActive = this.isMuteManagementPanelActive();
      this._wasBanPanelActive = this.isBanManagementPanelActive();
      this.scanModeratorPunishmentPermissions();
      this._punishmentPermissionObserver = new MutationObserver(() => {
        if (this._punishmentPermissionDebounceId) {
          clearTimeout(this._punishmentPermissionDebounceId);
        }
        this._punishmentPermissionDebounceId = setTimeout(() => {
          this._punishmentPermissionDebounceId = null;
          this._handleManagementPanelVisibilityForScan();
        }, 150);
      });
      this._punishmentPermissionObserver.observe(this.document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-hidden"]
      });
    },
    findCloseTicketButton(scopeEl) {
      const root = scopeEl || this.document.body;
      return Array.from(root.querySelectorAll("button")).find(
        (button) => button.textContent.trim() === "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u0442\u0438\u043A\u0435\u0442"
      ) || null;
    },
    findPunishmentInsertPoint(scopeEl) {
      const root = scopeEl || this.document.body;
      const closeButton = this.findCloseTicketButton(root);
      if (closeButton?.parentNode) {
        return { parent: closeButton.parentNode, before: closeButton };
      }
      const backButton = Array.from(root.querySelectorAll("button")).find(
        (button) => button.textContent.trim().includes("\u0412\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u043D\u0430\u0437\u0430\u0434")
      );
      if (backButton?.parentNode) {
        return { parent: backButton.parentNode, before: backButton };
      }
      const actionRow = root.querySelector(".sc-jcEreA");
      if (actionRow) {
        return { parent: actionRow, before: null };
      }
      return { parent: root, before: null };
    },
    createPunishmentActionsContainer() {
      let container = this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
      if (container) {
        this.refreshPunishmentActionButtonIcons(container);
        return container;
      }
      container = this.document.createElement("div");
      container.id = this.TICKET_PUNISHMENT_ACTIONS_ID;
      container.className = "ioh-ticket-punishment-actions";
      markIoh(container);
      const muteIcon = window.Icons?.mute || "";
      const banIcon = window.Icons?.ban || "";
      const muteButton = this.document.createElement("button");
      muteButton.id = this.TICKET_MUTE_BUTTON_ID;
      muteButton.type = "button";
      muteButton.className = "ioh-ticket-issue-mute";
      muteButton.innerHTML = `<span class="ioh-icon-box">${muteIcon}</span><span class="ioh-ticket-issue-label">\u041C\u0423\u0422</span>`;
      muteButton.addEventListener("click", this.handleTicketMuteButtonClick);
      const banButton = this.document.createElement("button");
      banButton.id = this.TICKET_BAN_BUTTON_ID;
      banButton.type = "button";
      banButton.className = "ioh-ticket-issue-ban";
      banButton.innerHTML = `<span class="ioh-icon-box">${banIcon}</span><span class="ioh-ticket-issue-label">\u0411\u0410\u041D</span>`;
      banButton.addEventListener("click", this.handleTicketBanButtonClick);
      container.append(muteButton, banButton);
      return container;
    },
    refreshPunishmentActionButtonIcons(container = null) {
      const root = container || this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
      if (!root || !window.Icons) {
        return;
      }
      const muteBox = root.querySelector(`#${this.TICKET_MUTE_BUTTON_ID} .ioh-icon-box`);
      const banBox = root.querySelector(`#${this.TICKET_BAN_BUTTON_ID} .ioh-icon-box`);
      if (muteBox && window.Icons.mute && !muteBox.querySelector(".ioh-badge-icon")) {
        muteBox.innerHTML = window.Icons.mute;
      }
      if (banBox && window.Icons.ban && !banBox.querySelector(".ioh-badge-icon")) {
        banBox.innerHTML = window.Icons.ban;
      }
    },
    _ensurePunishmentActionsPlacement(scope) {
      const insertPoint = this.findPunishmentInsertPoint(scope);
      if (!insertPoint?.parent) {
        return false;
      }
      const container = this.createPunishmentActionsContainer();
      if (insertPoint.before) {
        if (container.parentNode !== insertPoint.parent || container.nextElementSibling !== insertPoint.before) {
          insertPoint.parent.insertBefore(container, insertPoint.before);
        }
      } else if (container.parentNode !== insertPoint.parent) {
        insertPoint.parent.appendChild(container);
      }
      this._lastPunishmentScope = scope;
      return true;
    },
    shouldShowTicketMuteButton(scope) {
      if (!this._permissionsHydrated || !this.canIssueMute) {
        return false;
      }
      if (!scope || !this.isOpenComplaintScope(scope)) {
        return false;
      }
      const muteHistoryBlock = this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041C\u0443\u0442\u043E\u0432", scope);
      if (muteHistoryBlock && this.hasActiveMute(muteHistoryBlock)) {
        return false;
      }
      return true;
    },
    shouldShowTicketBanButton(scope) {
      if (!this._permissionsHydrated || !this.canIssueBan) {
        return false;
      }
      return Boolean(scope && this.isOpenComplaintScope(scope));
    },
    _applyPunishmentButtonsVisibility(scope) {
      const container = this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
      if (!container) {
        return;
      }
      const muteButton = this.document.getElementById(this.TICKET_MUTE_BUTTON_ID);
      const banButton = this.document.getElementById(this.TICKET_BAN_BUTTON_ID);
      const showMute = this.shouldShowTicketMuteButton(scope);
      const showBan = this.shouldShowTicketBanButton(scope);
      if (!showMute && !showBan) {
        if (container.style.display !== "none") {
          container.style.display = "none";
        }
        return;
      }
      if (container.style.display !== "") {
        container.style.display = "";
      }
      if (muteButton) {
        const nextMuteDisplay = showMute ? "" : "none";
        if (muteButton.style.display !== nextMuteDisplay) {
          muteButton.style.display = nextMuteDisplay;
        }
      }
      if (banButton) {
        const nextBanDisplay = showBan ? "" : "none";
        if (banButton.style.display !== nextBanDisplay) {
          banButton.style.display = nextBanDisplay;
        }
      }
    },
    updateTicketPunishmentButtons() {
      if (!this.isComplaintPage()) {
        return;
      }
      if (this.isSitePunishmentDialogOpen() && this._lastPunishmentScope?.isConnected) {
        this._applyPunishmentButtonsVisibility(this._lastPunishmentScope);
        return;
      }
      const scope = this.findActiveComplaintScope() || (this._lastPunishmentScope?.isConnected ? this._lastPunishmentScope : null);
      const hasPermissions = this.canIssueMute || this.canIssueBan;
      if (!scope) {
        if (!hasPermissions && !this.isSitePunishmentDialogOpen()) {
          const container = this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID);
          if (container) {
            container.style.display = "none";
          }
        }
        return;
      }
      this._isUpdatingPunishmentButtons = true;
      try {
        if (!this._ensurePunishmentActionsPlacement(scope)) {
          return;
        }
        this._applyPunishmentButtonsVisibility(scope);
      } finally {
        this._isUpdatingPunishmentButtons = false;
      }
    },
    ensureTicketPunishmentButtons() {
      this.updateTicketPunishmentButtons();
    },
    refreshComplaintPunishmentButtons() {
      if (!this.isComplaintPage()) {
        return;
      }
      this.updateTicketPunishmentButtons();
    },
    refreshTicketPunishmentButtons() {
      this.refreshComplaintPunishmentButtons();
    },
    clearTicketPunishmentButtons() {
      this.document.getElementById(this.TICKET_PUNISHMENT_ACTIONS_ID)?.remove();
      this._lastPunishmentScope = null;
    },
    teardownTicketPunishmentButtons() {
      this.clearTicketPunishmentButtons();
    },
    getOffenderSteamIdForScope(scope) {
      if (this.nativeData) return this.getNativeTicket(scope)?.suspectId || null;
      const offenderField = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope);
      return this.extractSteamIdFromField(offenderField);
    },
    getActivePunishmentScope() {
      return this.findActiveComplaintScope() || this._lastPunishmentScope;
    },
    handleTicketMuteButtonClick() {
      const scope = this.getActivePunishmentScope();
      const steamId3 = this.getOffenderSteamIdForScope(scope);
      this._closeReasonPunishmentOrigin = {
        type: "mute",
        scope,
        steamId: steamId3,
        ticketId: this.extractTicketIdFromComplaintScope(scope)
      };
      void this.openSiteMuteForm(steamId3);
    },
    handleTicketBanButtonClick() {
      const scope = this.getActivePunishmentScope();
      const steamId3 = this.getOffenderSteamIdForScope(scope);
      this._closeReasonPunishmentOrigin = {
        type: "ban",
        scope,
        steamId: steamId3,
        ticketId: this.extractTicketIdFromComplaintScope(scope)
      };
      void this.openSiteBanForm(steamId3);
    },
    invokeCachedSiteHandler(handler, type, button = null) {
      if (typeof handler !== "function") {
        return false;
      }
      const eventTarget = (button?.isConnected ? button : null) ?? this.getCachedIssueButton(type) ?? this.getLastKnownIssueButton(type);
      try {
        handler({
          preventDefault() {
          },
          stopPropagation() {
          },
          nativeEvent: new MouseEvent("click", { bubbles: true }),
          currentTarget: eventTarget,
          target: eventTarget
        });
        return true;
      } catch (error) {
        console.warn(`[IO Helper] \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0444\u043E\u0440\u043C\u0443 ${type}:`, error);
        if (type === "ban") {
          this._cachedOpenBanHandler = null;
        } else {
          this._cachedOpenMuteHandler = null;
        }
        return false;
      }
    },
    openSiteMuteForm(steamId3) {
      return this.punishmentBridge.openMuteForm(steamId3);
    },
    openSiteBanForm(steamId3) {
      return this.punishmentBridge.openBanForm(steamId3);
    },
    prefillMuteFormSteamId(steamId3) {
      this._prefillPunishmentFormSteamId(steamId3, "#mute-steamid64");
    },
    prefillBanFormSteamId(steamId3) {
      this._prefillPunishmentFormSteamId(steamId3, "#ban-steamid64");
    },
    _prefillPunishmentFormSteamId(steamId3, inputSelector) {
      if (!steamId3) {
        return;
      }
      const applyValue = (input) => {
        if (!input) {
          return false;
        }
        if (input.value !== steamId3) {
          input.value = steamId3;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
      };
      const existingInput = this.document.querySelector(`[role="dialog"] ${inputSelector}`);
      if (applyValue(existingInput)) {
        return;
      }
      const deadline = Date.now() + 2e3;
      const observer = new MutationObserver(() => {
        const input = this.document.querySelector(`[role="dialog"] ${inputSelector}`);
        if (applyValue(input)) {
          observer.disconnect();
          return;
        }
        if (Date.now() > deadline) {
          observer.disconnect();
        }
      });
      observer.observe(this.document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 2100);
    }
  };

  // modules/shared/faceitIcons.js
  var SHELL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><defs><radialGradient id="bar-bg-gradient__ID__" cx="0.5" cy="0.5" r="0.55"><stop offset="0.4" stop-color="#5D5D5D" /><stop offset="1" stop-color="#242424" /></radialGradient><linearGradient id="fill-gradient__ID__" x1="0" y1="0" x2="0" y2="1"><stop class="startStop" offset="0.5" stop-color="var(--fill-start,#F1F1F1)" /><stop class="endStop" offset="1" stop-color="var(--fill-end,#383838)" /></linearGradient><radialGradient id="fill-calibration__ID__" cx="0" cy="0.9" r="2"><stop offset="0.0865385" stop-color="#2A2A2A" /><stop offset="0.384615" stop-color="#4A4A4A" /><stop offset="0.711538" stop-color="#8D8D8D" /><stop offset="1" stop-color="#A6A6A6" /></radialGradient></defs><circle class="background" r="50%" cx="50%" cy="50%" fill="#060606" /><path class="bar-bg" d="         M 6.5, 18.4         A 8.4, 8.4 0 1 1 17.5, 18.4       " stroke="url(#bar-bg-gradient__ID__)" stroke-width="2.4" /><path class="progress" d="         M 6.5, 18.4         A 8.4, 8.4 0 1 1 17.5, 18.4       " stroke="url(#fill-gradient__ID__)" stroke-width="2.4" pathLength="10" /><path class="calibration" d="         M 6.5, 18.4         A 8.4, 8.4 0 1 1 17.5, 18.4       " stroke="url(#fill-calibration__ID__)" stroke-width="2.4" /></svg>';
  var DIGITS = { "1": '<path xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number n1" opacity="1" fill="#f1f1f1" transform="matrix(1.026794 0 0 0.9086 -0.503212 0.771038)" d="M11.625 15V10.5262L10.5 10.9971V9.80233L12.1047 9H13.1424V15H11.625Z" />', "2": '<path xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number n2" opacity="1" fill="#f1f1f1" transform="matrix(0.881606 0 0 0.9226 1.383817 0.561249)" d="M9.83 15V14.181C9.83 13.8534 9.83862 13.5718 9.85586 13.3362C9.8731 13.1006 9.91046 12.8994 9.96793 12.7328C10.0311 12.5661 10.1289 12.4253 10.261 12.3103C10.3932 12.1897 10.5743 12.0805 10.8041 11.9828L12.1145 11.4569C12.2811 11.3879 12.4047 11.3276 12.4852 11.2759C12.5656 11.2184 12.6174 11.1494 12.6403 11.069C12.6633 10.9885 12.6748 10.8764 12.6748 10.7328C12.6748 10.5546 12.6461 10.4253 12.5886 10.3448C12.5311 10.2586 12.4277 10.2069 12.2783 10.1897C12.1289 10.1667 11.9191 10.1552 11.649 10.1552C11.5225 10.1552 11.3645 10.1609 11.1748 10.1724C10.9909 10.1839 10.7926 10.1983 10.58 10.2155C10.3674 10.2328 10.1576 10.2529 9.95069 10.2759V9.18966C10.1403 9.15517 10.3559 9.12356 10.5972 9.09483C10.8386 9.06609 11.0857 9.0431 11.3386 9.02586C11.5972 9.00862 11.8357 9 12.0541 9C12.3415 9 12.6116 9.02011 12.8645 9.06035C13.1231 9.09483 13.3501 9.16667 13.5455 9.27586C13.7409 9.38506 13.8932 9.54885 14.0024 9.76724C14.1174 9.98563 14.1748 10.2787 14.1748 10.6466C14.1748 11.0144 14.1346 11.3103 14.0541 11.5345C13.9794 11.7586 13.8674 11.9368 13.7179 12.069C13.5685 12.2011 13.3875 12.3103 13.1748 12.3966L11.6921 12.9741C11.5771 13.0201 11.488 13.069 11.4248 13.1207C11.3674 13.1667 11.3271 13.2299 11.3041 13.3103C11.2811 13.3851 11.2697 13.4856 11.2697 13.6121V13.8362H14.1748V15H9.83Z" />', "3": '<path xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number n3" opacity="1" fill="#f1f1f1" transform="matrix(0.895103 0 0 0.9366 1.123928 0.435248)" d="M11.7535 15C11.5603 15 11.3501 14.9915 11.1228 14.9744C10.8956 14.9631 10.6711 14.9432 10.4495 14.9148C10.2336 14.8807 10.0405 14.8494 9.87 14.821V13.7557C10.0745 13.7727 10.2848 13.7898 10.5007 13.8068C10.7166 13.8239 10.9211 13.8381 11.1143 13.8494C11.3132 13.8551 11.4808 13.858 11.6172 13.858C11.8728 13.858 12.0745 13.8494 12.2223 13.8324C12.3757 13.8097 12.4836 13.7528 12.5461 13.6619C12.6143 13.571 12.6484 13.4233 12.6484 13.2188C12.6484 13.0256 12.6257 12.8807 12.5802 12.7841C12.5348 12.6818 12.4552 12.6136 12.3416 12.5795C12.228 12.5455 12.0689 12.5284 11.8643 12.5284H10.8842V11.4034H11.8643C12.0461 11.4034 12.1882 11.3892 12.2905 11.3608C12.3984 11.3267 12.4751 11.267 12.5206 11.1818C12.5717 11.0909 12.5973 10.9545 12.5973 10.7727C12.5973 10.5682 12.5689 10.4233 12.512 10.3381C12.4552 10.2472 12.3501 10.1932 12.1967 10.1761C12.0433 10.1534 11.8217 10.142 11.5319 10.142C11.3672 10.142 11.1853 10.1477 10.9865 10.1591C10.7933 10.1705 10.6001 10.1847 10.4069 10.2017C10.2194 10.2131 10.0518 10.2301 9.90409 10.2528V9.17898C10.0689 9.14489 10.2592 9.11364 10.4751 9.08523C10.6967 9.05682 10.9183 9.03693 11.1399 9.02557C11.3672 9.00852 11.5745 9 11.762 9C12.2109 9 12.5831 9.03409 12.8785 9.10227C13.1797 9.17045 13.4183 9.26989 13.5944 9.40057C13.7706 9.53125 13.8956 9.69318 13.9694 9.88636C14.049 10.0739 14.0887 10.2926 14.0887 10.5426C14.0887 10.9688 14.0035 11.2869 13.8331 11.4972C13.6626 11.7074 13.4098 11.8494 13.0745 11.9233V11.9574C13.3018 12.0085 13.495 12.0824 13.6541 12.179C13.8132 12.2756 13.9325 12.4176 14.012 12.6051C14.0973 12.7926 14.1399 13.0455 14.1399 13.3636C14.1399 13.608 14.1058 13.8324 14.0376 14.0369C13.9751 14.2358 13.8586 14.4091 13.6882 14.5568C13.5177 14.6989 13.2762 14.8097 12.9638 14.8892C12.6513 14.9631 12.2478 15 11.7535 15Z" />', "4": '<path xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number n4" opacity="1" fill="#f1f1f1" transform="matrix(0.826548 0 0 0.9086 1.971934 0.771038)" d="M12.3105 15V13.7965H9.45V12.7587L11.5081 9H13.1477L11.0372 12.6279H12.3541L12.7901 11.1802H13.8105V12.6279H14.5517V13.7965H13.8105V15H12.3105Z" />', "5": '<path xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number n5" opacity="1" fill="#f1f1f1" transform="matrix(0.856234 0 0 0.9226 1.659005 0.645038)" d="M11.7524 15C11.5628 15 11.353 14.9914 11.1231 14.9741C10.8932 14.9626 10.6662 14.9454 10.4421 14.9224C10.2179 14.8937 10.0139 14.8592 9.83 14.819V13.75C10.0311 13.7672 10.238 13.7845 10.4507 13.8017C10.6691 13.8132 10.876 13.8247 11.0714 13.8362C11.2668 13.842 11.4363 13.8448 11.58 13.8448C11.8099 13.8448 11.9938 13.8362 12.1317 13.819C12.2697 13.796 12.376 13.7586 12.4507 13.7069C12.5311 13.6552 12.5857 13.5805 12.6145 13.4828C12.6432 13.3793 12.6576 13.25 12.6576 13.0948C12.6576 12.9282 12.6403 12.796 12.6059 12.6983C12.5771 12.5948 12.5225 12.5201 12.4421 12.4741C12.3616 12.4224 12.2495 12.3879 12.1059 12.3707C11.9622 12.3534 11.7783 12.3448 11.5541 12.3448C11.4047 12.3448 11.2323 12.3506 11.0369 12.3621C10.8415 12.3678 10.6461 12.3793 10.4507 12.3966C10.2553 12.408 10.0714 12.4224 9.89897 12.4397V9H13.7266V10.1638H11.2093V11.2759C11.307 11.2644 11.4191 11.2529 11.5455 11.2414C11.6777 11.2299 11.8099 11.2213 11.9421 11.2155C12.0743 11.2098 12.1949 11.2069 12.3041 11.2069C12.6777 11.2069 12.9852 11.2471 13.2266 11.3276C13.4679 11.408 13.6576 11.5259 13.7955 11.681C13.9334 11.8305 14.0283 12.0144 14.08 12.2328C14.1375 12.4511 14.1662 12.704 14.1662 12.9914C14.1662 13.342 14.1317 13.6437 14.0628 13.8966C13.9938 14.1494 13.8702 14.3592 13.6921 14.5259C13.5197 14.6868 13.2754 14.8075 12.9593 14.8879C12.649 14.9626 12.2467 15 11.7524 15Z" />', "6": '<path xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number n6" opacity="1" fill="#f1f1f1" transform="matrix(0.830162 0 0 0.9366 2.040408 0.435248)" d="M12.0831 15C11.6797 15 11.3359 14.9801 11.0518 14.9403C10.7677 14.9006 10.5291 14.821 10.3359 14.7017C10.1484 14.5824 9.995 14.4006 9.87568 14.1562C9.81886 14.0256 9.77057 13.8636 9.73079 13.6705C9.69102 13.4716 9.66261 13.2358 9.64557 12.9631C9.62852 12.6847 9.62 12.3693 9.62 12.017C9.62 11.7216 9.62568 11.4545 9.63705 11.2159C9.65409 10.9716 9.67966 10.7528 9.71375 10.5597C9.75352 10.3608 9.80466 10.1875 9.86716 10.0398C9.96943 9.77273 10.1143 9.56534 10.3018 9.41761C10.495 9.26989 10.7422 9.16477 11.0433 9.10227C11.3444 9.03409 11.7109 9 12.1427 9C12.3075 9 12.495 9.00852 12.7052 9.02557C12.9211 9.04261 13.1456 9.06534 13.3785 9.09375C13.6115 9.11648 13.8302 9.14773 14.0348 9.1875V10.2528C13.8302 10.2301 13.6228 10.2102 13.4126 10.1932C13.2081 10.1761 13.0206 10.1648 12.8501 10.1591C12.6797 10.1477 12.5376 10.142 12.424 10.142C12.1285 10.142 11.8927 10.1619 11.7166 10.2017C11.5405 10.2358 11.4069 10.3068 11.316 10.4148C11.2308 10.517 11.174 10.6676 11.1456 10.8665C11.1172 11.0653 11.103 11.3295 11.103 11.6591H11.1541C11.1995 11.608 11.2677 11.5511 11.3586 11.4886C11.4495 11.4261 11.5831 11.3722 11.7592 11.3267C11.941 11.2756 12.1797 11.25 12.4751 11.25C12.7876 11.25 13.0632 11.2727 13.3018 11.3182C13.5405 11.3636 13.7393 11.4489 13.8984 11.5739C14.0575 11.6932 14.1768 11.8665 14.2564 12.0938C14.3359 12.321 14.3757 12.6165 14.3757 12.9801C14.3757 13.3438 14.3444 13.6563 14.2819 13.9176C14.2194 14.1733 14.103 14.3807 13.9325 14.5398C13.7677 14.6989 13.5376 14.8153 13.2422 14.8892C12.9467 14.9631 12.5603 15 12.0831 15ZM12.0149 13.875C12.2081 13.875 12.3643 13.8693 12.4836 13.858C12.6086 13.8409 12.7052 13.8097 12.7734 13.7642C12.8416 13.7131 12.8899 13.6392 12.9183 13.5426C12.9467 13.4403 12.9609 13.3068 12.9609 13.142C12.9609 12.9659 12.9467 12.8267 12.9183 12.7244C12.8899 12.6165 12.8416 12.5398 12.7734 12.4943C12.7109 12.4432 12.6172 12.4119 12.4922 12.4006C12.3672 12.3835 12.2081 12.375 12.0149 12.375C11.8103 12.375 11.6484 12.3864 11.5291 12.4091C11.4098 12.4318 11.3189 12.4716 11.2564 12.5284C11.1995 12.5795 11.1626 12.6477 11.1456 12.733C11.1285 12.8125 11.12 12.9119 11.12 13.0313C11.12 13.2358 11.1342 13.3949 11.1626 13.5085C11.1967 13.6222 11.2478 13.7074 11.316 13.7642C11.3842 13.8153 11.4751 13.8466 11.5888 13.858C11.7024 13.8693 11.8444 13.875 12.0149 13.875Z" />', "7": '<path xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number n7" opacity="1" fill="#f1f1f1" transform="matrix(0.911503 0 0 0.9086 0.967267 0.771038)" d="M10.3843 15L12.5907 10.1773H9.8V9H14.1866V10.0727L12.05 15H10.3843Z" />', "8": '<path xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number n8" opacity="1" fill="#f1f1f1" transform="matrix(0.83328 0 0 0.9366 2.000248 0.435248)" d="M12 15C11.4872 15 11.0647 14.9631 10.7325 14.8892C10.4062 14.8153 10.1527 14.7074 9.97203 14.5653C9.7972 14.4233 9.67483 14.2528 9.6049 14.054C9.53497 13.8494 9.5 13.6193 9.5 13.3636C9.5 13.0398 9.54079 12.7869 9.62238 12.6051C9.70979 12.4176 9.83508 12.2756 9.99825 12.179C10.1614 12.0824 10.3596 12.0085 10.5927 11.9574V11.9233C10.243 11.8494 9.98077 11.7074 9.80594 11.4972C9.63695 11.2869 9.55245 10.9687 9.55245 10.5426C9.55245 10.2926 9.59033 10.071 9.66609 9.87784C9.74767 9.68466 9.87879 9.52273 10.0594 9.39205C10.2459 9.26136 10.4965 9.16477 10.8112 9.10227C11.1317 9.03409 11.528 9 12 9C12.472 9 12.8654 9.03409 13.1801 9.10227C13.5006 9.16477 13.7512 9.26136 13.9318 9.39205C14.1183 9.52273 14.2494 9.68466 14.3252 9.87784C14.4068 10.071 14.4476 10.2926 14.4476 10.5426C14.4476 10.9687 14.3601 11.2869 14.1853 11.4972C14.0163 11.7074 13.757 11.8494 13.4073 11.9233V11.9574C13.6463 12.0085 13.8444 12.0824 14.0017 12.179C14.1649 12.2756 14.2873 12.4176 14.3689 12.6051C14.4563 12.7869 14.5 13.0398 14.5 13.3636C14.5 13.6193 14.465 13.8494 14.3951 14.054C14.3252 14.2528 14.1999 14.4233 14.0192 14.5653C13.8386 14.7074 13.5851 14.8153 13.2587 14.8892C12.9324 14.9631 12.5128 15 12 15ZM12 13.892C12.2622 13.892 12.4633 13.8807 12.6031 13.858C12.743 13.8295 12.8392 13.767 12.8916 13.6705C12.9499 13.5682 12.979 13.4119 12.979 13.2017C12.979 13.0426 12.9645 12.9148 12.9353 12.8182C12.912 12.7216 12.8625 12.6506 12.7867 12.6051C12.7168 12.554 12.6177 12.5199 12.4895 12.5028C12.3613 12.4858 12.1981 12.4773 12 12.4773C11.8019 12.4773 11.6387 12.4858 11.5105 12.5028C11.3823 12.5199 11.2832 12.554 11.2133 12.6051C11.1434 12.6506 11.0938 12.7216 11.0647 12.8182C11.0414 12.9148 11.0297 13.0426 11.0297 13.2017C11.0297 13.4119 11.0559 13.5682 11.1084 13.6705C11.1608 13.767 11.257 13.8295 11.3969 13.858C11.5425 13.8807 11.7436 13.892 12 13.892ZM12 11.4545C12.2681 11.4545 12.4662 11.4403 12.5944 11.4119C12.7284 11.3835 12.8158 11.321 12.8566 11.2244C12.9033 11.1278 12.9266 10.983 12.9266 10.7898C12.9266 10.5852 12.9033 10.4375 12.8566 10.3466C12.8158 10.25 12.7284 10.1875 12.5944 10.1591C12.4662 10.125 12.2681 10.108 12 10.108C11.7378 10.108 11.5396 10.125 11.4056 10.1591C11.2716 10.1875 11.1842 10.25 11.1434 10.3466C11.1026 10.4375 11.0822 10.5852 11.0822 10.7898C11.0822 10.983 11.1026 11.1278 11.1434 11.2244C11.1842 11.321 11.2716 11.3835 11.4056 11.4119C11.5396 11.4403 11.7378 11.4545 12 11.4545Z" />', "9": '<path xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number n9" opacity="1" fill="#f1f1f1" transform="matrix(0.831928 0 0 0.9366 2.023415 0.435248)" d="M11.853 15C11.6882 15 11.495 14.9915 11.2734 14.9744C11.0575 14.9574 10.8331 14.9347 10.6001 14.9062C10.3728 14.8778 10.1598 14.8466 9.96091 14.8125V13.7472C10.1768 13.7699 10.3842 13.7898 10.5831 13.8068C10.7876 13.8239 10.978 13.8381 11.1541 13.8494C11.3302 13.8551 11.4694 13.858 11.5717 13.858C11.8728 13.858 12.1086 13.8409 12.2791 13.8068C12.4552 13.767 12.5859 13.696 12.6711 13.5938C12.762 13.4858 12.8217 13.3324 12.8501 13.1335C12.8842 12.9347 12.9012 12.6705 12.9012 12.3409H12.8501C12.8047 12.392 12.7336 12.4489 12.637 12.5114C12.5461 12.5739 12.4126 12.6307 12.2365 12.6818C12.0603 12.7273 11.8245 12.75 11.5291 12.75C11.2109 12.75 10.9325 12.7273 10.6939 12.6818C10.4609 12.6364 10.2649 12.554 10.1058 12.4347C9.9467 12.3097 9.82454 12.1335 9.73932 11.9063C9.65977 11.679 9.62 11.3835 9.62 11.0199C9.62 10.6563 9.65125 10.3466 9.71375 10.0909C9.78193 9.82955 9.89841 9.61932 10.0632 9.46023C10.228 9.30114 10.4581 9.18466 10.7535 9.1108C11.0547 9.03693 11.441 9 11.9126 9C12.3615 9 12.7365 9.02557 13.0376 9.0767C13.3388 9.12216 13.5802 9.21591 13.762 9.35795C13.9495 9.49432 14.0888 9.70455 14.1797 9.98864C14.2535 10.2216 14.3047 10.5 14.3331 10.8239C14.3615 11.1477 14.3757 11.5341 14.3757 11.983C14.3757 12.3182 14.3643 12.6193 14.3416 12.8864C14.3245 13.1534 14.2933 13.3892 14.2478 13.5938C14.2024 13.7983 14.1399 13.9773 14.0603 14.1307C13.9467 14.3466 13.7933 14.5199 13.6001 14.6506C13.4069 14.7756 13.1683 14.8665 12.8842 14.9233C12.6001 14.9744 12.2564 15 11.853 15ZM11.9808 11.625C12.1853 11.625 12.3473 11.6136 12.4666 11.5909C12.5916 11.5682 12.6825 11.5312 12.7393 11.4801C12.7961 11.4233 12.8331 11.3551 12.8501 11.2756C12.8672 11.1903 12.8757 11.0881 12.8757 10.9687C12.8757 10.7642 12.8586 10.6051 12.8245 10.4915C12.7961 10.3778 12.7478 10.2955 12.6797 10.2443C12.6115 10.1875 12.5206 10.1534 12.4069 10.142C12.2933 10.1307 12.1512 10.125 11.9808 10.125C11.7933 10.125 11.637 10.1335 11.512 10.1506C11.387 10.1619 11.2905 10.1932 11.2223 10.2443C11.1541 10.2898 11.1058 10.3636 11.0774 10.4659C11.0547 10.5625 11.0433 10.6932 11.0433 10.858C11.0433 11.0341 11.0547 11.1761 11.0774 11.2841C11.1058 11.3864 11.1541 11.4631 11.2223 11.5142C11.2905 11.5597 11.3842 11.5909 11.5035 11.608C11.6285 11.6193 11.7876 11.625 11.9808 11.625Z" />', "10": '<g xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number n10" opacity="1" fill="#f1f1f1" transform="matrix(1.012282 0 0 0.9366 -0.352162 0.435248)"><path d="M13.7515 15C13.3348 15 12.9884 14.9773 12.7124 14.9318C12.4365 14.8807 12.2173 14.7926 12.0549 14.6676C11.8926 14.5426 11.7708 14.3693 11.6897 14.1477C11.6139 13.9205 11.5652 13.6307 11.5435 13.2784C11.5219 12.9261 11.5111 12.5 11.5111 12C11.5111 11.5 11.5219 11.0739 11.5435 10.7216C11.5652 10.3693 11.6139 10.0824 11.6897 9.8608C11.7708 9.63352 11.8926 9.45739 12.0549 9.33239C12.2173 9.20739 12.4365 9.12216 12.7124 9.0767C12.9884 9.02557 13.3348 9 13.7515 9C14.1736 9 14.5199 9.02557 14.7905 9.0767C15.0665 9.12216 15.2857 9.20739 15.448 9.33239C15.6104 9.45739 15.7294 9.63352 15.8052 9.8608C15.8864 10.0824 15.9378 10.3693 15.9594 10.7216C15.9865 11.0739 16 11.5 16 12C16 12.5 15.9865 12.9261 15.9594 13.2784C15.9378 13.6307 15.8864 13.9205 15.8052 14.1477C15.7294 14.3693 15.6104 14.5426 15.448 14.6676C15.2857 14.7926 15.0665 14.8807 14.7905 14.9318C14.5199 14.9773 14.1736 15 13.7515 15ZM13.7515 13.858C13.9138 13.858 14.0464 13.8523 14.1492 13.8409C14.2521 13.8239 14.3332 13.7869 14.3928 13.7301C14.4523 13.6733 14.4956 13.5795 14.5226 13.4489C14.5497 13.3125 14.5659 13.1278 14.5713 12.8949C14.5822 12.6619 14.5876 12.3636 14.5876 12C14.5876 11.6364 14.5822 11.3381 14.5713 11.1051C14.5659 10.8722 14.5497 10.6903 14.5226 10.5597C14.4956 10.4233 14.4523 10.3267 14.3928 10.2699C14.3332 10.2131 14.2521 10.179 14.1492 10.1676C14.0518 10.1506 13.9192 10.142 13.7515 10.142C13.5945 10.142 13.462 10.1506 13.3537 10.1676C13.2509 10.179 13.1697 10.2131 13.1102 10.2699C13.0561 10.3267 13.0155 10.4233 12.9884 10.5597C12.9614 10.6903 12.9424 10.8722 12.9316 11.1051C12.9262 11.3381 12.9235 11.6364 12.9235 12C12.9235 12.3636 12.9262 12.6619 12.9316 12.8949C12.9424 13.1278 12.9614 13.3125 12.9884 13.4489C13.0155 13.5795 13.0561 13.6733 13.1102 13.7301C13.1697 13.7869 13.2509 13.8239 13.3537 13.8409C13.4565 13.8523 13.5891 13.858 13.7515 13.858Z" /><path d="M9.04715 14.9318V10.5597L8 11.0199V9.85228L9.49361 9.06819H10.4596V14.9318H9.04715Z" /></g>', "q": '<path xmlns="http://www.w3.org/2000/svg" class="level-number rebranded-level-number nq" opacity="1" fill="#f1f1f1" d="M10.9551 13V12.4138C10.9551 12.1897 10.9803 12.0115 11.0307 11.8793C11.0812 11.7471 11.1537 11.6466 11.2482 11.5776C11.3491 11.5086 11.472 11.4511 11.617 11.4052L11.9291 11.3103C12.0615 11.2701 12.1592 11.2328 12.2222 11.1983C12.2916 11.158 12.3357 11.1006 12.3546 11.0259C12.3798 10.9454 12.3924 10.8305 12.3924 10.681C12.3924 10.5086 12.3641 10.3851 12.3073 10.3103C12.2506 10.2356 12.156 10.1925 12.0236 10.181C11.8976 10.1638 11.7179 10.1552 11.4846 10.1552C11.3901 10.1552 11.2766 10.158 11.1442 10.1638C11.0181 10.1695 10.8826 10.1782 10.7376 10.1897C10.5989 10.1954 10.4634 10.204 10.331 10.2155C10.2049 10.2213 10.0946 10.2299 10 10.2414V9.15517C10.1765 9.12644 10.3783 9.10057 10.6052 9.07759C10.8322 9.04885 11.0623 9.02874 11.2955 9.01724C11.5351 9.00575 11.7557 9 11.9574 9C12.279 9 12.5658 9.02299 12.818 9.06897C13.0701 9.11494 13.2845 9.19828 13.461 9.31897C13.6375 9.43391 13.7699 9.5977 13.8582 9.81034C13.9527 10.0172 14 10.2874 14 10.6207C14 10.8563 13.9779 11.0546 13.9338 11.2155C13.8897 11.3764 13.8266 11.5086 13.7447 11.6121C13.6627 11.7098 13.565 11.7902 13.4515 11.8534C13.3381 11.9167 13.2151 11.9713 13.0827 12.0172L12.7707 12.1121C12.6635 12.1408 12.5784 12.1695 12.5154 12.1983C12.4523 12.2213 12.405 12.2529 12.3735 12.2931C12.3483 12.3276 12.3294 12.3793 12.3168 12.4483C12.3105 12.5172 12.3073 12.6121 12.3073 12.7328V13H10.9551ZM10.8322 15V13.75H12.4492V15H10.8322Z" />' };
  var COLORS = ["#8d8d8d", "#f1f1f1", "#05ff00", "#05ff00", "#ffc700", "#ffc700", "#ffc700", "#ffc700", "#ff4b00", "#ff4b00", "#ef0000"];
  var nextId = 0;
  function createFaceitLevelIcon(document2, level) {
    const n = Number.isInteger(level) && level >= 1 && level <= 10 ? level : 0;
    const token = `__iohFaceit${++nextId}`;
    const template = document2.createElement("template");
    template.innerHTML = SHELL.replaceAll("__ID__", token);
    const svg = template.content.firstElementChild;
    svg.classList.add("ioh-faceit-rank");
    svg.setAttribute("width", "22");
    svg.setAttribute("height", "22");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", n ? `Faceit \u0443\u0440\u043E\u0432\u0435\u043D\u044C ${n}` : "Faceit: \u0430\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0439 \u0443\u0440\u043E\u0432\u0435\u043D\u044C \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442");
    svg.style.setProperty("--fill-start", COLORS[n]);
    svg.style.setProperty("--fill-end", COLORS[n]);
    svg.querySelector(".background").setAttribute("fill", "#121212");
    const progress = svg.querySelector(".progress");
    progress.setAttribute("stroke-dasharray", "10.1 10000");
    progress.setAttribute("stroke-dashoffset", String(n === 10 ? 0 : 10 - 0.99 * n));
    progress.setAttribute("opacity", n ? "1" : "0");
    svg.querySelector(".calibration").setAttribute("opacity", n ? "0" : "1");
    template.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${DIGITS[n || "q"].replaceAll("__ID__", token)}</svg>`;
    const digit = template.content.firstElementChild.firstElementChild;
    if (!n) digit.setAttribute("fill", "#a6a6a6");
    svg.append(digit);
    markIoh(svg);
    return svg;
  }

  // modules/ticket/OffenderProfile.js
  var OffenderProfileMethods = {
    clearSteamAccountCreationDate() {
      this.document.querySelectorAll(".ioh-account-created").forEach((node) => node.remove());
    },
    clearCybershokePlaytime() {
      this.document.querySelectorAll(".ioh-cybershoke-playtime").forEach((node) => node.remove());
    },
    clearOffenderCountry() {
      this.document.querySelectorAll(".ioh-offender-country").forEach((node) => node.remove());
    },
    clearFaceitElo() {
      this.document.querySelectorAll(".ioh-faceit-elo").forEach((node) => node.remove());
    },
    ensureSteamAccountCreationNode(field) {
      let node = field.parentNode.querySelector(".ioh-account-created");
      if (node) {
        return node.querySelector(".ioh-account-value");
      }
      node = this.document.createElement("div");
      node.className = field.className + " ioh-account-created";
      markIoh(node);
      const labelSpan = this.document.createElement("span");
      const originalSpan = field.querySelector("span");
      labelSpan.className = originalSpan ? originalSpan.className : "";
      labelSpan.textContent = "\u0421\u043E\u0437\u0434\u0430\u043D";
      const valueDiv = this.document.createElement("div");
      const originalDiv = field.querySelector("div");
      valueDiv.className = (originalDiv ? originalDiv.className : "") + " ioh-account-value";
      node.appendChild(labelSpan);
      node.appendChild(valueDiv);
      const playtimeNode = field.parentNode.querySelector(".ioh-cybershoke-playtime");
      const faceitNode = field.parentNode.querySelector(".ioh-faceit-elo");
      if (playtimeNode) {
        playtimeNode.insertAdjacentElement("beforebegin", node);
      } else if (faceitNode) {
        faceitNode.insertAdjacentElement("beforebegin", node);
      } else {
        field.insertAdjacentElement("afterend", node);
      }
      return valueDiv;
    },
    ensureFaceitEloNode(field) {
      let node = field.parentNode.querySelector(".ioh-faceit-elo");
      if (node) {
        return node.querySelector(".ioh-faceit-value");
      }
      node = this.document.createElement("div");
      node.className = field.className + " ioh-faceit-elo";
      markIoh(node);
      const labelSpan = this.document.createElement("span");
      const originalSpan = field.querySelector("span");
      labelSpan.className = originalSpan ? originalSpan.className : "";
      labelSpan.textContent = "Faceit";
      const valueDiv = this.document.createElement("div");
      const originalDiv = field.querySelector("div");
      valueDiv.className = (originalDiv ? originalDiv.className : "") + " ioh-faceit-value";
      node.appendChild(labelSpan);
      node.appendChild(valueDiv);
      const playtimeNode = field.parentNode.querySelector(".ioh-cybershoke-playtime");
      const accountNode = field.parentNode.querySelector(".ioh-account-created");
      if (playtimeNode) {
        playtimeNode.insertAdjacentElement("afterend", node);
      } else if (accountNode) {
        accountNode.insertAdjacentElement("afterend", node);
      } else {
        field.insertAdjacentElement("afterend", node);
      }
      return valueDiv;
    },
    ensureCybershokePlaytimeNode(field) {
      let node = field.parentNode.querySelector(".ioh-cybershoke-playtime");
      if (node) {
        return node.querySelector(".ioh-cybershoke-value");
      }
      node = this.document.createElement("div");
      node.className = field.className + " ioh-cybershoke-playtime";
      markIoh(node);
      const labelSpan = this.document.createElement("span");
      const originalSpan = field.querySelector("span");
      labelSpan.className = originalSpan ? originalSpan.className : "";
      labelSpan.textContent = "CYBERSHOKE";
      const valueDiv = this.document.createElement("div");
      const originalDiv = field.querySelector("div");
      valueDiv.className = (originalDiv ? originalDiv.className : "") + " ioh-cybershoke-value";
      node.appendChild(labelSpan);
      node.appendChild(valueDiv);
      const faceitNode = field.parentNode.querySelector(".ioh-faceit-elo");
      const accountNode = field.parentNode.querySelector(".ioh-account-created");
      if (faceitNode) {
        faceitNode.insertAdjacentElement("beforebegin", node);
      } else if (accountNode) {
        accountNode.insertAdjacentElement("afterend", node);
      } else {
        field.insertAdjacentElement("afterend", node);
      }
      return valueDiv;
    },
    findOffenderNickElement(field) {
      const valueBlock = this.findFieldValueBlock(field);
      if (!valueBlock) {
        return null;
      }
      const buttons = Array.from(valueBlock.querySelectorAll("button"));
      const nickButton = buttons.find((btn) => {
        const text = (btn.textContent || "").trim();
        return text && !/^\d{17,18}$/.test(text);
      });
      if (nickButton) {
        return nickButton;
      }
      const profileLink = valueBlock.querySelector(
        'a[href*="cybershoke.net/"], a[href*="/moderator/profile/"]'
      );
      if (!profileLink) {
        return null;
      }
      const linkRow = profileLink.parentElement;
      if (linkRow?.previousElementSibling) {
        const prev = linkRow.previousElementSibling;
        const prevButton = prev.querySelector?.("button") || (prev.tagName === "BUTTON" ? prev : null);
        if (prevButton) {
          return prevButton;
        }
        return prev;
      }
      return null;
    },
    ensureOffenderCountryNode(field) {
      const valueBlock = this.findFieldValueBlock(field);
      const existing = valueBlock?.querySelector(".ioh-offender-country") || field.parentNode.querySelector(".ioh-offender-country");
      if (existing) {
        return existing;
      }
      const node = this.document.createElement("span");
      node.className = "ioh-offender-country";
      node.hidden = true;
      markIoh(node);
      const nick = this.findOffenderNickElement(field);
      if (nick?.parentNode) {
        let insertAfter = nick;
        let next = nick.nextElementSibling;
        while (next && (next.classList.contains("ioh-admin-icon") || next.classList.contains("ioh-moderator-badge") || next.classList.contains("ioh-profile-verified") || next.classList.contains("ioh-vip-badge") || next.classList.contains("ioh-punishment-icon"))) {
          insertAfter = next;
          next = next.nextElementSibling;
        }
        insertAfter.insertAdjacentElement("afterend", node);
        return node;
      }
      const profileLink = valueBlock?.querySelector(
        'a[href*="cybershoke.net/"], a[href*="/moderator/profile/"]'
      );
      if (profileLink) {
        profileLink.insertAdjacentElement("afterend", node);
      } else if (valueBlock) {
        valueBlock.appendChild(node);
      } else {
        field.appendChild(node);
      }
      return node;
    },
    getOffenderFieldContext() {
      const ticketTextarea = this.findVisibleTicketResolutionTextarea() || this.document.querySelector('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]');
      if (!ticketTextarea) {
        return null;
      }
      const scope = this.getTicketScopeRoot(ticketTextarea);
      const offenderField = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope) || this.findInfoField("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C");
      const offenderSteamId = this.nativeData ? this.getNativeTicket(scope)?.suspectId : this.extractSteamIdFromField(offenderField);
      if (!offenderField || !offenderSteamId) {
        return null;
      }
      return { offenderField, offenderSteamId };
    },
    formatSteamCreationDate(timecreated) {
      const timestamp = Number(timecreated);
      if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return null;
      }
      return new Date(timestamp * 1e3).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    },
    formatCybershokePlaytime(playtime) {
      const seconds = Number(playtime);
      if (!Number.isFinite(seconds) || seconds < 0) {
        return "0\u0447";
      }
      return `${Math.floor(seconds / 3600)}\u0447`;
    },
    formatCountryTooltip(country) {
      const code = String(country || "").trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) {
        return code || "";
      }
      try {
        const names = new Intl.DisplayNames(["ru"], { type: "region" });
        const name = names.of(code);
        return name ? `${code} ${name}` : code;
      } catch {
        return code;
      }
    },
    extractOffenderProfileData(data, source = "fastmm") {
      return { creationDate: this.formatSteamCreationDate(data?.steam?.profile?.timecreated), source };
    },
    fetchOffenderProfile(steamId3, { force = false } = {}) {
      if (!force && this.offenderProfileCache.has(steamId3)) {
        return Promise.resolve(this.offenderProfileCache.get(steamId3));
      }
      if (!force && this.offenderProfileInflight.has(steamId3)) {
        return this.offenderProfileInflight.get(steamId3);
      }
      const requestPromise = new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: "fetchOffenderProfile", steamId: steamId3 },
          (response) => {
            if (chrome.runtime.lastError) {
              return reject(chrome.runtime.lastError);
            }
            if (!(response && response.success)) {
              return reject(new Error(response ? response.error : "Unknown error"));
            }
            const profileData = this.extractOffenderProfileData(
              response.data,
              response.source || "fastmm"
            );
            this.offenderProfileCache.set(steamId3, profileData);
            resolve(profileData);
          }
        );
      }).finally(() => {
        this.offenderProfileInflight.delete(steamId3);
      });
      this.offenderProfileInflight.set(steamId3, requestPromise);
      return requestPromise;
    },
    renderCybershokePlaytimeValue(valueNode, data) {
      if (!valueNode) {
        return;
      }
      valueNode.classList.remove("ioh-account-value--error");
      valueNode.textContent = this.formatCybershokePlaytime(data?.playtime);
    },
    renderOffenderCountryValue(containerNode, data) {
      if (!containerNode) {
        return;
      }
      containerNode.textContent = "";
      containerNode.classList.remove("ioh-account-value--error");
      delete containerNode.dataset.countryLabel;
      const country = data?.country;
      if (!country) {
        containerNode.hidden = true;
        return;
      }
      containerNode.hidden = false;
      containerNode.dataset.countryLabel = this.formatCountryTooltip(country);
      const img = this.document.createElement("img");
      markIoh(img);
      img.className = "ioh-offender-flag";
      img.alt = country;
      img.width = 16;
      img.height = 16;
      img.src = `https://cloud.cybershoke.net/img/flags/${country}.svg`;
      img.style.flexShrink = "0";
      containerNode.appendChild(img);
    },
    renderProfileFieldError(valueNode, containerNode, steamId3, reloadFn, cacheMap = this.offenderProfileCache) {
      valueNode.textContent = "";
      valueNode.classList.add("ioh-account-value--error");
      const errorSpan = this.document.createElement("span");
      markIoh(errorSpan);
      errorSpan.className = "ioh-account-error";
      errorSpan.textContent = "\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438";
      const retryBtn = this.document.createElement("button");
      markIoh(retryBtn);
      retryBtn.type = "button";
      retryBtn.className = "ioh-account-retry";
      retryBtn.title = "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C";
      retryBtn.textContent = "\u27F3";
      retryBtn.addEventListener("click", () => {
        valueNode.classList.remove("ioh-account-value--error");
        containerNode.dataset.loaded = "false";
        cacheMap.delete(steamId3);
        reloadFn({ force: true });
      });
      valueNode.appendChild(errorSpan);
      valueNode.appendChild(retryBtn);
    },
    async loadSteamAccountCreationDate(containerNode, steamId3, { force = false } = {}) {
      const valueNode = containerNode.querySelector(".ioh-account-value");
      if (!valueNode) return;
      if (!force && containerNode.dataset.steamId === steamId3 && containerNode.dataset.loaded === "true") {
        return;
      }
      containerNode.dataset.steamId = steamId3;
      containerNode.dataset.loaded = "false";
      valueNode.textContent = "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...";
      try {
        const profileData = await this.fetchOffenderProfile(steamId3, { force });
        if (!containerNode.isConnected || containerNode.dataset.steamId !== steamId3) return;
        valueNode.classList.remove("ioh-account-value--error");
        valueNode.textContent = profileData.creationDate ? profileData.creationDate : "\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u0441\u043A\u0440\u044B\u0442";
        containerNode.dataset.loaded = "true";
      } catch (error) {
        if (!containerNode.isConnected || containerNode.dataset.steamId !== steamId3) return;
        this.renderProfileFieldError(
          valueNode,
          containerNode,
          steamId3,
          (opts) => this.loadSteamAccountCreationDate(containerNode, steamId3, opts)
        );
        containerNode.dataset.loaded = "true";
      }
    },
    async renderSteamAccountCreationDate() {
      const context = this.getOffenderFieldContext();
      if (!context) {
        this.clearSteamAccountCreationDate();
        return;
      }
      const valueNode = this.ensureSteamAccountCreationNode(context.offenderField);
      const containerNode = valueNode.closest(".ioh-account-created");
      await this.loadSteamAccountCreationDate(containerNode, context.offenderSteamId);
    },
    async renderFaceitElo() {
      const context = this.getOffenderFieldContext();
      if (!context) {
        this.clearFaceitElo();
        return;
      }
      const faceit = this.nativeData?.player(context.offenderSteamId)?.faceit;
      if (!faceit) {
        this.clearFaceitElo();
        return;
      }
      const value = this.ensureFaceitEloNode(context.offenderField);
      const signature = `${context.offenderSteamId}:${faceit.elo}:${faceit.level}`;
      if (value.dataset.iohFaceitValue === signature) return;
      value.dataset.iohFaceitValue = signature;
      value.replaceChildren();
      const badge = createFaceitLevelIcon(this.document, faceit.level);
      const label = this.document.createElement("span");
      markIoh(label);
      label.textContent = faceit.elo == null ? "\u0411\u0435\u0437 \u0440\u0435\u0439\u0442\u0438\u043D\u0433\u0430" : `${faceit.elo} Elo`;
      value.append(badge, label);
    },
    async renderOffenderProjectInfo({ force = false } = {}) {
      const showPlaytime = this.settings?.features?.showCybershokePlaytime;
      const showCountry = this.settings?.features?.showOffenderCountry;
      if (!showPlaytime) {
        this.clearCybershokePlaytime();
      }
      if (!showCountry) {
        this.clearOffenderCountry();
      }
      if (!showPlaytime && !showCountry) {
        return;
      }
      const context = this.getOffenderFieldContext();
      if (!context) {
        this.clearCybershokePlaytime();
        this.clearOffenderCountry();
        return;
      }
      const { offenderField, offenderSteamId } = context;
      if (this.nativeData) {
        const data = this.nativePlayer(offenderSteamId);
        this._nativeProfileLoads ||= /* @__PURE__ */ new Map();
        if (data?.playtime == null && !this._nativeProfileLoads.has(offenderSteamId)) {
          this._nativeProfileLoads.set(offenderSteamId, "pending");
          void this.fetchParsedUserData(offenderSteamId).then(
            () => this._nativeProfileLoads.set(offenderSteamId, "ready"),
            () => this._nativeProfileLoads.set(offenderSteamId, "error")
          ).finally(() => {
            if (!this._pageClosed && this.getOffenderFieldContext()?.offenderSteamId === offenderSteamId) void this.renderOffenderProjectInfo();
          });
        }
        if (showPlaytime) {
          const value = this.ensureCybershokePlaytimeNode(offenderField);
          value.classList.remove("ioh-account-value--error");
          value.textContent = typeof data?.playtime === "number" && data.playtime >= 0 ? this.formatCybershokePlaytime(data.playtime) : this._nativeProfileLoads.get(offenderSteamId) === "pending" ? "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430..." : "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445";
          if (data?.playtime == null && this._nativeProfileLoads.get(offenderSteamId) === "error") this.renderProfileFieldError(
            value,
            value.closest(".ioh-cybershoke-playtime"),
            offenderSteamId,
            () => this.renderOffenderProjectInfo(),
            this._nativeProfileLoads
          );
        }
        if (showCountry) this.renderOffenderCountryValue(this.ensureOffenderCountryNode(offenderField), data);
        return;
      }
      const playtimeValue = showPlaytime ? this.ensureCybershokePlaytimeNode(offenderField) : null;
      const playtimeContainer = playtimeValue?.closest(".ioh-cybershoke-playtime") || null;
      const countryContainer = showCountry ? this.ensureOffenderCountryNode(offenderField) : null;
      if (!playtimeValue && !countryContainer) {
        return;
      }
      const nodesReady = (!playtimeContainer || playtimeContainer.dataset.steamId === offenderSteamId && playtimeContainer.dataset.loaded === "true") && (!countryContainer || countryContainer.dataset.steamId === offenderSteamId && countryContainer.dataset.loaded === "true");
      if (!force && nodesReady) {
        return;
      }
      const applyData = (data) => {
        if (playtimeValue) {
          this.renderCybershokePlaytimeValue(playtimeValue, data);
          playtimeContainer.dataset.steamId = offenderSteamId;
          playtimeContainer.dataset.loaded = "true";
        }
        if (countryContainer) {
          this.renderOffenderCountryValue(countryContainer, data);
          countryContainer.dataset.steamId = offenderSteamId;
          countryContainer.dataset.loaded = "true";
        }
      };
      const cached = !force ? this.offenderProjectCache.get(offenderSteamId) || this.offenderTicketProjectCache.get(offenderSteamId) : null;
      if (cached) {
        applyData(cached);
        return;
      }
      if (playtimeValue) {
        playtimeContainer.dataset.steamId = offenderSteamId;
        playtimeContainer.dataset.loaded = "false";
        playtimeValue.classList.remove("ioh-account-value--error");
        playtimeValue.textContent = "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...";
      }
      if (countryContainer) {
        countryContainer.dataset.steamId = offenderSteamId;
        countryContainer.dataset.loaded = "false";
        countryContainer.classList.remove("ioh-account-value--error");
        delete countryContainer.dataset.countryLabel;
        if (showPlaytime) {
          countryContainer.textContent = "";
          countryContainer.hidden = true;
        } else {
          countryContainer.hidden = false;
          countryContainer.textContent = "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...";
        }
      }
      try {
        const data = await this.getOffenderProjectData(offenderSteamId, { force });
        applyData(data);
      } catch (error) {
        const reloadFn = (opts) => this.renderOffenderProjectInfo(opts);
        if (playtimeValue) {
          this.renderProfileFieldError(
            playtimeValue,
            playtimeContainer,
            offenderSteamId,
            reloadFn,
            this.offenderTicketProjectCache
          );
          playtimeContainer.dataset.loaded = "true";
        }
        if (countryContainer) {
          countryContainer.hidden = false;
          this.renderProfileFieldError(
            countryContainer,
            countryContainer,
            offenderSteamId,
            reloadFn,
            this.offenderTicketProjectCache
          );
          countryContainer.dataset.loaded = "true";
        }
      }
    }
  };

  // modules/native/model.js
  var requestTime = (view) => view?.performance?.timeOrigin && typeof view.performance.now === "function" ? view.performance.timeOrigin + view.performance.now() : Date.now();
  var steamId2 = (value) => /^\d{17}$/.test(String(value || "")) ? String(value) : null;
  var record2 = (value) => value && typeof value === "object" && !Array.isArray(value);
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
  function normalizePunishment(value, kind) {
    if (!record2(value)) return null;
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
    return timeMs && typeof v.text === "string" ? { timeMs, text: str(v.text), adminId: steamId2(v.steamid64_admin) } : null;
  }
  function complaint(v, entity) {
    if (!record2(v) || !Number.isSafeInteger(Number(v.id)) || Number(v.id) <= 0 || !steamId2(v.steamid64_suspect)) return null;
    const result = { key: `${entity}:${v.id}`, entity, id: Number(v.id), suspectId: steamId2(v.steamid64_suspect), senderId: steamId2(v.steamid64_sender) };
    const strings = { message: "message", reasonCode: "reason", mode: "mode", category: "server_category", suspectCountry: "country_suspect", senderCountry: "country_sender" };
    for (const [key, source] of Object.entries(strings)) if (own(v, source)) result[key] = str(v[source]);
    if (own(v, "reason")) result.reason = reasonLabel(v.reason);
    for (const [key, source] of Object.entries({ status: "status", result: "result", playtime: "playtime_suspect", kills: "kills", deaths: "deaths", headshots: "headshots", cs2Hours: "cs2_hours_suspect", complaints: "complaints_count" })) if (own(v, source)) result[key] = number(v[source]);
    if (own(v, "server_ip")) result.complaintServer = endpoint(v.server_ip, v.server_port);
    if (own(v, "steamid64_admin")) result.adminId = steamId2(v.steamid64_admin);
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
    if (!record2(v)) return null;
    const data = record2(v.result) ? v.result : record2(v.data) ? v.data : v;
    if (!record2(data.basic) && !record2(data.cybershoke)) return null;
    if (data.basic?.steamid64 && steamId2(data.basic.steamid64) !== id) return null;
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
    if (own(data, "server") && (data.server === null || record2(data.server))) p.serverIp = data.server ? endpoint(data.server.server_ip, data.server.server_port) : null;
    if (data.server?.mode) p.serverLabel = [str(data.server.mode, 80), data.server.num ? "#" + data.server.num : "", str(data.server.category, 100)].filter(Boolean).join(" ");
    if (list(b.bans_list)) {
      for (const [kind, type] of [["bans", 4], ["mutes", 3]]) {
        const rows = b.bans_list.filter((x) => Number(x.type) === type).map((x) => normalizePunishment(x, kind));
        if (rows.some((x) => !x)) continue;
        p[kind] = rows;
        p[kind === "bans" ? "isBanned" : "isMuted"] = p[kind].some((x) => punishmentActive(x));
      }
    }
    const source = [b.connect, data.connect, data, b].find((x) => own(x, "faceit"));
    const f = source?.faceit;
    if (record2(f)) {
      const profile = record2(f.profile) ? f.profile : f;
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
    if (!descriptor || status < 200 || status >= 300 || !record2(raw) && !Array.isArray(raw)) return null;
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
          if (!timeMs || typeof text !== "string" || v.steamid64 && steamId2(v.steamid64) !== d.steamId) return null;
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
      if (!record2(a) || !steamId2(a.steamid64)) return null;
      let groups = a.access_group;
      if (typeof groups === "string") {
        try {
          groups = JSON.parse(groups);
        } catch {
          return null;
        }
      }
      payload = { steamId: steamId2(a.steamid64), groups: Array.isArray(groups) ? groups.filter((x) => typeof x === "string").slice(0, 500) : [], flags: str(a.access_abc, 200) };
    } else if (d.kind === "bypass") {
      const v = raw.data;
      if (raw.result !== "success" || !record2(v)) return null;
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
        endpoint: record2(s) ? endpoint(s.server_ip ?? s.ip, s.server_port ?? s.port) : null,
        players: raw.players.map((v) => ({ steamId: steamId2(v.steamid64), isModerator: bool(v.is_moderator) })).filter((v) => v.steamId)
      };
    } else if (d.kind === "action") {
      const success = bool(raw.success) ?? (raw.result === "success" || raw.results?.[0]?.status === "success" ? true : raw.result === "error" || raw.results?.[0]?.status === "error" ? false : void 0);
      if (success === void 0) return null;
      payload = { steamId: d.steamId, resource: d.resource, success };
    }
    return payload == null ? null : { version: 1, kind: d.kind, key: d.key, startedAt, receivedAt, sequence, payload };
  }

  // modules/shared/playerProfile.js
  var PLAYER_PROFILE_LINK_SELECTOR = 'a[href*="cybershoke.net/"], a[href*="cybershoke.ru/"]';
  function steamIdFromPlayerProfileUrl(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || !/^(?:www\.)?cybershoke\.(?:net|ru)$/.test(url.hostname)) return null;
      return url.pathname.match(/^\/(?:id\/)?(\d{17})\/?$/)?.[1] || null;
    } catch {
      return null;
    }
  }

  // modules/native/QueueChatClient.js
  var QUEUE_CHAT_CHANNEL = "ioh-queue-chat-v1";
  var QUEUE_CHAT_TIMEOUT = 15e3;
  var QUEUE_CHAT_MAX_INFLIGHT = 8;
  var clients = /* @__PURE__ */ new WeakMap();
  var validSteamId = (id) => typeof id === "string" && /^\d{17}$/.test(id);
  var allowedOrigin = (origin) => /^https:\/\/io\.cybershoke\.(net|ru)$/.test(origin);
  var codes = /* @__PURE__ */ new Set(["ABORTED", "TIMEOUT", "RATE_LIMIT", "UNAVAILABLE", "INVALID_RESPONSE", "BUSY"]);
  var queueChatError = (code) => Object.assign(new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0447\u0430\u0442\u0430: " + (codes.has(code) ? code : "UNAVAILABLE")), { code: codes.has(code) ? code : "UNAVAILABLE" });
  function validMessages(messages) {
    return Array.isArray(messages) && messages.length <= 1e4 && messages.every((m) => m && Number.isFinite(m.timeMs) && m.timeMs > 0 && typeof m.text === "string" && m.text.length <= 2e4 && ["all", "team"].includes(m.channel));
  }
  function getClient(window2) {
    if (clients.has(window2)) return clients.get(window2);
    const pending = /* @__PURE__ */ new Map();
    const origin = window2.location.origin;
    const post = (data) => window2.postMessage({ channel: QUEUE_CHAT_CHANNEL, ...data }, origin);
    const finish = (nonce, error, messages) => {
      const request = pending.get(nonce);
      if (!request) return;
      pending.delete(nonce);
      clearTimeout(request.timer);
      request.signal?.removeEventListener("abort", request.cancel);
      if (error) request.reject(error);
      else request.resolve(messages);
    };
    const listener = (event) => {
      if (event.source !== window2 || event.origin !== origin || event.data?.channel !== QUEUE_CHAT_CHANNEL) return;
      const data = event.data, request = pending.get(data.nonce);
      if (!request || data.steamId !== request.steamId) return;
      if (data.type === "error") finish(data.nonce, queueChatError(data.code));
      else if (data.type === "result") finish(data.nonce, validMessages(data.messages) ? null : queueChatError("INVALID_RESPONSE"), data.messages);
    };
    const hide = () => {
      for (const nonce of [...pending.keys()]) {
        post({ type: "cancel", nonce });
        finish(nonce, queueChatError("ABORTED"));
      }
      window2.removeEventListener("message", listener);
      window2.removeEventListener("pagehide", hide);
      clients.delete(window2);
    };
    window2.addEventListener("message", listener);
    window2.addEventListener("pagehide", hide);
    const client = { pending, post, finish };
    clients.set(window2, client);
    return client;
  }
  function requestQueueChat({ window: window2, steamId: steamId3, signal }) {
    if (!allowedOrigin(window2?.location?.origin || "") || !validSteamId(steamId3)) return Promise.reject(queueChatError("UNAVAILABLE"));
    if (signal?.aborted) return Promise.reject(queueChatError("ABORTED"));
    const client = getClient(window2);
    if (client.pending.size >= QUEUE_CHAT_MAX_INFLIGHT) return Promise.reject(queueChatError("BUSY"));
    const nonce = window2.crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        client.post({ type: "cancel", nonce });
        client.finish(nonce, queueChatError("ABORTED"));
      };
      const timer = setTimeout(() => {
        client.post({ type: "cancel", nonce });
        client.finish(nonce, queueChatError("TIMEOUT"));
      }, QUEUE_CHAT_TIMEOUT + 1e3);
      client.pending.set(nonce, { steamId: steamId3, signal, resolve, reject, cancel, timer });
      signal?.addEventListener("abort", cancel, { once: true });
      client.post({ type: "read", nonce, steamId: steamId3 });
    });
  }

  // modules/ticket/QueueChatTracking.js
  var QueueChatTrackingMethods = {
    pruneQueueChatCache() {
      if (!this._queueChatCache?.size) return;
      const now = Date.now();
      const queued = new Set((this.nativeData?.queueTickets?.() || []).map((ticket) => ticket.suspectId));
      for (const [id, cached] of this._queueChatCache) {
        if (!queued.has(id) && now - (cached.lastUsedAt ?? cached.fetchedAt) >= 10 * 60 * 1e3) this._queueChatCache.delete(id);
      }
    },
    async fetchQueueChat(steamId3) {
      this._queueChatInflight ||= /* @__PURE__ */ new Map();
      if (this._queueChatInflight.has(steamId3)) return this._queueChatInflight.get(steamId3).promise;
      const controller = new AbortController();
      const entry = { controller };
      entry.promise = requestQueueChat({ window, steamId: steamId3, signal: controller.signal }).then((messages) => {
        if (controller.signal.aborted) return null;
        this._queueChatCache ||= /* @__PURE__ */ new Map();
        this._queueChatCache.delete(steamId3);
        this._queueChatCache.set(steamId3, { messages, fetchedAt: Date.now(), lastUsedAt: Date.now() });
        this.pruneQueueChatCache();
        if (this._queueChatCache.size > 256) this._queueChatCache.delete(this._queueChatCache.keys().next().value);
        return messages;
      }).catch((error) => {
        if (!controller.signal.aborted) this._queueChatCache?.delete(steamId3);
        if (error.code === "RATE_LIMIT") this.globalServerCooldown = Date.now() + 660;
        return null;
      }).finally(() => {
        if (this._queueChatInflight.get(steamId3) === entry) this._queueChatInflight.delete(steamId3);
      });
      this._queueChatInflight.set(steamId3, entry);
      return entry.promise;
    },
    getQueueChatVerdict(row) {
      if (!this.settings.features?.trackOffenderServer || !this.isMuteHighlightComplaintReason(this.getComplaintReasonFromRow(row))) return null;
      const id = this.nativeData ? this.getNativeRowTicket(row)?.suspectId : steamIdFromPlayerProfileUrl(row.querySelector('td:nth-child(4) a[href*="cybershoke."]')?.href);
      const cached = this._queueChatCache?.get(id);
      if (!cached) return null;
      const now = Date.now();
      cached.lastUsedAt = now;
      this._queueChatCache.delete(id);
      this._queueChatCache.set(id, cached);
      if (!cached.verdict || cached.rules !== this.rules || cached.exceptions !== this.muteExceptions || cached.spamRules !== this.spamRules || now >= cached.expiresAt) {
        cached.messages = cached.messages.filter((message) => message.timeMs >= now - 864e5 && message.timeMs <= now);
        cached.verdict = analyzeQueueChatMessages(this, cached.messages, { now });
        cached.rules = this.rules;
        cached.exceptions = this.muteExceptions;
        cached.spamRules = this.spamRules;
        const expirations = cached.messages.map((m) => m.timeMs + 86400001).filter((time) => time > now);
        cached.expiresAt = expirations.length ? Math.min(...expirations) : Infinity;
      }
      return cached.verdict;
    },
    stopQueueChatTracking({ preserveCache = false } = {}) {
      for (const entry of this._queueChatInflight?.values() || []) entry.controller.abort();
      this._queueChatInflight?.clear();
      if (preserveCache) return;
      this._queueChatCache?.clear();
      this._offenderRowSnapshots = /* @__PURE__ */ new WeakMap();
      for (const row of this.document.querySelectorAll("tr.ioh-highlighted-chat-mute")) {
        row.classList.remove("ioh-highlighted-chat-mute");
        this.restoreAllOffenderPunishmentActionLabels(row);
      }
    }
  };

  // modules/ticket/OffenderTracking.js
  var OffenderTrackingMethods = {
    ...QueueChatTrackingMethods,
    normalizeVipName(raw) {
      if (raw == null) {
        return null;
      }
      const value = String(raw).trim();
      if (!value || /^null$/i.test(value) || /^none$/i.test(value)) {
        return null;
      }
      return value;
    },
    getCachedUserData(steamId3, maxAge = Infinity) {
      const p = this.nativeData ? this.nativePlayer(steamId3) : this.userDataCache.get(steamId3) || null;
      if (Number.isFinite(maxAge) && (!p || !Object.hasOwn(p, "serverIp") || Date.now() - (p.presenceAt ?? p.fetchedAt ?? 0) >= maxAge)) return null;
      return p;
    },
    setOffenderProjectCache(steamId3, data) {
      this.offenderProjectCache.set(steamId3, {
        country: data.country ?? null,
        playtime: data.playtime ?? null
      });
    },
    setOffenderTicketProjectCache(steamId3, data) {
      this.offenderTicketProjectCache.set(steamId3, {
        country: data.country ?? null,
        playtime: data.playtime ?? null
      });
    },
    collectComplaintQueueOffenderSteamIds() {
      const ids = /* @__PURE__ */ new Set();
      for (const table of this.findComplaintQueueTables()) {
        for (const row of table.querySelectorAll("tbody tr")) {
          const link = row.querySelector('td:nth-child(4) a[href*="cybershoke.net/"]');
          const match = link?.href?.match(/\d{17,18}/);
          if (match) {
            ids.add(match[0]);
          }
        }
      }
      return ids;
    },
    pruneOffenderProjectCache(presentSteamIds = null) {
      const present = presentSteamIds || this.collectComplaintQueueOffenderSteamIds();
      for (const steamId3 of [...this.offenderProjectCache.keys()]) {
        if (!present.has(steamId3)) {
          this.offenderProjectCache.delete(steamId3);
        }
      }
    },
    setCachedUserData(steamId3, data) {
      const previous = this.userDataCache.get(steamId3) || {};
      const next = { ...previous, ...data, fetchedAt: data.fetchedAt ?? Date.now() };
      this.userDataCache.set(steamId3, next);
      this.setOffenderProjectCache(steamId3, next);
      this.onCloseReasonPunishmentData?.(steamId3, next);
    },
    async fetchParsedUserData(steamId3) {
      if (this.offenderProjectInflight.has(steamId3)) {
        return this.offenderProjectInflight.get(steamId3);
      }
      const requestPromise = (async () => {
        const startedAt = requestTime(typeof window === "undefined" ? null : window), sequence = this._trackerResponseSequence = (this._trackerResponseSequence || 0) + 1;
        const controller = new AbortController();
        let timer;
        try {
          const response = await Promise.race([this.fetchUserData(steamId3, { signal: controller.signal }), new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("\u0422\u0430\u0439\u043C\u0430\u0443\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0438\u0433\u0440\u043E\u043A\u0430"));
            }, 15e3);
          })]);
          if (response.status === 429) {
            this.globalServerCooldown = Date.now() + 660;
            throw new Error("429");
          }
          if (!response.ok) {
            throw new Error(`fetch failed ${response.status}`);
          }
          const result = await response.json();
          if (this.nativeData) {
            const event = normalizeResponse(
              { kind: "player", steamId: steamId3, key: "player:" + steamId3 },
              result,
              { startedAt, receivedAt: Date.now(), sequence }
            );
            if (!event) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u0438\u0433\u0440\u043E\u043A\u0430");
            event.source = "tracker";
            this.nativeData.apply(event);
            return this.nativePlayer(steamId3);
          }
          const userData = this.parseUserDataResult(result);
          this.setCachedUserData(steamId3, userData);
          return userData;
        } finally {
          clearTimeout(timer);
        }
      })().finally(() => {
        this.offenderProjectInflight.delete(steamId3);
      });
      this.offenderProjectInflight.set(steamId3, requestPromise);
      return requestPromise;
    },
    async fetchOffenderTicketProjectData(steamId3) {
      const p = this.nativePlayer?.(steamId3) || this.offenderProjectCache.get(steamId3);
      if (p && typeof p.playtime === "number") return p;
      return this.fetchParsedUserData(steamId3);
    },
    async getOffenderProjectData(steamId3) {
      return this.fetchOffenderTicketProjectData(steamId3);
    },
    getServerLinkLabelElement(link) {
      return link.querySelector(":scope > span") || link.querySelector("span");
    },
    ensureServerLinkOriginalIp(link) {
      if (link.dataset.iohOriginalServerIp) {
        return link.dataset.iohOriginalServerIp;
      }
      const ip = link.href.replace(/^steam:\/\/connect\//i, "").trim().toLowerCase();
      link.dataset.iohOriginalServerIp = ip;
      return ip;
    },
    ensureServerLinkOriginalText(link) {
      if (link.dataset.iohOriginalServerText) {
        return link.dataset.iohOriginalServerText;
      }
      const labelEl = this.getServerLinkLabelElement(link);
      const originalText = labelEl?.textContent?.trim() || link.textContent?.trim() || "";
      link.dataset.iohOriginalServerText = originalText;
      return originalText;
    },
    updateServerLinkDisplay(link, { status, lastconnect = null, currentIp = null, serverLabel = null }) {
      if (!link) {
        return;
      }
      link.classList.remove("ioh-server-online", "ioh-server-offline", "ioh-server-other");
      const originalText = this.ensureServerLinkOriginalText(link);
      const labelEl = this.getServerLinkLabelElement(link);
      const setLabelText = (text) => {
        if (labelEl) {
          if (labelEl.textContent !== text) labelEl.textContent = text;
        } else {
          if (link.textContent !== text) link.textContent = text;
        }
      };
      if (status === "offline") {
        link.classList.add("ioh-server-offline");
        setLabelText(this.utils.formatLastConnectStatus(lastconnect));
        return;
      }
      if (status === "online") {
        link.classList.add("ioh-server-online");
        setLabelText(originalText);
        const originalIp = link.dataset.iohOriginalServerIp;
        if (originalIp) {
          link.href = `steam://connect/${originalIp}`;
        }
        return;
      }
      if (status === "other") {
        link.classList.add("ioh-server-other");
        const displayText = serverLabel || currentIp || originalText;
        setLabelText(displayText);
        if (currentIp) {
          link.href = `steam://connect/${currentIp}`;
        }
      }
    },
    getComplaintReasonFromRow(row) {
      if (!row) {
        return "";
      }
      if (this.nativeData) return this.getNativeRowTicket(row)?.reason || "";
      const cells = row.querySelectorAll("td");
      if (!cells.length) {
        return "";
      }
      const reasonIndex = this.getColumnIndex(row, ["\u043F\u0440\u0438\u0447\u0438\u043D\u0430"], 5);
      const reasonCell = cells[reasonIndex];
      if (!reasonCell) {
        return "";
      }
      const parsedCategory = this.utils.parseComplaintCell(reasonCell).category;
      if (parsedCategory) {
        return parsedCategory;
      }
      const firstDiv = reasonCell.querySelector(":scope > div > div, :scope > div");
      if (firstDiv?.textContent?.trim()) {
        return firstDiv.textContent.trim();
      }
      const rawText = reasonCell.innerText?.trim() || "";
      return rawText.split("\n")[0]?.trim() || rawText;
    },
    isMuteHighlightComplaintReason(reason) {
      const normalized = this.normalizeReason(reason);
      if (!normalized) {
        return false;
      }
      const allowedReasons = [
        "\u041D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0435 \u043F\u0440\u0430\u0432\u0438\u043B",
        "\u0421\u043F\u0430\u043C",
        "\u041C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433",
        "\u041F\u043E\u043F\u0440\u043E\u0448\u0430\u0439\u043D\u0438\u0447\u0435\u0441\u0442\u0432\u043E"
      ];
      return allowedReasons.some((item) => this.normalizeReason(item) === normalized);
    },
    applyOffenderPunishmentHighlight(row, userData) {
      if (!row) {
        return;
      }
      const highlightBan = Boolean(userData?.isBanned);
      let highlightMute = false;
      if (!highlightBan && userData?.isMuted) {
        highlightMute = this.isMuteHighlightComplaintReason(
          this.getComplaintReasonFromRow(row)
        );
      }
      row.classList.toggle("ioh-highlighted-banned", highlightBan);
      row.classList.toggle("ioh-highlighted-muted", highlightMute);
      row.classList.toggle("ioh-highlighted-chat-mute", !highlightBan && !userData?.isMuted && this.getQueueChatVerdict(row)?.kind === "mute");
    },
    applyOffenderBanHighlight(row, isBanned) {
      this.applyOffenderPunishmentHighlight(row, { isBanned: Boolean(isBanned) });
    },
    getOffenderPunishmentIconType(row, userData) {
      if (userData?.isBanned) {
        return "ban";
      }
      if (userData?.isMuted && this.isMuteHighlightComplaintReason(this.getComplaintReasonFromRow(row))) {
        return "mute";
      }
      if (this.getQueueChatVerdict(row)?.kind === "mute") return "warning";
      return null;
    },
    removeOffenderPunishmentIcons(offenderLink) {
      const cell = offenderLink?.closest("td");
      const ctx = this.resolveOffenderVipContext(offenderLink);
      const scope = cell || ctx?.textColumn || offenderLink?.parentElement;
      scope?.querySelectorAll(".ioh-punishment-icon").forEach((el) => el.remove());
      if (offenderLink) {
        delete offenderLink.dataset.iohPunishmentIcon;
      }
    },
    getRowActionControl(row) {
      if (!row) {
        return null;
      }
      const existing = row.querySelector(".ioh-punishment-action");
      if (existing) {
        return existing;
      }
      const acceptLabels = ["\u041F\u0440\u0438\u043D\u044F\u0442\u044C \u0440\u0435\u043F\u043E\u0440\u0442", "\u041F\u0440\u0438\u043D\u044F\u0442\u044C \u0442\u0438\u043A\u0435\u0442"];
      const candidates = Array.from(row.querySelectorAll('button, [role="button"], a, span'));
      for (const el of candidates) {
        if (el.closest(".ioh-punishment-action__inner, .ioh-icon-box, .ioh-vip-badge, .ioh-admin-icon")) {
          continue;
        }
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!acceptLabels.some((label) => text === label || text.includes(label))) {
          continue;
        }
        const nested = Array.from(el.querySelectorAll('button, [role="button"], a, span')).find((child) => {
          if (child.closest(".ioh-punishment-action__inner")) {
            return false;
          }
          const childText = (child.textContent || "").replace(/\s+/g, " ").trim();
          return acceptLabels.some((label) => childText === label);
        });
        return nested || el;
      }
      return null;
    },
    rowActionIsInReview(row) {
      if (this.nativeData) return this.getNativeRowTicket(row)?.status === 1;
      if (!row) {
        return false;
      }
      return Array.from(row.querySelectorAll('button, [role="button"], a, span')).some((el) => {
        if (el.closest(".ioh-punishment-action__inner, .ioh-icon-box, .ioh-vip-badge")) {
          return false;
        }
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        return text === "\u041D\u0430 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u0438\u0438" || text.includes("\u041D\u0430 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u0438\u0438");
      });
    },
    restoreOffenderPunishmentActionLabel(control) {
      if (!control) {
        return;
      }
      if (control.dataset.iohOriginalActionHtml != null) {
        control.innerHTML = control.dataset.iohOriginalActionHtml;
        delete control.dataset.iohOriginalActionHtml;
      }
      control.classList.remove(
        "ioh-punishment-action",
        "ioh-punishment-action--ban",
        "ioh-punishment-action--mute",
        "ioh-punishment-action--warning"
      );
      delete control.dataset.iohPunishmentAction;
    },
    restoreAllOffenderPunishmentActionLabels(row) {
      if (!row) {
        return;
      }
      row.querySelectorAll(".ioh-punishment-action").forEach((control) => {
        this.restoreOffenderPunishmentActionLabel(control);
      });
    },
    applyOffenderPunishmentActionLabel(row, userData) {
      const type = this.getOffenderPunishmentIconType(row, userData);
      if (!type || this.rowActionIsInReview(row)) {
        this.restoreAllOffenderPunishmentActionLabels(row);
        return;
      }
      const control = this.getRowActionControl(row);
      if (!control) {
        this.restoreAllOffenderPunishmentActionLabels(row);
        return;
      }
      if (control.dataset.iohPunishmentAction === type && control.classList.contains("ioh-punishment-action")) {
        return;
      }
      if (control.dataset.iohOriginalActionHtml == null) {
        control.dataset.iohOriginalActionHtml = control.innerHTML;
      }
      const iconSvg = window.Icons?.[type] || "";
      const label = type === "ban" ? "\u0417\u0410\u0411\u0410\u041D\u0415\u041D" : type === "mute" ? "\u0410\u041A\u0422\u0418\u0412\u041D\u042B\u0419 \u041C\u0423\u0422" : "\u041D\u0423\u0416\u0415\u041D \u041C\u0423\u0422";
      control.classList.remove("ioh-punishment-action--ban", "ioh-punishment-action--mute", "ioh-punishment-action--warning");
      control.classList.add("ioh-punishment-action", `ioh-punishment-action--${type}`);
      control.dataset.iohPunishmentAction = type;
      control.innerHTML = `<span class="ioh-punishment-action__inner" data-ioh="1"><span class="ioh-icon-box">${iconSvg}</span><span class="ioh-punishment-action__text">${label}</span></span>`;
    },
    applyOffenderMuteBanIcons(offenderLink, row, userData) {
      this.removeOffenderPunishmentIcons(offenderLink);
      this.applyOffenderPunishmentActionLabel(row, userData);
    },
    getVipBadgeMeta(vipName) {
      const normalized = this.normalizeVipName(vipName);
      if (!normalized) {
        return null;
      }
      const isLite = normalized.toLowerCase() === "lite";
      return {
        label: normalized,
        variant: isLite ? "lite" : "gold",
        iconUrl: isLite ? "https://cloud.cybershoke.net/img/icons/blue-corona.svg" : "https://cloud.cybershoke.net/img/icons/corona.svg"
      };
    },
    isVipStatusAllowed(vipName) {
      const normalized = this.normalizeVipName(vipName);
      if (!normalized) {
        return false;
      }
      const allowed = this.settings.offenderVipStatuses || ["prospect", "coach", "talent", "pro", "legend"];
      const statusKey = normalized.toLowerCase();
      return allowed.some((status) => String(status).toLowerCase() === statusKey);
    },
    clearVipNickColor(nameButton) {
      if (!nameButton) {
        return;
      }
      nameButton.style.removeProperty("color");
      nameButton.querySelectorAll("*").forEach((node) => {
        if (node.style) {
          node.style.removeProperty("color");
        }
      });
    },
    applyVipNickColor(nameButton, color) {
      if (!nameButton || !color) {
        return;
      }
      nameButton.style.setProperty("color", color, "important");
      nameButton.querySelectorAll("*").forEach((node) => {
        if (node.style) {
          node.style.setProperty("color", color, "important");
        }
      });
    },
    removeOffenderVipBadge(offenderLink) {
      const cell = offenderLink?.closest("td");
      const ctx = this.resolveOffenderVipContext(offenderLink);
      const scope = cell || ctx?.textColumn || offenderLink?.parentElement;
      scope?.querySelectorAll(".ioh-vip-badge").forEach((badge) => badge.remove());
      cell?.querySelectorAll(".ioh-vip-name-row").forEach((row) => {
        row.classList.remove("ioh-vip-nick--gold", "ioh-vip-nick--lite");
        row.style.removeProperty("--ioh-vip-color");
        this.clearVipNickColor(row.querySelector(":scope > button"));
        this.unwrapVipNameRow(row);
      });
      this.restoreLegacyMovedVipIcons(scope);
      cell?.querySelectorAll(".ioh-vip-steamid-row").forEach((row) => this.unwrapSteamIdRow(row));
      ctx?.textColumn?.classList.remove("ioh-has-vip-badge");
      ctx?.offenderRoot?.classList.remove("ioh-offender-with-vip");
      cell?.querySelectorAll(".ioh-offender-icons-empty").forEach((el) => {
        el.classList.remove("ioh-offender-icons-empty");
      });
      cell?.classList.remove("ioh-offender-vip-cell");
      if (offenderLink) {
        delete offenderLink.dataset.iohVipName;
      }
    },
    clearOffenderVipBadges() {
      const links = this.document.querySelectorAll(
        'a[href*="cybershoke.net/"][data-ioh-vip-name], a[href*="cybershoke.net/"][data-ioh-vip-source]'
      );
      links.forEach((link) => {
        this.removeOffenderVipBadge(link);
      });
      this.document.querySelectorAll(".ioh-vip-badge").forEach((badge) => badge.remove());
      this.document.querySelectorAll(".ioh-vip-name-row").forEach((row) => {
        row.classList.remove("ioh-vip-nick--gold", "ioh-vip-nick--lite");
        row.style.removeProperty("--ioh-vip-color");
        this.clearVipNickColor(row.querySelector(":scope > button"));
        this.unwrapVipNameRow(row);
      });
      this.restoreLegacyMovedVipIcons(this.document);
      this.document.querySelectorAll(".ioh-vip-steamid-row").forEach((row) => this.unwrapSteamIdRow(row));
      this.document.querySelectorAll(".ioh-has-vip-badge").forEach((el) => el.classList.remove("ioh-has-vip-badge"));
      this.document.querySelectorAll(".ioh-offender-with-vip").forEach((el) => el.classList.remove("ioh-offender-with-vip"));
      this.document.querySelectorAll(".ioh-offender-icons-empty").forEach((el) => el.classList.remove("ioh-offender-icons-empty"));
      this.document.querySelectorAll(".ioh-offender-vip-cell").forEach((el) => el.classList.remove("ioh-offender-vip-cell"));
    },
    refreshOffenderVipBadges() {
      const links = this.document.querySelectorAll('a[href*="cybershoke.net/"][data-ioh-vip-source]');
      links.forEach((link) => {
        this.applyOffenderVipBadge(link, link.dataset.iohVipSource);
      });
    },
    removeOffenderProfileVerification(offenderLink) {
      const cell = offenderLink?.closest("td");
      const ctx = this.resolveOffenderVipContext(offenderLink);
      const scope = cell || ctx?.textColumn || offenderLink?.parentElement;
      scope?.querySelectorAll(".ioh-profile-verified").forEach((el) => el.remove());
      if (offenderLink) {
        delete offenderLink.dataset.iohProfileVerified;
      }
    },
    clearOffenderProfileVerification() {
      this.document.querySelectorAll(
        'a[href*="cybershoke.net/"][data-ioh-profile-verified], a[href*="cybershoke.net/"][data-ioh-profile-verified-source]'
      ).forEach((link) => {
        this.removeOffenderProfileVerification(link);
      });
      this.document.querySelectorAll(".ioh-profile-verified").forEach((el) => el.remove());
    },
    clearOffenderModeratorHighlights() {
      this.document.querySelectorAll("tr.ioh-highlighted-moderator").forEach((row) => {
        row.classList.remove("ioh-highlighted-moderator");
      });
      this.document.querySelectorAll(
        'a[href*="cybershoke.net/"][data-ioh-moderator-badge], a[href*="cybershoke.net/"][data-ioh-moderator-source]'
      ).forEach((link) => {
        this.removeOffenderModeratorBadge(link);
      });
      this.document.querySelectorAll(".ioh-moderator-badge").forEach((el) => el.remove());
    },
    refreshOffenderProfileVerification() {
      this.document.querySelectorAll('a[href*="cybershoke.net/"][data-ioh-profile-verified-source]').forEach((link) => {
        this.applyOffenderProfileVerification(link, true, link.closest("tr"));
      });
    },
    applyOffenderProfileVerification(offenderLink, profileVerified, row = null) {
      if (!offenderLink) {
        return;
      }
      if (profileVerified) {
        offenderLink.dataset.iohProfileVerifiedSource = "1";
      } else {
        delete offenderLink.dataset.iohProfileVerifiedSource;
      }
      const track = Boolean(this.settings.features?.trackOffenderServer);
      const show = track && Boolean(profileVerified);
      const moderatorOwnsHighlight = Boolean(offenderLink.dataset.iohModeratorSource);
      if (row && !moderatorOwnsHighlight) {
        row.classList.toggle("ioh-highlighted-moderator", show);
      }
      if (!show) {
        this.removeOffenderProfileVerification(offenderLink);
        return;
      }
      if (moderatorOwnsHighlight || offenderLink.dataset.iohModeratorBadge) {
        this.removeOffenderProfileVerification(offenderLink);
        return;
      }
      const ctx = this.resolveOffenderVipContext(offenderLink);
      const nameButton = ctx?.nameButton;
      if (!nameButton?.parentNode) {
        return;
      }
      const nameRow = nameButton.closest(".ioh-vip-name-row");
      const insertParent = nameRow || nameButton.parentElement;
      const existingOurs = insertParent?.querySelector(":scope > .ioh-profile-verified") || ctx?.textColumn?.querySelector(".ioh-profile-verified");
      if (existingOurs) {
        offenderLink.dataset.iohProfileVerified = "1";
        return;
      }
      const existingAdminCandidate = insertParent?.querySelector(":scope > .ioh-admin-icon:not(.ioh-punishment-icon)") || (nameButton.nextElementSibling?.classList?.contains("ioh-admin-icon") && !nameButton.nextElementSibling.classList.contains("ioh-punishment-icon") ? nameButton.nextElementSibling : null);
      if (existingAdminCandidate) {
        offenderLink.dataset.iohProfileVerified = "1";
        return;
      }
      const iconSvg = window.Icons?.verification;
      if (!iconSvg) {
        return;
      }
      const template = this.document.createElement("template");
      template.innerHTML = iconSvg.trim();
      const badge = template.content.firstElementChild;
      if (!badge) {
        return;
      }
      badge.classList.add("ioh-admin-icon", "ioh-profile-verified");
      markIoh(badge);
      nameButton.parentNode.insertBefore(badge, nameButton.nextSibling);
      offenderLink.dataset.iohProfileVerified = "1";
    },
    removeOffenderModeratorBadge(offenderLink) {
      const cell = offenderLink?.closest("td");
      const ctx = this.resolveOffenderVipContext(offenderLink);
      const scope = cell || ctx?.textColumn || offenderLink?.parentElement;
      scope?.querySelectorAll(".ioh-moderator-badge").forEach((el) => el.remove());
      if (offenderLink) {
        delete offenderLink.dataset.iohModeratorBadge;
        delete offenderLink.dataset.iohModeratorSource;
      }
    },
    applyOffenderModeratorHighlight(row, offenderLink, isModerator) {
      if (offenderLink) {
        if (isModerator) {
          offenderLink.dataset.iohModeratorSource = "1";
        } else {
          delete offenderLink.dataset.iohModeratorSource;
        }
      }
      const show = Boolean(isModerator);
      if (row) {
        row.classList.toggle("ioh-highlighted-moderator", show);
      }
      if (!show) {
        this.removeOffenderModeratorBadge(offenderLink);
        return;
      }
      if (!offenderLink) {
        return;
      }
      const ctx = this.resolveOffenderVipContext(offenderLink);
      const nameButton = ctx?.nameButton;
      if (!nameButton?.parentNode) {
        return;
      }
      const nameRow = nameButton.closest(".ioh-vip-name-row");
      const insertParent = nameRow || nameButton.parentElement;
      const existingOurs = insertParent?.querySelector(":scope > .ioh-moderator-badge") || ctx?.textColumn?.querySelector(".ioh-moderator-badge");
      if (existingOurs) {
        offenderLink.dataset.iohModeratorBadge = "1";
        return;
      }
      insertParent?.querySelectorAll(":scope > .ioh-profile-verified").forEach((el) => el.remove());
      ctx?.textColumn?.querySelectorAll(".ioh-profile-verified").forEach((el) => el.remove());
      delete offenderLink.dataset.iohProfileVerified;
      const iconSvg = window.Icons?.admin;
      if (!iconSvg) {
        return;
      }
      const template = this.document.createElement("template");
      template.innerHTML = iconSvg.trim();
      const badge = template.content.firstElementChild;
      if (!badge) {
        return;
      }
      badge.classList.add("ioh-admin-icon", "ioh-moderator-badge");
      markIoh(badge);
      nameButton.parentNode.insertBefore(badge, nameButton.nextSibling);
      offenderLink.dataset.iohModeratorBadge = "1";
    },
    resolveOffenderVipContext(offenderLink) {
      if (!offenderLink) {
        return null;
      }
      let idContainer = offenderLink.closest("div");
      if (idContainer?.classList.contains("ioh-vip-steamid-row")) {
        idContainer = idContainer.parentElement;
      }
      if (idContainer?.classList.contains("ioh-vip-name-row")) {
        idContainer = idContainer.parentElement;
      }
      const textColumn = idContainer?.parentElement;
      if (!textColumn || !idContainer) {
        return null;
      }
      const offenderRoot = textColumn.parentElement;
      const nameRow = textColumn.querySelector(":scope > .ioh-vip-name-row") || idContainer.parentElement?.querySelector(":scope > .ioh-vip-name-row");
      let nameButton = nameRow?.querySelector("button") || null;
      if (!nameButton) {
        nameButton = Array.from(textColumn.querySelectorAll("button")).find((btn) => !idContainer.contains(btn) && textColumn.contains(btn)) || null;
      }
      const iconsColumn = this.resolveOffenderIconsColumn(offenderRoot, textColumn);
      return {
        idContainer,
        textColumn,
        offenderRoot,
        nameButton,
        nameRow: nameButton?.closest(".ioh-vip-name-row") || nameRow || null,
        iconsColumn
      };
    },
    resolveOffenderIconsColumn(offenderRoot, textColumn) {
      if (!offenderRoot || !textColumn) {
        return null;
      }
      const siblings = Array.from(offenderRoot.children).filter((child) => child !== textColumn);
      if (!siblings.length) {
        return null;
      }
      const withIcons = siblings.find((child) => child.querySelector('img[alt*="Prime" i]') || child.querySelector('button use[href*="lc-copy"], button use[href*="copy"]'));
      if (withIcons) {
        return withIcons;
      }
      if (siblings.length >= 2) {
        return siblings[siblings.length - 1];
      }
      return null;
    },
    findOffenderNameButton(offenderLink) {
      return this.resolveOffenderVipContext(offenderLink)?.nameButton || null;
    },
    isPrimeStatusImg(img) {
      if (!img || img.tagName !== "IMG") {
        return false;
      }
      if (img.closest(".ioh-vip-badge")) {
        return false;
      }
      return /prime/i.test(img.getAttribute("alt") || "");
    },
    isCopyControl(el) {
      if (!el || el.tagName !== "BUTTON") {
        return false;
      }
      return Boolean(
        el.querySelector('use[href*="lc-copy"], use[href*="copy"], use[xlink\\:href*="lc-copy"]')
      );
    },
    liftToChildOf(node, stopParent) {
      if (!node || !stopParent) {
        return node;
      }
      let el = node;
      while (el.parentElement && el.parentElement !== stopParent) {
        el = el.parentElement;
      }
      return el;
    },
    findOffenderPrimeIcon(ctx) {
      if (!ctx) {
        return null;
      }
      const slotted = ctx.nameRow?.querySelector(":scope > .ioh-vip-prime-slot") || ctx.textColumn?.querySelector(".ioh-vip-prime-slot");
      if (slotted) {
        return slotted;
      }
      if (ctx.iconsColumn) {
        const fromCol = Array.from(ctx.iconsColumn.children).find((child) => this.isPrimeStatusImg(child) || child.querySelector?.('img[alt*="Prime" i]'));
        return fromCol || ctx.iconsColumn.firstElementChild || null;
      }
      const nickParent = ctx.nameRow?.parentElement || ctx.nameButton?.parentElement || ctx.textColumn;
      if (!nickParent) {
        return null;
      }
      const img = Array.from(nickParent.querySelectorAll('img[alt*="Prime" i]')).find((candidate) => this.isPrimeStatusImg(candidate));
      if (!img) {
        return null;
      }
      if (ctx.nameRow && img.parentElement === nickParent) {
        return img;
      }
      return this.liftToChildOf(img, nickParent);
    },
    findOffenderCopyControl(ctx, offenderLink, primeEl = null) {
      if (!ctx) {
        return null;
      }
      const slotted = ctx.idContainer?.querySelector(".ioh-vip-copy-slot") || ctx.textColumn?.querySelector(".ioh-vip-copy-slot") || offenderLink?.closest("td")?.querySelector(".ioh-vip-copy-slot");
      if (slotted) {
        return slotted;
      }
      const searchRoots = [
        ctx.idContainer,
        offenderLink?.parentElement,
        ctx.textColumn,
        ctx.iconsColumn
      ].filter(Boolean);
      for (const root of searchRoots) {
        const btn = Array.from(root.querySelectorAll("button")).find((candidate) => this.isCopyControl(candidate) && candidate !== ctx.nameButton);
        if (btn) {
          if (ctx.iconsColumn?.contains(btn) && btn.parentElement === ctx.iconsColumn) {
            return btn;
          }
          if (ctx.idContainer?.contains(btn) || offenderLink?.parentElement?.contains(btn)) {
            return btn;
          }
          return btn;
        }
      }
      if (ctx.iconsColumn) {
        const last = ctx.iconsColumn.lastElementChild;
        if (last && last !== primeEl) {
          return last;
        }
      }
      return null;
    },
    storeVipIconRestore(el) {
      if (!el || el.__iohVipIconRestore) {
        return;
      }
      el.__iohVipIconRestore = {
        parent: el.parentElement,
        next: el.nextSibling
      };
    },
    restoreLegacyMovedVipIcons(scope) {
      const roots = [];
      if (scope) {
        roots.push(scope);
      }
      roots.push(this.document);
      roots.forEach((root) => {
        root.querySelectorAll?.(".ioh-vip-prime-slot, .ioh-vip-copy-slot").forEach((el) => {
          const restore = el.__iohVipIconRestore || el.__iohVipPrimeRestore;
          el.classList.remove("ioh-vip-prime-slot", "ioh-vip-copy-slot");
          if (restore?.parent?.isConnected) {
            restore.parent.insertBefore(el, restore.next);
          }
          delete el.__iohVipIconRestore;
          delete el.__iohVipPrimeRestore;
        });
      });
    },
    ensureSteamIdRow(offenderLink) {
      if (!offenderLink?.parentElement) {
        return null;
      }
      if (offenderLink.parentElement.classList.contains("ioh-vip-steamid-row")) {
        return offenderLink.parentElement;
      }
      const parent = offenderLink.parentElement;
      const row = this.document.createElement("div");
      row.className = "ioh-vip-steamid-row";
      parent.insertBefore(row, offenderLink);
      row.appendChild(offenderLink);
      return row;
    },
    unwrapSteamIdRow(node) {
      const row = node?.classList?.contains("ioh-vip-steamid-row") ? node : null;
      if (!row?.parentNode) {
        return;
      }
      const parent = row.parentNode;
      while (row.firstChild) {
        parent.insertBefore(row.firstChild, row);
      }
      row.remove();
    },
    arrangeVipRowIcons(nameRow, offenderLink, ctx) {
      if (!nameRow || !offenderLink || !ctx) {
        return;
      }
      nameRow.querySelectorAll(".ioh-vip-prime-slot").forEach((el) => {
        const restore = el.__iohVipIconRestore || el.__iohVipPrimeRestore;
        el.classList.remove("ioh-vip-prime-slot");
        if (restore?.parent?.isConnected) {
          restore.parent.insertBefore(el, restore.next);
        }
        delete el.__iohVipIconRestore;
        delete el.__iohVipPrimeRestore;
      });
      const prime = this.findOffenderPrimeIcon({ ...ctx, nameRow });
      const copy = this.findOffenderCopyControl({ ...ctx, nameRow }, offenderLink, prime);
      if (copy && copy !== prime) {
        const steamRow = this.ensureSteamIdRow(offenderLink);
        if (steamRow && !steamRow.contains(copy)) {
          this.storeVipIconRestore(copy);
          copy.classList.add("ioh-vip-copy-slot");
          steamRow.appendChild(copy);
        } else if (steamRow?.contains(copy)) {
          copy.classList.add("ioh-vip-copy-slot");
        }
      }
      const iconsColumn = ctx.iconsColumn;
      if (iconsColumn && !iconsColumn.childElementCount) {
        iconsColumn.classList.add("ioh-offender-icons-empty");
      } else {
        iconsColumn?.classList.remove("ioh-offender-icons-empty");
      }
    },
    ensureVipNameRow(nameButton, textColumn) {
      if (!nameButton?.parentNode) {
        return null;
      }
      if (textColumn && !textColumn.contains(nameButton)) {
        return null;
      }
      if (nameButton.parentElement.classList.contains("ioh-vip-name-row")) {
        return nameButton.parentElement;
      }
      const parent = nameButton.parentNode;
      const row = this.document.createElement("div");
      row.className = "ioh-vip-name-row";
      parent.insertBefore(row, nameButton);
      row.appendChild(nameButton);
      while (row.nextSibling?.classList?.contains("ioh-admin-icon") || row.nextSibling?.classList?.contains("ioh-profile-verified")) {
        row.appendChild(row.nextSibling);
      }
      return row;
    },
    unwrapVipNameRow(row) {
      if (!row?.classList?.contains("ioh-vip-name-row") || !row.parentNode) {
        return;
      }
      this.restoreLegacyMovedVipIcons(row);
      const parent = row.parentNode;
      while (row.firstChild) {
        parent.insertBefore(row.firstChild, row);
      }
      row.remove();
    },
    applyOffenderVipBadge(offenderLink, vipName) {
      if (!offenderLink) {
        return;
      }
      const normalized = this.normalizeVipName(vipName);
      if (normalized) {
        offenderLink.dataset.iohVipSource = normalized;
      } else {
        delete offenderLink.dataset.iohVipSource;
      }
      const showBadge = this.settings.features?.showOffenderVipBadge !== false && this.settings.features?.trackOffenderServer && this.isVipStatusAllowed(normalized);
      const meta = showBadge ? this.getVipBadgeMeta(normalized) : null;
      if (!meta) {
        this.removeOffenderVipBadge(offenderLink);
        return;
      }
      if (offenderLink.dataset.iohVipName === meta.label) {
        const cell = offenderLink.closest("td");
        const existing = cell?.querySelector(".ioh-vip-badge");
        if (existing) {
          const ctx2 = this.resolveOffenderVipContext(offenderLink);
          const nameRow2 = ctx2?.nameRow || existing.closest(".ioh-vip-name-row") || null;
          if (nameRow2 && ctx2) {
            this.restoreLegacyMovedVipIcons(nameRow2);
            this.restoreLegacyMovedVipIcons(cell);
            cell?.querySelectorAll(".ioh-vip-steamid-row").forEach((row) => this.unwrapSteamIdRow(row));
            cell?.querySelectorAll(".ioh-offender-icons-empty").forEach((el) => {
              el.classList.remove("ioh-offender-icons-empty");
            });
          }
          return;
        }
      }
      this.removeOffenderVipBadge(offenderLink);
      const ctx = this.resolveOffenderVipContext(offenderLink);
      if (!ctx?.textColumn) {
        return;
      }
      const badge = this.document.createElement("span");
      badge.className = `ioh-vip-badge ioh-vip-badge--${meta.variant}`;
      markIoh(badge);
      const icon = this.document.createElement("img");
      icon.src = meta.iconUrl;
      icon.alt = "";
      const label = this.document.createElement("span");
      label.textContent = meta.label;
      badge.appendChild(icon);
      badge.appendChild(label);
      const vipColor = meta.variant === "lite" ? "#6080ff" : "#f0b358";
      const nameButton = ctx.nameButton;
      let nameRow = null;
      if (nameButton) {
        nameRow = this.ensureVipNameRow(nameButton, ctx.textColumn);
        if (nameRow) {
          nameRow.classList.remove("ioh-vip-nick--gold", "ioh-vip-nick--lite");
          nameRow.classList.add(`ioh-vip-nick--${meta.variant}`);
          nameRow.style.setProperty("--ioh-vip-color", vipColor);
          this.applyVipNickColor(nameButton, vipColor);
          nameRow.insertBefore(badge, nameRow.firstChild);
        } else {
          this.applyVipNickColor(nameButton, vipColor);
          nameButton.parentNode.insertBefore(badge, nameButton.nextSibling);
          nameRow = nameButton.closest(".ioh-vip-name-row");
        }
      } else {
        ctx.idContainer?.appendChild(badge);
      }
      if (nameRow) {
        this.restoreLegacyMovedVipIcons(nameRow);
        this.restoreLegacyMovedVipIcons(ctx.textColumn);
        ctx.textColumn?.querySelectorAll(".ioh-vip-steamid-row").forEach((row) => this.unwrapSteamIdRow(row));
        ctx.iconsColumn?.classList.remove("ioh-offender-icons-empty");
        offenderLink.closest("td")?.querySelectorAll(".ioh-offender-icons-empty").forEach((el) => {
          el.classList.remove("ioh-offender-icons-empty");
        });
      }
      ctx.textColumn.classList.add("ioh-has-vip-badge");
      ctx.offenderRoot?.classList.add("ioh-offender-with-vip");
      offenderLink.closest("td")?.classList.add("ioh-offender-vip-cell");
      offenderLink.dataset.iohVipName = meta.label;
    },
    async fetchUserData(steamId3, { signal } = {}) {
      const response = await fetch("https://cybershoke.net/api/user/data", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "include",
        signal,
        body: new URLSearchParams({ steamid64: steamId3 }).toString()
      });
      return response;
    },
    applyOffenderServerStatus(linkToUpdate, targetSteamId, targetIp, userData) {
      if (!linkToUpdate) {
        return;
      }
      if (!Object.hasOwn(userData, "serverIp")) return;
      const currentIp = userData.serverIp;
      const lastconnect = userData.lastconnect;
      if (!currentIp) {
        this.updateServerLinkDisplay(linkToUpdate, { status: "offline", lastconnect });
        this.markOffenderOffline(targetSteamId);
        this.clearOffenderRelocated(targetSteamId);
        return;
      }
      if (currentIp === targetIp) {
        this.updateServerLinkDisplay(linkToUpdate, { status: "online", currentIp });
        this.clearOffenderOffline(targetSteamId);
        this.clearOffenderRelocated(targetSteamId);
        return;
      }
      this.updateServerLinkDisplay(linkToUpdate, {
        status: "other",
        currentIp,
        serverLabel: userData.serverLabel
      });
      this.markOffenderRelocated(targetSteamId, currentIp);
      this.clearOffenderOffline(targetSteamId);
    },
    getOpenTicketOffenderTrackingContext() {
      if (!this.settings?.features?.autoConnectServer || !this.settings?.features?.trackOffenderServer) {
        return null;
      }
      if (this.nativeData) {
        const scope2 = this.getAutoConnectScope(), ticket = this.getNativeTicket(scope2);
        return ticket && this.scopeHasInProgressStatus(scope2, { includeActivePanel: false }) ? { scope: scope2, steamId: ticket.suspectId, href: window.location.href } : null;
      }
      const href = window.location.href;
      const path = window.location.pathname || "";
      if (/\/support\/(tickets|reports)\b/i.test(path) || !/\/ticket\/|\/reports?\//i.test(path)) {
        return null;
      }
      const scope = this.getAutoConnectScope();
      if (!scope || !this.isActiveComplaintScope(scope) || !this.scopeHasInProgressStatus(scope)) {
        return null;
      }
      const offenderField = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope);
      if (offenderField?.closest?.('[aria-hidden="true"]')) {
        return null;
      }
      const steamId3 = this.extractSteamIdFromField(offenderField);
      return steamId3 ? { scope, steamId: steamId3, href } : null;
    },
    ticketServerShowsOffenderLeft(scope) {
      const field = this.findInfoFieldScoped("\u0421\u0435\u0440\u0432\u0435\u0440", scope);
      return Array.from(field?.querySelectorAll("button, span, p") || []).some((node) => {
        const hidden = node.closest('[aria-hidden="true"]');
        return !isIohNode(node) && (!hidden || hidden === scope || hidden.contains?.(scope)) && /^вышел\s+с\s+сервера(?:\s|$)/iu.test((node.textContent || "").trim());
      });
    },
    getOpenTicketOfflineIntervalMs() {
      const seconds = Number(this.settings.trackOpenTicketOfflineInterval);
      return (Number.isFinite(seconds) && seconds > 0 ? Math.max(seconds, 1) : 5) * 1e3;
    },
    syncOffenderTrackerStatus() {
      if (!this.document.createElement || !this.document.body?.append) return;
      this._trackerResults ||= /* @__PURE__ */ new Map();
      const lines = /* @__PURE__ */ new Map();
      for (const session of this._openTicketTrackingSessions?.values() || []) {
        if (!session.waitingForReturn && !session.pendingServer) continue;
        const ticket = this.getNativeTicket?.(session.scope);
        const label = ticket ? `#${ticket.id}` : "\u043E\u0442\u043A\u0440\u044B\u0442\u0430\u044F \u0436\u0430\u043B\u043E\u0431\u0430";
        lines.set(session.steamId, session.pendingServer ? `\u0418\u0433\u0440\u043E\u043A ${label} \u043D\u0430\u0439\u0434\u0435\u043D \xB7 \u043E\u0436\u0438\u0434\u0430\u0435\u043C \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u0430\u043D\u0430\u043B\u0438\u0437\u0430` : `\u0422\u0440\u0435\u043A\u0435\u0440 ${label} \xB7 \u0436\u0434\u0451\u043C \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u0438\u0433\u0440\u043E\u043A\u0430`);
      }
      clearTimeout(this._trackerStatusTimer);
      let next = Infinity;
      for (const [id, result] of this._trackerResults) {
        if (result.until <= Date.now()) {
          this._trackerResults.delete(id);
          continue;
        }
        if (!lines.has(id)) lines.set(id, result.text);
        next = Math.min(next, result.until - Date.now());
      }
      let host = this.document.getElementById("ioh-offender-tracker-status");
      if (!lines.size) {
        host?.remove();
        return;
      }
      if (!host) {
        host = this.document.createElement("div");
        markIoh(host);
        host.id = "ioh-offender-tracker-status";
        host.className = "ioh-tracker-status";
        host.setAttribute("role", "status");
        host.setAttribute("aria-live", "polite");
        this.document.body.append(host);
      }
      const text = [...lines.values()].join("\n");
      if (host.textContent !== text) host.textContent = text;
      host.classList.toggle("ioh-tracker-status--waiting", [...this._openTicketTrackingSessions?.values() || []].some((s) => s.waitingForReturn || s.pendingServer));
      if (next < Infinity) this._trackerStatusTimer = setTimeout(() => this.syncOffenderTrackerStatus(), next + 10);
    },
    announceOffenderTrackerResult(session, connected) {
      this._trackerResults ||= /* @__PURE__ */ new Map();
      const ticket = this.getNativeTicket?.(session.scope);
      const label = ticket ? ` #${ticket.id}` : "";
      this._trackerResults.set(session.steamId, {
        until: Date.now() + 5e3,
        text: connected ? `\u0418\u0433\u0440\u043E\u043A${label} \u043D\u0430\u0439\u0434\u0435\u043D \xB7 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0430` : `\u0418\u0433\u0440\u043E\u043A${label} \u043D\u0430\u0439\u0434\u0435\u043D \xB7 \u0441\u0435\u0440\u0432\u0435\u0440 \u0443\u0436\u0435 \u0432\u044B\u0431\u0440\u0430\u043D`
      });
      this.syncOffenderTrackerStatus();
    },
    isOpenTicketTrackingSessionCurrent(session) {
      if (!this.settings?.features?.autoConnectServer || !this.settings?.features?.trackOffenderServer || !session || this._openTicketTrackingSessions?.get(session.scope) !== session) {
        return false;
      }
      return this.document.contains(session.scope) && this.isOpenComplaintScope(session.scope) && this.scopeHasInProgressStatus(session.scope, { includeActivePanel: false }) && (this.nativeData ? this.getNativeTicket(session.scope)?.suspectId : this.extractSteamIdFromField(this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", session.scope))) === session.steamId;
    },
    stopOpenTicketOffenderTracking(session = null) {
      const sessions = session ? [session] : [...this._openTicketTrackingSessions?.values() || []];
      for (const entry of sessions) {
        if (entry.timer != null) clearTimeout(entry.timer);
        entry.observer?.disconnect();
        this._openTicketTrackingSessions.delete(entry.scope);
        this._trackerResults?.delete(entry.steamId);
      }
      this.syncOffenderTrackerStatus();
    },
    syncOpenTicketOffenderTracking() {
      if (!this.settings?.features?.autoConnectServer || !this.settings?.features?.trackOffenderServer) {
        this.stopOpenTicketOffenderTracking();
        return null;
      }
      this._openTicketTrackingSessions ||= /* @__PURE__ */ new Map();
      for (const session of this._openTicketTrackingSessions.values()) {
        if (!this.isOpenTicketTrackingSessionCurrent(session)) this.stopOpenTicketOffenderTracking(session);
      }
      const context = this.getOpenTicketOffenderTrackingContext();
      if (context && !this._openTicketTrackingSessions.has(context.scope)) {
        const siteOffline = this.ticketServerShowsOffenderLeft(context.scope);
        const waitingForReturn = this.isOffenderOffline(context.steamId) || siteOffline && !this.getOffenderRelocatedServer(context.steamId);
        this._openTicketTrackingSessions.set(context.scope, {
          ...context,
          waitingForReturn,
          siteOffline,
          timer: null,
          pending: false,
          observer: null,
          serverField: null,
          lastCheck: 0
        });
      }
      for (const session of this._openTicketTrackingSessions.values()) {
        this.refreshOpenTicketTrackingSession(session);
      }
      this.syncOffenderTrackerStatus();
      return context ? this._openTicketTrackingSessions.get(context.scope) : null;
    },
    refreshOpenTicketTrackingSession(session) {
      const siteOffline = this.ticketServerShowsOffenderLeft(session.scope);
      if (siteOffline && !session.siteOffline) {
        session.waitingForReturn = true;
      }
      session.siteOffline = siteOffline;
      const serverField = this.findInfoFieldScoped("\u0421\u0435\u0440\u0432\u0435\u0440", session.scope);
      if (serverField !== session.serverField) {
        session.observer?.disconnect();
        session.serverField = serverField;
        session.observer = serverField ? new MutationObserver((mutations) => {
          if (!mutations.every((mutation) => isIohNode(mutation.target) || mutation.type === "childList" && [...mutation.addedNodes, ...mutation.removedNodes].length > 0 && [...mutation.addedNodes, ...mutation.removedNodes].every(isIohNode))) {
            this.syncOpenTicketOffenderTracking();
          }
        }) : null;
        session.observer?.observe(serverField, { childList: true, subtree: true, characterData: true });
      }
      if ((session.waitingForReturn || session.pendingServer) && session.timer == null && !session.pending) {
        session.timer = setTimeout(() => {
          session.timer = null;
          if (!this.isOpenTicketTrackingSessionCurrent(session)) {
            this.syncOpenTicketOffenderTracking();
            return;
          }
          session.pending = true;
          void this.trackOpenTicketOffenderServer(this.getOpenTicketOfflineIntervalMs(), {
            session,
            isCurrent: () => this.isOpenTicketTrackingSessionCurrent(session)
          }).catch((err) => console.error(err)).finally(() => {
            session.pending = false;
            this.syncOpenTicketOffenderTracking();
          });
        }, this.getOpenTicketOfflineIntervalMs());
      } else if (!session.waitingForReturn && !session.pendingServer && session.timer != null) {
        clearTimeout(session.timer);
        session.timer = null;
      }
    },
    async trackOpenTicketOffenderServer(cacheIntervalMs = null, { isCurrent = () => true, session = null } = {}) {
      if (!isCurrent()) return;
      session ||= this.syncOpenTicketOffenderTracking();
      if (!this.isOpenTicketTrackingSessionCurrent(session)) return;
      const { scope, steamId: offenderSteamId } = session;
      const ticketConnectLink = this.findTicketServerConnectLink(scope);
      const ticketServerIp = this.nativeData ? this.getNativeTicket(scope)?.complaintServer : this.extractServerIpFromConnectLink(ticketConnectLink);
      const normalInterval = Math.max(
        Number(cacheIntervalMs) || (this.settings.trackOffenderIntervalWhileReviewing || 30) * 1e3,
        1e3
      );
      const CACHE_INTERVAL = session.waitingForReturn ? Math.min(normalInterval, this.getOpenTicketOfflineIntervalMs()) : normalInterval;
      const now = Date.now();
      if (session.lastCheck && now - session.lastCheck < CACHE_INTERVAL && !session.pendingServer) {
        return;
      }
      if (this.globalServerCooldown && now < this.globalServerCooldown) {
        return;
      }
      let userData = this.getCachedUserData(offenderSteamId, CACHE_INTERVAL);
      if (!userData) {
        try {
          userData = await this.fetchParsedUserData(offenderSteamId);
        } catch (err) {
          if (err?.message === "429") {
            console.log("[Helper] \u0422\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0442\u0438\u043A\u0435\u0442\u0430: skip \u2014 429 cooldown");
            return;
          }
          console.log("[Helper] \u0422\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0442\u0438\u043A\u0435\u0442\u0430: skip \u2014 \u043E\u0448\u0438\u0431\u043A\u0430 fetch", err);
          return;
        }
      }
      if (!isCurrent() || !this.isOpenTicketTrackingSessionCurrent(session)) {
        return;
      }
      session.lastCheck = Date.now();
      if (!userData || !Object.hasOwn(userData, "serverIp")) return;
      const currentIp = userData.serverIp ? String(userData.serverIp).trim().toLowerCase() : null;
      if (!currentIp) {
        this.markOffenderOffline(offenderSteamId);
        this.clearOffenderRelocated(offenderSteamId);
        console.log("[Helper] \u0422\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0442\u0438\u043A\u0435\u0442\u0430: \u043D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C offline");
        return;
      }
      const returned = session.waitingForReturn;
      for (const trackedSession of this._openTicketTrackingSessions.values()) {
        if (trackedSession.steamId === offenderSteamId) trackedSession.waitingForReturn = false;
      }
      this.clearOffenderOffline(offenderSteamId);
      this.syncOpenTicketOffenderTracking();
      if (!returned && ticketServerIp && currentIp === ticketServerIp) {
        this.clearOffenderRelocated(offenderSteamId);
        return;
      }
      const previousRelocated = this.getOffenderRelocatedServer(offenderSteamId);
      this.markOffenderRelocated(offenderSteamId, currentIp);
      if (!returned && !session.pendingServer && (previousRelocated === currentIp || session.lastConnectedIp === currentIp)) {
        return;
      }
      console.log(`[Helper] \u0422\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0442\u0438\u043A\u0435\u0442\u0430: ${returned ? "\u0432\u043E\u0437\u0432\u0440\u0430\u0442 \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440" : "\u043F\u0435\u0440\u0435\u0435\u0437\u0434"} \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D`, {
        offenderSteamId,
        ticketServerIp,
        currentIp,
        previousRelocated
      });
      if (this.settings?.features?.autoConnectServer) {
        session.pendingServer = currentIp;
        const connected = this.connectToTrackedOffenderServer(session, currentIp);
        if (connected || this.isAlreadyOnRequestedServer(currentIp)) {
          for (const tracked of this._openTicketTrackingSessions.values()) if (tracked.steamId === offenderSteamId) tracked.pendingServer = null;
          this.announceOffenderTrackerResult(session, connected);
        } else this.syncOffenderTrackerStatus();
      }
      if (currentIp === ticketServerIp) {
        this.clearOffenderRelocated(offenderSteamId);
      }
    },
    queueOffenderTrackingRows(rows) {
      this._offenderTrackingArrivals ||= /* @__PURE__ */ new Set();
      for (const row of rows) if (row.isConnected) this._offenderTrackingArrivals.add(row);
      this._offenderTrackingArrivals = new Set([...this._offenderTrackingArrivals].sort((a, b) => {
        const position = a.compareDocumentPosition?.(b) || 0;
        if (position & 1) return 0;
        return position & 2 ? -1 : position & 4 ? 1 : 0;
      }));
    },
    hasPendingOffenderTrackingRows() {
      return Boolean(this._offenderTrackingArrivals?.size);
    },
    async checkOffendersServers(cacheIntervalMs = null, { singleRowPerPass = false, arrivalsOnly = false, isCurrent = () => true, acceptArrivals = () => true } = {}) {
      const path = window.location.pathname || "";
      const href = window.location.href || "";
      const isQueuePage = href.includes("/support/reports") || href.includes("/support/tickets");
      const isDetailPage = !/\/support\/(tickets|reports)\b/i.test(path) && /\/ticket\/|\/reports?\//i.test(path);
      if (!isQueuePage && !isDetailPage) {
        this._offenderTrackingArrivals?.clear();
        return;
      }
      if (this.isCheckingServer) return;
      this.isCheckingServer = true;
      const CACHE_INTERVAL = Math.max(
        Number(cacheIntervalMs) || (this.settings.trackOffenderInterval || 5) * 1e3,
        1e3
      );
      const passIsCurrent = () => this.settings.features.trackOffenderServer && !this.document.hidden && window.location.href === href && isCurrent();
      const offenderSelector = 'td:nth-child(4) a[href*="cybershoke.net/"], td:nth-child(4) a[href*="cybershoke.ru/"]';
      const serverSelector = 'td:nth-child(2) a[href^="steam://connect/"]';
      try {
        this.pruneQueueChatCache?.();
        const seen = /* @__PURE__ */ new Map();
        this._offenderRowTrackingIdentity ||= /* @__PURE__ */ new WeakMap();
        this._offenderTicketChecks ||= /* @__PURE__ */ new Map();
        const toCandidate = (row) => {
          const now = Date.now();
          const offenderLink = row.querySelector(offenderSelector);
          const serverLink = row.querySelector(serverSelector);
          const steamId3 = steamIdFromPlayerProfileUrl(offenderLink?.href);
          if (!steamId3 || !serverLink) {
            return null;
          }
          const ip = this.ensureServerLinkOriginalIp(serverLink);
          const ticketKey = row.dataset.iohNativeTicket || "";
          const identity = `${ticketKey}|${steamId3}|${ip}`;
          if (seen.get(row) === identity) return null;
          seen.set(row, identity);
          const previous = this._offenderRowTrackingIdentity.get(row);
          if (previous && previous !== identity) {
            delete row.dataset.lastIpCheck;
            delete row.dataset.lastIpAttempt;
            this._offenderRowSnapshots?.delete(row);
          }
          this._offenderRowTrackingIdentity.set(row, identity);
          const saved = ticketKey && this._offenderTicketChecks.get(identity);
          if (saved) {
            for (const field of ["lastIpCheck", "lastIpAttempt"]) {
              row.dataset[field] = String(Math.max(Number(row.dataset[field]) || 0, saved[field] || 0));
            }
          }
          const lastCheck = Math.max(
            Number.parseInt(row.dataset.lastIpCheck || "0", 10) || 0,
            Number.parseInt(row.dataset.lastIpAttempt || "0", 10) || 0
          );
          if (arrivalsOnly && lastCheck) return null;
          if (now - lastCheck < CACHE_INTERVAL) {
            return null;
          }
          return { row, offenderLink, serverLink, steamId: steamId3, lastCheck, ip, identity, ticketKey };
        };
        const initialRows = this._offenderTrackingArrivals;
        this._offenderTrackingArrivals = /* @__PURE__ */ new Set();
        const initial = [...initialRows || []].filter((row) => row.isConnected).map(toCandidate).filter(Boolean);
        const regular = (arrivalsOnly ? [] : Array.from(this.document.querySelectorAll("table tbody tr")).reverse()).map(toCandidate).filter(Boolean).concat(initial.filter((candidate) => candidate.lastCheck)).sort((a, b) => a.lastCheck - b.lastCheck);
        const candidates = initial.filter((candidate) => !candidate.lastCheck).concat(regular);
        const dataBySteamId = /* @__PURE__ */ new Map();
        const chatBySteamId = /* @__PURE__ */ new Map();
        while (true) {
          if (arrivalsOnly && !acceptArrivals()) {
            this._offenderTrackingArrivals ||= /* @__PURE__ */ new Set();
            for (const candidate2 of candidates) this._offenderTrackingArrivals.add(candidate2.row);
            break;
          }
          const arrivals = acceptArrivals() ? this._offenderTrackingArrivals : null;
          if (arrivals) this._offenderTrackingArrivals = /* @__PURE__ */ new Set();
          const added = [...arrivals || []].filter((row) => row.isConnected).map(toCandidate).filter(Boolean);
          if (added.length) {
            candidates.unshift(...added.filter((candidate2) => !candidate2.lastCheck));
            candidates.push(...added.filter((candidate2) => candidate2.lastCheck));
          }
          const candidate = candidates.shift();
          if (!candidate) break;
          if (!passIsCurrent()) {
            break;
          }
          if (this.globalServerCooldown && Date.now() < this.globalServerCooldown) {
            const waitMs = this.globalServerCooldown - Date.now();
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
          const { row: targetRow, steamId: targetSteamId, ip: targetIp, offenderLink, serverLink } = candidate;
          const markCheck = (field) => {
            targetRow.dataset[field] = Date.now().toString();
            if (!candidate.ticketKey) return;
            this._offenderTicketChecks.delete(candidate.identity);
            this._offenderTicketChecks.set(candidate.identity, {
              lastIpCheck: Number(targetRow.dataset.lastIpCheck) || 0,
              lastIpAttempt: Number(targetRow.dataset.lastIpAttempt) || 0
            });
            if (this._offenderTicketChecks.size > 1024) this._offenderTicketChecks.delete(this._offenderTicketChecks.keys().next().value);
          };
          const rowIsCurrent = () => targetRow.isConnected && (targetRow.dataset.iohNativeTicket || "") === candidate.ticketKey && targetRow.querySelector(offenderSelector) === offenderLink && steamIdFromPlayerProfileUrl(offenderLink.href) === targetSteamId && targetRow.querySelector(serverSelector) === serverLink && this.ensureServerLinkOriginalIp(serverLink) === targetIp;
          if (!passIsCurrent() || !rowIsCurrent()) {
            continue;
          }
          let userData = dataBySteamId.has(targetSteamId) ? dataBySteamId.get(targetSteamId) : this.getCachedUserData(targetSteamId, CACHE_INTERVAL);
          let deferCandidate = false;
          while (!userData && !dataBySteamId.has(targetSteamId)) {
            if (!passIsCurrent() || !rowIsCurrent()) {
              break;
            }
            if (this.globalServerCooldown && Date.now() < this.globalServerCooldown) {
              await new Promise((resolve) => setTimeout(resolve, this.globalServerCooldown - Date.now()));
            }
            await new Promise((resolve) => setTimeout(resolve, 340));
            if (!passIsCurrent() || !rowIsCurrent()) {
              break;
            }
            if (this.globalServerCooldown && Date.now() < this.globalServerCooldown) {
              continue;
            }
            if (arrivalsOnly && !acceptArrivals() || acceptArrivals() && [...this._offenderTrackingArrivals || []].some((row) => row.isConnected && (!seen.has(row) || !seen.get(row).startsWith(`${row.dataset.iohNativeTicket || ""}|`)))) {
              candidates.unshift(candidate);
              deferCandidate = true;
              break;
            }
            markCheck("lastIpAttempt");
            try {
              userData = await this.fetchParsedUserData(targetSteamId);
              break;
            } catch (err) {
              if (err?.message === "429") {
                await new Promise((resolve) => setTimeout(resolve, 660));
                continue;
              }
              dataBySteamId.set(targetSteamId, null);
              break;
            }
          }
          if (deferCandidate) continue;
          if (userData) {
            dataBySteamId.set(targetSteamId, userData);
          }
          if (!userData || !passIsCurrent() || !rowIsCurrent()) {
            continue;
          }
          const complaintReason = this.getComplaintReasonFromRow(targetRow);
          if (this.isMuteHighlightComplaintReason(complaintReason) && !chatBySteamId.has(targetSteamId)) {
            const cached = this._queueChatCache?.get(targetSteamId);
            const needsMute = this.getQueueChatVerdict(targetRow)?.kind === "mute";
            if (!needsMute && (!cached || Date.now() - cached.fetchedAt >= CACHE_INTERVAL)) {
              await new Promise((resolve) => setTimeout(resolve, Math.max(
                340,
                (this.globalServerCooldown || 0) - Date.now()
              )));
              while (passIsCurrent() && rowIsCurrent() && Date.now() < (this.globalServerCooldown || 0)) {
                await new Promise((resolve) => setTimeout(resolve, this.globalServerCooldown - Date.now()));
              }
              if (!passIsCurrent() || !rowIsCurrent()) continue;
              if (arrivalsOnly && !acceptArrivals() || acceptArrivals() && [...this._offenderTrackingArrivals || []].some((row) => row.isConnected && (!seen.has(row) || !seen.get(row).startsWith(`${row.dataset.iohNativeTicket || ""}|`)))) {
                candidates.unshift(candidate);
                continue;
              }
              markCheck("lastIpAttempt");
              await this.fetchQueueChat(targetSteamId);
              if (!passIsCurrent() || !rowIsCurrent()) continue;
            }
            chatBySteamId.set(targetSteamId, true);
          }
          const actionState = this.rowActionIsInReview(targetRow) ? "review" : targetRow.querySelector(".ioh-punishment-action") ? "custom" : "accept";
          const chatVerdict = this.getQueueChatVerdict(targetRow);
          const snapshotKey = `${targetSteamId}|${userData.serverIp || ""}|${userData.vipName || ""}|${userData.profileVerified ? 1 : 0}|${userData.isModerator ? 1 : 0}|${userData.isBanned ? 1 : 0}|${userData.isMuted ? 1 : 0}|${actionState}|${complaintReason}|${chatVerdict?.kind || ""}|${chatVerdict?.reason || ""}`;
          if (!this._offenderRowSnapshots) {
            this._offenderRowSnapshots = /* @__PURE__ */ new WeakMap();
          }
          if (this._offenderRowSnapshots.get(targetRow) === snapshotKey) {
            if (!userData.serverIp) {
              this.scheduleOffenderUi(() => {
                if (!passIsCurrent() || !rowIsCurrent()) return;
                const label = this.getServerLinkLabelElement(serverLink) || serverLink;
                const text = this.utils.formatLastConnectStatus(userData.lastconnect);
                if (label.textContent !== text) label.textContent = text;
              });
            }
            markCheck("lastIpCheck");
            if (singleRowPerPass) {
              break;
            }
            continue;
          }
          this.scheduleOffenderUi(() => {
            if (!passIsCurrent() || !rowIsCurrent()) {
              return;
            }
            this._offenderRowSnapshots.set(targetRow, snapshotKey);
            this.applyOffenderServerStatus(serverLink, targetSteamId, targetIp, userData);
            this.applyOffenderPunishmentHighlight(targetRow, userData);
            this.applyOffenderVipBadge(offenderLink, userData.vipName);
            if (!this.nativeData) this.applyOffenderModeratorHighlight(targetRow, offenderLink, userData.isModerator);
            this.applyOffenderProfileVerification(
              offenderLink,
              userData.profileVerified,
              targetRow
            );
            this.applyOffenderMuteBanIcons(offenderLink, targetRow, userData);
            this.renderNativeQueue?.({ steamIds: /* @__PURE__ */ new Set([targetSteamId]) });
          });
          markCheck("lastIpCheck");
          if (singleRowPerPass) {
            break;
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        this.isCheckingServer = false;
      }
    },
    scheduleOffenderUi(job) {
      if (!this._vipPending) {
        this._vipPending = /* @__PURE__ */ new Set();
      }
      this._vipPending.add(job);
      if (this._vipRafId) {
        return;
      }
      this._vipRafId = requestAnimationFrame(() => {
        this._vipRafId = null;
        const jobs = [...this._vipPending];
        this._vipPending.clear();
        jobs.forEach((fn) => fn());
      });
    },
    extractServerLabel(result) {
      const server = result?.server;
      if (!server) {
        return null;
      }
      const parts = [];
      if (server.mode) {
        parts.push(String(server.mode));
      }
      if (server.category) {
        parts.push(String(server.category));
      }
      if (server.num != null && server.num !== "") {
        parts.push(`#${server.num}`);
      }
      return parts.length ? parts.join(" ") : null;
    },
    extractBansList(result) {
      const candidates = [
        result?.basic?.bans_list,
        result?.bans_list,
        result?.cybershoke?.bans_list
      ];
      for (const list2 of candidates) {
        if (Array.isArray(list2) && list2.length) {
          return list2;
        }
      }
      return [];
    },
    isPunishmentActive(entry, type) {
      if (Number(entry?.type) !== type) {
        return false;
      }
      const now = Math.floor(Date.now() / 1e3);
      const end = Number(entry?.end);
      const created = Number(entry?.created);
      const length = Number(entry?.length);
      if (Number.isFinite(end) && end > now) {
        return true;
      }
      if (Number.isFinite(created) && Number.isFinite(length) && length > 0 && created + length > now) {
        return true;
      }
      return false;
    },
    isBanActive(ban) {
      return this.isPunishmentActive(ban, 4);
    },
    isMuteActive(mute) {
      return this.isPunishmentActive(mute, 3);
    },
    extractActiveBan(result) {
      const bans = this.extractBansList(result);
      if (!bans.length) {
        return false;
      }
      return bans.some((ban) => this.isBanActive(ban));
    },
    extractActiveMute(result) {
      const bans = this.extractBansList(result);
      if (!bans.length) {
        return false;
      }
      return bans.some((entry) => this.isMuteActive(entry));
    },
    extractServerIpFromUserData(result) {
      if (result?.server?.server_ip && result?.server?.server_port) {
        return `${result.server.server_ip}:${result.server.server_port}`.toLowerCase();
      }
      return null;
    },
    extractLastConnect(result) {
      const raw = result?.cybershoke?.global?.lastconnect;
      if (raw == null || raw === "") {
        return null;
      }
      const seconds = Number(raw);
      return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    },
    normalizeCountryCode(raw) {
      if (raw == null || raw === "") {
        return null;
      }
      const value = String(raw).trim().toLowerCase();
      return /^[a-z]{2}$/.test(value) ? value : null;
    },
    extractCountry(result) {
      return this.normalizeCountryCode(result?.basic?.country);
    },
    extractPlaytime(result) {
      const raw = result?.cybershoke?.global?.playtime;
      if (raw == null || raw === "") {
        return null;
      }
      const seconds = Number(raw);
      return Number.isFinite(seconds) ? seconds : null;
    },
    extractVipName(result) {
      return this.normalizeVipName(result?.basic?.vip_name);
    },
    extractVerification(result) {
      return result?.basic?.verification ?? result?.personal_data?.verification ?? result?.verification ?? null;
    },
    extractProfileVerified(result) {
      return Boolean(this.extractVerification(result)?.profile);
    },
    extractIsModerator(result) {
      return Boolean(this.extractVerification(result)?.moderation);
    },
    parseUserDataResult(result) {
      return {
        serverIp: this.extractServerIpFromUserData(result),
        lastconnect: this.extractLastConnect(result),
        serverLabel: this.extractServerLabel(result),
        isBanned: this.extractActiveBan(result),
        isMuted: this.extractActiveMute(result),
        vipName: this.extractVipName(result),
        profileVerified: this.extractProfileVerified(result),
        isModerator: this.extractIsModerator(result),
        country: this.extractCountry(result),
        playtime: this.extractPlaytime(result)
      };
    }
  };

  // modules/ticket/CloseReason.js
  var LABELS = {
    punished: "\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C \u0431\u044B\u043B \u043D\u0430\u043A\u0430\u0437\u0430\u043D",
    noCheats: "\u0427\u0438\u0442\u043E\u0432 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E",
    insufficient: "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0434\u043E\u043A\u0430\u0437\u0430\u0442\u0435\u043B\u044C\u0441\u0442\u0432",
    left: "\u0418\u0433\u0440\u043E\u043A \u0432\u044B\u0448\u0435\u043B \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u0430",
    noViolations: "\u041D\u0435\u0442 \u043D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0439"
  };
  var CATEGORIES = /* @__PURE__ */ new Map([
    ["\u0447\u0438\u0442\u0435\u0440\u0441\u0442\u0432\u043E", "ban"],
    ["\u0431\u0430\u0433\u043E\u044E\u0437", "ban"],
    ["\u043C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433", "mute"],
    ["\u0441\u043F\u0430\u043C", "mute"],
    ["\u043F\u043E\u043F\u0440\u043E\u0448\u0430\u0439\u043D\u0438\u0447\u0435\u0441\u0442\u0432\u043E", "mute"]
  ]);
  var normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  function closeReasonEvidenceMinutes(value) {
    if (value === "" || value === null || value === void 0) return 3;
    const number2 = Number(value);
    return Number.isFinite(number2) ? Math.min(120, Math.max(0, number2)) : 3;
  }
  function parseCloseReasonTimer(value) {
    const match = String(value || "").trim().match(/^(\d+):([0-5]\d):([0-5]\d)$/);
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
  }
  function chooseCloseReason(category, elapsedSeconds, minutes = 3, data = {}) {
    const normalized = normalize(category);
    const type = CATEGORIES.get(normalized);
    if (!type) return null;
    if (type === "ban" && data.isBanned || type === "mute" && data.isMuted) return LABELS.punished;
    if (Object.hasOwn(data, "serverIp") && data.serverIp === null) return LABELS.left;
    if (normalized !== "\u0447\u0438\u0442\u0435\u0440\u0441\u0442\u0432\u043E") return LABELS.noViolations;
    return elapsedSeconds !== null && elapsedSeconds >= closeReasonEvidenceMinutes(minutes) * 60 ? LABELS.insufficient : LABELS.noCheats;
  }
  function mergeCloseReasonData(previous, incoming) {
    const next = { ...previous, fetchedAt: incoming.fetchedAt ?? Date.now() };
    for (const key of ["isBanned", "isMuted"]) {
      if (typeof incoming[key] === "boolean") next[key] = incoming[key];
    }
    if (Object.hasOwn(incoming, "serverIp") && (incoming.serverIp === null || typeof incoming.serverIp === "string" && incoming.serverIp.trim())) {
      next.serverIp = incoming.serverIp === null ? null : incoming.serverIp.trim().toLowerCase();
    }
    return next;
  }
  function containsNode(root, node) {
    if (root?.contains) return root.contains(node);
    for (let current = node; current; current = current.parentElement) if (current === root) return true;
    return false;
  }
  var CloseReasonMethods = {
    getCloseReasonContext(textarea) {
      if (!textarea || !this.document.contains(textarea)) return null;
      this._closeReasonScopes ||= /* @__PURE__ */ new WeakMap();
      const savedScope = this._closeReasonScopes.get(textarea);
      const scope = savedScope && this.document.contains(savedScope) && containsNode(savedScope, textarea) ? savedScope : this.getTicketScopeRoot(textarea);
      let card = textarea.parentElement;
      let title = null;
      while (card && card !== scope?.parentElement && card !== this.document.body) {
        title = Array.from(card.querySelectorAll("h3")).find((header) => /^Результат рассмотрения (?:тикета|репорта) #\d+\b/i.test(header.textContent.trim()));
        if (title) break;
        if (card === scope) return null;
        card = card.parentElement;
      }
      if (!title || !card || card === this.document.body) return null;
      const ticket = this.nativeData && this.getNativeTicket(scope);
      const ticketId = this.nativeData ? ticket && String(ticket.id) : title.textContent.match(/#(\d+)/)?.[1];
      const steamId3 = this.nativeData ? ticket?.suspectId : this.extractSteamIdFromField(this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope));
      const category = this.getTicketComplaintCategory(scope);
      if (!ticketId || !steamId3 || !CATEGORIES.has(normalize(category))) return null;
      this._closeReasonScopes.set(textarea, scope);
      const buttons = Array.from(card.querySelectorAll("button")).filter((button) => Object.values(LABELS).includes(button.textContent.trim()) && !isIohNode(button));
      return { textarea, scope, card, title, ticketId, steamId: steamId3, category, buttons };
    },
    isCloseReasonContextEditable(context) {
      return Boolean(context && !context.textarea.readOnly && !context.textarea.disabled && this.isCloseReasonContextInProgress(context) && context.buttons.some((button) => !button.disabled));
    },
    isCloseReasonContextInProgress(context) {
      if (this.nativeData) return Boolean(context && this.scopeHasInProgressStatus(context.scope, { includeActivePanel: false }));
      const header = context?.title?.parentElement;
      if (header?.querySelectorAll) {
        return Array.from(header.querySelectorAll("span")).some((span) => span.textContent.trim() === "\u0412 \u0440\u0430\u0431\u043E\u0442\u0435");
      }
      return Boolean(context && this.scopeHasInProgressStatus(context.scope, { includeActivePanel: false }));
    },
    isCloseReasonTextareaVisible(textarea, scope = null) {
      if (!textarea || !this.document.contains(textarea)) return false;
      const modal = this.document.querySelector?.('[role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"]');
      if (!modal) return this.isVisibleTicketTextarea(textarea);
      const view = this.document.defaultView || (typeof window !== "undefined" ? window : null);
      for (let node = textarea; node; node = node.parentElement) {
        const style = view?.getComputedStyle?.(node);
        if (node.hidden || style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") return false;
        const ariaHidden = node.getAttribute?.("aria-hidden") === "true";
        const inert = node.inert || node.hasAttribute?.("inert");
        if (ariaHidden || inert) {
          if (ariaHidden && (node.getAttribute?.("role") === "tabpanel" || node.getAttribute?.("data-state") === "inactive")) return false;
          if (node === scope && node.getAttribute?.("aria-selected") === "false") return false;
          const blanketMask = node.hasAttribute?.("data-aria-hidden") || node.getAttribute?.("data-aria-hidden") != null || scope && node !== scope && containsNode(node, scope);
          if (!blanketMask) return false;
        }
      }
      return typeof textarea.getClientRects === "function" ? textarea.getClientRects().length > 0 : this.isVisibleTicketTextarea(textarea);
    },
    getCloseReasonComplaintState(context) {
      this._closeReasonStateByScope ||= /* @__PURE__ */ new WeakMap();
      let state = this._closeReasonStateByScope.get(context.scope);
      if (!state || state.ticketId !== context.ticketId || state.steamId !== context.steamId || state.category !== normalize(context.category)) {
        state = {
          ticketId: context.ticketId,
          steamId: context.steamId,
          category: normalize(context.category),
          manual: false,
          punishmentData: null,
          intents: /* @__PURE__ */ new Map()
        };
        this._closeReasonStateByScope.set(context.scope, state);
      }
      return state;
    },
    transferCloseReasonComplaintScope(oldScope, newContext) {
      if (!oldScope || !newContext || oldScope === newContext.scope || this.document.contains(oldScope) || !this.document.contains(newContext.scope) || !containsNode(newContext.scope, newContext.textarea) || !this.isCloseReasonContextEditable(newContext)) return false;
      const state = this._closeReasonStateByScope?.get(oldScope);
      if (!state || state.ticketId !== newContext.ticketId || state.steamId !== newContext.steamId || state.category !== normalize(newContext.category)) return false;
      const mountedState = this._closeReasonStateByScope.get(newContext.scope);
      if (mountedState && mountedState !== state && mountedState.ticketId === state.ticketId && mountedState.steamId === state.steamId && mountedState.category === state.category) {
        state.manual ||= mountedState.manual;
        for (const [token, type] of mountedState.intents) {
          state.intents.set(token, type);
          this._closeReasonIntentStates?.set(token, state);
        }
        if (mountedState.punishmentData && (!state.punishmentData || mountedState.punishmentData.fetchedAt > state.punishmentData.fetchedAt)) {
          state.punishmentData = mergeCloseReasonData(state.punishmentData, mountedState.punishmentData);
        }
      }
      const oldSession = this._closeReasonSessions?.get(oldScope);
      if (oldSession) this.releaseCloseReasonSession(oldSession);
      this._closeReasonStateByScope.delete(oldScope);
      this._closeReasonStateByScope.set(newContext.scope, state);
      this._closeReasonScopes ||= /* @__PURE__ */ new WeakMap();
      this._closeReasonScopes.set(newContext.textarea, newContext.scope);
      const newSession = this._closeReasonSessions?.get(newContext.scope);
      if (newSession) {
        newSession.complaintState = state;
        this.refreshCloseReasonSession(newSession);
      }
      return true;
    },
    syncCloseReasonSelection() {
      if (!this.settings?.features?.autoSelectCloseReason) {
        this.stopCloseReasonSelection();
        return;
      }
      this._closeReasonSessions ||= /* @__PURE__ */ new Map();
      this._closeReasonPendingCards ||= /* @__PURE__ */ new Map();
      for (const pending of this._closeReasonPendingCards.values()) {
        const current = this.getCloseReasonContext(pending.textarea);
        if (!current || current.card !== pending.card || current.ticketId !== pending.ticketId || current.steamId !== pending.steamId || !this.isCloseReasonContextInProgress(current) || this.isCloseReasonContextEditable(current)) {
          pending.observer.disconnect();
          this._closeReasonPendingCards.delete(pending.card);
        }
      }
      for (const session of this._closeReasonSessions.values()) {
        this.refreshCloseReasonSession(session);
      }
      for (const textarea of this.document.querySelectorAll('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]')) {
        const context = this.getCloseReasonContext(textarea);
        if (!context || !this.isCloseReasonTextareaVisible(textarea, context.scope)) continue;
        if (!this.isCloseReasonContextEditable(context)) {
          if (context && this.isCloseReasonContextInProgress(context) && !this._closeReasonSessions.has(context.scope) && !this._closeReasonPendingCards.has(context.card)) {
            const pending = { ...context };
            pending.observer = new MutationObserver((mutations) => {
              if (mutations.every((mutation) => isIohNode(mutation.target))) return;
              this.syncCloseReasonSelection();
            });
            pending.observer.observe(context.card, {
              childList: true,
              subtree: true,
              characterData: !this.nativeData,
              attributes: true,
              attributeFilter: ["disabled", "readonly"]
            });
            this._closeReasonPendingCards.set(context.card, pending);
          }
          continue;
        }
        let session = this._closeReasonSessions.get(context.scope);
        if (!session) {
          const complaintState = this.getCloseReasonComplaintState(context);
          session = { ...context, complaintState, applying: false, lastApplied: null, lastAppliedButton: null };
          this._closeReasonSessions.set(context.scope, session);
          session.onClick = (event) => {
            if (session.applying) return;
            const button = event.target?.closest?.("button");
            if (button && this.isCloseReasonButton(session, button)) session.complaintState.manual = true;
          };
          session.card.addEventListener("click", session.onClick, true);
          session.observer = new MutationObserver((mutations) => {
            if (mutations.every((mutation) => isIohNode(mutation.target))) return;
            this.refreshCloseReasonSession(session);
          });
          session.observer.observe(session.card, {
            childList: true,
            subtree: true,
            characterData: !this.nativeData,
            attributes: true,
            attributeFilter: ["disabled", "readonly"]
          });
        }
        this.refreshCloseReasonSession(session);
      }
    },
    isCloseReasonButton(session, button) {
      if (isIohNode(button) || button.disabled || button.type !== "button") return false;
      const first = session.buttons[0];
      return Boolean(first && button.parentElement === first.parentElement);
    },
    refreshCloseReasonSession(session) {
      if (this._closeReasonSessions?.get(session.scope) !== session) return;
      if (!this.settings?.features?.autoSelectCloseReason) {
        this.stopCloseReasonSelection();
        return;
      }
      const context = this.getCloseReasonContext(session.textarea);
      if (!context || context.scope !== session.scope || context.card !== session.card || context.ticketId !== session.ticketId || context.steamId !== session.steamId || normalize(context.category) !== normalize(session.category) || !this.isCloseReasonContextInProgress(context)) {
        if (!context || context.ticketId !== session.ticketId || context.steamId !== session.steamId || !this.isCloseReasonContextInProgress(context)) this.clearCloseReasonIntents(session.complaintState);
        this.releaseCloseReasonSession(session);
        return;
      }
      session.buttons = context.buttons;
      if (!this.isCloseReasonContextEditable(context)) return;
      const cached = this.getCachedUserData?.(session.steamId);
      const state = session.complaintState;
      if (cached && (!state.punishmentData || cached.fetchedAt > state.punishmentData.fetchedAt)) {
        state.punishmentData = mergeCloseReasonData(state.punishmentData, cached);
      }
      if (state.manual || !this.isCloseReasonTextareaVisible(session.textarea, session.scope)) return;
      const ticket = this.nativeData && this.getNativeTicket(session.scope);
      const elapsed = this.nativeData ? ticket?.startedAt ? Math.max(0, (Date.now() - ticket.startedAt) / 1e3) : null : parseCloseReasonTimer(context.title.parentElement?.querySelector('use[href="#lc-clock"]')?.closest("svg")?.parentElement?.textContent);
      if (this.nativeData) {
        clearTimeout(session.thresholdTimer);
        const remaining = ticket?.startedAt + closeReasonEvidenceMinutes(this.settings.closeReasonEvidenceMinutes) * 6e4 - Date.now();
        if (ticket?.startedAt && remaining > 0) session.thresholdTimer = setTimeout(() => this.refreshCloseReasonSession(session), remaining + 10);
      }
      const data = state.punishmentData || {};
      const matchingType = CATEGORIES.get(normalize(session.category));
      const desired = Array.from(state.intents.values()).includes(matchingType) ? LABELS.punished : chooseCloseReason(session.category, elapsed, this.settings.closeReasonEvidenceMinutes, data);
      if (!desired) return;
      const button = context.buttons.find((candidate) => candidate.textContent.trim() === desired && !candidate.disabled);
      if (!button) return;
      if (desired === session.lastApplied && button === session.lastAppliedButton) return;
      session.lastApplied = desired;
      session.lastAppliedButton = button;
      session.applying = true;
      try {
        button.click();
      } finally {
        session.applying = false;
      }
    },
    onCloseReasonPunishmentData(steamId3, data) {
      if (!this.settings?.features?.autoSelectCloseReason || !steamId3 || !data) return;
      for (const session of this._closeReasonSessions?.values() || []) {
        if (session.steamId !== steamId3) continue;
        if (data.scope !== void 0 && data.scope !== session.scope) continue;
        if (data.ticketId !== void 0 && String(data.ticketId) !== session.ticketId) continue;
        const state = session.complaintState;
        state.punishmentData = mergeCloseReasonData(state.punishmentData, data);
        for (const [token, type] of state.intents) {
          if (type === "ban" ? data.isBanned === true : data.isMuted === true) {
            state.intents.delete(token);
            this._closeReasonIntentStates?.delete(token);
          }
        }
        this.refreshCloseReasonSession(session);
      }
    },
    onCloseReasonPunishmentIntent({ type, scope, steamId: steamId3, ticketId, attemptToken } = {}) {
      if (!this.settings?.features?.autoSelectCloseReason || !attemptToken || typeof attemptToken !== "object" || !scope || !steamId3 || !ticketId) return false;
      this.syncCloseReasonSelection();
      const session = this._closeReasonSessions?.get(scope);
      if (!session || session.steamId !== steamId3 || session.ticketId !== String(ticketId) || CATEGORIES.get(normalize(session.category)) !== type) return false;
      const context = this.getCloseReasonContext(session.textarea);
      if (!context || context.scope !== scope || context.steamId !== steamId3 || context.ticketId !== String(ticketId) || !this.isCloseReasonContextEditable(context)) return false;
      session.complaintState.intents.set(attemptToken, type);
      this.rememberNativePunishmentIntent?.({ type, scope, steamId: steamId3, ticketId, attemptToken });
      this._closeReasonIntentStates ||= /* @__PURE__ */ new WeakMap();
      this._closeReasonIntentStates.set(attemptToken, session.complaintState);
      this.refreshCloseReasonSession(session);
      return true;
    },
    cancelCloseReasonPunishmentIntent(attemptToken) {
      this._nativePunishmentAttempts?.delete(attemptToken);
      const state = this._closeReasonIntentStates?.get(attemptToken);
      if (!state) return;
      state.intents.delete(attemptToken);
      this._closeReasonIntentStates.delete(attemptToken);
      for (const session of this._closeReasonSessions?.values() || []) {
        if (session.complaintState === state) this.refreshCloseReasonSession(session);
      }
    },
    clearCloseReasonIntents(state) {
      for (const token of state.intents.keys()) this._closeReasonIntentStates?.delete(token);
      state.intents.clear();
    },
    releaseCloseReasonSession(session) {
      clearTimeout(session.thresholdTimer);
      session.observer?.disconnect();
      session.card.removeEventListener("click", session.onClick, true);
      if (this._closeReasonSessions?.get(session.scope) === session) this._closeReasonSessions.delete(session.scope);
    },
    stopCloseReasonSelection() {
      for (const session of this._closeReasonSessions?.values() || []) {
        this.clearCloseReasonIntents(session.complaintState);
        this.releaseCloseReasonSession(session);
      }
      this._closeReasonIntentStates = /* @__PURE__ */ new WeakMap();
      this._closeReasonSessions?.clear();
      for (const pending of this._closeReasonPendingCards?.values() || []) pending.observer.disconnect();
      this._closeReasonPendingCards?.clear();
    }
  };

  // modules/ticket/PunishmentFeedback.js
  var PunishmentFeedbackMethods = {
    getTicketPunishmentFeedbackContext(textarea, preferredScope = null) {
      if (!textarea || !this.document.contains(textarea)) return null;
      const saved = Array.from(this._punishmentFeedbackSessions?.values() || []).find((session) => session.textarea === textarea);
      const scope = preferredScope || saved?.scope || this.getTicketScopeRoot(textarea);
      if (!scope || scope === this.document.body || !scope.contains(textarea)) return null;
      let card = textarea.parentElement;
      while (card && card !== scope.parentElement) {
        const title = Array.from(card.querySelectorAll("h3")).find((header) => /^Результат рассмотрения (?:тикета|репорта) #\d+\b/i.test(header.textContent.trim()));
        if (title) {
          const ticket = this.nativeData && this.getNativeTicket(scope);
          const ticketId = this.nativeData ? ticket && String(ticket.id) : title.textContent.match(/#(\d+)/)?.[1];
          const steamId3 = this.getOffenderSteamIdForScope(scope);
          return ticketId && steamId3 ? {
            scope,
            textarea,
            title,
            card,
            ticketId,
            steamId: steamId3,
            category: this.getTicketComplaintCategory(scope),
            buttons: Array.from(card.querySelectorAll("button")).filter((button) => !isIohNode(button))
          } : null;
        }
        if (card === scope) break;
        card = card.parentElement;
      }
      return null;
    },
    isTicketPunishmentFeedbackContextEditable(context) {
      return Boolean(context && !context.textarea.readOnly && !context.textarea.disabled && this.isCloseReasonContextInProgress(context));
    },
    onTicketPunishmentFeedbackIntent(intent) {
      if (this.settings?.features?.processTicketRules !== true || !intent?.attemptToken || !["ban", "mute"].includes(intent.type)) return false;
      const textarea = intent.scope?.querySelector('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]');
      const context = this.getTicketPunishmentFeedbackContext(textarea, intent.scope);
      if (!this.isTicketPunishmentFeedbackContextEditable(context) || context.ticketId !== String(intent.ticketId) || context.steamId !== intent.steamId) return false;
      this.syncTicketPunishmentFeedback();
      this._punishmentFeedbackSessions ||= /* @__PURE__ */ new Map();
      let session = this._punishmentFeedbackSessions.get(context.scope);
      if (!session) {
        session = { ...context, intents: /* @__PURE__ */ new Map(), lastHtml: null, histories: /* @__PURE__ */ new Set() };
        const previous = this.document.getElementById("helper-suggest-badge");
        if (previous?.parentNode === textarea.parentNode) {
          session.previousBadge = {
            html: previous.innerHTML,
            variant: previous.className.match(/ioh-info-badge--([\w-]+)/)?.[1] || "muted"
          };
        }
        this._punishmentFeedbackSessions.set(context.scope, session);
        const Observer = this.document.defaultView.MutationObserver;
        session.observer = new Observer((mutations) => {
          if (mutations.every((mutation) => isIohNode(mutation.target))) return;
          this.refreshTicketPunishmentFeedback(session);
        });
        session.observer.observe(session.scope, { childList: true, subtree: true });
      }
      session.intents.set(intent.attemptToken, intent.type);
      this.rememberNativePunishmentIntent?.(intent);
      this._punishmentFeedbackTokens ||= /* @__PURE__ */ new WeakMap();
      this._punishmentFeedbackTokens.set(intent.attemptToken, session);
      this.refreshTicketPunishmentFeedback(session);
      return true;
    },
    cancelTicketPunishmentFeedbackIntent(token) {
      this._nativePunishmentAttempts?.delete(token);
      const session = this._punishmentFeedbackTokens?.get(token);
      if (!session) return;
      session.intents.delete(token);
      this._punishmentFeedbackTokens.delete(token);
      this.refreshTicketPunishmentFeedback(session);
    },
    renderTicketPunishmentFeedback(textarea) {
      const session = Array.from(this._punishmentFeedbackSessions?.values() || []).find((candidate) => candidate.textarea === textarea);
      return session ? this.refreshTicketPunishmentFeedback(session, { restoreAnalysis: false }) : false;
    },
    refreshTicketPunishmentFeedback(session, { restoreAnalysis = true } = {}) {
      if (this._punishmentFeedbackSessions?.get(session.scope) !== session) return false;
      const context = this.getTicketPunishmentFeedbackContext(session.textarea, session.scope);
      if (this.settings?.features?.processTicketRules !== true || !context || context.ticketId !== session.ticketId || context.steamId !== session.steamId || !this.isCloseReasonContextInProgress(context)) {
        this.releaseTicketPunishmentFeedback(session);
        return false;
      }
      const blocks = this.getHistoryBlocks(session.scope, { force: true });
      if (Array.from(session.histories).some((history) => history.isConnected === false)) {
        session.observer.disconnect();
        session.histories.clear();
        session.observer.observe(session.scope, { childList: true, subtree: true });
      }
      for (const history of [blocks.ban, blocks.mute]) {
        if (history?.nativeHistory) continue;
        if (!history || history === session.scope || history === this.document.body || history === this.document.documentElement || session.histories.has(history)) continue;
        session.histories.add(history);
        session.observer.observe(history, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["class", "style"]
        });
      }
      const ban = this.findActivePunishmentRow(blocks.ban);
      const mute = this.findActivePunishmentRow(blocks.mute);
      for (const [token, type2] of session.intents) {
        if (type2 === "ban" ? ban : mute) {
          session.intents.delete(token);
          this._punishmentFeedbackTokens?.delete(token);
        }
      }
      const types = Array.from(session.intents.values());
      if (session.nativeConfirmed) {
        const player2 = this.nativePlayer(session.steamId), key = session.nativeConfirmed.type === "ban" ? "isBanned" : "isMuted";
        if (player2?.[key] === false && (player2.stamps[key] > session.nativeConfirmed.startedAt || player2.stamps[key] === session.nativeConfirmed.startedAt && player2.orders[key] > session.nativeConfirmed.sequence)) session.nativeConfirmed = null;
        else types.push(session.nativeConfirmed.type);
      }
      const type = ban || types.includes("ban") ? "ban" : mute || types.includes("mute") ? "mute" : null;
      if (!type) {
        const hadBadge = session.lastHtml !== null;
        this.releaseTicketPunishmentFeedback(session);
        if (hadBadge) {
          if (session.previousBadge && this.isCloseReasonTextareaVisible(session.textarea, session.scope)) {
            this.badgeService.updateInfoBadge(
              "helper-suggest-badge",
              session.previousBadge.variant,
              session.previousBadge.html,
              session.textarea
            );
          }
          const key = this.getChatCacheKey(session.textarea);
          this.chatSignatureByKey.delete(key);
          this.activePunishmentBadgeByKey.delete(key);
          if (restoreAnalysis && this.isVisibleTicketTextarea(session.textarea)) {
            void this.processTicketRules(session.textarea);
          }
        }
        return false;
      }
      if (!this.isCloseReasonTextareaVisible(session.textarea, session.scope)) return true;
      const icons = this.getAnalysisIcons();
      this.syncActivePunishmentPreview?.(
        session.textarea,
        type === "ban" ? ban : mute,
        icons[type] || icons.chatError || "",
        type === "ban" ? " \u0417\u0410\u0411\u0410\u041D\u0415\u041D" : " \u0410\u041A\u0422\u0418\u0412\u041D\u042B\u0419 \u041C\u0423\u0422"
      );
      const html = this.buildActivePunishmentBadge(
        icons[type] || icons.chatError || "",
        type === "ban" ? " \u0417\u0410\u0411\u0410\u041D\u0415\u041D" : " \u0410\u041A\u0422\u0418\u0412\u041D\u042B\u0419 \u041C\u0423\u0422",
        type === "ban" ? ban : mute,
        session.textarea
      );
      const badge = this.document.getElementById("helper-suggest-badge");
      if (session.lastHtml !== html || !badge || badge.parentNode !== session.textarea.parentNode) {
        this.clearSuggestedMuteReason();
        this.badgeService.updateInfoBadge("helper-suggest-badge", type === "ban" ? "accent" : "warning", html, session.textarea);
        session.lastHtml = html;
      }
      return true;
    },
    releaseTicketPunishmentFeedback(session) {
      session.observer.disconnect();
      for (const token of session.intents.keys()) this._punishmentFeedbackTokens?.delete(token);
      session.intents.clear();
      this._punishmentFeedbackSessions.delete(session.scope);
    },
    syncTicketPunishmentFeedback() {
      for (const session of this._punishmentFeedbackSessions?.values() || []) {
        this.refreshTicketPunishmentFeedback(session);
      }
    },
    stopTicketPunishmentFeedback() {
      this.stopActivePunishmentPreviews?.();
      for (const session of this._punishmentFeedbackSessions?.values() || []) this.releaseTicketPunishmentFeedback(session);
    }
  };

  // modules/ticket/NativeData.js
  var NativeTicketMethods = {
    getNativeTicket(scope = null) {
      if (!this.nativeData) return null;
      scope ||= this.getAutoConnectScope?.() || this.document.body;
      const headings = [...scope?.querySelectorAll?.("h3") || []];
      const matches = headings.map((h) => (h.textContent || "").match(/Результат рассмотрения (тикета|репорта) #(\d+)/i)).filter(Boolean);
      if (matches.length !== 1) return null;
      const match = matches[0];
      const ticket = this.nativeData.tickets.get(`${match[1].toLowerCase() === "\u0442\u0438\u043A\u0435\u0442\u0430" ? "ticket" : "report"}:${match[2]}`);
      if (!ticket) return null;
      const field = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope);
      const link = field?.querySelector(PLAYER_PROFILE_LINK_SELECTOR);
      if (link && steamIdFromPlayerProfileUrl(link.href) !== ticket.suspectId) return null;
      return ticket;
    },
    getNativeRowTicket(row) {
      if (!this.nativeData || !row?.querySelectorAll) return null;
      const links = [...row.querySelectorAll(PLAYER_PROFILE_LINK_SELECTOR)];
      const ids = links.map((x) => steamIdFromPlayerProfileUrl(x.href)).filter(Boolean);
      if (ids.length < 2) return null;
      const fiberKey = Object.keys(row).find((k) => k.startsWith("__reactFiber$"));
      let fiber = fiberKey ? row[fiberKey] : null;
      for (let i = 0; fiber && i < 4; i++, fiber = fiber.return) {
        if (!/^\d{1,12}$/.test(String(fiber.key || ""))) continue;
        const found = this.nativeData.queueTickets().filter((t) => t.id === Number(fiber.key) && t.senderId === ids[0] && t.suspectId === ids[1]);
        if (found.length === 1) return found[0];
      }
      const link = row.querySelector('a[href^="steam://connect/"]');
      const original = link?.dataset.iohOriginalServerIp || link?.href?.replace(/^steam:\/\/connect\//i, "").toLowerCase();
      const candidates = this.nativeData.queueTickets().filter((t) => t.senderId === ids[0] && t.suspectId === ids[1] && (!original || t.complaintServer === original));
      const saved = candidates.find((t) => t.key === row.dataset.iohNativeTicket);
      if (saved) return saved;
      candidates.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const ticket = candidates.length === 1 ? candidates[0] : null;
      if (ticket) row.dataset.iohNativeTicket = ticket.key;
      return ticket || null;
    },
    nativePlayer(id) {
      const p = this.nativeData?.player(id);
      if (!p) return null;
      const result = { ...p, fetchedAt: p.updatedAt };
      const newer = (a, b) => p.stamps[a] > p.stamps[b] || p.stamps[a] === p.stamps[b] && (p.orders[a] || 0) >= (p.orders[b] || 0);
      if (p.bans && newer("bans", "isBanned")) result.isBanned = p.bans.some((x) => punishmentActive(x));
      if (p.mutes && newer("mutes", "isMuted")) result.isMuted = p.mutes.some((x) => punishmentActive(x));
      if (p.serverIp) result.serverLabel ||= this.nativeData.servers.get(p.serverIp);
      return result;
    },
    nativeAutoConnectDecision({ analysisFallback = false } = {}) {
      const scope = this.getAutoConnectScope(), t = this.getNativeTicket(scope);
      if (!this.settings.features?.autoConnectServer || !t || !this.scopeHasInProgressStatus(scope)) return { allowed: false, reason: "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0439 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0439 \u0436\u0430\u043B\u043E\u0431\u044B" };
      const p = this.nativePlayer(t.suspectId);
      if (!p?.serverIp) return { allowed: false, reason: "\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0441\u0435\u0440\u0432\u0435\u0440 \u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D \u0441\u0430\u0439\u0442\u043E\u043C" };
      if (!this.canAutoConnectAfterAnalysis(scope)) return { allowed: false, reason: "\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0430\u044E\u0449\u0435\u0433\u043E \u0430\u043D\u0430\u043B\u0438\u0437\u0430" };
      const reasonAllowed = (this.settings.autoConnectReasons || ["\u0427\u0438\u0442\u0435\u0440\u0441\u0442\u0432\u043E", "\u0411\u0430\u0433\u043E\u044E\u0437"]).some((r) => t.reason?.toLowerCase().includes(r.toLowerCase()));
      const allowed = analysisFallback || reasonAllowed || this.complaintTextMatchesAutoconnectTrigger(t.message);
      return { allowed, reason: allowed ? "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u0441\u0430\u0439\u0442\u0430" : "\u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F \u043D\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0430\u0435\u0442 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" };
    },
    nativeHistory(scope, resource) {
      const ticket = this.getNativeTicket(scope);
      const history = ticket && this.nativeData.history(ticket.suspectId, resource);
      const player2 = ticket && this.nativePlayer(ticket.suspectId);
      const items = history?.items || player2?.[resource];
      const knownActive = player2?.[resource === "bans" ? "isBanned" : "isMuted"] === true;
      return {
        nativeHistory: true,
        resource,
        items: items || [],
        ready: Boolean(items),
        steamId: ticket?.suspectId,
        revision: history?.revision || 0,
        active: ticket ? this.nativeData.active(ticket.suspectId, resource) || (knownActive ? { nativeStatus: true, kind: resource } : null) : null
      };
    },
    nativeHistoryBlocks(scope) {
      const t = this.getNativeTicket(scope);
      return {
        ban: this.nativeHistory(scope, "bans"),
        mute: this.nativeHistory(scope, "mutes"),
        warning: { nativeHistory: true, items: t?.warnings || [], ready: Boolean(t && Object.hasOwn(t, "warnings")) },
        chat: this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scope),
        offenderSteamId: t?.suspectId || "unknown"
      };
    },
    nativeAnalysisReady(scope) {
      const t = this.getNativeTicket(scope);
      if (!t) return false;
      const p = this.nativePlayer(t.suspectId);
      if (p?.isBanned || p?.isMuted) return true;
      return Boolean(this.nativeData.history(t.suspectId, "chats") && this.nativeData.history(t.suspectId, "mutes") && this.nativeData.history(t.suspectId, "bans") && Object.hasOwn(t, "warnings") && typeof p?.isBanned === "boolean" && typeof p?.isMuted === "boolean");
    },
    nativeMessages(scope) {
      const t = this.getNativeTicket(scope);
      const messages = t && this.nativeData.history(t.suspectId, "chats")?.items;
      if (!messages) return [];
      const now = Date.now(), anchor = t.chatAnchor || (t.endedAt && t.endedAt <= now ? t.endedAt : now);
      return messages.filter((m) => m.timeMs >= anchor - 864e5 && m.timeMs <= anchor && m.timeMs >= now - 864e5 && m.timeMs <= now);
    },
    nativeAnalysisSignature(scope) {
      const t = this.getNativeTicket(scope);
      if (!t) return "pending";
      const p = this.nativePlayer(t.suspectId);
      return JSON.stringify([
        t.key,
        t.chatAnchor,
        t.endedAt,
        t.warnings,
        this.nativeMessages(scope),
        p?.isBanned,
        p?.isMuted,
        (this.nativeData.history(t.suspectId, "mutes")?.items || p?.mutes)?.filter((m) => m.created >= Date.now() - 30 * 864e5)
      ]);
    },
    bindNativeMessageRows(scope) {
      const t = this.getNativeTicket(scope);
      const messages = t && this.nativeData.history(t.suspectId, "chats")?.items;
      const block = this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scope);
      const bindings = /* @__PURE__ */ new Map();
      if (!messages || !block) return bindings;
      const used = /* @__PURE__ */ new Set();
      for (const row of block.querySelectorAll("tbody tr")) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 2) continue;
        const stamp = row.querySelector("[data-2gnyztty]")?.getAttribute("data-2gnyztty");
        const timeText = cells[0]?.innerText || cells[0]?.textContent || "";
        const text = this.utils.extractMessageText(cells[cells.length - 1]);
        const message = messages.find((m) => !used.has(m.id) && (stamp === m.id || stamp === String(m.timeMs / 1e3) || m.text === text && Math.abs((this.utils.parseTimeToMs(timeText) || 0) - m.timeMs) < 1e3));
        if (message) {
          bindings.set(message.id, row);
          used.add(message.id);
        }
      }
      return bindings;
    },
    setNativeModerators(moderators) {
      this.nativeModerators = new Set(["Tier", "Movement", "Hns", "Jail"].flatMap((k) => Object.keys(flattenModeratorGroup(moderators?.[k]))));
    },
    renderNativeParticipant(link, id) {
      if (!link || !id) return false;
      const moderator = Boolean(this.nativeModerators?.has(id) || this.nativeData.player(id)?.isModerator);
      this.applyOffenderModeratorHighlight(null, link, moderator);
      return moderator;
    },
    renderNativeQueue({ steamIds = null } = {}) {
      if (!this.nativeData) return;
      for (const table of this.findComplaintQueueTables()) for (const row of table.querySelectorAll("tbody tr")) {
        const links = [...row.querySelectorAll(PLAYER_PROFILE_LINK_SELECTOR)];
        if (steamIds && !links.some((link) => steamIds.has(steamIdFromPlayerProfileUrl(link.href)))) continue;
        const t = this.getNativeRowTicket(row);
        if (!t) continue;
        const sender = links.find((l) => steamIdFromPlayerProfileUrl(l.href) === t.senderId);
        const suspect = links.find((l) => steamIdFromPlayerProfileUrl(l.href) === t.suspectId && l !== sender) || links[1];
        const p = this.nativePlayer(t.suspectId) || {};
        const senderMod = this.renderNativeParticipant(sender, t.senderId);
        const suspectMod = this.renderNativeParticipant(suspect, t.suspectId);
        if (this.settings.features?.trackOffenderServer) {
          const link = row.querySelector('a[href^="steam://connect/"]');
          if (link && Object.hasOwn(p, "serverIp")) {
            link.dataset.iohOriginalServerIp = t.complaintServer || "";
            this.applyOffenderServerStatus(link, t.suspectId, t.complaintServer, p);
          }
          this.applyOffenderPunishmentHighlight(row, p);
          this.applyOffenderPunishmentActionLabel(row, p);
          this.applyOffenderVipBadge(suspect, p.vipName);
          this.applyOffenderProfileVerification(suspect, p.profileVerified, null);
        }
        row.classList.toggle("ioh-highlighted-moderator", senderMod || suspectMod || Boolean(this.settings.features?.trackOffenderServer && p.profileVerified));
      }
    },
    syncNativeTicketViews({ steamIds = null, syncTracking = true } = {}) {
      if (!this.nativeData) return;
      for (const textarea of this.document.querySelectorAll('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]')) {
        const scope = this.getTicketScopeRoot(textarea), t = this.getNativeTicket(scope);
        if (!t) continue;
        if (steamIds && !steamIds.has(t.suspectId) && !steamIds.has(t.senderId)) continue;
        for (const [label, id] of [["\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u0435\u043B\u044C", t.senderId], ["\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", t.suspectId]]) {
          const field = this.findInfoFieldScoped(label, scope);
          const link = [...field?.querySelectorAll(PLAYER_PROFILE_LINK_SELECTOR) || []].find((l) => steamIdFromPlayerProfileUrl(l.href) === id);
          this.renderNativeParticipant(link, id);
        }
        this.renderNativeContext(scope, t);
      }
      this.renderNativeQueue({ steamIds });
      if (syncTracking) this.syncOpenTicketOffenderTracking();
    },
    renderNativeContext(scope, ticket) {
      scope.querySelector("#ioh-native-context")?.remove();
      const bypass = this.nativeData.bypasses.get(ticket.suspectId);
      const field = this.findInfoFieldScoped("\u041E\u0431\u0445\u043E\u0434 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438", scope) || this.findInfoFieldScoped("\u041E\u0431\u0445\u043E\u0434 \u0431\u0430\u043D\u0430", scope) || this.findInfoFieldScoped("\u041E\u0431\u0445\u043E\u0434 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438:", scope);
      const previous = scope.querySelector(".ioh-bypass-count");
      if (!field || bypass?.checked !== true || !Number.isFinite(bypass.bannedAccounts)) {
        previous?.remove();
        return;
      }
      const host = field.querySelector(":scope > div") || field;
      let node = previous;
      if (!node || !field.contains(node)) {
        node?.remove();
        node = this.document.createElement("span");
        markIoh(node);
        node.className = "ioh-bypass-count";
        host.append(node);
      }
      const text = String(bypass.bannedAccounts);
      if (node.textContent !== text) node.textContent = text;
      node.title = `\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u043E\u0432: ${bypass.bannedAccounts}`;
      node.setAttribute("aria-label", node.title);
    },
    consumeNativeEvent(event) {
      if (!this.nativeData) return;
      const closeReasonPlayers = new Set([...this._closeReasonSessions?.values() || []].map((s) => s.steamId));
      for (const id of closeReasonPlayers) {
        const p = this.nativePlayer(id);
        if (p) this.onCloseReasonPunishmentData(id, p);
      }
      if (event.kind === "account") {
        this.syncNativePermissions();
      }
      if (event.kind === "action") {
        const attempt = [...this._nativePunishmentAttempts?.values() || []].filter((a) => a.steamId === event.payload.steamId && (a.type === "ban" ? "bans" : "mutes") === event.payload.resource && a.at <= event.startedAt).sort((a, b) => b.at - a.at)[0];
        if (attempt) {
          this._nativePunishmentAttempts.delete(attempt.attemptToken);
          const t = this.getNativeTicket(attempt.scope);
          if (t && t.id === Number(attempt.ticketId) && t.suspectId === attempt.steamId && this.document.contains(attempt.scope)) {
            if (event.payload.success) {
              const key = attempt.type === "ban" ? "isBanned" : "isMuted";
              this.nativeData.mergePlayer(attempt.steamId, { [key]: true }, event);
              const current = this.nativePlayer(attempt.steamId);
              this.onCloseReasonPunishmentData(attempt.steamId, { ...current, scope: attempt.scope, ticketId: attempt.ticketId });
              const session = this._punishmentFeedbackSessions?.get(attempt.scope);
              if (current?.[key] && session) session.nativeConfirmed = { type: attempt.type, startedAt: event.startedAt, sequence: event.sequence };
              if (!current?.[key]) {
                this.cancelTicketPunishmentFeedbackIntent(attempt.attemptToken);
                this.cancelCloseReasonPunishmentIntent(attempt.attemptToken);
              }
            } else {
              this.cancelTicketPunishmentFeedbackIntent(attempt.attemptToken);
              this.cancelCloseReasonPunishmentIntent(attempt.attemptToken);
            }
          }
        }
      }
      const presenceIds = /* @__PURE__ */ new Set();
      if (event.source !== "tracker" && event.kind === "player" && Object.hasOwn(event.payload, "serverIp")) presenceIds.add(event.payload.steamId);
      if (event.kind === "ticket" && event.payload.presence) presenceIds.add(event.payload.suspectId);
      if (event.kind === "serverPlayers" && event.payload.endpoint) event.payload.players.forEach((p) => presenceIds.add(p.steamId));
      this.syncOpenTicketOffenderTracking();
      for (const session of this._openTicketTrackingSessions.values()) {
        if (!presenceIds.has(session.steamId)) continue;
        const p = this.nativePlayer(session.steamId);
        if (!p || !Object.hasOwn(p, "serverIp")) continue;
        const old = session.lastServer;
        session.lastServer = p.serverIp;
        if (p.serverIp === null) {
          session.waitingForReturn = true;
          session.pendingServer = null;
          this.markOffenderOffline(session.steamId);
        } else {
          const t = this.getNativeTicket(session.scope);
          this.clearOffenderOffline(session.steamId);
          if (p.serverIp !== t?.complaintServer) this.markOffenderRelocated(session.steamId, p.serverIp);
          else this.clearOffenderRelocated(session.steamId);
          if (session.waitingForReturn || old && old !== p.serverIp || old === void 0 && p.serverIp !== t?.complaintServer) session.pendingServer = p.serverIp;
          if (session.pendingServer === p.serverIp) {
            const already = this.isAlreadyOnRequestedServer(p.serverIp);
            const connected = !already && this.connectToTrackedOffenderServer(session, p.serverIp);
            if (already || connected) {
              session.pendingServer = null;
              this.announceOffenderTrackerResult?.(session, connected);
            }
          }
          session.waitingForReturn = false;
        }
      }
      const steamIds = event.source === "tracker" && event.kind === "player" ? /* @__PURE__ */ new Set([event.payload.steamId]) : null;
      this.syncNativeTicketViews({ steamIds, syncTracking: false });
      this.syncCloseReasonSelection();
      this.syncTicketPunishmentFeedback();
      this.syncOffenderTrackerStatus?.();
    },
    rememberNativePunishmentIntent(intent) {
      if (!this.nativeData || !intent.attemptToken || this._nativePunishmentAttempts?.has(intent.attemptToken)) return;
      this._nativePunishmentAttempts ||= /* @__PURE__ */ new Map();
      this._nativePunishmentAttempts.set(intent.attemptToken, { ...intent, at: Date.now() });
      while (this._nativePunishmentAttempts.size > 40) this._nativePunishmentAttempts.delete(this._nativePunishmentAttempts.keys().next().value);
    },
    syncNativePermissions() {
      const account = this.nativeData?.account;
      const has = (name) => account?.groups.some((g) => g.split(":")[0] === name);
      this.canIssueBan = Boolean(account && (/z/.test(account.flags) || has("web.users.bans.set")));
      this.canIssueMute = Boolean(account && (/z/.test(account.flags) || has("web.users.comms.set")));
      this._permissionsHydrated = Boolean(account);
    }
  };

  // modules/TicketService.js
  var TicketService = class {
    constructor({ document: document2, utils, badgeService, settings, rules, spamRules = {}, muteExceptions = {}, chrome: chrome2 = null, nativeData = null }) {
      this.nativeData = nativeData;
      this.document = document2;
      this.utils = utils;
      this.badgeService = badgeService;
      this.settings = settings;
      this._rules = rules;
      this.spamRules = spamRules;
      this._muteExceptions = muteExceptions;
      this.chrome = chrome2;
      this._ruleMatcher = compileRuleMatcher(rules, muteExceptions);
      this._scopeCache = /* @__PURE__ */ new WeakMap();
      this._offenderRowSnapshots = /* @__PURE__ */ new WeakMap();
      this._vipRafId = null;
      this._vipPending = /* @__PURE__ */ new Set();
      this.triggerRows = /* @__PURE__ */ new Map();
      this._sortedTriggers = [];
      this._visibleTriggerCount = 0;
      this.handleTriggerClick = this.handleTriggerClick.bind(this);
      this.isCheckingServer = false;
      this.offenderProfileCache = /* @__PURE__ */ new Map();
      this.offenderProfileInflight = /* @__PURE__ */ new Map();
      this.offenderProjectCache = /* @__PURE__ */ new Map();
      this.offenderProjectInflight = /* @__PURE__ */ new Map();
      this.offenderTicketProjectCache = /* @__PURE__ */ new Map();
      this.offenderTicketProjectInflight = /* @__PURE__ */ new Map();
      this.autoConnectedServerIps = /* @__PURE__ */ new Map();
      this._autoConnectSkipLoggedIps = /* @__PURE__ */ new Set();
      this.chatSignatureByKey = /* @__PURE__ */ new Map();
      this.activePunishmentBadgeByKey = /* @__PURE__ */ new Map();
      this.suggestedMuteReason = null;
      this.globalServerCooldown = 0;
      this.offenderOffline = /* @__PURE__ */ new Map();
      this.offenderRelocated = /* @__PURE__ */ new Map();
      this.userDataCache = /* @__PURE__ */ new Map();
      this._openTicketTrackingSessions = /* @__PURE__ */ new Map();
      this.LEFT_OFFENDER_TTL_MS = 8 * 60 * 1e3;
      this.MODERATOR_PERMISSIONS_KEY = "iohModeratorPermissions";
      this.MUTE_MANAGEMENT_ROUTE = "/comms/list";
      this.BAN_MANAGEMENT_ROUTE = "/bans/list";
      this.TICKET_PUNISHMENT_ACTIONS_ID = "ioh-ticket-punishment-actions";
      this.TICKET_MUTE_BUTTON_ID = "ioh-ticket-issue-mute";
      this.TICKET_BAN_BUTTON_ID = "ioh-ticket-issue-ban";
      this.TICKET_LIST_TAB_LABELS = ["\u0410\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0435 \u0442\u0438\u043A\u0435\u0442\u044B"];
      this.canIssueMute = false;
      this.canIssueBan = false;
      this.mutePanelReady = false;
      this.banPanelReady = false;
      this._cachedOpenMuteHandler = null;
      this._cachedOpenBanHandler = null;
      this._cachedMuteIssueButton = null;
      this._cachedBanIssueButton = null;
      this._punishmentPermissionObserver = null;
      this._punishmentPermissionDebounceId = null;
      this._muteRevokeDebounceId = null;
      this._banRevokeDebounceId = null;
      this._lastPunishmentScope = null;
      this._isUpdatingPunishmentButtons = false;
      this._permissionsHydrated = false;
      this._permissionScanSuppressed = 0;
      this._wasMutePanelActive = false;
      this._wasBanPanelActive = false;
      this._lastManagementOpenedViaAside = false;
      this._punishmentInitFailCount = 0;
      this.handleTicketMuteButtonClick = this.handleTicketMuteButtonClick.bind(this);
      this.handleTicketBanButtonClick = this.handleTicketBanButtonClick.bind(this);
      this.punishmentBridge = new SitePunishmentBridge({ document: document2, ticketService: this });
    }
    get rules() {
      return this._rules;
    }
    set rules(value) {
      this.setRuleInputs(value, this._muteExceptions);
    }
    get muteExceptions() {
      return this._muteExceptions;
    }
    set muteExceptions(value) {
      this.setRuleInputs(this._rules, value);
    }
    setRuleInputs(rules, muteExceptions) {
      this._rules = rules;
      this._muteExceptions = muteExceptions || {};
      this.recompileRuleMatcher();
    }
    recompileRuleMatcher() {
      this._ruleMatcher = compileRuleMatcher(this._rules, this._muteExceptions);
    }
    async processTicketRules(textarea) {
      if (this.renderTicketPunishmentFeedback(textarea)) return { kind: "skip" };
      if (!this.isVisibleTicketTextarea(textarea)) {
        return { kind: "skip" };
      }
      const scope = this.getTicketScopeRoot(textarea);
      if (!this.isChatHistorySettledScoped(scope)) {
        return { kind: "pending" };
      }
      const blocks = this.getHistoryBlocks(scope, { force: true });
      const analysisIcons = this.getAnalysisIcons();
      const {
        triggers,
        reason,
        info: infoIcon,
        punishment,
        chatError,
        shield,
        done
      } = analysisIcons;
      const banIcon = analysisIcons.ban || chatError;
      const muteIcon = analysisIcons.mute || chatError;
      const warningIcon = analysisIcons.warning || chatError;
      const doneIcon = done || shield || chatError;
      const muteHistoryBlock = blocks.mute;
      const banHistoryBlock = blocks.ban;
      const chatHistoryBlock = blocks.chat;
      const warningHistoryBlock = blocks.warning;
      const cacheKey = this.getChatCacheKey(textarea);
      const pathname = window.location.pathname;
      const activeBanRow = this.findActivePunishmentRow(banHistoryBlock);
      if (activeBanRow) {
        this.syncActivePunishmentPreview(textarea, activeBanRow, banIcon, " \u0417\u0410\u0411\u0410\u041D\u0415\u041D");
        const signature2 = `${pathname}|ban:${this.getPunishmentRowFingerprint(activeBanRow)}`;
        if (this.chatSignatureByKey.get(cacheKey) === signature2) {
          return { kind: "unchanged" };
        }
        this.chatSignatureByKey.set(cacheKey, signature2);
        this.clearSuggestedMuteReason();
        if (!this.shouldSkipActivePunishmentBadge("ban", activeBanRow, textarea)) {
          this.badgeService.updateInfoBadge(
            "helper-suggest-badge",
            "accent",
            this.buildActivePunishmentBadge(banIcon, " \u0417\u0410\u0411\u0410\u041D\u0415\u041D", activeBanRow, textarea),
            textarea
          );
        }
        return { kind: "skip" };
      }
      const activeMuteRow = this.findActivePunishmentRow(muteHistoryBlock);
      if (activeMuteRow) {
        this.syncActivePunishmentPreview(textarea, activeMuteRow, muteIcon, " \u0410\u041A\u0422\u0418\u0412\u041D\u042B\u0419 \u041C\u0423\u0422");
        const signature2 = `${pathname}|mute:${this.getPunishmentRowFingerprint(activeMuteRow)}`;
        if (this.chatSignatureByKey.get(cacheKey) === signature2) {
          return { kind: "unchanged" };
        }
        this.chatSignatureByKey.set(cacheKey, signature2);
        this.clearSuggestedMuteReason();
        if (!this.shouldSkipActivePunishmentBadge("mute", activeMuteRow, textarea)) {
          this.badgeService.updateInfoBadge(
            "helper-suggest-badge",
            "warning",
            this.buildActivePunishmentBadge(muteIcon, " \u0410\u041A\u0422\u0418\u0412\u041D\u042B\u0419 \u041C\u0423\u0422", activeMuteRow, textarea),
            textarea
          );
        }
        return { kind: "skip" };
      }
      this.activePunishmentBadgeByKey.delete(cacheKey);
      this.releaseActivePunishmentPreview(textarea);
      const rows = this.nativeData ? this.nativeMessages(scope) : Array.from(chatHistoryBlock?.querySelectorAll("tbody tr, tr") || []).filter((row) => row.querySelector("td"));
      const lastRow = rows[rows.length - 1];
      const chatEmpty = this.nativeData ? rows.length === 0 : this.isChatHistoryEmptyScoped(scope) || rows.length === 0;
      const warnPart = this.getWarningHistorySignaturePart(warningHistoryBlock);
      const signature = this.nativeData ? this.nativeAnalysisSignature(scope) : chatEmpty ? `${pathname}|empty|${warnPart}` : `${pathname}|${rows.length}|${(lastRow.innerText || "").trim().slice(0, 220)}|${warnPart}`;
      if (this.chatSignatureByKey.get(cacheKey) === signature) {
        return { kind: "unchanged" };
      }
      this.chatSignatureByKey.set(cacheKey, signature);
      if (chatEmpty) {
        this.clearSuggestedMuteReason();
        this.badgeService.updateInfoBadge(
          "helper-suggest-badge",
          "muted",
          `<div class="ioh-badge-row"><span class="ioh-icon-box">${chatError}</span><span>\u0427\u0410\u0422 \u041F\u0423\u0421\u0422</span></div>`,
          textarea
        );
        return { kind: "none" };
      }
      const lastMuteDate = this.findLastMuteWithin24h(muteHistoryBlock);
      const analysis = this.analyzeChatRows(rows, lastMuteDate);
      let { allViolations, ruleCounters } = analysis;
      const coveringWarning = this.getCoveringWarningWithoutNewTriggers(warningHistoryBlock, allViolations);
      if (coveringWarning) {
        const warningRecord = { nativePunishment: true, kind: "warnings", id: String(coveringWarning.date.getTime()), created: coveringWarning.date.getTime(), reason: coveringWarning.text };
        if (this.nativeData) this.syncActivePunishmentPreview(textarea, warningRecord, warningIcon, " \u0418\u0433\u0440\u043E\u043A\u0443 \u0443\u0436\u0435 \u0432\u044B\u0434\u0430\u043D\u043E \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435!");
        this.clearSuggestedMuteReason();
        this.badgeService.updateInfoBadge(
          "helper-suggest-badge",
          "warning",
          this.nativeData ? this.buildActivePunishmentBadge(warningIcon, " \u0418\u0433\u0440\u043E\u043A\u0443 \u0443\u0436\u0435 \u0432\u044B\u0434\u0430\u043D\u043E \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435!", warningRecord, textarea) : `<div class="ioh-badge-row ioh-warning-text-tooltip" data-full-msg="${this.utils.escapeHtml(coveringWarning.text)}" title=""><span class="ioh-icon-box">${warningIcon}</span><span><b> \u0418\u0433\u0440\u043E\u043A\u0443 \u0443\u0436\u0435 \u0432\u044B\u0434\u0430\u043D\u043E \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435!</b></span></div>`,
          textarea
        );
        return { kind: "skip" };
      }
      ({ allViolations, ruleCounters } = this.dropSoloTrollingViolation(allViolations, ruleCounters));
      const activeStats = Object.entries(ruleCounters).filter(([, count]) => count > 0);
      const activeStatsSummary = activeStats.map(([name, count]) => `${name}: ${count}`).join(" | ");
      const activityHTML = activeStatsSummary ? ` <span class="ioh-activity-text">(${this.utils.escapeHtml(activeStatsSummary)})</span>` : "";
      if (allViolations.length === 0) {
        this.clearSuggestedMuteReason();
        this.badgeService.updateInfoBadge(
          "helper-suggest-badge",
          "success",
          `<div class="ioh-badge-row">${doneIcon}<span>\u041D\u0415\u0422 \u041D\u0410\u0420\u0423\u0428\u0415\u041D\u0418\u0419 ${activityHTML}</span></div>`,
          textarea
        );
        return { kind: "none" };
      }
      const mostSevere = this.findMostSeverePunishment(ruleCounters);
      if (!mostSevere) {
        this.clearSuggestedMuteReason();
        return { kind: "skip" };
      }
      const {
        finalName,
        finalDuration,
        finalDurationStr
      } = this.calculateFinalPunishment(mostSevere.rule, mostSevere.count, ruleCounters);
      const sortedTriggers = allViolations.sort((a, b) => b.severity - a.severity || b.duration - a.duration || a.keyword.localeCompare(b.keyword));
      this._sortedTriggers = sortedTriggers;
      const initialLimit = Number(this.settings?.maxVisionTriggers) || 30;
      this._visibleTriggerCount = Math.min(initialLimit, sortedTriggers.length);
      const topTriggersHTML = this.buildVisibleTriggersHtml();
      let finalDurationForDisplay = finalDurationStr;
      if (finalDuration > 0) {
        const recentSameReasonMute = this.findRecentMuteForReasons(muteHistoryBlock, [finalName]);
        if (recentSameReasonMute) {
          finalDurationForDisplay = this.utils.formatDuration(recentSameReasonMute.duration * 2);
        }
      }
      const isWarning = finalDurationStr === "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435";
      const punishmentText = isWarning ? finalDurationStr : `\u043C\u0443\u0442 \u043D\u0430 ${finalDurationForDisplay}`;
      const offenderId = blocks.offenderSteamId === "unknown" ? "" : blocks.offenderSteamId;
      if (isWarning) {
        this.clearSuggestedMuteReason();
      } else {
        this.setSuggestedMuteReason(offenderId, finalName);
      }
      const severityByRule = {};
      const durationByRule = {};
      for (const v of allViolations) {
        if ((v.severity ?? -1) > (severityByRule[v.ruleName] ?? -1)) {
          severityByRule[v.ruleName] = v.severity;
        }
        if ((v.duration ?? -1) > (durationByRule[v.ruleName] ?? -1)) {
          durationByRule[v.ruleName] = v.duration;
        }
      }
      const sortedStats = [...activeStats].sort(
        (a, b) => (severityByRule[b[0]] ?? 0) - (severityByRule[a[0]] ?? 0) || (durationByRule[b[0]] ?? 0) - (durationByRule[a[0]] ?? 0) || a[0].localeCompare(b[0])
      );
      const statsTooltip = sortedStats.length > 1 && infoIcon ? `<span class="ioh-analysis-stats-tooltip" title="">${infoIcon}<span class="ioh-analysis-stats-tooltip__panel" role="tooltip">${sortedStats.map(
        ([name, count]) => `<span class="ioh-analysis-stats-tooltip__row"><span class="ioh-analysis-stats-tooltip__name">${this.utils.escapeHtml(name)}</span><span class="ioh-analysis-stats-tooltip__count">${count}</span></span>`
      ).join("")}</span></span>` : "";
      const htmlResponse = `
                <div class="ioh-analysis-grid">
                    <div class="ioh-analysis-row">
                        <div class="ioh-analysis-label">${triggers}<span></span></div>
                        <div class="ioh-analysis-value ioh-analysis-triggers">${topTriggersHTML}</div>
                    </div>
                    <div class="ioh-analysis-row">
                        <div class="ioh-analysis-label">${reason}<span></span></div>
                        <div class="ioh-analysis-value ioh-analysis-value--reason">
                            <strong>${this.utils.escapeHtml(finalName)}</strong>${statsTooltip}
                        </div>
                    </div>
                    <div class="ioh-analysis-row ioh-analysis-row--verdict">
                        <div class="ioh-analysis-label">${punishment}<span></span></div>
                        <div class="ioh-analysis-value"><strong>${this.utils.escapeHtml(punishmentText)}</strong></div>
                    </div>
                </div>
            </div>
        `;
      const badgeVariant = isWarning ? "warning" : "accent";
      this.badgeService.updateInfoBadge("helper-suggest-badge", badgeVariant, htmlResponse, textarea);
      const badge = this.document.getElementById("helper-suggest-badge");
      if (badge) {
        badge.removeEventListener("click", this.handleTriggerClick);
        badge.addEventListener("click", this.handleTriggerClick);
      }
      return { kind: isWarning ? "warning" : "mute" };
    }
    findLastMuteWithin24h(muteHistoryBlock) {
      if (muteHistoryBlock?.nativeHistory) {
        const newest = muteHistoryBlock.items.filter((p) => p.created >= Date.now() - 864e5).sort((a, b) => b.created - a.created)[0];
        return newest ? new Date(newest.created) : null;
      }
      if (!muteHistoryBlock) {
        return null;
      }
      let lastMuteDate = null;
      const now = Date.now();
      muteHistoryBlock.querySelectorAll("tbody tr").forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 6) {
          return;
        }
        const muteDate = this.parseDateCell(cells[1]);
        if (!muteDate) {
          return;
        }
        const hoursDiff = (now - muteDate.getTime()) / (1e3 * 60 * 60);
        if (hoursDiff <= 24 && (!lastMuteDate || muteDate > lastMuteDate)) {
          lastMuteDate = muteDate;
        }
      });
      return lastMuteDate;
    }
    analyzeChatRows(rows, lastMuteDate) {
      this.triggerRows.clear();
      const messages = [];
      for (const row of rows) {
        const chatRow = this.nativeData ? { messageText: row.text, authorText: row.channel === "team" ? "\u041A\u043E\u043C\u0430\u043D\u0434\u0430" : "\u0412\u0441\u0435", timeText: "", timeMs: row.timeMs } : this.getChatRowData(row);
        if (!chatRow || !chatRow.messageText) {
          continue;
        }
        if (!this.nativeData && !this.utils.isMessageWithin24Hours(chatRow.timeText)) {
          continue;
        }
        const msgTimeMs = this.nativeData ? chatRow.timeMs : this.utils.parseTimeToMs(chatRow.timeText);
        if (lastMuteDate && msgTimeMs && msgTimeMs <= lastMuteDate.getTime()) {
          continue;
        }
        messages.push({ messageText: chatRow.messageText, authorText: chatRow.authorText, timeMs: msgTimeMs, row });
      }
      return scanChatMessages(this, messages, { triggerRows: this.triggerRows });
    }
    dropSoloTrollingViolation(allViolations, ruleCounters) {
      if (ruleCounters["\u0422\u0440\u043E\u043B\u043B\u0438\u043D\u0433/\u043F\u0440\u043E\u0432\u043E\u043A\u0430\u0446\u0438\u044F"] !== 1 || (ruleCounters["\u0421\u043F\u0430\u043C \u0432 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D/\u0447\u0430\u0442"] || 0) !== 0 || (ruleCounters["\u041E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u0435"] || 0) !== 0 || (ruleCounters["\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C"] || 0) !== 0 || (ruleCounters["\u0420\u0430\u0441\u0438\u0437\u043C / \u0434\u0438\u0441\u043A\u0440\u0438\u043C\u0438\u043D\u0430\u0446\u0438\u044F"] || 0) !== 0) {
        return { allViolations, ruleCounters };
      }
      return {
        allViolations: allViolations.filter((v) => v.ruleName !== "\u0422\u0440\u043E\u043B\u043B\u0438\u043D\u0433/\u043F\u0440\u043E\u0432\u043E\u043A\u0430\u0446\u0438\u044F"),
        ruleCounters: {
          ...ruleCounters,
          "\u0422\u0440\u043E\u043B\u043B\u0438\u043D\u0433/\u043F\u0440\u043E\u0432\u043E\u043A\u0430\u0446\u0438\u044F": 0
        }
      };
    }
  };
  Object.assign(
    TicketService.prototype,
    TicketScopeMethods,
    ChatAnalyzerMethods,
    VerdictMethods,
    AnalysisBadgeMethods,
    ActivePunishmentMethods,
    AutoConnectMethods,
    QueueCardsMethods,
    PunishmentPanelMethods,
    OffenderProfileMethods,
    OffenderTrackingMethods,
    CloseReasonMethods,
    PunishmentFeedbackMethods,
    NativeTicketMethods
  );

  // modules/PunishmentService.js
  var PunishmentService = class {
    constructor({ document: document2, ticketService = null }) {
      this.document = document2;
      this.ticketService = ticketService;
      this.enabled = true;
      this.debounceId = null;
      this.formBindings = /* @__PURE__ */ new Map();
      this.punishmentBindings = /* @__PURE__ */ new Map();
      this.punishmentIntentListeners = null;
    }
    init() {
      this.enabled = true;
      this.scanDialogs();
    }
    teardown() {
      this.enabled = false;
      clearTimeout(this.debounceId);
      this.debounceId = null;
      for (const cleanup of this.formBindings.values()) cleanup();
      this.formBindings.clear();
      this.stopPunishmentIntentBindings();
      this.syncPunishmentIntentListeners();
      for (const binding of this.punishmentBindings.values()) binding.cleanup();
      this.punishmentBindings.clear();
    }
    scheduleScan() {
      clearTimeout(this.debounceId);
      if (!this.enabled) return;
      this.debounceId = setTimeout(() => {
        this.debounceId = null;
        this.scanDialogs();
      }, 150);
    }
    isRelevantNode(node) {
      return Boolean(node?.nodeType === 1 && (node.matches?.('[role="dialog"], #mute-reason, #mute-steamid64, #ban-steamid64') || node.querySelector?.("#mute-reason, #mute-steamid64, #ban-steamid64")));
    }
    scanDialogs() {
      if (!this.enabled) return;
      this.syncPunishmentIntentListeners();
      if (!this.isPunishmentConfirmationEnabled()) this.stopPunishmentIntentBindings();
      for (const [dialog, binding] of this.punishmentBindings) {
        if (!dialog.isConnected || dialog.getAttribute?.("data-state") === "closed") {
          binding.cleanup();
          this.punishmentBindings.delete(dialog);
        }
      }
      for (const [reasonSelect, cleanup] of this.formBindings) {
        if (!reasonSelect.isConnected) {
          cleanup();
          this.formBindings.delete(reasonSelect);
        }
      }
      this.document.querySelectorAll('[role="dialog"]').forEach((dialog) => {
        this.bindPunishmentConfirmation(dialog);
        const reasonSelect = dialog.querySelector("#mute-reason");
        if (reasonSelect) this.bindMuteForm(reasonSelect, dialog);
      });
    }
    isPunishmentConfirmationEnabled() {
      const features = this.ticketService?.settings?.features;
      return this.enabled && (features?.autoSelectCloseReason === true || features?.processTicketRules === true);
    }
    syncPunishmentIntentListeners() {
      if (!this.isPunishmentConfirmationEnabled()) {
        if (this.punishmentIntentListeners) {
          const { click: click2, submit: submit2 } = this.punishmentIntentListeners;
          this.document.removeEventListener("click", click2, true);
          this.document.removeEventListener("submit", submit2, true);
          this.punishmentIntentListeners = null;
        }
        return;
      }
      if (this.punishmentIntentListeners || !this.document.addEventListener) return;
      const click = (event) => this.handlePunishmentIntentEvent(event);
      const submit = (event) => this.handlePunishmentIntentEvent(event);
      this.document.addEventListener("click", click, true);
      this.document.addEventListener("submit", submit, true);
      this.punishmentIntentListeners = { click, submit };
    }
    handlePunishmentIntentEvent(event) {
      if (!this.isPunishmentConfirmationEnabled()) return;
      const element = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      const dialog = element?.closest?.('[role="dialog"]');
      if (!dialog || !dialog.isConnected || isIohNode(dialog)) return;
      this.bindPunishmentConfirmation(dialog);
      const binding = this.punishmentBindings.get(dialog);
      if (binding) this.applyPunishmentIntentEvent(binding, event);
    }
    getPunishmentConfirmationOrigin(scope, steamId3, { requireEditable = true } = {}) {
      const ticket = this.ticketService;
      if (!scope || !steamId3 || !this.document.contains(scope) || !ticket.isOpenComplaintScope(scope) || ticket.getOffenderSteamIdForScope(scope) !== steamId3) return null;
      const ticketId = ticket.extractTicketIdFromComplaintScope(scope);
      if (!ticketId) return null;
      if (!requireEditable) return { scope, steamId: steamId3, ticketId };
      const textarea = scope.querySelector?.('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]');
      if (!textarea || textarea.readOnly || textarea.disabled) return null;
      if (ticket.getTicketPunishmentFeedbackContext && ticket.isTicketPunishmentFeedbackContextEditable) {
        const context = ticket.getTicketPunishmentFeedbackContext(textarea, scope);
        if (!context || context.ticketId !== ticketId || context.steamId !== steamId3 || !ticket.isTicketPunishmentFeedbackContextEditable(context)) return null;
      } else if (ticket.getCloseReasonContext && ticket.isCloseReasonContextEditable) {
        const context = ticket.getCloseReasonContext(textarea);
        if (!context || context.scope !== scope || context.steamId !== steamId3 || context.ticketId !== ticketId || !ticket.isCloseReasonContextEditable(context)) return null;
      } else if (!ticket.scopeHasInProgressStatus(scope, { includeActivePanel: false })) {
        return null;
      }
      return { scope, steamId: steamId3, ticketId };
    }
    bindPunishmentConfirmation(dialog) {
      if (!this.isPunishmentConfirmationEnabled() || this.punishmentBindings.has(dialog) || dialog.getAttribute?.("data-state") === "closed") return;
      const form = dialog.querySelector("form");
      if (!form) return;
      const banInput = dialog.querySelector("#ban-steamid64");
      const input = banInput || dialog.querySelector("#mute-steamid64");
      if (!input) return;
      const type = banInput ? "ban" : "mute";
      const ticket = this.ticketService;
      const captured = ticket._closeReasonPunishmentOrigins?.get(dialog) || ticket._closeReasonPunishmentOrigin;
      ticket._closeReasonPunishmentOrigins?.delete(dialog);
      const initialScope = captured?.scope || ticket.getActivePunishmentScope();
      let initialOrigin = this.getPunishmentConfirmationOrigin(
        initialScope,
        captured?.steamId || initialScope && ticket.getOffenderSteamIdForScope(initialScope),
        { requireEditable: false }
      );
      if (captured && (captured.type !== type || captured.ticketId !== initialOrigin?.ticketId)) initialOrigin = null;
      const binding = {
        dialog,
        form,
        input,
        type,
        initialOrigin,
        originIdentity: captured ? { ...captured } : initialOrigin ? { ...initialOrigin, type } : null,
        attemptToken: null,
        errorObserver: null,
        cleanup: null
      };
      const onSubmit = (event) => this.applyPunishmentIntentEvent(binding, event);
      const onClick = (event) => this.applyPunishmentIntentEvent(binding, event);
      const onInvalid = () => this.cancelPunishmentIntent(binding);
      form.addEventListener("submit", onSubmit, true);
      form.addEventListener("invalid", onInvalid, true);
      dialog.addEventListener?.("click", onClick, true);
      binding.cleanup = () => {
        form.removeEventListener("submit", onSubmit, true);
        form.removeEventListener("invalid", onInvalid, true);
        dialog.removeEventListener?.("click", onClick, true);
        binding.errorObserver?.disconnect();
        ticket._closeReasonPunishmentOrigins?.delete(dialog);
      };
      this.punishmentBindings.set(dialog, binding);
    }
    applyPunishmentIntentEvent(binding, event) {
      if (!this.isPunishmentConfirmationEnabled() || !binding.dialog.isConnected || binding.dialog.getAttribute?.("data-state") === "closed") return;
      if (event.type === "click") {
        const element = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
        const button = element?.closest?.("button");
        if (!button || button.disabled || isIohNode(button) || !binding.form.contains(button)) return;
        const label = String(button.textContent || "").replace(/\s+/g, " ").trim();
        if (button.type === "button" && label === "\u041E\u0442\u043C\u0435\u043D\u0430") {
          this.cancelPunishmentIntent(binding);
          return;
        }
        const expected = binding.type === "ban" ? "\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C" : "\u0412\u044B\u0434\u0430\u0442\u044C \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0435";
        if (!["submit", "button"].includes(button.type) || label !== expected) return;
      } else if (event.type !== "submit") {
        return;
      } else if (event.submitter) {
        const expected = binding.type === "ban" ? "\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C" : "\u0412\u044B\u0434\u0430\u0442\u044C \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0435";
        if (event.submitter.disabled || event.submitter.type !== "submit" || !binding.form.contains(event.submitter) || String(event.submitter.textContent || "").replace(/\s+/g, " ").trim() !== expected) return;
      }
      this.recoverPunishmentBindingOrigin(binding);
      if (event.defaultPrevented || !binding.initialOrigin) return;
      const steamId3 = binding.input.value.trim();
      if (!/^\d{17,18}$/.test(steamId3) || binding.input.disabled || binding.form.checkValidity && !binding.form.checkValidity() || binding.dialog.querySelector('[aria-invalid="true"]')) {
        this.cancelPunishmentIntent(binding);
        return;
      }
      const origin = this.getPunishmentConfirmationOrigin(binding.initialOrigin.scope, steamId3);
      if (!origin || origin.steamId !== binding.initialOrigin.steamId || origin.ticketId !== binding.initialOrigin.ticketId) return;
      if (binding.attemptToken) return;
      const attemptToken = {};
      binding.attemptToken = attemptToken;
      this.ticketService.onTicketPunishmentFeedbackIntent?.({ ...origin, type: binding.type, attemptToken });
      this.ticketService.onCloseReasonPunishmentIntent({
        ...origin,
        type: binding.type,
        attemptToken
      });
      const Observer = this.document.defaultView?.MutationObserver || (typeof MutationObserver === "function" ? MutationObserver : null);
      if (Observer && !binding.errorObserver) {
        binding.errorObserver = new Observer((mutations) => {
          if (!binding.attemptToken || !this.isPunishmentConfirmationEnabled() || mutations.every((mutation) => isIohNode(mutation.target))) return;
          const invalid = binding.dialog.querySelector('[aria-invalid="true"]');
          const alerts = binding.dialog.querySelectorAll('[role="alert"]');
          if (invalid || Array.from(alerts).some((alert) => !isIohNode(alert) && alert.getAttribute?.("aria-hidden") !== "true" && alert.textContent.trim())) {
            this.cancelPunishmentIntent(binding);
          }
        });
        binding.errorObserver.observe(binding.dialog, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["aria-invalid", "role", "aria-hidden"]
        });
      }
    }
    recoverPunishmentBindingOrigin(binding) {
      const saved = binding.originIdentity;
      if (!saved || this.document.contains(saved.scope)) return;
      const latest = this.ticketService._closeReasonPunishmentOrigins?.get(binding.dialog);
      if (!latest || latest.type !== binding.type || latest.type !== saved.type || latest.ticketId !== saved.ticketId || latest.steamId !== saved.steamId) return;
      const origin = this.getPunishmentConfirmationOrigin(latest.scope, latest.steamId);
      if (!origin || origin.ticketId !== saved.ticketId) return;
      binding.initialOrigin = origin;
      binding.originIdentity = { ...origin, type: binding.type };
      this.ticketService._closeReasonPunishmentOrigins.delete(binding.dialog);
    }
    cancelPunishmentIntent(binding) {
      if (binding.attemptToken) this.ticketService.cancelTicketPunishmentFeedbackIntent?.(binding.attemptToken);
      if (binding.attemptToken) this.ticketService.cancelCloseReasonPunishmentIntent(binding.attemptToken);
      binding.attemptToken = null;
    }
    stopPunishmentIntentBindings() {
      for (const binding of this.punishmentBindings.values()) {
        this.cancelPunishmentIntent(binding);
        binding.cleanup();
      }
      this.punishmentBindings.clear();
    }
    bindMuteForm(reasonSelect, dialog) {
      if (this.formBindings.has(reasonSelect)) return;
      const steamInput = dialog.querySelector("#mute-steamid64");
      let lastSteamId = steamInput?.value?.trim() || "";
      let manualReason = false;
      let applyingReason = false;
      const applyReason = () => {
        if (!this.enabled || manualReason || !reasonSelect.isConnected || !dialog.isConnected) return;
        applyingReason = true;
        try {
          this.applySuggestedMuteReason(reasonSelect, dialog);
        } finally {
          applyingReason = false;
        }
      };
      const onReasonChange = () => {
        if (!applyingReason) manualReason = true;
      };
      const onDialogClick = (event) => {
        if (this.isSiteRecidivismAction(event.target, dialog)) manualReason = true;
      };
      const onSteamIdChange = () => {
        const steamId3 = steamInput.value.trim();
        if (steamId3 === lastSteamId) return;
        lastSteamId = steamId3;
        manualReason = false;
        applyReason();
      };
      const observer = new MutationObserver((mutations) => {
        if (mutations.every((m) => isIohNode(m.target))) return;
        applyReason();
      });
      observer.observe(dialog, { childList: true, subtree: true });
      dialog.addEventListener("click", onDialogClick, true);
      reasonSelect.addEventListener("change", onReasonChange);
      steamInput?.addEventListener("input", onSteamIdChange);
      steamInput?.addEventListener("change", onSteamIdChange);
      this.formBindings.set(reasonSelect, () => {
        observer.disconnect();
        dialog.removeEventListener("click", onDialogClick, true);
        reasonSelect.removeEventListener("change", onReasonChange);
        steamInput?.removeEventListener("input", onSteamIdChange);
        steamInput?.removeEventListener("change", onSteamIdChange);
      });
      applyReason();
    }
    isSiteRecidivismAction(target, dialog) {
      const element = target?.nodeType === 1 ? target : target?.parentElement;
      const button = element?.closest?.('button[type="button"]');
      if (!button || !dialog.contains(button) || isIohNode(button)) return false;
      const list2 = button.closest("li")?.parentElement;
      if (list2?.tagName !== "UL" || !dialog.contains(list2.parentElement)) return false;
      const heading = list2.parentElement.querySelector(":scope > span");
      return String(heading?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === "\u0440\u0435\u0446\u0438\u0434\u0438\u0432 \u043F\u043E \u0434\u0440\u0443\u0433\u043E\u0439 \u043F\u0440\u0438\u0447\u0438\u043D\u0435";
    }
    applySuggestedMuteReason(reasonSelect, dialog) {
      const steamId3 = this.resolveMuteFormSteamId(dialog);
      const label = this.ticketService?.getSuggestedMuteReason(steamId3);
      if (label && this.setReasonByLabel(reasonSelect, label)) return true;
      return this.setReasonByLabel(reasonSelect, "\u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C");
    }
    resolveMuteFormSteamId(dialog) {
      const fromInput = dialog?.querySelector("#mute-steamid64")?.value?.trim();
      if (fromInput) {
        return fromInput;
      }
      const ticketService = this.ticketService;
      if (!ticketService) {
        return "";
      }
      return ticketService.getOffenderSteamIdForScope(ticketService.getActivePunishmentScope()) || "";
    }
    setReasonByLabel(reasonSelect, reasonLabel2) {
      if (!reasonSelect || !reasonLabel2) {
        return false;
      }
      const normalized = this.normalizePunishmentReason(reasonLabel2);
      if (!normalized) {
        return false;
      }
      const options = Array.from(reasonSelect.options);
      let option = options.find(
        (opt) => this.normalizePunishmentReason(opt.textContent || "") === normalized
      );
      if (!option) {
        option = options.find((opt) => {
          const optNorm = this.normalizePunishmentReason(opt.textContent || "");
          return optNorm.startsWith(normalized) || normalized.startsWith(optNorm);
        });
      }
      if (!option) {
        return false;
      }
      if (reasonSelect.value === option.value) {
        return true;
      }
      return this.setSelectValue(reasonSelect, option.value);
    }
    normalizePunishmentReason(text) {
      return String(text || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
    }
    setSelectValue(select, value) {
      if (select?.tagName !== "SELECT" || value == null || select.value === String(value)) return false;
      const view = this.document.defaultView || window;
      const descriptor = Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, "value");
      if (descriptor?.set) descriptor.set.call(select, String(value));
      else select.value = String(value);
      select.dispatchEvent(new view.Event("input", { bubbles: true }));
      select.dispatchEvent(new view.Event("change", { bubbles: true }));
      return true;
    }
  };

  // modules/DOMCoordinator.js
  var DOMCoordinator = class {
    constructor(app) {
      this.app = app;
      this.document = app.document;
      this.listeners = /* @__PURE__ */ new Map();
      this.pending = /* @__PURE__ */ new Set();
      this.bodyObserver = null;
      this.bodyDebounceId = null;
      this._ticketMountedLeadingFlushed = false;
      this.tablesRowsRafId = null;
      this.pendingHighlightRows = /* @__PURE__ */ new Set();
      this.complaintQueueTableObservers = /* @__PURE__ */ new Map();
      this.ticketPanelVisibilityObserver = null;
      this.ticketPanelVisibilityDebounceId = null;
      this.observedTicketPanelRoots = /* @__PURE__ */ new WeakSet();
    }
    on(event, handler) {
      const list2 = this.listeners.get(event) || [];
      list2.push(handler);
      this.listeners.set(event, list2);
      return () => {
        this.listeners.set(
          event,
          (this.listeners.get(event) || []).filter((item) => item !== handler)
        );
      };
    }
    emit(event) {
      this.pending.add(event);
    }
    notify(event) {
      this.emit(event);
      this.scheduleFlush();
    }
    init() {
      console.log("[Helper] DOMCoordinator: init");
      this.initBodyObserver();
      this.refreshComplaintQueueTableObservers();
      this.refreshComplaintQueueVisibilityObserver();
      this.emit("notification");
      this.emit("currentServerMods");
      this.emit("tableAdded");
      this.flush();
    }
    teardownAll() {
      console.log("[Helper] DOMCoordinator: teardownAll");
      this.teardownBodyObserver();
      this.teardownComplaintQueueTableObservers();
      this.teardownTicketPanelVisibilityObserver();
      if (this.tablesRowsRafId != null) {
        cancelAnimationFrame(this.tablesRowsRafId);
        this.tablesRowsRafId = null;
      }
      this.pendingHighlightRows.clear();
      this.pending.clear();
    }
    teardownBodyObserver() {
      if (this.bodyObserver) {
        this.bodyObserver.disconnect();
        this.bodyObserver = null;
        console.log("[Helper] DOMCoordinator: bodyObserver teardown");
      }
      if (this.bodyDebounceId) {
        clearTimeout(this.bodyDebounceId);
        this.bodyDebounceId = null;
      }
      this._ticketMountedLeadingFlushed = false;
      this.pending.clear();
    }
    teardownComplaintQueueTableObservers() {
      if (this.complaintQueueTableObservers.size) {
        console.log(`[Helper] DOMCoordinator: complaintQueueTableObservers teardown (${this.complaintQueueTableObservers.size})`);
      }
      for (const observer of this.complaintQueueTableObservers.values()) {
        observer.disconnect();
      }
      this.complaintQueueTableObservers.clear();
    }
    isComplaintQueueRow(row) {
      const table = row?.closest?.("table");
      return Boolean(table && this.app.ticketService.isComplaintQueueTable(table));
    }
    handleComplaintQueueTableMutations(mutations) {
      const newRows = /* @__PURE__ */ new Set();
      const updatedRows = /* @__PURE__ */ new Set();
      let structureChanged = false;
      for (const mutation of mutations) {
        if (isIohNode(mutation.target)) {
          continue;
        }
        for (const node of mutation.addedNodes || []) {
          if (!node || node.nodeType !== 1 || isIohNode(node)) {
            continue;
          }
          structureChanged = true;
          if (node.matches?.("tr")) {
            newRows.add(node);
            continue;
          }
          const nestedRows = node.querySelectorAll?.("tr") || [];
          nestedRows.forEach((row2) => newRows.add(row2));
        }
        for (const node of mutation.removedNodes || []) {
          if (!node || node.nodeType !== 1 || isIohNode(node)) {
            continue;
          }
          if (node.matches?.("tr") || node.querySelector?.("tr")) {
            structureChanged = true;
          }
        }
        const target = mutation.target;
        const row = target?.nodeType === 1 ? target.closest?.("tbody tr") : target?.parentElement?.closest?.("tbody tr");
        if (row && !newRows.has(row)) {
          updatedRows.add(row);
        }
      }
      if (newRows.size) {
        newRows.forEach((row) => this.app._applyRowHighlights(row));
        if (this.app.onComplaintQueueRowsAdded) {
          const complaintRows = [...newRows].filter((row) => row.isConnected && this.isComplaintQueueRow(row));
          if (complaintRows.length) this.app.onComplaintQueueRowsAdded(complaintRows);
        }
      }
      if (updatedRows.size) {
        this.scheduleRowHighlights(updatedRows);
      }
      if (structureChanged) {
        this.app.ticketService.pruneOffenderProjectCache();
      }
    }
    observeComplaintQueueTable(table) {
      const tbody = table.querySelector("tbody");
      if (!tbody) {
        return;
      }
      const previous = this.complaintQueueTableObservers.get(table);
      if (previous?.iohTbody === tbody) return;
      previous?.disconnect();
      const observer = new MutationObserver((mutations) => {
        this.handleComplaintQueueTableMutations(mutations);
      });
      observer.observe(tbody, {
        childList: true,
        subtree: true,
        characterData: true
      });
      observer.iohTbody = tbody;
      this.complaintQueueTableObservers.set(table, observer);
      const rows = [...tbody.querySelectorAll("tr")].filter((row) => row.isConnected && !isIohNode(row) && this.isComplaintQueueRow(row));
      if (rows.length) this.app.onComplaintQueueRowsAdded?.(rows);
      console.log("[Helper] DOMCoordinator: complaintQueueTableObserver init");
    }
    refreshComplaintQueueTableObservers() {
      const tables = this.app.ticketService.findComplaintQueueTables();
      const activeTables = new Set(tables);
      for (const [table, observer] of this.complaintQueueTableObservers) {
        if (!this.document.contains(table) || !activeTables.has(table)) {
          observer.disconnect();
          this.complaintQueueTableObservers.delete(table);
        }
      }
      tables.forEach((table) => this.observeComplaintQueueTable(table));
    }
    teardownTicketPanelVisibilityObserver() {
      if (this.ticketPanelVisibilityObserver) {
        this.ticketPanelVisibilityObserver.disconnect();
        this.ticketPanelVisibilityObserver = null;
        console.log("[Helper] DOMCoordinator: ticketPanelVisibilityObserver teardown");
      }
      if (this.ticketPanelVisibilityDebounceId) {
        clearTimeout(this.ticketPanelVisibilityDebounceId);
        this.ticketPanelVisibilityDebounceId = null;
      }
      this.observedTicketPanelRoots = /* @__PURE__ */ new WeakSet();
    }
    scheduleFlush() {
      const leadingTicketFlush = this.pending.has("ticketMounted") && !this._ticketMountedLeadingFlushed;
      if (this.bodyDebounceId) {
        clearTimeout(this.bodyDebounceId);
      }
      if (leadingTicketFlush) {
        this._ticketMountedLeadingFlushed = true;
        this.flush();
      }
      this.bodyDebounceId = setTimeout(() => {
        this.bodyDebounceId = null;
        this._ticketMountedLeadingFlushed = false;
        if (this.pending.size) {
          this.flush();
        }
      }, 150);
    }
    flush() {
      const events = [...this.pending];
      this.pending.clear();
      if (events.length) {
        console.log("[Helper] DOMCoordinator: flush", events.join(", "));
      }
      for (const event of events) {
        for (const handler of this.listeners.get(event) || []) {
          handler();
        }
      }
    }
    initBodyObserver() {
      if (this.bodyObserver) {
        this.bodyObserver.disconnect();
      }
      console.log("[Helper] DOMCoordinator: bodyObserver init");
      this.bodyObserver = new MutationObserver((mutations) => {
        const rowsToUpdate = /* @__PURE__ */ new Set();
        for (const mutation of mutations) {
          if (isIohNode(mutation.target)) {
            continue;
          }
          if (mutation.type === "attributes") {
            this.emit("pageTools");
            if (mutation.attributeName !== "aria-hidden") {
              continue;
            }
            const target = mutation.target;
            if (!target || target.nodeType !== 1) {
              continue;
            }
            if (this.app.ticketService.isExtensionUiElement(target) || isIohNode(target)) {
              continue;
            }
            if (target.getAttribute("aria-hidden") === "true") {
              continue;
            }
            if (this.isCurrentServerNode(target)) {
              this.emit("currentServerMods");
            }
            continue;
          }
          for (const node of mutation.addedNodes || []) {
            if (!node || node.nodeType !== 1 || isIohNode(node)) {
              continue;
            }
            this.inspectAddedNode(node, rowsToUpdate);
          }
          for (const node of mutation.removedNodes || []) {
            if (!node || node.nodeType !== 1 || isIohNode(node)) continue;
            if (this.isPunishmentDialogNode(node)) this.emit("punishmentDialog");
            if (node.matches?.('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]') || node.querySelector?.('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]')) {
              this.emit("ticketMounted");
            }
          }
        }
        if (this.pending.size) {
          this.scheduleFlush();
        }
        if (rowsToUpdate.size) {
          rowsToUpdate.forEach((row) => {
            if (!this.isComplaintQueueRow(row)) {
              this.app._applyRowHighlights(row);
            }
          });
        }
      });
      this.bodyObserver.observe(this.document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-hidden"]
      });
    }
    inspectAddedNode(node, rowsToUpdate) {
      if (node.matches?.("tbody") && this.app.ticketService.isComplaintQueueTable(node.closest("table"))) this.emit("tableAdded");
      if (node.matches?.("main, aside, h3, section") || node.querySelector?.("main, h3")) this.emit("pageTools");
      if (this.isRelevantNotificationNode(node)) {
        this.emit("notification");
      }
      if (this.isRelevantTicketMountNode(node)) {
        this.emit("ticketMounted");
      }
      if (this.isCurrentServerNode(node) || node.matches?.(PLAYER_PROFILE_LINK_SELECTOR) || node.querySelector?.(PLAYER_PROFILE_LINK_SELECTOR)) {
        this.emit("currentServerMods");
      }
      if (node.matches?.("table, tr") || node.querySelector?.("table, tr")) {
        this.emit("tableAdded");
      }
      if (this.isPunishmentDialogNode(node)) {
        this.emit("punishmentDialog");
      }
      if (node.matches?.("tr")) {
        rowsToUpdate.add(node);
      } else {
        const nestedRows = node.querySelectorAll?.("tr") || [];
        nestedRows.forEach((row) => rowsToUpdate.add(row));
      }
      if (node.matches?.('[role="tabpanel"]') || node.querySelector?.('[role="tabpanel"]')) {
        this.emit("ticketMounted");
      }
    }
    isRelevantNotificationNode(node) {
      if (!node || node.nodeType !== 1) {
        return false;
      }
      if (isIohNode(node) || node.closest?.(".ioh-panel")) {
        return false;
      }
      if (node.matches?.("textarea") || node.matches?.('[role="dialog"]')) {
        return true;
      }
      const text = node.textContent || "";
      if (text.includes("\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435")) {
        return true;
      }
      return Boolean(node.querySelector?.('textarea, [role="dialog"]'));
    }
    isExtensionOrHelperNode(node) {
      return isIohNode(node) || this.app.ticketService.isExtensionUiElement(node);
    }
    isRelevantTicketMountNode(node) {
      if (!node || node.nodeType !== 1) {
        return false;
      }
      if (this.isExtensionOrHelperNode(node) || this.isCurrentServerNode(node)) {
        return false;
      }
      if (node.matches?.('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]')) {
        return true;
      }
      if (node.querySelector?.('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]')) {
        return true;
      }
      const headers = node.matches?.("h3") ? [node] : Array.from(node.querySelectorAll?.("h3") || []);
      return headers.some(
        (h) => h.textContent?.includes("\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u0442\u0438\u043A\u0435\u0442\u0430") || h.textContent?.includes("\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u043E\u0431 \u0438\u0433\u0440\u043E\u043A\u0430\u0445")
      );
    }
    isCurrentServerNode(node) {
      if (!node || node.nodeType !== 1) {
        return false;
      }
      if (node.matches?.("h3") && node.textContent?.includes("\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0441\u0435\u0440\u0432\u0435\u0440")) {
        return true;
      }
      if (node.querySelector?.("h3")) {
        return Array.from(node.querySelectorAll("h3")).some((h) => h.textContent?.includes("\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0441\u0435\u0440\u0432\u0435\u0440"));
      }
      return false;
    }
    isPunishmentDialogNode(node) {
      if (!node || node.nodeType !== 1) {
        return false;
      }
      return this.app.punishmentService.isRelevantNode(node);
    }
    scheduleRowHighlights(rows) {
      if (!rows.size) {
        return;
      }
      rows.forEach((row) => this.pendingHighlightRows.add(row));
      if (this.tablesRowsRafId != null) {
        return;
      }
      this.tablesRowsRafId = requestAnimationFrame(() => {
        this.tablesRowsRafId = null;
        const rowsToUpdate = [...this.pendingHighlightRows];
        this.pendingHighlightRows.clear();
        rowsToUpdate.forEach((row) => {
          if (row.isConnected) {
            this.app._applyRowHighlights(row);
          }
        });
      });
    }
    findTicketPanelRoots() {
      const roots = /* @__PURE__ */ new Set();
      const textarea = this.app.ticketService.findVisibleTicketResolutionTextarea();
      const scope = textarea?.closest('section, article, main, [role="main"]');
      if (scope) {
        roots.add(scope);
      }
      this.document.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
        if (panel.closest('section, article, main, [role="main"]')) {
          roots.add(panel);
        }
      });
      this.document.querySelectorAll('[aria-hidden="false"]').forEach((panel) => {
        if (this.isCurrentServerNode(panel) || this.isRelevantTicketMountNode(panel)) {
          roots.add(panel);
        }
      });
      return roots;
    }
    findComplaintQueueVisibilityRoots() {
      const roots = new Set(this.findTicketPanelRoots());
      if (!this.app.messageService._isComplaintQueuePage()) {
        return roots;
      }
      const main = this.document.querySelector("main");
      if (main) {
        roots.add(main);
      }
      this.app.ticketService.findComplaintQueueTables().forEach((table) => {
        const container = table.closest('section, article, [role="main"], [aria-hidden]') || table.parentElement;
        if (container) {
          roots.add(container);
        }
      });
      return roots;
    }
    refreshComplaintQueueVisibilityObserver() {
      const roots = this.findComplaintQueueVisibilityRoots();
      if (!roots.size) {
        return;
      }
      if (!this.ticketPanelVisibilityObserver) {
        console.log("[Helper] DOMCoordinator: ticketPanelVisibilityObserver init");
        this.ticketPanelVisibilityObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type !== "attributes" || mutation.attributeName !== "aria-hidden") {
              continue;
            }
            if (isIohNode(mutation.target) || this.app.ticketService.isExtensionUiElement(mutation.target)) {
              continue;
            }
            if (mutation.target.getAttribute("aria-hidden") === "true") {
              continue;
            }
            this.scheduleTicketTabVisibilityRefresh();
            return;
          }
        });
      }
      for (const root of roots) {
        if (this.observedTicketPanelRoots.has(root)) {
          continue;
        }
        this.observedTicketPanelRoots.add(root);
        this.ticketPanelVisibilityObserver.observe(root, {
          attributes: true,
          attributeFilter: ["aria-hidden"],
          subtree: true
        });
      }
    }
    scheduleTicketTabVisibilityRefresh() {
      if (this.ticketPanelVisibilityDebounceId) {
        clearTimeout(this.ticketPanelVisibilityDebounceId);
      }
      this.ticketPanelVisibilityDebounceId = setTimeout(() => {
        this.ticketPanelVisibilityDebounceId = null;
        this.app.onTicketTabVisibilityChange();
      }, 120);
    }
  };

  // modules/analytics/ProfileLauncher.js
  var ProfileLauncher = class {
    constructor({ document: document2, chrome: chrome2 }) {
      this.document = document2;
      this.chrome = chrome2;
    }
    sync() {
      const root = this.document.querySelector("main");
      if (this.href === location.href && this.root === root) return;
      this.href = location.href;
      this.root = root;
      this.refresh();
    }
    refresh() {
      this.stop();
      if (!/^\/moderator\/profile\/7656119\d{10}$/.test(location.pathname)) return;
      const root = this.document.querySelector("main");
      if (!root) return;
      const render = () => {
        if (!/^\/moderator\/profile\/(7656119\d{10})$/.test(location.pathname)) return;
        const steamId3 = location.pathname.split("/").at(-1);
        const native = [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430" && !b.closest('[aria-hidden="true"]'));
        if (!native) return;
        const existing = native.parentElement.querySelector(".ioh-analytics-launch");
        if (existing) {
          existing.dataset.steamId = steamId3;
          return;
        }
        const button = markIoh(this.document.createElement("button"));
        const peer = [...native.parentElement.querySelectorAll(":scope > button")].find((item) => item !== native && !item.hasAttribute("data-ioh"));
        button.className = (peer?.className || native.className) + " ioh-analytics-launch";
        button.type = "button";
        button.dataset.steamId = steamId3;
        button.setAttribute("aria-label", "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0443 \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u0430 IoHelper \u0432 \u043D\u043E\u0432\u043E\u0439 \u0432\u043A\u043B\u0430\u0434\u043A\u0435");
        button.title = "\u041F\u043E\u0434\u0440\u043E\u0431\u043D\u0430\u044F \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0438 \u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u0435 \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u0432";
        button.innerHTML = '<span class="ioh-analytics-launch__icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16M8 15v-4m5 4V7m5 8v-6"/></svg></span><span class="ioh-analytics-launch__label">\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430 IoHelper</span><svg class="ioh-analytics-launch__arrow" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>';
        button.querySelectorAll("*").forEach(markIoh);
        button.addEventListener("click", () => this.chrome.runtime.sendMessage({ action: "openAnalytics", steamId: button.dataset.steamId }));
        native.parentElement.append(button);
      };
      this.observer = new MutationObserver((mutations) => {
        if (mutations.every((m) => isIohNode(m.target) || [...m.addedNodes, ...m.removedNodes].every(isIohNode))) return;
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => {
          this.raf = null;
          render();
        });
      });
      this.observer.observe(root, { childList: true, subtree: true });
      render();
    }
    stop() {
      this.observer?.disconnect();
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  };

  // modules/AppearanceService.js
  var INTENSITIES = ["soft", "balanced", "clear"];
  var SURFACE_ATTR = "data-ioh-glass-surface";
  var HEADER_ATTR = "data-ioh-glass-header";
  var DENSE_ATTR = "data-ioh-glass-dense";
  function normalizeAppearance(value = {}) {
    return { enabled: value?.enabled === true, intensity: INTENSITIES.includes(value?.intensity) ? value.intensity : "balanced" };
  }
  var AppearanceService = class {
    constructor({ document: document2, chrome: chrome2 }) {
      this.document = document2;
      this.chrome = chrome2;
      this.preference = normalizeAppearance();
      this.generation = 0;
      this.surfaceByHeading = /* @__PURE__ */ new WeakMap();
    }
    sync() {
      const root = this.document.querySelector("main");
      if (this.href === location.href && this.root === root) return;
      this.href = location.href;
      this.root = root;
      this.refresh();
    }
    async start() {
      const generation = ++this.generation;
      const { iohAppearance } = await this.chrome.storage.local.get("iohAppearance");
      if (generation !== this.generation) return;
      this.preference = normalizeAppearance(iohAppearance);
      this.apply();
      this.refresh();
      this.listener = (changes, area) => {
        if (area !== "local" || !changes.iohAppearance) return;
        this.preference = normalizeAppearance(changes.iohAppearance.newValue);
        this.apply();
        this.render();
      };
      this.chrome.storage.onChanged.addListener(this.listener);
    }
    apply() {
      const root = this.document.documentElement;
      root.style.removeProperty("--ioh-glass-base");
      if (this.preference.enabled) root.dataset.iohGlass = this.preference.intensity;
      else {
        delete root.dataset.iohGlass;
        this.clearSurfaces();
      }
    }
    clearSurfaces() {
      this.document.querySelectorAll(`[${SURFACE_ATTR}], [${HEADER_ATTR}], [${DENSE_ATTR}]`).forEach((element) => {
        element.removeAttribute(SURFACE_ATTR);
        element.removeAttribute(HEADER_ATTR);
        element.removeAttribute(DENSE_ATTR);
      });
    }
    refresh() {
      this.observer?.disconnect();
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      const root = this.document.querySelector("main");
      if (!root) return;
      this.observer = new MutationObserver((mutations) => {
        if (mutations.every((m) => isIohNode(m.target) || [...m.addedNodes, ...m.removedNodes].every(isIohNode))) return;
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => {
          this.raf = null;
          this.render();
        });
      });
      this.observer.observe(root, { childList: true, subtree: true });
      this.render();
    }
    findSurface(header, root) {
      const cached = this.surfaceByHeading.get(header);
      if (cached?.isConnected && root.contains(cached) && cached.contains(header)) return cached;
      const view = this.document.defaultView;
      let candidate = header.parentElement;
      let fallback = null;
      for (let depth = 0; candidate && candidate !== root && depth < 7; depth++, candidate = candidate.parentElement) {
        if (["MAIN", "TABLE", "TR", "TD", "TH", "TBODY"].includes(candidate.tagName) || candidate.hasAttribute("aria-hidden")) break;
        if (candidate.closest("[data-ioh]")) break;
        const style = view.getComputedStyle(candidate);
        const painted = style.backgroundColor !== "transparent" && !/rgba\([^)]*,\s*0\s*\)$/.test(style.backgroundColor);
        const rounded = parseFloat(style.borderTopLeftRadius || style.borderRadius) > 0;
        if (painted && candidate.children.length > 1) fallback ||= candidate;
        if (rounded && painted || ["SECTION", "ARTICLE"].includes(candidate.tagName)) {
          this.surfaceByHeading.set(header, candidate);
          return candidate;
        }
      }
      if (fallback) this.surfaceByHeading.set(header, fallback);
      return fallback;
    }
    markSurface(header, root) {
      const card = this.findSurface(header, root);
      if (!card) return;
      card.setAttribute(SURFACE_ATTR, "1");
      let branch = header;
      while (branch.parentElement && branch.parentElement !== card) branch = branch.parentElement;
      if (branch !== header && !branch.querySelector("table, textarea")) branch.setAttribute(HEADER_ATTR, "1");
      if (card.querySelector("table") && card.getBoundingClientRect().height > 1400) card.setAttribute(DENSE_ATTR, "1");
      else card.removeAttribute(DENSE_ATTR);
    }
    render() {
      const root = this.document.querySelector("main");
      if (!root) return;
      const visible = (element) => element.getClientRects().length && !element.closest('[aria-hidden="true"]');
      if (this.preference.enabled) {
        root.querySelectorAll("h3").forEach((header2) => {
          if (visible(header2) && !header2.closest("[data-ioh]")) this.markSurface(header2, root);
        });
      }
      if (location.pathname !== "/settings/appearance") return;
      const header = [...root.querySelectorAll("h3")].find((element) => visible(element) && element.textContent.trim() === "\u0422\u0435\u043C\u0430 \u043E\u0444\u043E\u0440\u043C\u043B\u0435\u043D\u0438\u044F");
      if (!header) return;
      const themeCard = this.findSurface(header, root);
      if (!themeCard?.parentElement) return;
      let section = themeCard.parentElement.querySelector(":scope > .ioh-appearance");
      if (!section) {
        section = markIoh(this.document.createElement("section"));
        section.className = "ioh-appearance";
        section.innerHTML = '<div class="ioh-appearance-sample" aria-hidden="true"><span>Liquid</span><b>Glass</b><i>IO HELPER</i></div><div class="ioh-appearance-content"><h3>Liquid Glass</h3><p>\u041D\u043E\u0432\u044B\u0439 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430: \u043E\u0431\u044A\u0451\u043C\u043D\u044B\u0435 \u043F\u0430\u043D\u0435\u043B\u0438, \u043F\u0440\u043E\u0437\u0440\u0430\u0447\u043D\u043E\u0441\u0442\u044C \u0438 \u043F\u043B\u0430\u0432\u043D\u044B\u0435 \u043F\u0435\u0440\u0435\u0445\u043E\u0434\u044B.</p><div class="ioh-glass-setting"><span>\u042D\u0444\u0444\u0435\u043A\u0442 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430</span><label class="ioh-glass-switch"><input type="checkbox" class="ioh-glass-enabled" aria-label="\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C Liquid Glass"><span aria-hidden="true"></span></label></div><label class="ioh-glass-select">\u041F\u0440\u043E\u0437\u0440\u0430\u0447\u043D\u043E\u0441\u0442\u044C<select><option value="soft">\u041C\u044F\u0433\u043A\u0430\u044F</option><option value="balanced">\u0421\u0431\u0430\u043B\u0430\u043D\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u0430\u044F</option><option value="clear">\u0412\u044B\u0440\u0430\u0437\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F</option></select></label><small>\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442\u0441\u044F \u0432 \u044D\u0442\u043E\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435. \u0423\u0447\u0438\u0442\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0443\u043C\u0435\u043D\u044C\u0448\u0435\u043D\u0438\u0435 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F.</small></div>';
        section.querySelectorAll("*").forEach(markIoh);
        themeCard.insertAdjacentElement("beforebegin", section);
        const save = () => this.chrome.storage.local.set({ iohAppearance: {
          enabled: section.querySelector("input").checked,
          intensity: section.querySelector("select").value
        } });
        section.querySelector("input").addEventListener("change", save);
        section.querySelector("select").addEventListener("change", save);
      }
      section.querySelector("input").checked = this.preference.enabled;
      section.querySelector("select").value = this.preference.intensity;
    }
    stop() {
      this.generation++;
      this.observer?.disconnect();
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      if (this.listener) this.chrome.storage.onChanged.removeListener(this.listener);
    }
  };

  // modules/native/Store.js
  var NativeDataStore = class {
    constructor() {
      this.resources = /* @__PURE__ */ new Map();
      this.tickets = /* @__PURE__ */ new Map();
      this.players = /* @__PURE__ */ new Map();
      this.queues = /* @__PURE__ */ new Map();
      this.histories = /* @__PURE__ */ new Map();
      this.bypasses = /* @__PURE__ */ new Map();
      this.servers = /* @__PURE__ */ new Map();
      this.listeners = /* @__PURE__ */ new Set();
      this.revision = 0;
      this.account = null;
      this.sizes = /* @__PURE__ */ new WeakMap();
    }
    retain(map, key, value, limit, byteLimit = 8 * 1024 * 1024) {
      let budget = this.sizes.get(map);
      if (!budget) {
        budget = { total: 0, keys: /* @__PURE__ */ new Map() };
        this.sizes.set(map, budget);
      }
      const bytes = JSON.stringify(value).length * 2;
      budget.total -= budget.keys.get(key) || 0;
      budget.keys.delete(key);
      map.delete(key);
      budget.keys.set(key, bytes);
      budget.total += bytes;
      map.set(key, value);
      while (map.size > limit || budget.total > byteLimit) {
        const oldest = map.keys().next().value;
        budget.total -= budget.keys.get(oldest) || 0;
        budget.keys.delete(oldest);
        map.delete(oldest);
      }
    }
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    mergePlayer(id, patch, event) {
      if (!id) return;
      const p = this.players.get(id) || { steamId: id, stamps: {}, orders: {} };
      for (const [key, value] of Object.entries(patch)) {
        if (key === "steamId" || value === void 0) continue;
        if ((p.stamps[key] ?? -1) > event.startedAt || p.stamps[key] === event.startedAt && p.orders[key] > event.sequence) continue;
        p[key] = value;
        p.stamps[key] = event.startedAt;
        p.orders[key] = event.sequence;
        if (key === "serverIp") p.presenceAt = event.receivedAt;
      }
      p.updatedAt = event.receivedAt;
      this.retain(this.players, id, p, 1500);
    }
    mergeTicket(p, event) {
      this._queueTicketsCache = null;
      const previous = this.tickets.get(p.key);
      const t = previous || { key: p.key, stamps: {}, orders: {} };
      for (const [key, value] of Object.entries(p)) {
        if (value === void 0 || (t.stamps[key] ?? -1) > event.startedAt || t.stamps[key] === event.startedAt && t.orders[key] > event.sequence) continue;
        t[key] = value;
        t.stamps[key] = event.startedAt;
        t.orders[key] = event.sequence;
      }
      t.updatedAt = Math.max(t.updatedAt || 0, event.receivedAt);
      this.retain(this.tickets, p.key, t, 500, 4 * 1024 * 1024);
      const profile = {};
      if (Object.hasOwn(p, "playtime")) profile.playtime = p.playtime;
      if (p.suspectCountry) profile.country = p.suspectCountry;
      this.mergePlayer(p.suspectId, profile, event);
      if (p.senderCountry) this.mergePlayer(p.senderId, { country: p.senderCountry }, event);
      if (p.presence) this.mergePlayer(p.suspectId, p.presence, event);
    }
    apply(event) {
      if (event?.version !== 1 || !Number.isFinite(event.startedAt) || !Number.isFinite(event.receivedAt) || !Number.isSafeInteger(event.sequence) || event.sequence < 0 || typeof event.key !== "string") return false;
      const p = event.payload;
      const retained = event.kind === "history" ? this.history(p?.steamId, p?.resource) : event.kind === "queue" ? this.queues.get(event.key) : event.kind === "bypass" ? this.bypasses.get(p?.steamId) : event.kind === "account" ? this.accountStamp : event.kind === "servers" ? this.serverStamp : null;
      const previous = this.resources.get(event.key) || retained;
      if (previous && (previous.startedAt > event.startedAt || previous.startedAt === event.startedAt && previous.sequence >= event.sequence)) return false;
      if (!p || !["queue", "ticket", "player", "history", "account", "bypass", "servers", "serverPlayers", "action", "resourceError"].includes(event.kind)) return false;
      if (JSON.stringify(event).length > 1024 * 1024) return false;
      this.retain(this.resources, event.key, event, 160);
      if (event.kind === "queue") {
        this._queueTicketsCache = null;
        this.queues.set(event.key, { entity: p.entity, keys: p.items.map((x) => x.key), startedAt: event.startedAt, sequence: event.sequence });
        while (this.queues.size > 32) this.queues.delete(this.queues.keys().next().value);
        p.items.forEach((t) => this.mergeTicket(t, event));
      } else if (event.kind === "ticket") this.mergeTicket(p, event);
      else if (event.kind === "player") this.mergePlayer(p.steamId, p, event);
      else if (event.kind === "history") {
        const key = p.steamId + ":" + p.resource;
        this.retain(this.histories, key, { ...p, revision: this.revision + 1, startedAt: event.startedAt, sequence: event.sequence, receivedAt: event.receivedAt }, 240);
        if (p.resource === "bans" || p.resource === "mutes") this.mergePlayer(p.steamId, { [p.resource]: p.items, [p.resource === "bans" ? "isBanned" : "isMuted"]: p.items.some((x) => punishmentActive(x)) }, event);
      } else if (event.kind === "account") {
        this.account = p;
        this.accountStamp = { startedAt: event.startedAt, sequence: event.sequence };
      } else if (event.kind === "bypass") {
        this.bypasses.delete(p.steamId);
        this.bypasses.set(p.steamId, { ...p, startedAt: event.startedAt, sequence: event.sequence });
        while (this.bypasses.size > 500) this.bypasses.delete(this.bypasses.keys().next().value);
      } else if (event.kind === "servers") {
        this.servers = new Map(p.map((x) => [x.endpoint, x.label]));
        this.serverStamp = { startedAt: event.startedAt, sequence: event.sequence };
      } else if (event.kind === "serverPlayers") {
        for (const x of p.players) {
          const patch = {};
          if (x.isModerator !== void 0) patch.isModerator = x.isModerator;
          if (p.endpoint) patch.serverIp = p.endpoint;
          this.mergePlayer(x.steamId, patch, event);
        }
      }
      this.revision++;
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("[IoHelper] Native data consumer failed", error?.message || "unknown");
        }
      }
      return true;
    }
    player(id) {
      return this.players.get(id) || null;
    }
    resourceState(key) {
      const event = this.resources.get(key);
      return !event ? "unknown" : event.kind === "resourceError" ? "error" : "ready";
    }
    history(id, kind) {
      return this.histories.get(id + ":" + kind) || null;
    }
    active(id, kind) {
      const p = this.player(id), rows = p?.[kind];
      const key = kind === "bans" ? "isBanned" : "isMuted";
      if (p && (p.stamps[key] > p.stamps[kind] || p.stamps[key] === p.stamps[kind] && p.orders[key] > p.orders[kind])) return null;
      return rows?.find((x) => punishmentActive(x)) || null;
    }
    queueTickets() {
      if (this._queueTicketsCache) return this._queueTicketsCache;
      const keys = new Set([...this.queues.values()].flatMap((q) => q.keys));
      this._queueTicketsCache = [...keys].map((k) => this.tickets.get(k)).filter(Boolean);
      return this._queueTicketsCache;
    }
    clear() {
      this._queueTicketsCache = null;
      for (const map of [this.resources, this.tickets, this.players, this.queues, this.histories, this.bypasses, this.servers]) map.clear();
      this.account = null;
      this.accountStamp = null;
      this.serverStamp = null;
      this.revision++;
      this.sizes = /* @__PURE__ */ new WeakMap();
    }
  };

  // modules/App.js
  var App = class {
    constructor({ window: window2, document: document2, chrome: chrome2, config, settingsOverrides = {} }) {
      this.window = window2;
      this.document = document2;
      this.chrome = chrome2;
      this.nativeData = window2.__iohNativeData?.store || new NativeDataStore();
      this.rules = config.muteRules || [];
      this.spamRules = config.spamRules || {};
      this.muteExceptions = config.muteExceptions || {};
      this.templates = config.templates || {};
      this.baseSettings = structuredClone(config.settings);
      this.settingsOverrides = settingsOverrides;
      this.configRevision = config.iohRevision || "";
      this.settings = mergeSettings(this.baseSettings, settingsOverrides);
      this.features = this.settings.features;
      this.reasonTriggers = this.settings.reasonTriggers;
      this.reasonTriggersAutoconnect = this.settings.reasonTriggersAutoconnect;
      this.ipTrackTimeoutId = null;
      this._offenderTrackingPassPromise = null;
      this._offenderTrackingGeneration = 0;
      this._offenderTrackingRestartRequested = false;
      this._offenderTrackingFullPassRequested = false;
      this.ticketChatHistoryObservers = /* @__PURE__ */ new Map();
      this.visibilityCatchUpInstalled = false;
      this.visibilityCatchUpDebounceId = null;
      this.navigationWatcherInstalled = false;
      this._lastHref = this.window?.location?.href || "";
      this._lastTicketSectionPath = "";
      this._lastVisibleTicketTextarea = null;
      this._lastAutoConnectTicketKey = null;
      this._wasOnComplaintDetail = this.isComplaintDetailPage();
      this._offenderTrackingHref = this._lastHref;
      this._offenderTrackingTextarea = null;
      this.utils = new Utils({ document: document2 });
      this.profileLauncher = new ProfileLauncher({ document: document2, chrome: chrome2 });
      this.appearanceService = new AppearanceService({ document: document2, chrome: chrome2 });
      this.badgeService = new BadgeService({ document: document2 });
      this.panelService = new PanelService({ document: document2 });
      this.messageService = new MessageService({
        document: document2,
        utils: this.utils,
        badgeService: this.badgeService,
        settings: this.settings
      });
      this.ticketService = new TicketService({
        document: document2,
        utils: this.utils,
        badgeService: this.badgeService,
        settings: this.settings,
        rules: this.rules,
        spamRules: this.spamRules,
        muteExceptions: this.muteExceptions,
        nativeData: this.nativeData,
        chrome: chrome2
      });
      this.ticketService.setNativeModerators(config.moderators);
      this.ticketService.syncNativePermissions();
      this.serverConnectionMemory = new ServerConnectionMemory({ document: document2, chrome: chrome2 });
      this.ticketService.serverConnectionMemory = this.serverConnectionMemory;
      this.moderatorService = {
        highlightSavedModerators: () => {
          void this.withModeratorService((service) => service.highlightSavedModerators());
        },
        scanSchedulePage: () => {
          void this.withModeratorService((service) => service.scanSchedulePage());
        }
      };
      this.punishmentService = new PunishmentService({
        document: document2,
        ticketService: this.ticketService
      });
      this.domCoordinator = new DOMCoordinator(this);
      this.messageService.ticketService = this.ticketService;
      this.bindCoordinatorEvents();
    }
    bindCoordinatorEvents() {
      this.domCoordinator.on("pageTools", () => {
        this.profileLauncher?.sync();
        this.appearanceService?.sync();
      });
      this.domCoordinator.on("notification", () => this.initNotificationPanels());
      this.domCoordinator.on("ticketMounted", () => {
        this.initTicketSectionFeatures();
        this.domCoordinator.refreshComplaintQueueVisibilityObserver();
        if (this.features.highlightNewAccounts || this.features.highlightComplaintTriggers || this.features.highlightHighHs) {
          this._reapplyTicketRowHighlights();
        }
      });
      this.domCoordinator.on("currentServerMods", () => {
        this.moderatorService.highlightSavedModerators();
      });
      this.domCoordinator.on("tableAdded", () => {
        this.initTableFeatures();
        this.domCoordinator.refreshComplaintQueueTableObservers();
        this._reapplyTicketRowHighlights();
      });
      this.domCoordinator.on("punishmentDialog", () => {
        this.punishmentService.scheduleScan();
        if (this.pendingConfiguration && !this.ticketService.isSitePunishmentDialogOpen()) {
          const pending = this.pendingConfiguration;
          this.pendingConfiguration = null;
          this.applyConfiguration(pending.config, pending.revision);
        }
      });
      this.domCoordinator.on("chatChanged", () => {
        if (this.features.translateText) {
          this.messageService.processChatMessages();
        }
      });
    }
    async loadModeratorService() {
      if (this._moderatorService) {
        return this._moderatorService;
      }
      if (!this._moderatorServicePromise) {
        this._moderatorServicePromise = import(chrome.runtime.getURL("dist/chunks/moderator.js")).then(({ ModeratorService }) => {
          this._moderatorService = new ModeratorService({
            document: this.document,
            chrome: this.chrome,
            isEnabled: () => Boolean(this.features.scanSchedulePage)
          });
          this._moderatorService.participantService = this.ticketService;
          this.moderatorService = this._moderatorService;
          return this._moderatorService;
        });
      }
      return this._moderatorServicePromise;
    }
    async withModeratorService(fn) {
      const service = await this.loadModeratorService();
      return fn(service);
    }
    handleNativeDataEvent(event) {
      this.ticketService.consumeNativeEvent(event);
      if (event.source === "tracker" && event.kind === "player") {
        const textarea = this.ticketService.findVisibleTicketResolutionTextarea();
        const scope = textarea && this.ticketService.getTicketScopeRoot(textarea);
        const ticket = scope && this.ticketService.getNativeTicket(scope);
        if (ticket?.suspectId === event.payload.steamId) {
          this.maybeAutoConnectOnTicketMount();
          this.ticketService.refreshComplaintPunishmentButtons();
          if (this.features.showFaceitElo) void this.ticketService.renderFaceitElo();
          if (this.features.showCybershokePlaytime || this.features.showOffenderCountry) void this.ticketService.renderOffenderProjectInfo({ force: true });
          if (this.features.processTicketRules) this.ensureTicketChatHistoryObserver(textarea);
        }
        return;
      }
      this.maybeAutoConnectOnTicketMount();
      this.ticketService.refreshComplaintPunishmentButtons();
      if (this.features.showFaceitElo) void this.ticketService.renderFaceitElo();
      if (this.features.showCybershokePlaytime || this.features.showOffenderCountry) void this.ticketService.renderOffenderProjectInfo({ force: true });
      this._reapplyTicketRowHighlights();
      this.document.querySelectorAll('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]').forEach((textarea) => {
        if (this.features.processTicketRules && this.ticketService.isVisibleTicketTextarea(textarea)) this.ensureTicketChatHistoryObserver(textarea);
      });
      if (this.features.translateText) this.messageService.processChatMessages();
    }
    async start() {
      let pageClosed = false;
      this._nativeUnsubscribe = this.nativeData.subscribe((event) => this.handleNativeDataEvent(event));
      this.window.addEventListener("pagehide", (event) => {
        if (event.persisted) return;
        pageClosed = true;
        this._trackingStopped = true;
        this.ticketService._pageClosed = true;
        this.ticketService.stopQueueChatTracking();
        this.ticketService._offenderTrackingArrivals?.clear();
        this.ticketService._offenderTicketChecks?.clear();
        this._nativeUnsubscribe?.();
        this.ticketService.stopOpenTicketOffenderTracking();
        this.ticketService.cancelTriggerNavigation();
        this._offenderTrackingGeneration++;
        this._offenderTrackingFullPassRequested = false;
        clearTimeout(this.ipTrackTimeoutId);
        this.ipTrackTimeoutId = null;
        this.teardownTicketChatHistoryObservers();
        this.serverConnectionMemory.stop();
        this.ticketService.stopCloseReasonSelection();
        this.ticketService.stopTicketPunishmentFeedback();
        this.punishmentService.teardown();
      });
      this.window.addEventListener("pageshow", (event) => {
        if (event.persisted) void this.serverConnectionMemory.refresh();
      });
      await this.serverConnectionMemory.start();
      if (pageClosed) return;
      fetch(chrome.runtime.getURL("icons/icons.json")).then((r) => r.json()).then((data) => {
        window.Icons = data;
        this.runDOMUpdates();
        this.moderatorService.highlightSavedModerators();
      });
      this.chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        if (changes.helperSettings) this.settingsOverrides = changes.helperSettings.newValue || {};
        if (changes.helperConfig && ConfigService.isValid(changes.helperConfig.newValue)) {
          this.applyConfiguration(changes.helperConfig.newValue, changes.helperConfigMeta?.newValue?.revision || "");
        } else if (changes.helperSettings) this.updateSettings(this.settingsOverrides);
        if (changes.helperConfig || changes.helperScheduleModerators) this.moderatorService.highlightSavedModerators();
      });
      this.initNavigationWatcher();
      this.profileLauncher.refresh();
      void this.appearanceService.start();
      this.window.addEventListener("pagehide", () => {
        this.profileLauncher.stop();
        this.appearanceService.stop();
      }, { once: true });
      this.domCoordinator.init();
      this.initPunishmentFormObserver();
      this.ticketService.initMuteIssueFeature();
      this.initVisibilityCatchUpListener();
      this.handleTrackOffenderLoop();
      void this.chrome.runtime.sendMessage({ action: "iohClientReady" }).catch(() => {
      });
      void this.chrome.runtime.sendMessage({ action: "configApplied", revision: this.configRevision }).catch(() => {
      });
    }
    applyConfiguration(config, revision) {
      if (this.ticketService.isSitePunishmentDialogOpen()) {
        this.pendingConfiguration = { config, revision };
        if (this.settingsOverrides) this.updateSettings(this.settingsOverrides);
        return;
      }
      if (JSON.stringify(this.rules) !== JSON.stringify(config.muteRules) || JSON.stringify(this.muteExceptions) !== JSON.stringify(config.muteExceptions || {})) {
        this.rules = config.muteRules;
        this.muteExceptions = config.muteExceptions || {};
        this.ticketService.resetChatAnalysisCache();
      }
      if (JSON.stringify(this.spamRules) !== JSON.stringify(config.spamRules || {})) this.ticketService.resetChatAnalysisCache();
      this.spamRules = config.spamRules || {};
      this.ticketService.spamRules = this.spamRules;
      if (JSON.stringify(this.templates) !== JSON.stringify(config.templates || {})) {
        this.templates = config.templates || {};
        this.document.querySelectorAll("#mod-ticket-panel[data-ioh], #mod-notif-panel[data-ioh]").forEach((e) => e.remove());
      }
      this.baseSettings = structuredClone(config.settings);
      this.configRevision = revision;
      this.updateSettings(this.settingsOverrides || {});
      void this.chrome.runtime.sendMessage({ action: "configApplied", revision }).catch(() => {
      });
    }
    updateSettings(settings) {
      const previousSettings = structuredClone(this.settings);
      const nextSettings = mergeSettings(this.baseSettings || this.settings, settings);
      const previousFeatures = previousSettings?.features || {};
      const newAccountHoursChanged = previousSettings?.newAccountHours !== nextSettings.newAccountHours;
      const newAccountsReenabled = !previousFeatures.highlightNewAccounts && nextSettings.features.highlightNewAccounts;
      this.settings = nextSettings;
      this.features = this.settings.features;
      this.reasonTriggers = this.settings.reasonTriggers;
      this.reasonTriggersAutoconnect = this.settings.reasonTriggersAutoconnect;
      this.messageService.settings = this.settings;
      this.ticketService.settings = this.settings;
      if (this.ticketService.rules !== this.rules || this.ticketService.muteExceptions !== this.muteExceptions) {
        this.ticketService.setRuleInputs(this.rules, this.muteExceptions);
      }
      if (!previousSettings.features?.autoConnectServer && this.settings.features.autoConnectServer) {
        this._lastAutoConnectTicketKey = null;
        this.maybeAutoConnectOnTicketMount();
      }
      this.cleanupChangedSettings(previousSettings, this.settings);
      if (this.features.highlightNewAccounts && (newAccountHoursChanged || newAccountsReenabled)) {
        this.messageService.reapplyNewAccountHighlights();
      }
      if (!this.features.processTicketRules) {
        this.teardownTicketChatHistoryObservers();
        this.ticketService.teardownTicketPunishmentButtons();
      }
      this.initPunishmentFormObserver();
      this.runDOMUpdates();
      this.domCoordinator.init();
      this.handleTrackOffenderLoop(previousSettings);
    }
    handleTrackOffenderLoop(previousSettings = null) {
      this.ticketService.syncOpenTicketOffenderTracking();
      const isEnabled = this.features.trackOffenderServer;
      const currentInterval = this.settings.trackOffenderInterval || 5;
      const currentReviewInterval = this.settings.trackOffenderIntervalWhileReviewing || 30;
      const prevInterval = previousSettings?.trackOffenderInterval;
      const prevReviewInterval = previousSettings?.trackOffenderIntervalWhileReviewing;
      const intervalChanged = prevInterval !== void 0 && prevInterval !== currentInterval;
      const reviewIntervalChanged = prevReviewInterval !== void 0 && prevReviewInterval !== currentReviewInterval;
      if (!isEnabled || intervalChanged || reviewIntervalChanged) {
        if (!isEnabled) this.ticketService._offenderTrackingArrivals?.clear();
        this.restartOffenderTracking();
        return;
      }
      if (this.ipTrackTimeoutId == null && !this._offenderTrackingPassPromise) {
        void this.runOffenderTrackingPass();
      }
    }
    restartOffenderTracking({ immediate = true } = {}) {
      this.ticketService.stopQueueChatTracking({ preserveCache: Boolean(this.features.trackOffenderServer) });
      this._offenderTrackingGeneration++;
      this._offenderTrackingFullPassRequested = false;
      if (this.ipTrackTimeoutId != null) {
        clearTimeout(this.ipTrackTimeoutId);
        this.ipTrackTimeoutId = null;
      }
      this._offenderTrackingRestartRequested = Boolean(this.features.trackOffenderServer && immediate);
      if (this._offenderTrackingPassPromise || !this.features.trackOffenderServer) {
        return;
      }
      if (immediate) {
        void this.runOffenderTrackingPass();
      } else {
        this.scheduleNextOffenderInterval();
      }
    }
    onComplaintQueueRowsAdded(rows = []) {
      if (this._trackingStopped || !this.features.trackOffenderServer) return;
      this.ticketService.renderNativeQueue();
      this.ticketService.queueOffenderTrackingRows(rows);
      if (this._offenderTrackingPassPromise) {
        return;
      }
      void this.runOffenderTrackingPass({ arrivalsOnly: true });
    }
    isComplaintQueuePage() {
      const path = this.window.location.pathname || "";
      return /\/support\/(tickets|reports)\b/i.test(path);
    }
    isComplaintDetailPage() {
      const path = this.window.location.pathname || "";
      if (/\/support\/(tickets|reports)\b/i.test(path)) {
        return false;
      }
      return /\/ticket\/|\/reports?\//i.test(path);
    }
    isReviewingComplaint() {
      return this.isComplaintDetailPage();
    }
    getOffenderTrackIntervalSec() {
      const reviewing = this.isComplaintDetailPage();
      const n = Number(reviewing ? this.settings.trackOffenderIntervalWhileReviewing : this.settings.trackOffenderInterval);
      return Number.isFinite(n) && n > 0 ? Math.max(1, n) : reviewing ? 30 : 5;
    }
    syncOffenderTrackingForPage() {
      this.ticketService.syncOpenTicketOffenderTracking();
      const next = this.isComplaintDetailPage();
      const href = this.window.location.href;
      const textarea = next ? this.ticketService.findVisibleTicketResolutionTextarea() : null;
      if (this._wasOnComplaintDetail === next && this._offenderTrackingHref === href && this._offenderTrackingTextarea === textarea) {
        return;
      }
      this._wasOnComplaintDetail = next;
      this._offenderTrackingHref = href;
      this._offenderTrackingTextarea = textarea;
      this.restartOffenderTracking({ immediate: true });
    }
    runOffenderTrackingPass({ arrivalsOnly = false } = {}) {
      if (this._trackingStopped) return Promise.resolve();
      if (this._offenderTrackingPassPromise) {
        return this._offenderTrackingPassPromise;
      }
      if (!this.features.trackOffenderServer) {
        return Promise.resolve();
      }
      if (!arrivalsOnly && this.ipTrackTimeoutId != null) {
        clearTimeout(this.ipTrackTimeoutId);
        this.ipTrackTimeoutId = null;
      }
      this._offenderTrackingRestartRequested = false;
      if (!arrivalsOnly) this._offenderTrackingFullPassRequested = false;
      const generation = this._offenderTrackingGeneration;
      const href = this.window.location.href;
      const isCurrent = () => this.features.trackOffenderServer && !this.document.hidden && generation === this._offenderTrackingGeneration && this.window.location.href === href;
      const pass = Promise.resolve().then(async () => {
        if (!isCurrent()) {
          return;
        }
        const cacheIntervalMs = this.getOffenderTrackIntervalSec() * 1e3;
        if (!arrivalsOnly && this.isComplaintDetailPage()) {
          const ticket = this.ticketService.getNativeTicket?.(this.ticketService.getAutoConnectScope?.());
          if (ticket && !this.ticketService.getCachedUserData(ticket.suspectId, cacheIntervalMs)) {
            await this.ticketService.fetchParsedUserData(ticket.suspectId).catch(() => {
            });
          }
          if (isCurrent()) await this.ticketService.trackOpenTicketOffenderServer(cacheIntervalMs, { isCurrent });
        }
        if (isCurrent()) {
          await this.ticketService.checkOffendersServers(cacheIntervalMs, {
            isCurrent,
            arrivalsOnly,
            acceptArrivals: () => !arrivalsOnly || !this._offenderTrackingFullPassRequested
          });
        }
      }).catch((err) => {
        console.error(err);
      }).finally(() => {
        this._offenderTrackingPassPromise = null;
        const restart = this._offenderTrackingRestartRequested;
        this._offenderTrackingRestartRequested = false;
        if ((restart || this._offenderTrackingFullPassRequested) && this.features.trackOffenderServer) {
          void this.runOffenderTrackingPass();
        } else {
          this.scheduleNextOffenderInterval();
          if (isCurrent() && this.ticketService.hasPendingOffenderTrackingRows?.()) {
            void this.runOffenderTrackingPass({ arrivalsOnly: true });
          }
        }
      });
      this._offenderTrackingPassPromise = pass;
      return pass;
    }
    scheduleNextOffenderInterval() {
      if (this._trackingStopped) return;
      if (!this.features.trackOffenderServer || this._offenderTrackingPassPromise || this.ipTrackTimeoutId != null) {
        return;
      }
      const intervalMs = this.getOffenderTrackIntervalSec() * 1e3;
      this.ipTrackTimeoutId = setTimeout(async () => {
        this.ipTrackTimeoutId = null;
        this._offenderTrackingFullPassRequested = true;
        await this.runOffenderTrackingPass();
      }, intervalMs);
    }
    cleanupChangedSettings(previousSettings, nextSettings) {
      const previousFeatures = previousSettings?.features || {};
      const nextFeatures = nextSettings.features;
      const triggersChanged = JSON.stringify(previousSettings?.reasonTriggers || []) !== JSON.stringify(nextSettings.reasonTriggers);
      const newAccountHoursChanged = previousSettings?.newAccountHours !== nextSettings.newAccountHours;
      if (!nextFeatures.scanSchedulePage) this._moderatorService?.cancelScan();
      if (!nextFeatures.highlightComplaintTriggers || triggersChanged) {
        this.messageService.clearComplaintTriggerHighlights();
      }
      if (!nextFeatures.highlightNewAccounts || newAccountHoursChanged) {
        this.messageService.clearNewAccountHighlights();
      }
      if (!nextFeatures.highlightHighHs) {
        this.messageService.clearHighHsHighlights();
      }
      if (!nextFeatures.highlightDuplicateServers && previousFeatures.highlightDuplicateServers !== false) {
        this.messageService.clearDuplicateServerHighlights();
      }
      if (!nextFeatures.processTicketRules && previousFeatures.processTicketRules !== false) {
        this.ticketService.clearTicketRuleBadge();
        this.ticketService.clearSuggestedMuteReason();
        this.ticketService.teardownTicketPunishmentButtons();
      }
      if (!nextFeatures.translateText && previousFeatures.translateText !== false) {
        this.messageService.clearTranslationDecorations();
      }
      if (!nextFeatures.trackOffenderServer && previousFeatures.trackOffenderServer || !nextFeatures.showOffenderVipBadge && previousFeatures.showOffenderVipBadge !== false) {
        this.ticketService.clearOffenderVipBadges();
      }
      if (!nextFeatures.trackOffenderServer && previousFeatures.trackOffenderServer) {
        this.ticketService.clearOffenderProfileVerification();
        this.ticketService.clearOffenderModeratorHighlights();
      }
      const vipStatusesChanged = JSON.stringify(previousSettings?.offenderVipStatuses || []) !== JSON.stringify(nextSettings.offenderVipStatuses || []);
      const vipBadgeReenabled = !previousFeatures.showOffenderVipBadge && nextFeatures.showOffenderVipBadge !== false;
      if (nextFeatures.trackOffenderServer && nextFeatures.showOffenderVipBadge !== false && (vipStatusesChanged || vipBadgeReenabled)) {
        this.ticketService.refreshOffenderVipBadges();
      }
      if (!previousFeatures.trackOffenderServer && nextFeatures.trackOffenderServer) {
        this.ticketService.refreshOffenderProfileVerification();
      }
    }
    runDOMUpdates() {
      this.ticketService.syncNativeTicketViews();
      this.initPageSpecificFeatures();
      this.initTicketSectionFeatures();
      this.initTableFeatures();
    }
    initPageSpecificFeatures() {
      if (this.features.scanSchedulePage) {
        this.moderatorService.scanSchedulePage();
      }
    }
    initTicketSectionFeatures() {
      this.initNotificationPanels();
      this.ticketService.syncCloseReasonSelection();
      this.ticketService.syncTicketPunishmentFeedback();
      const ticketPath = window.location.pathname || window.location.href;
      if (this._lastTicketSectionPath !== ticketPath) {
        this._lastTicketSectionPath = ticketPath;
        this.ticketService.resetChatAnalysisCache(null, { preserveCompleted: true });
      }
      const textareas = this.document.querySelectorAll("textarea");
      textareas.forEach((textarea) => {
        if (this.isTicketResolutionTextarea(textarea)) {
          if (!this.document.getElementById("mod-ticket-panel") && typeof this.templates.ticket !== "undefined") {
            textarea.parentNode.insertBefore(this.panelService.createPanel(this.templates.ticket, textarea, "mod-ticket-panel"), textarea);
          }
          if (this.features.processTicketRules) {
            this.ensureTicketChatHistoryObserver(textarea);
          }
        }
      });
      this.maybeAutoConnectOnTicketMount();
      if (this.features.showSteamAccountCreationDate) {
        this.ticketService.renderSteamAccountCreationDate();
      } else {
        this.ticketService.clearSteamAccountCreationDate();
      }
      if (this.features.showFaceitElo) {
        this.ticketService.renderFaceitElo();
      } else {
        this.ticketService.clearFaceitElo();
      }
      if (this.features.showCybershokePlaytime || this.features.showOffenderCountry) {
        this.ticketService.renderOffenderProjectInfo();
      } else {
        this.ticketService.clearCybershokePlaytime();
        this.ticketService.clearOffenderCountry();
      }
      this.ticketService.refreshComplaintPunishmentButtons();
      this.syncOffenderTrackingForPage();
    }
    maybeAutoConnectOnTicketMount() {
      if (!this.features.autoConnectServer) {
        return;
      }
      if (this.nativeData) {
        const ticket = this.ticketService.getNativeTicket(this.ticketService.getAutoConnectScope());
        if (!ticket || !this.ticketService.nativePlayer(ticket.suspectId)?.serverIp) return;
        if (!this.ticketService.scopeHasInProgressStatus(this.ticketService.getAutoConnectScope())) return;
      }
      const key = this.ticketService.getAutoConnectTicketKey();
      if (!key) {
        return;
      }
      if (this._lastAutoConnectTicketKey === key) {
        return;
      }
      if (this.nativeData) {
        const ticket = this.ticketService.getNativeTicket(this.ticketService.getAutoConnectScope());
        const endpoint2 = this.ticketService.nativePlayer(ticket.suspectId).serverIp;
        if (this.ticketService.isAlreadyOnRequestedServer(endpoint2)) {
          this._lastAutoConnectTicketKey = key;
          return;
        }
      }
      console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435: mount \u0442\u0438\u043A\u0435\u0442\u0430", key);
      const connected = this.ticketService.connectToCurrentServer();
      if (!this.nativeData || connected) this._lastAutoConnectTicketKey = key;
    }
    initVisibilityCatchUpListener() {
      if (this.visibilityCatchUpInstalled) {
        return;
      }
      this.visibilityCatchUpInstalled = true;
      const scheduleCatchUp = () => {
        if (this.document.visibilityState === "hidden") {
          return;
        }
        if (this.visibilityCatchUpDebounceId) {
          clearTimeout(this.visibilityCatchUpDebounceId);
        }
        this.visibilityCatchUpDebounceId = setTimeout(() => {
          this.visibilityCatchUpDebounceId = null;
          this._handlePageReturnCatchUp();
        }, 80);
      };
      this.document.addEventListener("visibilitychange", scheduleCatchUp);
      this.window.addEventListener("focus", scheduleCatchUp);
      this.window.addEventListener("pageshow", scheduleCatchUp);
    }
    _handlePageReturnCatchUp() {
      this.ticketService.syncOpenTicketOffenderTracking();
      if (this.features.highlightHighHs) {
        this._getHighlightTargetRows().forEach((row) => this.messageService.highlightHighHs(row));
      }
      if (this.features.highlightComplaintTriggers) {
        this._getHighlightTargetRows().forEach((row) => this.messageService.highlightComplaintTriggers(row));
      }
      if (this.features.highlightNewAccounts) {
        if (this.messageService._isComplaintQueuePage()) {
          this.messageService.syncNewAccountHighlights();
        } else {
          this._getHighlightTargetRows().forEach((row) => this.messageService.highlightNewAccounts(row));
        }
      }
    }
    initNotificationPanels() {
      if (typeof this.templates.notification === "undefined") return;
      const textareas = this.document.querySelectorAll("textarea");
      textareas.forEach((textarea) => {
        if (!this.isNotificationTextarea(textarea)) return;
        this.hideSiteNotificationTemplates(textarea);
        const existingPanel = this.findNotificationPanelNear(textarea);
        if (existingPanel) {
          if (existingPanel.previousElementSibling !== textarea) {
            const siteTemplates2 = this.findSiteNotificationTemplatesContainer(textarea);
            if (siteTemplates2) {
              siteTemplates2.insertAdjacentElement("beforebegin", existingPanel);
            } else {
              textarea.insertAdjacentElement("afterend", existingPanel);
            }
          }
          return;
        }
        const panel = this.panelService.createPanel(
          this.templates.notification,
          textarea,
          "mod-notif-panel"
        );
        const siteTemplates = this.findSiteNotificationTemplatesContainer(textarea);
        if (siteTemplates) {
          siteTemplates.insertAdjacentElement("beforebegin", panel);
        } else {
          textarea.insertAdjacentElement("afterend", panel);
        }
      });
    }
    findNotificationPanelNear(textarea) {
      const dialog = textarea.closest('[role="dialog"]') || textarea.parentElement;
      if (!dialog) {
        return null;
      }
      return dialog.querySelector("#mod-notif-panel");
    }
    getSiteNotificationChipLabels() {
      return [
        "\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435",
        "\u041D\u0435 \u0441\u043F\u0430\u043C\u044C\u0442\u0435",
        "\u041D\u0435 \u043E\u0441\u043A\u043E\u0440\u0431\u043B\u044F\u0439\u0442\u0435",
        "\u041D\u0435 \u043F\u0440\u043E\u0432\u043E\u0446\u0438\u0440\u0443\u0439\u0442\u0435",
        "\u041D\u0435 \u043C\u043E\u043D\u0438\u0442\u043E\u0440\u044C\u0442\u0435",
        "\u041D\u0435 \u043F\u0440\u0435\u043F\u044F\u0442\u0441\u0442\u0432\u0443\u0439\u0442\u0435 \u0434\u0440\u0443\u0433\u0438\u043C",
        "\u042D\u0442\u043E \u043D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0435 \u043F\u0440\u0430\u0432\u0438\u043B \u043F\u0440\u043E\u0435\u043A\u0442\u0430",
        "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u0435 \u043D\u0438\u043A\u043D\u0435\u0439\u043C",
        "\u041D\u0435 \u043D\u0430\u0440\u0443\u0448\u0430\u0439\u0442\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0440\u0435\u0436\u0438\u043C\u0430"
      ];
    }
    isSiteNotificationChipButton(button) {
      if (!button || button.closest(".ioh-panel")) {
        return false;
      }
      const text = (button.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text === "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C") {
        return false;
      }
      return this.getSiteNotificationChipLabels().some((label) => text === label || text.startsWith(label));
    }
    findSiteNotificationTemplatesContainer(textarea) {
      const dialog = textarea.closest('[role="dialog"]');
      if (!dialog) {
        return null;
      }
      const chipButtons = Array.from(dialog.querySelectorAll("button")).filter(
        (button) => this.isSiteNotificationChipButton(button)
      );
      if (chipButtons.length < 2) {
        return null;
      }
      let container = chipButtons[0].parentElement;
      while (container && container !== dialog) {
        const chipCount = Array.from(container.children).filter(
          (child) => child.tagName === "BUTTON" && this.isSiteNotificationChipButton(child)
        ).length;
        if (chipCount >= 2 && !container.contains(textarea)) {
          return container;
        }
        container = container.parentElement;
      }
      return chipButtons[0].parentElement;
    }
    hideSiteNotificationTemplates(textarea) {
      const container = this.findSiteNotificationTemplatesContainer(textarea);
      if (!container) {
        return;
      }
      if (container.style.display !== "none") {
        container.dataset.iohPrevDisplay = container.style.display || "";
        container.style.display = "none";
      }
      container.dataset.iohHiddenSiteTemplates = "true";
    }
    initPunishmentFormObserver() {
      this.punishmentService.init();
    }
    initTableFeatures() {
      if (this.features.highlightHighHs) {
        this._getHighlightTargetRows().forEach((row) => this.messageService.highlightHighHs(row));
      }
      if (this.features.squareTickets) {
        this.ticketService.renderSquareTicketCards();
      } else {
        this.ticketService.clearSquareTicketCards();
      }
      if (this.features.highlightDuplicateServers) {
        this.messageService.highlightDuplicateServerIps();
      }
    }
    initNavigationWatcher() {
      if (this.navigationWatcherInstalled) return;
      this.navigationWatcherInstalled = true;
      const self2 = this;
      const history = this.window.history;
      if (history?.pushState) {
        const originalPushState = history.pushState;
        history.pushState = function() {
          const ret = originalPushState.apply(this, arguments);
          self2.handleNavigationChange();
          return ret;
        };
      }
      if (history?.replaceState) {
        const originalReplaceState = history.replaceState;
        history.replaceState = function() {
          const ret = originalReplaceState.apply(this, arguments);
          self2.handleNavigationChange();
          return ret;
        };
      }
      this.window.addEventListener("popstate", () => this.handleNavigationChange());
    }
    handleNavigationChange() {
      const href = this.window.location.href;
      if (href === this._lastHref) return;
      this._lastHref = href;
      this.profileLauncher?.refresh();
      this.appearanceService?.refresh();
      if (!this.ticketService.isComplaintPage()) {
        this.ticketService.clearAutoConnectedServers();
        this._lastAutoConnectTicketKey = null;
      } else {
        delete this.document.body.dataset.autoConnected;
        delete this.document.body.dataset.autoConnectedFor;
        this._lastAutoConnectTicketKey = null;
      }
      this._lastVisibleTicketTextarea = null;
      this.teardownTicketChatHistoryObservers();
      this.ticketService.teardownTicketPunishmentButtons();
      this.domCoordinator.teardownAll();
      this.ticketService.clearTicketRuleBadge();
      this.ticketService.resetChatAnalysisCache(null, { preserveCompleted: true });
      this.runDOMUpdates();
      this.domCoordinator.init();
      this.syncOffenderTrackingForPage();
      void this.ticketService.scanModeratorPunishmentPermissions();
      void this.ticketService.loadModeratorPermissions().then(() => {
        if (this.ticketService.isComplaintPage()) {
          this.ticketService.refreshComplaintPunishmentButtons();
        }
      });
    }
    onTicketTabVisibilityChange() {
      this.ticketService.syncCloseReasonSelection();
      this.ticketService.syncTicketPunishmentFeedback();
      if (this.ticketService.isSitePunishmentDialogOpen()) {
        return;
      }
      const visibleTextarea = this.ticketService.findVisibleTicketResolutionTextarea();
      const textareaChanged = visibleTextarea !== this._lastVisibleTicketTextarea;
      this._lastVisibleTicketTextarea = visibleTextarea;
      if (visibleTextarea && this.features.processTicketRules && textareaChanged) {
        this.ensureTicketChatHistoryObserver(visibleTextarea);
        this.ticketService.resetChatAnalysisCache(visibleTextarea);
        this._runTicketChatAnalysis(visibleTextarea);
      }
      if (textareaChanged) {
        this.maybeAutoConnectOnTicketMount();
      }
      this.ticketService.refreshComplaintPunishmentButtons();
      if (this.features.highlightHighHs) {
        this._getHighlightTargetRows().forEach((row) => this.messageService.highlightHighHs(row));
      }
      if (this.features.highlightComplaintTriggers) {
        this._getHighlightTargetRows().forEach((row) => this.messageService.highlightComplaintTriggers(row));
      }
      if (this.features.highlightNewAccounts) {
        if (this.messageService._isComplaintQueuePage()) {
          this.messageService.syncNewAccountHighlights();
        } else {
          this._getHighlightTargetRows().forEach((row) => this.messageService.highlightNewAccounts(row));
        }
      }
      this.syncOffenderTrackingForPage();
    }
    teardownTicketChatHistoryObservers() {
      if (this.ticketChatHistoryObservers.size) {
        console.log(`[Helper] ticketChatHistoryObservers: teardown (${this.ticketChatHistoryObservers.size})`);
      }
      for (const entry of this.ticketChatHistoryObservers.values()) {
        if (entry.debounceTimerId) {
          clearTimeout(entry.debounceTimerId);
        }
        if (entry.idleId != null) {
          if (typeof cancelIdleCallback === "function") {
            cancelIdleCallback(entry.idleId);
          } else {
            clearTimeout(entry.idleId);
          }
        }
        entry.observer?.disconnect();
        entry.waitObserver?.disconnect();
      }
      this.ticketChatHistoryObservers.clear();
      this.ticketService.resetChatAnalysisCache(null, { preserveCompleted: true });
    }
    ensureTicketChatHistoryObserver(textarea) {
      if (!this.document.contains(textarea) || !this.ticketService.isVisibleTicketTextarea(textarea)) return;
      if (!this.ticketChatHistoryObservers.has(textarea)) this.ticketChatHistoryObservers.set(textarea, {});
      void this._runTicketChatAnalysis(textarea);
    }
    _debouncedProcessTicketRules(textarea, delayMs = 100) {
      const entry = this.ticketChatHistoryObservers.get(textarea);
      if (!entry) return;
      if (!this.features.processTicketRules) return;
      this.ticketService.invalidateChatAnalysis(textarea);
      if (entry.debounceTimerId) {
        clearTimeout(entry.debounceTimerId);
        entry.debounceTimerId = null;
      }
      if (entry.idleId != null) {
        if (typeof cancelIdleCallback === "function") {
          cancelIdleCallback(entry.idleId);
        } else {
          clearTimeout(entry.idleId);
        }
        entry.idleId = null;
      }
      entry.debounceTimerId = setTimeout(() => {
        entry.debounceTimerId = null;
        entry.idleId = scheduleIdle(() => this._runTicketChatAnalysis(textarea));
      }, delayMs);
    }
    async _runTicketChatAnalysis(textarea) {
      if (!this.features.processTicketRules) return;
      if (!this.document.contains(textarea)) return;
      if (!this.ticketService.isVisibleTicketTextarea(textarea)) return;
      const state = this.ticketService.beginChatAnalysis(textarea);
      this.domCoordinator.notify("chatChanged");
      const settled = await this.ticketService.waitForSettledChatHistory(textarea);
      if (!settled || !this.features.processTicketRules || !this.ticketService.isChatAnalysisCurrent(state)) return;
      let result;
      try {
        result = await this.ticketService.processTicketRules(textarea);
      } catch {
        console.warn("[Helper] ticket chat analysis failed; auto-connect remains blocked");
        return;
      }
      if (!this.features.processTicketRules) return;
      const completed = this.ticketService.completeChatAnalysis(state, result);
      if (completed) await this.ticketService.maybeAutoConnectAfterChatAnalysis(completed, textarea);
    }
    _getHighlightTargetRows() {
      if (this.messageService._isComplaintQueuePage()) {
        return this.messageService._getComplaintQueueRows();
      }
      return Array.from(this.document.querySelectorAll("table tbody tr"));
    }
    _reapplyTicketRowHighlights() {
      if (this.features.highlightHighHs) {
        this._getHighlightTargetRows().forEach((row) => this.messageService.highlightHighHs(row));
      }
      if (this.features.highlightComplaintTriggers) {
        this._getHighlightTargetRows().forEach((row) => this.messageService.highlightComplaintTriggers(row));
      }
      if (this.features.highlightNewAccounts) {
        if (this.messageService._isComplaintQueuePage()) {
          this.messageService.syncNewAccountHighlights();
        } else {
          this._getHighlightTargetRows().forEach((row) => this.messageService.highlightNewAccounts(row));
        }
      }
    }
    _applyRowHighlights(row) {
      if (this.features.highlightHighHs) {
        this.messageService.highlightHighHs(row);
      }
      if (this.features.highlightComplaintTriggers) {
        this.messageService.highlightComplaintTriggers(row);
      }
      if (this.features.highlightNewAccounts) {
        this.messageService.highlightNewAccounts(row);
      }
    }
    isNotificationTextarea(textarea) {
      let parent = textarea.parentElement;
      while (parent && parent !== this.document.body) {
        if (parent.innerText && parent.innerText.includes("\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435")) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    }
    isTicketResolutionTextarea(textarea) {
      return Boolean(textarea.placeholder && textarea.placeholder.includes("\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"));
    }
  };

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

  // modules/analytics/Collector.js
  function startAnalyticsCollector(chrome2, window2, document2) {
    void document2;
    let task = null, alive = true;
    const send = (request) => chrome2.runtime.sendMessage(request).catch(() => {
    });
    const cancel = (nonce) => window2.postMessage({ channel: "ioh-analytics-request-v2", type: "cancel", nonce }, window2.location.origin);
    const finish = (message, { notifyReady = true, notifyResult = true } = {}) => {
      if (!task) return;
      const completed = task;
      clearTimeout(completed.timer);
      task = null;
      if (completed.kind === "roster") completed.respond(message);
      else {
        if (notifyResult) void send(message.success ? { action: "analyticsResult", nonce: completed.nonce, result: message.result } : { action: "analyticsFailure", nonce: completed.nonce, error: message.error });
        if (notifyReady) void send({ action: "iohClientReady" });
      }
    };
    const onPageMessage = (event) => {
      if (event.source !== window2 || event.origin !== window2.location.origin) return;
      if (event.data?.channel === "ioh-moderator-config-request-v1" && /^[a-f0-9-]{16,64}$/.test(event.data.nonce || "")) {
        const nonce = event.data.nonce;
        void chrome2.runtime.sendMessage({ action: "getModeratorConfig" }).then((response) => {
          if (alive) window2.postMessage({ channel: "ioh-moderator-config-response-v1", nonce, response }, window2.location.origin);
        }).catch(() => {
          if (alive) window2.postMessage({ channel: "ioh-moderator-config-response-v1", nonce, response: { success: false, error: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u0432" } }, window2.location.origin);
        });
        return;
      }
      if (!task || event.data?.channel !== "ioh-analytics-response-v2" || event.data.nonce !== task.nonce) return;
      const message = event.data;
      if (message.type === "progress" && task.kind !== "roster") void send({ action: "analyticsProgress", nonce: task.nonce, stage: String(message.stage || "").slice(0, 120) });
      if (message.type === "result" || message.type === "error") {
        finish(message.type === "result" ? { success: true, result: message.result } : { success: false, error: String(message.error || "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435").slice(0, 300), ...message.code === "BUSY" ? { code: "BUSY" } : {} });
      }
    };
    const onRuntimeMessage = (request, _sender, respond) => {
      if (request.action === "analyticsPing") {
        respond({ success: true, version: 2, scheduleNative: 1, profileMetadata: 1, busy: !!task });
        return;
      }
      if (request.action === "analyticsCancelWorker" || request.action === "scheduleCancelNative") {
        const kind = request.action === "scheduleCancelNative" ? "roster" : "profile";
        if (task?.nonce === request.nonce && task.kind === kind) {
          cancel(task.nonce);
          finish({ success: false, error: "\u0421\u0431\u043E\u0440 \u043E\u0442\u043C\u0435\u043D\u0451\u043D" }, { notifyResult: false });
        }
        respond({ success: true });
        return;
      }
      const roster = request.action === "scheduleCollectNative";
      if (!roster && request.action !== "analyticsCollect") return;
      if (!roster && (!parseSteamId(request.steamId) || !validateRange(request.range)) || !/^[a-f0-9-]{16,64}$/.test(request.nonce || "")) {
        respond({ success: false });
        return;
      }
      if (task) {
        respond({ success: false, code: "BUSY", error: "\u0412\u043A\u043B\u0430\u0434\u043A\u0430 \u0443\u0436\u0435 \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0435" });
        return;
      }
      task = { nonce: request.nonce, kind: roster ? "roster" : "profile", respond };
      task.timer = setTimeout(() => {
        if (task?.nonce !== request.nonce) return;
        cancel(task.nonce);
        finish({ success: false, error: "\u041A\u043B\u0438\u0435\u043D\u0442 \u0441\u0430\u0439\u0442\u0430 \u043D\u0435 \u043E\u0442\u0432\u0435\u0442\u0438\u043B. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0430\u0434\u043C\u0438\u043D\u043A\u0443 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u0441\u0431\u043E\u0440." });
      }, 12e4);
      window2.postMessage({
        channel: "ioh-analytics-request-v2",
        type: roster ? "roster" : "collect",
        nonce: request.nonce,
        ...!roster ? { steamId: request.steamId, range: request.range } : {}
      }, window2.location.origin);
      if (roster) return true;
      respond({ success: true });
    };
    window2.addEventListener("message", onPageMessage);
    chrome2.runtime.onMessage.addListener(onRuntimeMessage);
    window2.addEventListener("pagehide", () => {
      alive = false;
      if (task) {
        cancel(task.nonce);
        finish({ success: false, error: "\u0418\u0441\u0445\u043E\u0434\u043D\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0430\u0434\u043C\u0438\u043D\u043A\u0438 \u0431\u044B\u043B\u0430 \u0437\u0430\u043A\u0440\u044B\u0442\u0430 \u0438\u043B\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430" }, { notifyReady: false });
      }
      window2.removeEventListener("message", onPageMessage);
      chrome2.runtime.onMessage.removeListener(onRuntimeMessage);
    }, { once: true });
    return false;
  }

  // content.js
  chrome.storage.local.get(["scriptEnabled", "helperSettings"], (result) => {
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
})();
//# sourceMappingURL=content.js.map
