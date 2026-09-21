// IoHelper/modules/shared/dom.js
function markIoh(el) {
  if (el && el.nodeType === 1) {
    el.setAttribute("data-ioh", "1");
  }
  return el;
}

// IoHelper/modules/ConfigService.js
var ConfigService = class {
  static LOCAL_KEY = "helperConfig";
  static FETCHED_AT_KEY = "helperConfigFetchedAt";
  static FETCH_TTL_MS = 3364e3;
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
    const fallback = await fetch(chrome.runtime.getURL("config.json")).then((r) => r.json());
    await chrome.storage.local.set({
      [this.LOCAL_KEY]: fallback,
      [this.FETCHED_AT_KEY]: Date.now()
    });
    console.log("[IO HELPER] Using bundled config");
    return fallback;
  }
};

// IoHelper/modules/ModeratorService.js
var ModeratorService = class _ModeratorService {
  static WEEKDAY_LABELS = [
    "\u041F\u043E\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u0438\u043A",
    "\u0412\u0442\u043E\u0440\u043D\u0438\u043A",
    "\u0421\u0440\u0435\u0434\u0430",
    "\u0427\u0435\u0442\u0432\u0435\u0440\u0433",
    "\u041F\u044F\u0442\u043D\u0438\u0446\u0430",
    "\u0421\u0443\u0431\u0431\u043E\u0442\u0430",
    "\u0412\u043E\u0441\u043A\u0440\u0435\u0441\u0435\u043D\u044C\u0435"
  ];
  static MODERATOR_CATEGORIES = ["Tier", "Movement", "Hns", "Jail"];
  static CATEGORY_KEYS = ["verification", "Tier", "Movement", "Hns", "Jail"];
  constructor({ document: document2, chrome }) {
    this.document = document2;
    this.chrome = chrome;
    this.isScanning = false;
    this.hasCompletedWeeklyScan = false;
  }
  scanSchedulePage() {
    if (!window.location.href.includes("/worktime")) {
      return;
    }
    if (this.isScanning || this.hasCompletedWeeklyScan) {
      return;
    }
    void this.runWeeklyScheduleScan();
  }
  async runWeeklyScheduleScan() {
    this.isScanning = true;
    console.log("[IO HELPER] \u041D\u0435\u0434\u0435\u043B\u044C\u043D\u044B\u0439 \u0441\u043A\u0430\u043D \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F \u0437\u0430\u043F\u0443\u0449\u0435\u043D.");
    try {
      const dayButtons = await this.waitForDayButtons();
      if (!dayButtons) {
        console.log("[IO HELPER] \u041A\u043D\u043E\u043F\u043A\u0438 \u0434\u043D\u0435\u0439 \u043D\u0435\u0434\u0435\u043B\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B. \u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430.");
        return;
      }
      const scheduleModerators = {};
      let previousFingerprint = null;
      for (const dayLabel of _ModeratorService.WEEKDAY_LABELS) {
        const button = dayButtons[dayLabel];
        if (!button) {
          console.log(`[IO HELPER] \u041A\u043D\u043E\u043F\u043A\u0430 \xAB${dayLabel}\xBB \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430, \u043F\u0440\u043E\u043F\u0443\u0441\u043A.`);
          continue;
        }
        console.log(`[IO HELPER] \u0421\u043A\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0434\u043D\u044F: ${dayLabel}`);
        button.click();
        const ready = await this.waitForScheduleContent(previousFingerprint);
        if (!ready) {
          console.log(`[IO HELPER] \u041A\u043E\u043D\u0442\u0435\u043D\u0442 \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F \u0434\u043B\u044F \xAB${dayLabel}\xBB \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043B\u0441\u044F \u0432\u043E\u0432\u0440\u0435\u043C\u044F.`);
        }
        const dayMods = this.collectModeratorsFromPage();
        previousFingerprint = this.getScheduleFingerprint();
        const dayCount = Object.keys(dayMods).length;
        console.log(`[IO HELPER] \xAB${dayLabel}\xBB: \u043D\u0430\u0439\u0434\u0435\u043D\u043E ${dayCount} \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u0432.`);
        Object.assign(scheduleModerators, dayMods);
      }
      const totalFound = Object.keys(scheduleModerators).length;
      if (totalFound === 0) {
        console.log("[IO HELPER] \u041C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u044B \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B. \u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430.");
        return;
      }
      await this.applyTierDiffAndReport(scheduleModerators);
    } catch (error) {
      console.error("[IO HELPER] \u041E\u0448\u0438\u0431\u043A\u0430 \u043D\u0435\u0434\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u043A\u0430\u043D\u0430 \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F:", error);
    } finally {
      this.hasCompletedWeeklyScan = true;
      this.isScanning = false;
    }
  }
  waitForDayButtons(timeoutMs = 15e3) {
    return new Promise((resolve) => {
      const find = () => this.findDayButtons();
      const existing = find();
      if (existing) {
        resolve(existing);
        return;
      }
      let settled = false;
      const finish = (value, reason) => {
        if (settled) {
          return;
        }
        settled = true;
        observer.disconnect();
        console.log(`[Helper] ModeratorService: waitForDayButtons finish \u2014 ${reason}`);
        resolve(value);
      };
      console.log("[Helper] ModeratorService: waitForDayButtons start");
      const observer = new MutationObserver(() => {
        const buttons = find();
        if (buttons) {
          finish(buttons, "found");
        }
      });
      observer.observe(this.document.body, { childList: true, subtree: true });
      setTimeout(() => finish(find(), "timeout"), timeoutMs);
    });
  }
  findDayButtons() {
    const buttons = {};
    const allButtons = this.document.querySelectorAll('button[type="button"]');
    allButtons.forEach((button) => {
      const label = (button.textContent || "").replace(/\s+/g, " ").trim();
      if (_ModeratorService.WEEKDAY_LABELS.includes(label)) {
        buttons[label] = button;
      }
    });
    const foundCount = Object.keys(buttons).length;
    return foundCount >= 7 ? buttons : null;
  }
  waitForScheduleContent(previousFingerprint, timeoutMs = 1e4) {
    return new Promise((resolve) => {
      const isReady = () => {
        const fingerprint = this.getScheduleFingerprint();
        if (!fingerprint) {
          return false;
        }
        if (previousFingerprint == null) {
          return true;
        }
        return fingerprint !== previousFingerprint;
      };
      const finish = (ok) => {
        if (settled) {
          return;
        }
        settled = true;
        observer?.disconnect();
        setTimeout(() => resolve(ok), 350);
      };
      let settled = false;
      let observer = null;
      if (isReady()) {
        finish(true);
        return;
      }
      console.log("[Helper] ModeratorService: waitForScheduleContent start");
      observer = new MutationObserver(() => {
        if (isReady()) {
          console.log("[Helper] ModeratorService: waitForScheduleContent finish \u2014 ready");
          finish(true);
        }
      });
      observer.observe(this.document.body, { childList: true, subtree: true });
      setTimeout(() => {
        if (settled) {
          return;
        }
        console.log("[Helper] ModeratorService: waitForScheduleContent finish \u2014 timeout");
        finish(this.countScheduleMarkers() > 0);
      }, timeoutMs);
    });
  }
  countScheduleMarkers() {
    return this.document.querySelectorAll(
      'a[href*="/moderator/profile/"], [data-steamid64]'
    ).length;
  }
  getScheduleFingerprint() {
    const ids = /* @__PURE__ */ new Set();
    this.document.querySelectorAll("[data-steamid64]").forEach((node) => {
      const steamId = (node.getAttribute("data-steamid64") || "").trim();
      if (this.isSteamId64(steamId)) {
        ids.add(steamId);
      }
    });
    this.document.querySelectorAll('a[href*="/moderator/profile/"]').forEach((link) => {
      const match = (link.getAttribute("href") || link.href || "").match(/\/moderator\/profile\/(\d{17,18})/);
      if (match) {
        ids.add(match[1]);
      }
    });
    if (ids.size === 0) {
      return null;
    }
    return Array.from(ids).sort().join(",");
  }
  collectModeratorsFromPage() {
    const result = {};
    this.document.querySelectorAll("[data-steamid64]").forEach((node) => {
      const steamId = (node.getAttribute("data-steamid64") || "").trim();
      if (!this.isSteamId64(steamId)) {
        return;
      }
      const nick = this.extractNickFromSteamidNode(node, steamId);
      if (nick) {
        result[steamId] = nick;
      }
    });
    this.document.querySelectorAll('a[href*="/moderator/profile/"]').forEach((link) => {
      const match = (link.getAttribute("href") || link.href || "").match(/\/moderator\/profile\/(\d{17,18})/);
      if (!match) {
        return;
      }
      const steamId = match[1];
      if (result[steamId]) {
        return;
      }
      const nick = this.extractNickFromProfileLink(link, steamId);
      if (nick) {
        result[steamId] = nick;
      }
    });
    return result;
  }
  normalizeNick(name) {
    if (!name || typeof name !== "string") {
      return "";
    }
    let nick = name.replace(/\s+/g, " ").trim();
    while (/^аватар игрока\s+/i.test(nick)) {
      nick = nick.replace(/^аватар игрока\s+/i, "").trim();
    }
    return nick;
  }
  extractNickFromSteamidNode(node, steamId) {
    const roleLinks = node.querySelectorAll('[role="link"]');
    for (const el of roleLinks) {
      const text = this.normalizeNick(el.textContent || "");
      if (this.isValidNick(text, steamId) && !/^\d{1,2}:\d{2}/.test(text)) {
        return text;
      }
    }
    const withoutTime = this.normalizeNick(
      (node.textContent || "").replace(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/g, "")
    );
    if (this.isValidNick(withoutTime, steamId)) {
      return withoutTime;
    }
    const title = this.normalizeNick(
      node.closest("[title]")?.getAttribute("title") || ""
    );
    if (this.isValidNick(title, steamId)) {
      return title;
    }
    const img = node.querySelector("img[alt]");
    if (img) {
      const alt = this.normalizeNick(img.getAttribute("alt") || "");
      if (this.isValidNick(alt, steamId)) {
        return alt;
      }
    }
    return null;
  }
  extractNickFromProfileLink(link, steamId) {
    const span = link.querySelector("span");
    if (span) {
      const text2 = this.normalizeNick(span.textContent || "");
      if (this.isValidNick(text2, steamId)) {
        return text2;
      }
    }
    const card = link.closest('[data-player-card="true"]');
    if (card) {
      const nickLink = Array.from(card.querySelectorAll('a[href*="/moderator/profile/"]')).find((a) => {
        const text2 = this.normalizeNick(a.textContent || "");
        return this.isValidNick(text2, steamId);
      });
      if (nickLink) {
        return this.normalizeNick(nickLink.textContent || "");
      }
      const imgAlt = card.querySelector("img[alt]");
      if (imgAlt) {
        const alt = this.normalizeNick(imgAlt.getAttribute("alt") || "");
        if (this.isValidNick(alt, steamId)) {
          return alt;
        }
      }
    }
    const img = link.querySelector("img[alt]");
    if (img) {
      const alt = this.normalizeNick(img.getAttribute("alt") || "");
      if (this.isValidNick(alt, steamId)) {
        return alt;
      }
    }
    const text = this.normalizeNick(link.textContent || "");
    if (this.isValidNick(text, steamId)) {
      return text;
    }
    return null;
  }
  isSteamId64(value) {
    return typeof value === "string" && /^\d{17,18}$/.test(value);
  }
  isValidNick(name, steamId) {
    if (!name || typeof name !== "string") {
      return false;
    }
    const trimmed = this.normalizeNick(name);
    if (trimmed.length < 1) {
      return false;
    }
    if (trimmed.includes("ID:")) {
      return false;
    }
    if (trimmed === steamId || /^\d{17,18}$/.test(trimmed)) {
      return false;
    }
    if (/^аватар игрока$/i.test(trimmed)) {
      return false;
    }
    return true;
  }
  async loadBaselineModerators() {
    try {
      const response = await fetch(ConfigService.DEFAULT_CONFIG_URL, { cache: "no-cache" });
      if (response.ok) {
        const remote = await response.json();
        console.log("[IO HELPER] Baseline Tier \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D \u0441 GitHub.");
        return this.normalizeModerators(remote.moderators);
      }
    } catch (e) {
      console.log("[IO HELPER] GitHub baseline \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D, \u043F\u0440\u043E\u0431\u0443\u0435\u043C bundled config.");
    }
    try {
      const bundled = await fetch(this.chrome.runtime.getURL("config.json")).then((r) => r.json());
      console.log("[IO HELPER] Baseline Tier \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D \u0438\u0437 bundled config.json.");
      return this.normalizeModerators(bundled.moderators);
    } catch (e) {
      console.log("[IO HELPER] Bundled config \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0434\u043B\u044F baseline.");
      return null;
    }
  }
  applyTierDiffAndReport(scheduleModerators) {
    return new Promise(async (resolve) => {
      const baselineModerators = await this.loadBaselineModerators();
      this.chrome.storage.local.get(["helperConfig"], ({ helperConfig }) => {
        if (!helperConfig) {
          console.log("[IO HELPER] helperConfig \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432 storage.");
          resolve();
          return;
        }
        const moderators = this.normalizeModerators(helperConfig.moderators);
        const oldTier = baselineModerators ? { ...baselineModerators.Tier || {} } : { ...moderators.Tier || {} };
        if (!baselineModerators) {
          console.log("[IO HELPER] Baseline \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u2014 diff \u043F\u0440\u043E\u0442\u0438\u0432 local helperConfig.Tier.");
        }
        const added = {};
        const removed = {};
        const newTier = {};
        for (const [steamId, nick] of Object.entries(scheduleModerators)) {
          newTier[steamId] = nick;
          if (!oldTier[steamId]) {
            added[steamId] = nick;
          }
        }
        for (const [steamId, nick] of Object.entries(oldTier)) {
          if (!scheduleModerators[steamId]) {
            removed[steamId] = nick;
          }
        }
        moderators.Tier = newTier;
        helperConfig.moderators = moderators;
        if (helperConfig.weeklySchedule) {
          delete helperConfig.weeklySchedule;
        }
        this.chrome.storage.local.set({ helperConfig }, () => {
          console.log("[IO HELPER] === \u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043D\u0435\u0434\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u0441\u043A\u0430\u043D\u0430 Tier ===");
          console.log("[IO HELPER] \u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0435 \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u044B:", added);
          console.log("[IO HELPER] \u0423\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0435 \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u044B:", removed);
          console.log("[IO HELPER] \u041F\u043E\u043B\u043D\u044B\u0439 JSON \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u0432 (\u0434\u043B\u044F \u043A\u043E\u043F\u0438\u043F\u0430\u0441\u0442\u0430):");
          console.log(JSON.stringify(moderators, null, 2));
          console.log(
            `[IO HELPER] \u0418\u0442\u043E\u0433\u043E \u0432 Tier: ${Object.keys(newTier).length} (\u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E: ${Object.keys(added).length}, \u0443\u0434\u0430\u043B\u0435\u043D\u043E: ${Object.keys(removed).length})`
          );
          resolve();
        });
      });
    });
  }
  normalizeModerators(raw) {
    const result = {
      verification: {},
      Tier: {},
      Movement: {},
      Hns: {},
      Jail: {}
    };
    if (!raw || typeof raw !== "object") {
      return result;
    }
    for (const key of _ModeratorService.CATEGORY_KEYS) {
      if (raw[key] && typeof raw[key] === "object" && !Array.isArray(raw[key])) {
        result[key] = { ...raw[key] };
      }
    }
    for (const [key, value] of Object.entries(raw)) {
      if (_ModeratorService.CATEGORY_KEYS.includes(key)) {
        continue;
      }
      if (typeof value === "string" && this.isSteamId64(key) && value) {
        result.Tier[key] = value;
      }
    }
    return result;
  }
  resolveModeratorType(steamId, moderators) {
    const normalized = this.normalizeModerators(moderators);
    if (normalized.verification?.[steamId]) {
      return "verification";
    }
    for (const category of _ModeratorService.MODERATOR_CATEGORIES) {
      if (normalized[category]?.[steamId]) {
        return "admin";
      }
    }
    return null;
  }
  insertModeratorBadge(link, badgeType) {
    const iconKey = badgeType === "verification" ? "verification" : "admin";
    const iconSvg = window.Icons?.[iconKey];
    if (!iconSvg) {
      return false;
    }
    const existingBadge = link.parentElement?.querySelector(".ioh-admin-icon") || link.querySelector(".ioh-admin-icon");
    if (existingBadge && link.dataset.moderBadgeType === badgeType) {
      link.dataset.hasModerBadge = "true";
      return true;
    }
    if (existingBadge) {
      existingBadge.remove();
    }
    const template = document.createElement("template");
    template.innerHTML = iconSvg.trim();
    const badge = template.content.firstElementChild;
    badge.classList.add("ioh-admin-icon");
    markIoh(badge);
    const idContainer = link.closest("div");
    const parentContainer = idContainer ? idContainer.parentElement : null;
    const nameButton = parentContainer ? parentContainer.querySelector("button") : null;
    if (nameButton) {
      nameButton.parentNode.insertBefore(badge, nameButton.nextSibling);
    } else {
      link.appendChild(badge);
    }
    link.dataset.hasModerBadge = "true";
    link.dataset.moderBadgeType = badgeType;
    return true;
  }
  _findCurrentServerSection() {
    const header = Array.from(this.document.querySelectorAll("h3")).find((h) => h.textContent?.includes("\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0441\u0435\u0440\u0432\u0435\u0440"));
    if (!header) {
      return null;
    }
    let container = header.parentElement;
    for (let depth = 0; depth < 8 && container; depth++) {
      if (container.querySelector("table") && container.querySelector('a[href*="cybershoke.net/"]')) {
        return container;
      }
      container = container.parentElement;
    }
    return header.closest('main, [role="main"], section, article, [role="tabpanel"]') || header.parentElement;
  }
  highlightSavedModerators() {
    this.chrome.storage.local.get(["helperConfig"], ({ helperConfig }) => {
      const moderators = helperConfig?.moderators || {};
      if (Object.keys(moderators).length === 0) return;
      const section = this._findCurrentServerSection();
      if (!section) return;
      const links = section.querySelectorAll('a[href*="cybershoke.net/"]');
      links.forEach((link) => {
        const match = link.href.match(/cybershoke\.net\/(\d+)/);
        if (!match) return;
        const steamId = match[1];
        const badgeType = this.resolveModeratorType(steamId, moderators);
        if (!badgeType) return;
        const row = link.closest("tr");
        if (row && !row.classList.contains("ioh-highlighted-moderator")) {
          row.classList.add("ioh-highlighted-moderator");
        }
        if (!link.dataset.hasModerBadge || link.dataset.moderBadgeType !== badgeType) {
          this.insertModeratorBadge(link, badgeType);
        }
      });
    });
  }
};
export {
  ModeratorService
};
//# sourceMappingURL=moderator.js.map
