// modules/shared/dom.js
function markIoh(el) {
  if (el && el.nodeType === 1) {
    el.setAttribute("data-ioh", "1");
  }
  return el;
}

// modules/shared/moderators.js
var record = (value) => value && typeof value === "object" && !Array.isArray(value);
var steamId = (value) => /^\d{17}$/.test(value);
var UNKNOWN_ROLE = "\u0414\u043E\u043B\u0436\u043D\u043E\u0441\u0442\u044C \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u0430";
function configRoleName(value) {
  const role = String(value || "").trim().slice(0, 100);
  const tier = role.match(/^(?:moderator\s*)?tier\s*([1-5])$/i);
  if (tier) return "Tier " + tier[1];
  if (/^(?:moderator\s+new|new\s+moderator)$/i.test(role)) return "New moderator";
  if (/^senior\s+moderator$/i.test(role)) return "Senior Moderator";
  if (/^advanced$/i.test(role)) return "Advanced";
  return role || UNKNOWN_ROLE;
}
function isGeneralModeratorRole(value) {
  return !/(?:jail|\bhns\b|hide\s*(?:and|&)\s*seek|movement|джайл|джейл|движени)/i.test(String(value || ""));
}
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
function validScheduleSnapshot(snapshot) {
  if (!snapshot || snapshot.formatVersion !== 2 || snapshot.source !== "worktime-api" || !Number.isFinite(snapshot.scannedAt) || snapshot.scannedAt <= 0 || !Array.isArray(snapshot.days) || snapshot.days.length !== 7 || new Set(snapshot.days).size !== 7 || snapshot.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || !validModeratorGroup(snapshot.Tier) || !Array.isArray(snapshot.members) || !snapshot.members.length || snapshot.members.length > 5e3) return false;
  const entries = moderatorEntries(snapshot.Tier), byId = new Map(entries.map((member) => [member.steamId, member]));
  if (entries.length !== byId.size || byId.size !== snapshot.members.length) return false;
  const seen = /* @__PURE__ */ new Set();
  return snapshot.members.every((member) => {
    if (!member || !steamId(member.steamId) || seen.has(member.steamId) || typeof member.name !== "string" || typeof member.className !== "string" || !member.className.trim() || !isGeneralModeratorRole(member.className)) return false;
    seen.add(member.steamId);
    const grouped = byId.get(member.steamId);
    return grouped?.name === member.name && grouped.className === configRoleName(member.className);
  });
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

// modules/ModeratorService.js
var ModeratorService = class _ModeratorService {
  static MODERATOR_CATEGORIES = ["Tier", "Movement", "Hns", "Jail"];
  static CATEGORY_KEYS = ["verification", "Tier", "Movement", "Hns", "Jail"];
  constructor({ document, chrome, isEnabled = () => true }) {
    this.document = document;
    this.chrome = chrome;
    this.isEnabled = isEnabled;
    this.hasCompletedWeeklyScan = false;
    this._scanNextAt = 0;
  }
  // Compatibility entry point. Collection is owned by the daily API scheduler;
  // this service never navigates or clicks the native worktime controls.
  scanSchedulePage() {
    if (!this.isEnabled() || this._scanRequest || Date.now() < this._scanNextAt) return this._scanRequest;
    this._scanNextAt = Date.now() + 6e4;
    this._scanRequest = this.chrome.runtime.sendMessage({ action: "requestScheduleScan" }).then((response) => {
      if (response?.nextAt) this._scanNextAt = response.nextAt;
      this.hasCompletedWeeklyScan = response?.status === "complete";
      return response;
    }).catch((error) => {
      console.warn("[IO HELPER] API \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F:", error.message);
      return { success: false, error: error.message };
    }).finally(() => {
      this._scanRequest = null;
    });
    return this._scanRequest;
  }
  runWeeklyScheduleScan() {
    return this.scanSchedulePage();
  }
  cancelScan() {
    void this.chrome.runtime.sendMessage({ action: "cancelScheduleScan" }).catch(() => {
    });
  }
  isSteamId64(value) {
    return typeof value === "string" && /^\d{17}$/.test(value);
  }
  async loadBaselineModerators() {
    const { helperConfig, helperScheduleModerators } = await this.chrome.storage.local.get(["helperConfig", "helperScheduleModerators"]);
    return this.normalizeModerators({
      ...helperConfig?.moderators,
      ...validScheduleSnapshot(helperScheduleModerators) ? { Tier: helperScheduleModerators.Tier } : {}
    });
  }
  normalizeModerators(raw) {
    const result = Object.fromEntries(_ModeratorService.CATEGORY_KEYS.map((key) => [key, flattenModeratorGroup(raw?.[key])]));
    for (const [key, value] of Object.entries(raw || {})) {
      if (this.isSteamId64(key) && typeof value === "string" && value) result.Tier[key] = value;
    }
    return result;
  }
  resolveModeratorType(steamId2, moderators) {
    const normalized = this.normalizeModerators(moderators);
    if (_ModeratorService.MODERATOR_CATEGORIES.some((category) => normalized[category][steamId2])) return "admin";
    return normalized.verification[steamId2] ? "verification" : null;
  }
  insertModeratorBadge(link, badgeType) {
    const iconKey = badgeType === "verification" ? "verification" : "admin";
    const iconSvg = window.Icons?.[iconKey];
    if (!iconSvg) {
      return false;
    }
    const scope = link.closest("td") || link.parentElement || link;
    const existingBadge = scope.querySelector(".ioh-saved-moderator-badge[data-ioh]");
    if (existingBadge && existingBadge.dataset.moderBadgeType === badgeType) {
      link.dataset.hasModerBadge = "true";
      link.dataset.moderBadgeType = badgeType;
      return true;
    }
    if (existingBadge) {
      existingBadge.remove();
    }
    const template = this.document.createElement("template");
    template.innerHTML = iconSvg.trim();
    const badge = template.content.firstElementChild;
    if (!badge) return false;
    badge.classList.add("ioh-admin-icon", "ioh-saved-moderator-badge");
    badge.dataset.moderBadgeType = badgeType;
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
  _findCurrentServerSections() {
    const sections = /* @__PURE__ */ new Set();
    const headers = Array.from(this.document.querySelectorAll("h3")).filter((h) => h.textContent?.includes("\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0441\u0435\u0440\u0432\u0435\u0440") && h.getClientRects().length && !h.closest('[aria-hidden="true"]'));
    for (const header of headers) {
      const panel = header.closest("[aria-hidden]") || header.closest('main, [role="main"]');
      if (!panel) continue;
      for (const table of panel.querySelectorAll("table")) {
        if (!table.getClientRects().length || table.closest('[aria-hidden="true"]')) continue;
        const columns = Array.from(table.querySelectorAll("thead th")).map((cell) => cell.textContent.replace(/\s+/g, " ").trim().toLowerCase());
        if (columns.includes("\u0438\u0433\u0440\u043E\u043A") && (columns.includes("\u043A\u043E\u043C\u0430\u043D\u0434\u0430") || columns.includes("\u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435") || columns.includes("\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F"))) {
          sections.add(table);
        }
      }
    }
    return [...sections];
  }
  _findCurrentServerSection() {
    return this._findCurrentServerSections()[0] || null;
  }
  clearSavedModerator(link) {
    const scope = link.closest("td") || link.parentElement || link;
    scope.querySelectorAll(".ioh-saved-moderator-badge[data-ioh]").forEach((badge) => badge.remove());
    const row = link.closest("tr");
    if (row?.dataset.iohSavedModerator) {
      delete row.dataset.iohSavedModerator;
      if (!row.querySelector('.ioh-moderator-badge, .ioh-profile-verified, [data-ioh-moderator-source="1"]')) {
        row.classList.remove("ioh-highlighted-moderator");
      }
    }
    delete link.dataset.hasModerBadge;
    delete link.dataset.moderBadgeType;
  }
  async highlightSavedModerators() {
    const generation = this._highlightGeneration = (this._highlightGeneration || 0) + 1;
    let moderators;
    try {
      moderators = await this.loadBaselineModerators();
    } catch (error) {
      console.warn("[IO HELPER] \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0441\u043E\u0441\u0442\u0430\u0432 \u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440\u043E\u0432:", error.message);
      return;
    }
    if (generation !== this._highlightGeneration) return;
    this.participantService?.setNativeModerators(moderators);
    this.participantService?.syncNativeTicketViews();
    for (const section of this._findCurrentServerSections()) {
      for (const link of section.querySelectorAll(PLAYER_PROFILE_LINK_SELECTOR)) {
        const steamId2 = steamIdFromPlayerProfileUrl(link.href);
        if (!steamId2) continue;
        const badgeType = this.resolveModeratorType(steamId2, moderators);
        if (!badgeType) {
          this.clearSavedModerator(link);
          continue;
        }
        const row = link.closest("tr");
        if (row) {
          row.classList.add("ioh-highlighted-moderator");
          row.dataset.iohSavedModerator = "1";
        }
        this.insertModeratorBadge(link, badgeType);
      }
    }
  }
};
export {
  ModeratorService
};
//# sourceMappingURL=moderator.js.map
