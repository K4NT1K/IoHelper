(() => {
  // IoHelper/modules/ConfigService.js
  var ConfigService = class {
    static LOCAL_KEY = "helperConfig";
    static FETCHED_AT_KEY = "helperConfigFetchedAt";
    static FETCH_TTL_MS = 3364e3;
    static DEFAULT_CONFIG_URL = "https://raw.githubusercontent.com/K4NT1K/CYBERSHOKE/refs/heads/main/IoHelper/config.json";
    static async load(chrome2) {
      const local = await chrome2.storage.local.get([
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
          await chrome2.storage.local.set({
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
      const fallback = await fetch(chrome2.runtime.getURL("config.json")).then((r) => r.json());
      await chrome2.storage.local.set({
        [this.LOCAL_KEY]: fallback,
        [this.FETCHED_AT_KEY]: Date.now()
      });
      console.log("[IO HELPER] Using bundled config");
      return fallback;
    }
  };

  // IoHelper/modules/Utils.js
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

  // IoHelper/modules/shared/dom.js
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

  // IoHelper/modules/BadgeService.js
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

  // IoHelper/modules/PanelService.js
  var PanelService = class {
    constructor({ document: document2 }) {
      this.document = document2;
    }
    buildCommentText(name, clickCount, defaultText) {
      if (clickCount === 1) {
        return defaultText;
      }
      if (clickCount >= 3 && name === "\u041E\u0441\u043A") {
        return "\u041C\u0443\u0442 \u0422\u043E\u043A\u0441\u0438\u0447\u043D\u043E\u0441\u0442\u044C";
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
    applyTrackedMessage(target, messageKey, nextMessage, { inline = false } = {}) {
      const trackedMessages = this.readTrackedMessages(target);
      const previousMessage = trackedMessages[messageKey];
      let nextValue = this.removeTrackedMessage(target.value, previousMessage, { inline });
      if (nextMessage) {
        const trimmedValue = nextValue.trim();
        if (inline) {
          nextValue = trimmedValue ? `${trimmedValue}. ${nextMessage}` : nextMessage;
        } else {
          nextValue = trimmedValue ? `${trimmedValue}
${nextMessage}` : nextMessage;
        }
        trackedMessages[messageKey] = nextMessage;
      } else {
        delete trackedMessages[messageKey];
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
      const entries = this.normalizeTemplateEntries(templates);
      entries.forEach(([name, text]) => {
        const btn = this.document.createElement("button");
        btn.className = "ioh-panel-btn";
        const icon = this.document.createElement("span");
        icon.className = "ioh-panel-btn-icon";
        icon.setAttribute("aria-hidden", "true");
        const label = this.document.createElement("span");
        label.innerText = name;
        btn.append(icon, label);
        let clickCount = 0;
        let clickTimer = null;
        btn.onclick = (e) => {
          e.preventDefault();
          clickCount++;
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
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

  // IoHelper/modules/MessageService.js
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
    }
    decorateMessageCell(messageCell) {
      if (messageCell.dataset.mhlprHoverReady === "true") return;
      const textNode = this.utils.extractMainTextNode(messageCell);
      if (!textNode) return;
      const originalText = textNode.nodeValue;
      const isRussian = this.utils.detectLanguage(originalText);
      messageCell.dataset.mhlprOriginalText = originalText;
      if (isRussian) {
        messageCell.dataset.mhlprHoverReady = "true";
        return;
      }
      messageCell.dataset.mhlprHoverReady = "true";
      messageCell.classList.add("ioh-chat-message");
      const translateOnHover = async () => {
        if (messageCell.dataset.isTranslating === "true") return;
        if (!messageCell.dataset.translatedText) {
          messageCell.dataset.isTranslating = "true";
          messageCell.classList.add("ioh-loading");
          const result = await this.badgeService.translateText(originalText, "RU");
          messageCell.classList.remove("ioh-loading");
          messageCell.dataset.isTranslating = "false";
          if (result && result.translated) {
            messageCell.dataset.translatedText = result.translated;
          }
        }
        if (messageCell.matches(":hover") && messageCell.dataset.translatedText) {
          textNode.nodeValue = messageCell.dataset.translatedText;
          messageCell.classList.add("ioh-translated");
        }
      };
      const restore = () => {
        textNode.nodeValue = originalText;
        messageCell.classList.remove("ioh-translated");
      };
      messageCell.addEventListener("mouseenter", translateOnHover);
      messageCell.addEventListener("mouseleave", restore);
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
      const scope = this.document.body;
      const chatHistoryBlock = this.ticketService?.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scope) || this.ticketService?.getHistorySectionCard("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430", scope) || this._findChatHistoryBlock();
      if (!chatHistoryBlock) return;
      const rows = Array.from(chatHistoryBlock.querySelectorAll("tbody tr, tr")).filter((row) => row.querySelector("td"));
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) this.decorateMessageCell(cells[cells.length - 1]);
      });
    }
    highlightComplaintTriggers(targetRow) {
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
      if (hours >= this.settings.newAccountHours) {
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
      this.document.querySelectorAll(".ioh-chat-message").forEach((messageCell) => {
        const textNode = this.utils.extractMainTextNode(messageCell);
        if (textNode && messageCell.dataset.mhlprOriginalText) {
          textNode.nodeValue = messageCell.dataset.mhlprOriginalText;
        }
        messageCell.classList.remove("ioh-chat-message", "ioh-loading", "ioh-translated");
        delete messageCell.dataset.mhlprHoverReady;
        delete messageCell.dataset.isTranslating;
        delete messageCell.dataset.translatedText;
        delete messageCell.dataset.mhlprOriginalText;
        const clone = messageCell.cloneNode(true);
        messageCell.replaceWith(clone);
      });
    }
  };

  // IoHelper/modules/SitePunishmentBridge.js
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
      this._dialogCleanupObserver = null;
      this._lastFailReason = null;
    }
    openMuteForm(steamId) {
      return this.openForm("mute", steamId);
    }
    openBanForm(steamId) {
      return this.openForm("ban", steamId);
    }
    _debugLog(reason, details = {}) {
      this.ticketService.debugPunishmentLog(reason, details);
    }
    async openForm(type, steamId) {
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
        console.warn(`[IO Helper] \u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0430 \u043A \u0444\u043E\u0440\u043C\u0435 \u0432\u044B\u0434\u0430\u0447\u0438 ${type === "ban" ? "\u0431\u0430\u043D\u0430" : "\u043C\u0443\u0442\u0430"}. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \xAB${panel.sectionTitle}\xBB.`);
        this._debugLog(this._lastFailReason || "open_form_failed", { type });
        return false;
      }
      this.ticketService.markPanelReady(type);
      this.ticketService.recordPunishmentOpenSuccess();
      await this.ticketService.persistPanelReadyState();
      if (steamId) {
        if (type === "ban") {
          this.ticketService.prefillBanFormSteamId(steamId);
        } else {
          this.ticketService.prefillMuteFormSteamId(steamId);
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
        this._applyManagementTabInitFlags(returnContext);
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
        this._scheduleManagementTabCleanupOnDialogClose(
          type,
          this._shouldCloseManagementTabOnCleanup(returnContext)
        );
        return true;
      } finally {
        this.ticketService.releasePermissionScan();
      }
    }
    _saveReturnContext(type) {
      const tabContext = this.ticketService.collectReturnTabContext();
      this._returnContext = {
        ...tabContext,
        managementType: type || null,
        managementTabWasOpen: this.ticketService.isManagementSpaTabOpen(type),
        openedManagementTabForInit: false
      };
    }
    _applyManagementTabInitFlags(returnContext) {
      if (returnContext.managementTabWasOpen) {
        return;
      }
      if (this.ticketService.getLastManagementOpenedViaAside() || this.ticketService.isManagementSpaTabOpen(returnContext.managementType)) {
        returnContext.openedManagementTabForInit = true;
      }
    }
    _shouldCloseManagementTabOnCleanup(returnContext) {
      return returnContext.openedManagementTabForInit && !returnContext.managementTabWasOpen;
    }
    _clearReturnContext() {
      this._returnContext = null;
    }
    _scheduleManagementTabCleanupOnDialogClose(type, shouldClose) {
      if (!shouldClose) {
        return;
      }
      if (this._dialogCleanupObserver) {
        this._dialogCleanupObserver.disconnect();
        this._dialogCleanupObserver = null;
      }
      const cleanup = () => {
        if (this._isTargetDialogOpen(type)) {
          return;
        }
        this._dialogCleanupObserver?.disconnect();
        this._dialogCleanupObserver = null;
        console.log("[Helper] SitePunishmentBridge: dialogCleanupObserver teardown");
        this.ticketService.suppressPermissionScan();
        try {
          this.ticketService.closeManagementTab(type);
        } finally {
          this.ticketService.releasePermissionScan();
        }
      };
      this._dialogCleanupObserver = new MutationObserver(cleanup);
      this._dialogCleanupObserver.observe(this.document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-state", "open"]
      });
      console.log("[Helper] SitePunishmentBridge: dialogCleanupObserver init");
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
        if (this.ticketService.invokeCachedSiteHandler(handler, type, cachedButton) && await this._waitForDialogOpen(type, 3e3)) {
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

  // IoHelper/modules/shared/RuleMatcher.js
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
  function detectSpamLinear(playerChatLog, spamRule, getSeverity) {
    const violations = [];
    for (const msgs of Object.values(playerChatLog)) {
      const sorted = [...msgs].sort((a, b) => a.time - b.time);
      const windowCounts = /* @__PURE__ */ new Map();
      let windowStart = 0;
      for (let i = 0; i < sorted.length; i++) {
        const current = sorted[i];
        while (windowStart < i && (current.time - sorted[windowStart].time) / 1e3 > 5) {
          const leaving = sorted[windowStart];
          const left = windowCounts.get(leaving.text);
          if (left) {
            left.count -= 1;
            if (left.count <= 0) {
              windowCounts.delete(leaving.text);
            }
          }
          windowStart += 1;
        }
        let bucket = windowCounts.get(current.text);
        if (!bucket) {
          bucket = { count: 0, firstIndex: i, rows: [] };
          windowCounts.set(current.text, bucket);
        }
        bucket.count += 1;
        bucket.rows.push(current.row);
        if (bucket.count > 4) {
          const first = sorted[bucket.firstIndex];
          violations.push({
            rows: [...bucket.rows],
            dupes: bucket.count,
            raw: first.raw,
            timeMs: first.time,
            severity: getSeverity(spamRule),
            duration: spamRule?.duration ?? 0
          });
          break;
        }
      }
    }
    return violations;
  }

  // IoHelper/modules/ticket/TicketScope.js
  var TicketScopeMethods = {
    getChatCacheKey(textarea) {
      const scope = this.getTicketScopeRoot(textarea);
      const blocks = this.getHistoryBlocks(scope);
      const offenderId = blocks.offenderSteamId || "unknown";
      const scopeToken = scope?.getAttribute?.("aria-hidden") ?? scope?.className?.slice(0, 40) ?? "";
      const path = window.location.pathname || window.location.href;
      return `${path}|${offenderId}|${scopeToken}`;
    },
    getHistoryBlocks(scope, { force = false } = {}) {
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
        element?.closest("[data-ioh], .ioh-analysis-row, .ioh-analysis-label, .ioh-analysis-value, #mod-ticket-panel, #mod-notif-panel, #helper-suggest-badge, #ioh-ticket-punishment-actions, #ioh-ticket-issue-mute, #ioh-ticket-issue-ban, .ioh-badge-row, .ioh-account-created, .ioh-faceit-elo")
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
    findInfoFieldByLabels(labelTexts) {
      for (const labelText of labelTexts) {
        const field = this.findInfoField(labelText);
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

  // IoHelper/modules/ticket/ChatAnalyzer.js
  var ChatAnalyzerMethods = {
    resetChatAnalysisCache(textarea) {
      if (textarea) {
        const key = this.getChatCacheKey(textarea);
        this.chatSignatureByKey.delete(key);
        this.activePunishmentBadgeByKey.delete(key);
        this.invalidateHistoryCache(this.getTicketScopeRoot(textarea));
        return;
      }
      this.chatSignatureByKey.clear();
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
      const dateText = spans && spans[0] ? spans[0].innerText?.trim() : null;
      const timeText = spans && spans[1] ? spans[1].innerText?.trim() : "00:00";
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

  // IoHelper/modules/ticket/Verdict.js
  var VerdictMethods = {
    findRecentMuteForReasons(muteHistoryBlock, reasonNames) {
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
      let bestScore = -1;
      if (!Array.isArray(this.rules) || this.rules.length === 0) {
        return null;
      }
      this.rules.forEach((rule) => {
        const count = ruleCounters[rule.name] || 0;
        if (count > 0) {
          let score = this.getRuleSeverity(rule);
          if (rule.name === "\u041E\u0441\u043A\u043E\u0440\u0431\u043B\u0435\u043D\u0438\u0435" && count > 4) {
            score = 720;
          }
          if (score > bestScore) {
            bestScore = score;
            bestRule = { rule, count };
          }
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
        if (count < 4) {
          finalDuration = 0;
          finalDurationStr = "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435";
        }
      } else if (rule.name === "\u0420\u0430\u0441\u0438\u0437\u043C / \u0434\u0438\u0441\u043A\u0440\u0438\u043C\u0438\u043D\u0430\u0446\u0438\u044F" && count < 2) {
        finalDuration = 0;
        finalDurationStr = "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435";
      }
      return { finalName, finalDuration, finalDurationStr };
    },
    getWarningHistoryBlockScoped(scope) {
      return this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439", scope) || this.getBlockByHeaderScoped("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439", scope);
    },
    parseWarningHistoryRows(warningHistoryBlock) {
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

  // IoHelper/modules/ticket/AnalysisBadge.js
  var AnalysisBadgeMethods = {
    setSuggestedMuteReason(steamId, label) {
      this.suggestedMuteReason = label ? { steamId: steamId || "", label } : null;
    },
    getSuggestedMuteReason(steamId) {
      const entry = this.suggestedMuteReason;
      if (!entry?.label) {
        return null;
      }
      if (!entry.steamId || !steamId || entry.steamId === steamId) {
        return entry.label;
      }
      return null;
    },
    clearSuggestedMuteReason() {
      this.suggestedMuteReason = null;
    },
    handleTriggerClick(e) {
      const trigger = e.target.closest(".ioh-trigger-link");
      if (!trigger) return;
      const target = this.triggerRows.get(trigger.dataset.triggerId);
      if (!target) return;
      const rows = Array.isArray(target) ? target : [target];
      rows[0].scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      rows.forEach((row) => row.classList.add("ioh-chat-highlight"));
      setTimeout(() => {
        rows.forEach((row) => row.classList.remove("ioh-chat-highlight"));
      }, 1e3);
    },
    clearTicketRuleBadge() {
      this.document.getElementById("helper-suggest-badge")?.remove();
      this.activePunishmentBadgeByKey.clear();
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

  // IoHelper/modules/ticket/ActivePunishment.js
  var ActivePunishmentMethods = {
    LIFTED_STATUS_RGB: "21, 141, 183",
    ACTIVE_STATUS_RGBS: ["234, 179, 8", "250, 204, 21", "255, 193, 7"],
    DURATION_TEXT_RE: /(\d+)\s*(день|дня|дней|д\.|час|часа|часов|ч\.|мин|минут|м\.)/i,
    findActivePunishmentRow(historyBlock) {
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
        const dateText = spans[0]?.innerText?.trim();
        const timeText = spans[1]?.innerText?.trim();
        const durationText = cells[durationIndex]?.innerText?.trim();
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
    buildPunishmentPreviewPanel(activeRow) {
      if (!activeRow) {
        return "";
      }
      return `<span class="ioh-punishment-preview-tooltip__panel"><span class="ioh-punishment-preview-tooltip__panel-inner"><table><tbody>${activeRow.outerHTML}</tbody></table></span></span>`;
    },
    getPunishmentRowFingerprint(row) {
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
    buildActivePunishmentBadge(icon, message, activeRow) {
      const preview = this.buildPunishmentPreviewPanel(activeRow);
      return `<div class="ioh-badge-row ioh-punishment-preview-tooltip" tabindex="0"><span class="ioh-icon-box">${icon}</span><span><b>${message}</b></span>${preview}</div>`;
    }
  };

  // IoHelper/modules/ticket/AutoConnect.js
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
      const offenderId = this.extractSteamIdFromField(
        this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope)
      ) || "unknown";
      const path = window.location.pathname || window.location.href;
      return `${path}|${offenderId}`;
    },
    hasRecentlyAutoConnected(serverIp) {
      const normalized = String(serverIp || "").trim().toLowerCase();
      if (!normalized) {
        return false;
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
    markOffenderOffline(steamId) {
      if (!steamId) return;
      this.offenderOffline.set(steamId, Date.now() + this.LEFT_OFFENDER_TTL_MS);
    },
    clearOffenderOffline(steamId) {
      if (!steamId) return;
      this.offenderOffline.delete(steamId);
    },
    isOffenderOffline(steamId) {
      if (!steamId) return false;
      const expiresAt = this.offenderOffline.get(steamId);
      if (!expiresAt) return false;
      if (Date.now() >= expiresAt) {
        this.offenderOffline.delete(steamId);
        return false;
      }
      return true;
    },
    markOffenderRelocated(steamId, serverIp) {
      if (!steamId || !serverIp) return;
      this.offenderRelocated.set(steamId, {
        serverIp: String(serverIp).trim().toLowerCase(),
        expiresAt: Date.now() + this.LEFT_OFFENDER_TTL_MS
      });
    },
    clearOffenderRelocated(steamId) {
      if (!steamId) return;
      this.offenderRelocated.delete(steamId);
    },
    getOffenderRelocatedServer(steamId) {
      if (!steamId) return null;
      const entry = this.offenderRelocated.get(steamId);
      if (!entry) return null;
      if (Date.now() >= entry.expiresAt) {
        this.offenderRelocated.delete(steamId);
        return null;
      }
      return entry.serverIp;
    },
    getTicketComplaintParts() {
      const categoryField = this.findInfoFieldByLabels(["\u041F\u0440\u0438\u0447\u0438\u043D\u0430 \u0436\u0430\u043B\u043E\u0431\u044B", "\u041F\u0440\u0438\u0447\u0438\u043D\u0430"]);
      const valueBlock = this.findFieldValueBlock(categoryField);
      let category = valueBlock?.querySelector(":scope > span")?.textContent?.trim() || "";
      if (!category) {
        category = this.utils.parseComplaintCell(valueBlock || categoryField).category;
      }
      let playerText = this.getTicketPlayerMessageText();
      if (!playerText) {
        playerText = this.utils.parseComplaintCell(valueBlock || categoryField).playerText;
      }
      return { category, playerText };
    },
    getTicketPlayerMessageText() {
      const messageField = this.findInfoFieldByLabels(["\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043E\u0442 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F"]);
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
    getTicketComplaintCategory() {
      return this.getTicketComplaintParts().category;
    },
    getPlayerComplaintText() {
      return this.getTicketComplaintParts().playerText;
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
    getAutoConnectScope() {
      const visibleTextarea = this.findVisibleTicketResolutionTextarea();
      if (visibleTextarea) {
        return this.getTicketScopeRoot(visibleTextarea);
      }
      return this.findActiveComplaintScope();
    },
    scopeHasInProgressStatus(scope) {
      if (!scope) {
        return false;
      }
      const roots = [scope];
      const activePanel = this.findActiveComplaintScope();
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
      if (offenderSteamId && this.isOffenderOffline(offenderSteamId)) {
        return {
          allowed: false,
          reason: "\u043D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C \u043D\u0435\u0434\u0430\u0432\u043D\u043E \u0432\u044B\u0448\u0435\u043B \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u0430",
          debug: { connectTarget, connectSource }
        };
      }
      const category = this.getTicketComplaintCategory();
      const playerText = this.getPlayerComplaintText();
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
      return link.href.replace(/^steam:\/\/connect\//i, "").trim().toLowerCase() || null;
    },
    connectToSteamServer(serverIp) {
      const normalized = String(serverIp || "").trim().toLowerCase();
      if (!normalized) {
        return false;
      }
      const link = this.document.createElement("a");
      link.href = `steam://connect/${normalized}`;
      link.style.display = "none";
      this.document.body.appendChild(link);
      link.click();
      link.remove();
      return true;
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
      const offenderField = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope);
      const offenderSteamId = this.extractSteamIdFromField(offenderField);
      const relocatedIp = offenderSteamId ? this.getOffenderRelocatedServer(offenderSteamId) : null;
      if (!relocatedIp) {
        console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (\u0444\u043E\u0440\u0441-\u043F\u0435\u0440\u0435\u0435\u0437\u0434) \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: IP \u043F\u0435\u0440\u0435\u0435\u0437\u0434\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
        return false;
      }
      console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (\u0444\u043E\u0440\u0441-\u043F\u0435\u0440\u0435\u0435\u0437\u0434) \u043A \u0441\u0435\u0440\u0432\u0435\u0440\u0443:", relocatedIp);
      this.markAutoConnected(relocatedIp);
      this.connectToSteamServer(relocatedIp);
      return true;
    },
    connectToCurrentServer({ forceRelocate = false, analysisFallback = false } = {}) {
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
          `${logPrefix} \u0443\u0436\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u043B\u043E\u0441\u044C \u0434\u043B\u044F \u0441\u0435\u0440\u0432\u0435\u0440\u0430 (TTL 8 \u043C\u0438\u043D): ${connectTarget}`
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
        connectLink.click();
        return true;
      }
      console.log(`${logPrefix}: \u0441\u0441\u044B\u043B\u043A\u0430 steam:// \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430 \u0432 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0435 \u0442\u0438\u043A\u0435\u0442\u0430.`, decision.debug || "");
      return false;
    },
    hasActivePunishmentForVoiceFallback(textarea = null) {
      const scope = textarea ? this.getTicketScopeRoot(textarea) : this.getAutoConnectScope() || this.document.body;
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
      let kind = analysisResult?.kind;
      if (kind === "pending") {
        if (!textarea) {
          return false;
        }
        const settled = await this.waitForSettledChatHistory(textarea);
        if (!settled) {
          console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (voice-fallback) \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E: \u0447\u0430\u0442 \u0435\u0449\u0451 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043B\u0441\u044F");
          return false;
        }
        const fresh = await this.processTicketRules(textarea);
        kind = fresh?.kind;
      }
      if (kind !== "none" && kind !== "warning") {
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

  // IoHelper/modules/ticket/QueueCards.js
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

  // IoHelper/modules/ticket/PunishmentPanel.js
  var PunishmentPanelMethods = {
    _isExtensionPunishmentButton(button) {
      return button?.id === this.TICKET_MUTE_BUTTON_ID || button?.id === this.TICKET_BAN_BUTTON_ID || Boolean(button?.closest(`#${this.TICKET_PUNISHMENT_ACTIONS_ID}`));
    },
    async loadModeratorPermissions() {
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
      let button = this.getCachedIssueButton(type) ?? this.findSiteIssueButtonForType(type, { requireVisible: false });
      if (!button?.isConnected) {
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
      const byReorderId = aside.querySelector(
        'button.glass-fx[data-reorder-id="6"], button[class*="glass-fx"][data-reorder-id="6"]'
      );
      if (byReorderId && !this.isExtensionUiElement(byReorderId)) {
        return byReorderId;
      }
      const byMenuIcon = Array.from(aside.querySelectorAll("button")).filter((button) => !this.isExtensionUiElement(button)).find((button) => button.querySelector('use[href="#lc-menu"]'));
      if (byMenuIcon) {
        return byMenuIcon;
      }
      const byAriaExpanded = Array.from(aside.querySelectorAll("button[aria-expanded]")).filter((button) => !this.isExtensionUiElement(button) && !button.closest("nav")).find((button) => button.querySelector("svg"));
      if (byAriaExpanded) {
        return byAriaExpanded;
      }
      const buttons = Array.from(aside.querySelectorAll('button.glass-fx, button[class*="glass-fx"]')).filter((button) => !this.isExtensionUiElement(button) && !button.closest("nav"));
      return buttons.find((button) => button.querySelector("svg")) || buttons[0] || null;
    },
    findAsideManagementLink(type) {
      const route = this.getManagementRouteForType(type);
      const aside = this.document.querySelector("aside");
      if (!aside) {
        return null;
      }
      const link = aside.querySelector(
        `nav a.glass-fx[href="${route}"], nav a[class*="glass-fx"][href="${route}"]`
      );
      if (link && !this.isExtensionUiElement(link)) {
        return link;
      }
      return null;
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
      const tabExists = await this.waitForSpaTabExists(sectionTitle, 5e3);
      if (!tabExists) {
        this.debugPunishmentLog("management_tab_not_created", { type, via: "aside" });
        return false;
      }
      await this.waitForSpaTabActive(sectionTitle, 5e3);
      return true;
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
      if (!scopeEl) {
        return null;
      }
      const headers = scopeEl.querySelectorAll("h3");
      for (const header of headers) {
        const text = header.textContent || "";
        const ticketMatch = text.match(/(?:тикет|ticket|жалоб)[^#]*#(\d+)/i);
        if (ticketMatch) {
          return ticketMatch[1];
        }
        const hashMatch = text.match(/#(\d+)/);
        if (hashMatch && /тикет|ticket|жалоб/i.test(text)) {
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
    _isManagementPanelVisible(sectionTitle) {
      const headers = Array.from(this.document.querySelectorAll("span, h1, h2, h3")).filter((element) => !this.isExtensionUiElement(element) && element.textContent.trim() === sectionTitle);
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
      }
      return false;
    },
    _getManagementPanelRoot(header) {
      let element = header.parentElement;
      while (element && element !== this.document.body) {
        if (element.hasAttribute?.("aria-hidden")) {
          return element;
        }
        element = element.parentElement;
      }
      return null;
    },
    _isButtonInSection(button, sectionTitle) {
      if (!button) {
        return false;
      }
      const headers = Array.from(this.document.querySelectorAll("span, h1, h2, h3")).filter((element) => !this.isExtensionUiElement(element) && element.textContent.trim() === sectionTitle);
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
      return false;
    },
    findSiteIssueButtonInSection(sectionTitle, { requireVisible = true } = {}) {
      const headers = Array.from(this.document.querySelectorAll("span, h1, h2, h3")).filter((element) => !this.isExtensionUiElement(element) && element.textContent.trim() === sectionTitle);
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
      const offenderField = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope);
      return this.extractSteamIdFromField(offenderField);
    },
    getActivePunishmentScope() {
      return this.findActiveComplaintScope() || this._lastPunishmentScope;
    },
    handleTicketMuteButtonClick() {
      const scope = this.getActivePunishmentScope();
      const steamId = this.getOffenderSteamIdForScope(scope);
      void this.openSiteMuteForm(steamId);
    },
    handleTicketBanButtonClick() {
      const scope = this.getActivePunishmentScope();
      const steamId = this.getOffenderSteamIdForScope(scope);
      void this.openSiteBanForm(steamId);
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
    openSiteMuteForm(steamId) {
      return this.punishmentBridge.openMuteForm(steamId);
    },
    openSiteBanForm(steamId) {
      return this.punishmentBridge.openBanForm(steamId);
    },
    prefillMuteFormSteamId(steamId) {
      this._prefillPunishmentFormSteamId(steamId, "#mute-steamid64");
    },
    prefillBanFormSteamId(steamId) {
      this._prefillPunishmentFormSteamId(steamId, "#ban-steamid64");
    },
    _prefillPunishmentFormSteamId(steamId, inputSelector) {
      if (!steamId) {
        return;
      }
      const applyValue = (input) => {
        if (!input) {
          return false;
        }
        if (input.value !== steamId) {
          input.value = steamId;
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

  // IoHelper/modules/ticket/OffenderProfile.js
  var OffenderProfileMethods = {
    clearSteamAccountCreationDate() {
      this.document.querySelectorAll(".ioh-account-created").forEach((node) => node.remove());
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
      const faceitNode = field.parentNode.querySelector(".ioh-faceit-elo");
      if (faceitNode) {
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
      const accountNode = field.parentNode.querySelector(".ioh-account-created");
      if (accountNode) {
        accountNode.insertAdjacentElement("afterend", node);
      } else {
        field.insertAdjacentElement("afterend", node);
      }
      return valueDiv;
    },
    getOffenderFieldContext() {
      const ticketTextarea = this.findVisibleTicketResolutionTextarea() || this.document.querySelector('textarea[placeholder*="\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F"]');
      if (!ticketTextarea) {
        return null;
      }
      const scope = this.getTicketScopeRoot(ticketTextarea);
      const offenderField = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope) || this.findInfoField("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C");
      const offenderSteamId = this.extractSteamIdFromField(offenderField);
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
    extractSkillLevelFromFastmm(faceitProfile, elo, faceitMissing = false) {
      if (faceitMissing) {
        return { skillLevel: null, rankIconUrl: null };
      }
      let skillLevel = null;
      const level = Number(faceitProfile?.level);
      if (Number.isFinite(level) && level >= 1 && level <= 10) {
        skillLevel = String(level);
      }
      if (!skillLevel && elo) {
        const fromElo = this.faceitEloToSkillLevel(Number(elo));
        if (fromElo != null) {
          skillLevel = String(fromElo);
        }
      }
      const rankIconUrl = skillLevel ? `https://mobile.fastmm.win/img/rank/faceit/level${skillLevel}.png` : null;
      return { skillLevel, rankIconUrl };
    },
    extractOffenderProfileData(data, source = "fastmm") {
      const payload = data && typeof data === "object" ? data : {};
      const steamProfile = payload.steam?.profile || null;
      const faceitPayload = payload.faceit || null;
      const faceitProfile = faceitPayload?.profile || null;
      const creationDate = this.formatSteamCreationDate(steamProfile?.timecreated);
      const eloRaw = faceitProfile?.elo;
      const elo = eloRaw != null && String(eloRaw).trim() !== "" ? String(eloRaw).trim() : null;
      let faceitMissing = Boolean(faceitPayload?.error) || !faceitProfile || !elo;
      const { skillLevel, rankIconUrl } = this.extractSkillLevelFromFastmm(
        faceitProfile,
        elo,
        faceitMissing
      );
      return {
        creationDate,
        elo: faceitMissing ? null : elo,
        skillLevel: faceitMissing ? null : skillLevel,
        rankIconUrl: faceitMissing ? null : rankIconUrl,
        faceitMissing,
        source
      };
    },
    faceitEloToSkillLevel(elo) {
      if (!Number.isFinite(elo) || elo <= 0) return null;
      if (elo < 801) return 1;
      if (elo < 951) return 2;
      if (elo < 1101) return 3;
      if (elo < 1251) return 4;
      if (elo < 1401) return 5;
      if (elo < 1551) return 6;
      if (elo < 1701) return 7;
      if (elo < 1851) return 8;
      if (elo < 2001) return 9;
      return 10;
    },
    fetchOffenderProfile(steamId, { force = false } = {}) {
      if (!force && this.offenderProfileCache.has(steamId)) {
        return Promise.resolve(this.offenderProfileCache.get(steamId));
      }
      if (!force && this.offenderProfileInflight.has(steamId)) {
        return this.offenderProfileInflight.get(steamId);
      }
      const requestPromise = new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: "fetchOffenderProfile", steamId },
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
            this.offenderProfileCache.set(steamId, profileData);
            resolve(profileData);
          }
        );
      }).finally(() => {
        this.offenderProfileInflight.delete(steamId);
      });
      this.offenderProfileInflight.set(steamId, requestPromise);
      return requestPromise;
    },
    renderFaceitEloValue(valueNode, profileData) {
      if (!valueNode) return;
      valueNode.textContent = "";
      valueNode.classList.remove("ioh-account-value--error");
      if (!profileData?.elo) {
        valueNode.textContent = "\u2014";
        return;
      }
      if (profileData.rankIconUrl) {
        const img = this.document.createElement("img");
        img.className = "ioh-faceit-rank";
        img.src = profileData.rankIconUrl;
        img.alt = profileData.skillLevel ? `FaceIt level ${profileData.skillLevel} icon` : "FaceIt level icon";
        img.width = 22;
        img.height = 22;
        valueNode.appendChild(img);
      }
      const eloText = this.document.createElement("span");
      eloText.textContent = `${profileData.elo} Elo`;
      valueNode.appendChild(eloText);
    },
    renderProfileFieldError(valueNode, containerNode, steamId, reloadFn) {
      valueNode.textContent = "";
      valueNode.classList.add("ioh-account-value--error");
      const errorSpan = this.document.createElement("span");
      errorSpan.className = "ioh-account-error";
      errorSpan.textContent = "\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438";
      const retryBtn = this.document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "ioh-account-retry";
      retryBtn.title = "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C";
      retryBtn.textContent = "\u27F3";
      retryBtn.addEventListener("click", () => {
        valueNode.classList.remove("ioh-account-value--error");
        containerNode.dataset.loaded = "false";
        this.offenderProfileCache.delete(steamId);
        reloadFn({ force: true });
      });
      valueNode.appendChild(errorSpan);
      valueNode.appendChild(retryBtn);
    },
    async loadSteamAccountCreationDate(containerNode, steamId, { force = false } = {}) {
      const valueNode = containerNode.querySelector(".ioh-account-value");
      if (!valueNode) return;
      if (!force && containerNode.dataset.steamId === steamId && containerNode.dataset.loaded === "true") {
        return;
      }
      containerNode.dataset.steamId = steamId;
      containerNode.dataset.loaded = "false";
      valueNode.textContent = "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...";
      try {
        const profileData = await this.fetchOffenderProfile(steamId, { force });
        valueNode.classList.remove("ioh-account-value--error");
        valueNode.textContent = profileData.creationDate ? profileData.creationDate : "\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u0441\u043A\u0440\u044B\u0442";
        containerNode.dataset.loaded = "true";
      } catch (error) {
        this.renderProfileFieldError(
          valueNode,
          containerNode,
          steamId,
          (opts) => this.loadSteamAccountCreationDate(containerNode, steamId, opts)
        );
        containerNode.dataset.loaded = "true";
      }
    },
    async loadFaceitElo(containerNode, steamId, { force = false } = {}) {
      const valueNode = containerNode.querySelector(".ioh-faceit-value");
      if (!valueNode) return;
      if (!force && containerNode.dataset.steamId === steamId && containerNode.dataset.loaded === "true") {
        return;
      }
      containerNode.dataset.steamId = steamId;
      containerNode.dataset.loaded = "false";
      valueNode.textContent = "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...";
      try {
        const profileData = await this.fetchOffenderProfile(steamId, { force });
        this.renderFaceitEloValue(valueNode, profileData);
        containerNode.dataset.loaded = "true";
      } catch (error) {
        this.renderProfileFieldError(
          valueNode,
          containerNode,
          steamId,
          (opts) => this.loadFaceitElo(containerNode, steamId, opts)
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
      const valueNode = this.ensureFaceitEloNode(context.offenderField);
      const containerNode = valueNode.closest(".ioh-faceit-elo");
      await this.loadFaceitElo(containerNode, context.offenderSteamId);
    }
  };

  // IoHelper/modules/ticket/OffenderTracking.js
  var OffenderTrackingMethods = {
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
      for (const list of candidates) {
        if (Array.isArray(list) && list.length) {
          return list;
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
    extractVipName(result) {
      return this.normalizeVipName(result?.basic?.vip_name);
    },
    extractProfileVerified(result) {
      return Boolean(result?.verification?.profile);
    },
    parseUserDataResult(result) {
      return {
        serverIp: this.extractServerIpFromUserData(result),
        lastconnect: this.extractLastConnect(result),
        serverLabel: this.extractServerLabel(result),
        isBanned: this.extractActiveBan(result),
        isMuted: this.extractActiveMute(result),
        vipName: this.extractVipName(result),
        profileVerified: this.extractProfileVerified(result)
      };
    },
    getCachedUserData(steamId, ttlMs = 5e3) {
      const entry = this.userDataCache.get(steamId);
      if (!entry) {
        return null;
      }
      if (Date.now() - entry.fetchedAt >= ttlMs) {
        this.userDataCache.delete(steamId);
        return null;
      }
      return entry;
    },
    setCachedUserData(steamId, data) {
      this.userDataCache.set(steamId, {
        serverIp: data.serverIp ?? null,
        lastconnect: data.lastconnect ?? null,
        serverLabel: data.serverLabel ?? null,
        isBanned: Boolean(data.isBanned),
        isMuted: Boolean(data.isMuted),
        vipName: data.vipName ?? null,
        profileVerified: Boolean(data.profileVerified),
        fetchedAt: Date.now()
      });
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
          labelEl.textContent = text;
        } else {
          link.textContent = text;
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
        "ioh-punishment-action--mute"
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
      const label = type === "ban" ? "\u0417\u0410\u0411\u0410\u041D\u0415\u041D" : "\u0410\u041A\u0422\u0418\u0412\u041D\u042B\u0419 \u041C\u0423\u0422";
      control.classList.remove("ioh-punishment-action--ban", "ioh-punishment-action--mute");
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
    refreshOffenderProfileVerification() {
      this.document.querySelectorAll('a[href*="cybershoke.net/"][data-ioh-profile-verified-source]').forEach((link) => {
        this.applyOffenderProfileVerification(link, true);
      });
    },
    applyOffenderProfileVerification(offenderLink, profileVerified) {
      if (!offenderLink) {
        return;
      }
      if (profileVerified) {
        offenderLink.dataset.iohProfileVerifiedSource = "1";
      } else {
        delete offenderLink.dataset.iohProfileVerifiedSource;
      }
      const show = this.settings.features?.trackOffenderServer && Boolean(profileVerified);
      if (!show) {
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
      const vipColor = meta.variant === "lite" ? "#32a0ef" : "#feb611";
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
    async fetchUserData(steamId) {
      const response = await fetch("https://cybershoke.net/api/user/data", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "include",
        body: new URLSearchParams({ steamid64: steamId }).toString()
      });
      return response;
    },
    applyOffenderServerStatus(linkToUpdate, targetSteamId, targetIp, userData) {
      if (!linkToUpdate) {
        return;
      }
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
    async trackOpenTicketOffenderServer(cacheIntervalMs = null) {
      if (!this.settings?.features?.trackOffenderServer) {
        return;
      }
      const scope = this.getAutoConnectScope();
      if (!scope || !this.isActiveComplaintScope(scope)) {
        return;
      }
      if (!this.scopeHasInProgressStatus(scope)) {
        return;
      }
      const offenderField = this.findInfoFieldScoped("\u041D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C", scope);
      const offenderSteamId = this.extractSteamIdFromField(offenderField);
      if (!offenderSteamId) {
        console.log("[Helper] \u0422\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0442\u0438\u043A\u0435\u0442\u0430: skip \u2014 steamId \u043D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D");
        return;
      }
      const ticketConnectLink = this.findTicketServerConnectLink(scope);
      const ticketServerIp = this.extractServerIpFromConnectLink(ticketConnectLink);
      const CACHE_INTERVAL = Math.max(
        Number(cacheIntervalMs) || (this.settings.trackOffenderIntervalWhileReviewing || 30) * 1e3,
        1e3
      );
      const now = Date.now();
      if (now - this._openTicketOffenderLastCheck < CACHE_INTERVAL) {
        return;
      }
      if (this.globalServerCooldown && now < this.globalServerCooldown) {
        return;
      }
      let userData = this.getCachedUserData(offenderSteamId, CACHE_INTERVAL);
      if (!userData) {
        try {
          const response = await this.fetchUserData(offenderSteamId);
          if (response.status === 429) {
            this.globalServerCooldown = Date.now() + 660;
            console.log("[Helper] \u0422\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0442\u0438\u043A\u0435\u0442\u0430: skip \u2014 429 cooldown");
            return;
          }
          if (!response.ok) {
            console.log("[Helper] \u0422\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0442\u0438\u043A\u0435\u0442\u0430: skip \u2014 fetch failed", response.status);
            return;
          }
          const result = await response.json();
          userData = this.parseUserDataResult(result);
          this.setCachedUserData(offenderSteamId, userData);
        } catch (err) {
          console.log("[Helper] \u0422\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0442\u0438\u043A\u0435\u0442\u0430: skip \u2014 \u043E\u0448\u0438\u0431\u043A\u0430 fetch", err);
          return;
        }
      }
      this._openTicketOffenderLastCheck = Date.now();
      const currentIp = userData?.serverIp ? String(userData.serverIp).trim().toLowerCase() : null;
      if (!currentIp) {
        this.markOffenderOffline(offenderSteamId);
        this.clearOffenderRelocated(offenderSteamId);
        console.log("[Helper] \u0422\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0442\u0438\u043A\u0435\u0442\u0430: \u043D\u0430\u0440\u0443\u0448\u0438\u0442\u0435\u043B\u044C offline");
        return;
      }
      this.clearOffenderOffline(offenderSteamId);
      if (ticketServerIp && currentIp === ticketServerIp) {
        this.clearOffenderRelocated(offenderSteamId);
        return;
      }
      const previousRelocated = this.getOffenderRelocatedServer(offenderSteamId);
      this.markOffenderRelocated(offenderSteamId, currentIp);
      if (previousRelocated === currentIp) {
        return;
      }
      console.log("[Helper] \u0422\u0440\u0435\u043A\u0435\u0440 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0442\u0438\u043A\u0435\u0442\u0430: \u043F\u0435\u0440\u0435\u0435\u0437\u0434 \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D", {
        offenderSteamId,
        ticketServerIp,
        currentIp,
        previousRelocated
      });
      if (this.settings?.features?.autoConnectServer) {
        this.connectToCurrentServer({ forceRelocate: true });
      }
    },
    async checkOffendersServers(cacheIntervalMs = null, { singleRowPerPass = false } = {}) {
      const path = window.location.pathname || "";
      const href = window.location.href || "";
      const isQueuePage = href.includes("/support/reports") || href.includes("/support/tickets");
      const isDetailPage = !/\/support\/(tickets|reports)\b/i.test(path) && /\/ticket\/|\/reports?\//i.test(path);
      if (!isQueuePage && !isDetailPage) {
        return;
      }
      if (this.isCheckingServer) return;
      if (this.globalServerCooldown && Date.now() < this.globalServerCooldown) {
        return;
      }
      this.isCheckingServer = true;
      const CACHE_INTERVAL = Math.max(
        Number(cacheIntervalMs) || (this.settings.trackOffenderInterval || 5) * 1e3,
        1e3
      );
      const TICKET_AGE_LIMIT = (this.settings.ticketAgeLimit || 0) * 1e3;
      try {
        while (this.settings.features.trackOffenderServer) {
          if (this.globalServerCooldown && Date.now() < this.globalServerCooldown) {
            const waitMs = this.globalServerCooldown - Date.now();
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }
          const rows = this.document.querySelectorAll("table tbody tr");
          if (!rows.length) {
            break;
          }
          let targetRow = null;
          let targetIp = null;
          let targetSteamId = null;
          let oldestCheck = Infinity;
          const now = Date.now();
          for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            const timeCell = row.querySelector(".ticket-time, td:nth-child(1), td:nth-child(2)");
            if (timeCell) {
              const ticketTimeMs = this.utils.parseTimeToMs(timeCell.innerText) || new Date(timeCell.textContent.trim()).getTime();
              if (ticketTimeMs && now - ticketTimeMs < TICKET_AGE_LIMIT) {
                continue;
              }
            }
            const offenderLink = row.querySelector('td:nth-child(4) a[href*="cybershoke.net/"]');
            const serverIpLink = row.querySelector('td:nth-child(2) a[href^="steam://connect/"]');
            if (!offenderLink || !serverIpLink) continue;
            const ticketServerIp = this.ensureServerLinkOriginalIp(serverIpLink);
            const steamIdMatch = offenderLink.href.match(/\d{17,18}/);
            if (!steamIdMatch) continue;
            const lastCheck = parseInt(row.dataset.lastIpCheck || "0");
            if (now - lastCheck < CACHE_INTERVAL) continue;
            if (lastCheck === 0) {
              targetRow = row;
              targetIp = ticketServerIp;
              targetSteamId = steamIdMatch[0];
              break;
            }
            if (lastCheck < oldestCheck) {
              oldestCheck = lastCheck;
              targetRow = row;
              targetIp = ticketServerIp;
              targetSteamId = steamIdMatch[0];
            }
          }
          if (!targetRow) {
            break;
          }
          let userData = this.getCachedUserData(targetSteamId, CACHE_INTERVAL);
          if (!userData) {
            await new Promise((resolve) => setTimeout(resolve, 340));
            const response = await this.fetchUserData(targetSteamId);
            if (response.status === 429) {
              this.globalServerCooldown = Date.now() + 660;
              await new Promise((resolve) => setTimeout(resolve, 660));
              continue;
            }
            if (!response.ok) {
              continue;
            }
            const result = await response.json();
            userData = this.parseUserDataResult(result);
            this.setCachedUserData(targetSteamId, userData);
          }
          const actionState = this.rowActionIsInReview(targetRow) ? "review" : targetRow.querySelector(".ioh-punishment-action") ? "custom" : "accept";
          const snapshotKey = `${targetSteamId}|${userData.serverIp || ""}|${userData.vipName || ""}|${userData.profileVerified ? 1 : 0}|${userData.isBanned ? 1 : 0}|${userData.isMuted ? 1 : 0}|${actionState}`;
          if (!this._offenderRowSnapshots) {
            this._offenderRowSnapshots = /* @__PURE__ */ new WeakMap();
          }
          if (this._offenderRowSnapshots.get(targetRow) === snapshotKey) {
            targetRow.dataset.lastIpCheck = Date.now().toString();
            if (singleRowPerPass) {
              break;
            }
            continue;
          }
          this._offenderRowSnapshots.set(targetRow, snapshotKey);
          const linkToUpdate = targetRow.querySelector('td:nth-child(2) a[href^="steam://connect/"]');
          const offenderLinkToUpdate = targetRow.querySelector('td:nth-child(4) a[href*="cybershoke.net/"]');
          this.scheduleOffenderUi(() => {
            this.applyOffenderServerStatus(linkToUpdate, targetSteamId, targetIp, userData);
            this.applyOffenderPunishmentHighlight(targetRow, userData);
            this.applyOffenderVipBadge(offenderLinkToUpdate, userData.vipName);
            this.applyOffenderProfileVerification(offenderLinkToUpdate, userData.profileVerified);
            this.applyOffenderMuteBanIcons(offenderLinkToUpdate, targetRow, userData);
          });
          targetRow.dataset.lastIpCheck = Date.now().toString();
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
    }
  };

  // IoHelper/modules/TicketService.js
  var TicketService = class {
    constructor({ document: document2, utils, badgeService, settings, rules, muteExceptions = {}, chrome: chrome2 = null }) {
      this.document = document2;
      this.utils = utils;
      this.badgeService = badgeService;
      this.settings = settings;
      this._rules = rules;
      this._muteExceptions = muteExceptions;
      this.chrome = chrome2;
      this._ruleMatcher = compileRuleMatcher(rules, muteExceptions);
      this._scopeCache = /* @__PURE__ */ new WeakMap();
      this._offenderRowSnapshots = /* @__PURE__ */ new WeakMap();
      this._vipRafId = null;
      this._vipPending = /* @__PURE__ */ new Set();
      this.triggerRows = /* @__PURE__ */ new Map();
      this.handleTriggerClick = this.handleTriggerClick.bind(this);
      this.isCheckingServer = false;
      this.offenderProfileCache = /* @__PURE__ */ new Map();
      this.offenderProfileInflight = /* @__PURE__ */ new Map();
      this.autoConnectedServerIps = /* @__PURE__ */ new Map();
      this._autoConnectSkipLoggedIps = /* @__PURE__ */ new Set();
      this.chatSignatureByKey = /* @__PURE__ */ new Map();
      this.activePunishmentBadgeByKey = /* @__PURE__ */ new Map();
      this.suggestedMuteReason = null;
      this.globalServerCooldown = 0;
      this.offenderOffline = /* @__PURE__ */ new Map();
      this.offenderRelocated = /* @__PURE__ */ new Map();
      this.userDataCache = /* @__PURE__ */ new Map();
      this._openTicketOffenderLastCheck = 0;
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
      this._rules = value;
      this._ruleMatcher = compileRuleMatcher(value, this._muteExceptions);
    }
    get muteExceptions() {
      return this._muteExceptions;
    }
    set muteExceptions(value) {
      this._muteExceptions = value || {};
      this._ruleMatcher = compileRuleMatcher(this._rules, this._muteExceptions);
    }
    recompileRuleMatcher() {
      this._ruleMatcher = compileRuleMatcher(this._rules, this._muteExceptions);
    }
    async processTicketRules(textarea) {
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
            this.buildActivePunishmentBadge(banIcon, " \u0417\u0410\u0411\u0410\u041D\u0415\u041D", activeBanRow),
            textarea
          );
        }
        return { kind: "skip" };
      }
      const activeMuteRow = this.findActivePunishmentRow(muteHistoryBlock);
      if (activeMuteRow) {
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
            this.buildActivePunishmentBadge(muteIcon, " \u0410\u041A\u0422\u0418\u0412\u041D\u042B\u0419 \u041C\u0423\u0422", activeMuteRow),
            textarea
          );
        }
        return { kind: "skip" };
      }
      this.activePunishmentBadgeByKey.delete(cacheKey);
      const rows = Array.from(chatHistoryBlock?.querySelectorAll("tbody tr, tr") || []).filter((row) => row.querySelector("td"));
      const lastRow = rows[rows.length - 1];
      const chatEmpty = this.isChatHistoryEmptyScoped(scope) || rows.length === 0;
      const warnPart = this.getWarningHistorySignaturePart(warningHistoryBlock);
      const signature = chatEmpty ? `${pathname}|empty|${warnPart}` : `${pathname}|${rows.length}|${(lastRow.innerText || "").trim().slice(0, 220)}|${warnPart}`;
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
        this.clearSuggestedMuteReason();
        this.badgeService.updateInfoBadge(
          "helper-suggest-badge",
          "warning",
          `<div class="ioh-badge-row ioh-warning-text-tooltip" data-full-msg="${this.utils.escapeHtml(coveringWarning.text)}" title=""><span class="ioh-icon-box">${warningIcon}</span><span><b> \u0418\u0433\u0440\u043E\u043A\u0443 \u0443\u0436\u0435 \u0432\u044B\u0434\u0430\u043D\u043E \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435!</b></span></div>`,
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
      const topTriggersHTML = sortedTriggers.map((t) => `
    <span
        class="ioh-trigger-tooltip ioh-trigger-link"
        data-trigger-id="${t.id}"
        data-full-msg="${this.utils.escapeHtml(t.fullMessage)}">
        ${this.utils.escapeHtml(t.keyword)}
    </span>`).join('<span class="ioh-trigger-separator">,</span> ');
      let finalDurationForDisplay = finalDurationStr;
      if (finalDuration > 0) {
        const recentSameReasonMute = this.findRecentMuteForReasons(muteHistoryBlock, [finalName, mostSevere.rule.name]);
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
      const allViolations = [];
      const ruleCounters = {};
      (this.rules || []).forEach((rule) => {
        ruleCounters[rule.name] = 0;
      });
      const playerChatLog = {};
      const matcher = this._ruleMatcher;
      const getSeverity = (rule) => this.getRuleSeverity(rule);
      for (const row of rows) {
        const chatRow = this.getChatRowData(row);
        if (!chatRow || !chatRow.messageText) {
          continue;
        }
        if (!this.utils.isMessageWithin24Hours(chatRow.timeText)) {
          continue;
        }
        const msgTimeMs = this.utils.parseTimeToMs(chatRow.timeText);
        if (lastMuteDate && msgTimeMs && msgTimeMs <= lastMuteDate.getTime()) {
          continue;
        }
        const { authorText, messageText } = chatRow;
        const textLower = messageText.toLowerCase().trim();
        if (msgTimeMs && textLower.length > 0) {
          if (!playerChatLog[authorText]) {
            playerChatLog[authorText] = [];
          }
          playerChatLog[authorText].push({ time: msgTimeMs, text: textLower, raw: messageText, row });
        }
        const strongest = matcher.matchStrongest(textLower, messageText, getSeverity);
        if (!strongest) {
          continue;
        }
        ruleCounters[strongest.rule.name] += 1;
        const triggerId = crypto.randomUUID();
        this.triggerRows.set(triggerId, row);
        allViolations.push({
          id: triggerId,
          ruleName: strongest.rule.name,
          keyword: strongest.displayKeyword,
          fullMessage: messageText,
          severity: getSeverity(strongest.rule),
          duration: strongest.rule.duration,
          timeMs: msgTimeMs || null
        });
      }
      const spamRule = (this.rules || []).find((r) => r.name === "\u0421\u043F\u0430\u043C \u0432 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D/\u0447\u0430\u0442");
      for (const spam of detectSpamLinear(playerChatLog, spamRule, getSeverity)) {
        const triggerId = crypto.randomUUID();
        this.triggerRows.set(triggerId, spam.rows);
        allViolations.push({
          id: triggerId,
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
    OffenderTrackingMethods
  );

  // IoHelper/modules/PunishmentService.js
  var PunishmentService = class {
    constructor({ document: document2, durations, utils = null, ticketService = null }) {
      this.document = document2;
      this.utils = utils;
      this.ticketService = ticketService;
      this.durations = {
        defaultMuteReason: "Reason_Mute_Toxic",
        mute: {},
        ban: {},
        ...durations || {}
      };
      this.observer = null;
      this.debounceId = null;
      this.enabled = true;
      this.isProgrammaticSelectUpdate = false;
      this.userTimeSelectInteraction = null;
      this.boundReasonSelects = /* @__PURE__ */ new WeakSet();
      this.boundTimeChangeListeners = /* @__PURE__ */ new WeakSet();
      this.boundMuteTimeObservers = /* @__PURE__ */ new WeakSet();
      this.boundSteamIdInputs = /* @__PURE__ */ new WeakSet();
      this.desiredDurationByReasonSelect = /* @__PURE__ */ new WeakMap();
      this.userDurationOverrideByReason = /* @__PURE__ */ new WeakMap();
      this.durationRestoreIds = /* @__PURE__ */ new WeakMap();
      this.listboxBodyObserver = null;
      this.suppressDurationRestoreUntil = 0;
      this.handleReasonChange = this.handleReasonChange.bind(this);
    }
    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      if (!this.enabled) {
        this.teardown();
      }
    }
    init() {
      if (!this.enabled) {
        console.log("[Helper] PunishmentService: skip init \u2014 \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D");
        return;
      }
      console.log("[Helper] PunishmentService: init");
      this.teardown();
      this.scanDialogs();
    }
    teardown() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.listboxBodyObserver) {
        this.listboxBodyObserver.disconnect();
        this.listboxBodyObserver = null;
        console.log("[Helper] PunishmentService: listboxBodyObserver teardown");
      }
      if (this.debounceId) {
        clearTimeout(this.debounceId);
        this.debounceId = null;
      }
    }
    scheduleScan() {
      if (this.debounceId) {
        clearTimeout(this.debounceId);
      }
      this.debounceId = setTimeout(() => {
        this.debounceId = null;
        this.scanDialogs();
      }, 150);
    }
    isRelevantNode(node) {
      if (!node || node.nodeType !== 1) {
        return false;
      }
      if (node.matches?.('[role="dialog"]')) {
        return Boolean(
          node.querySelector?.("#mute-reason, #ban-reason") || node.querySelector?.("#mute-time, #ban-time")
        );
      }
      if (node.matches?.('#mute-reason, #ban-reason, #mute-time, #ban-time, [role="listbox"]')) {
        return true;
      }
      return Boolean(
        node.querySelector?.('#mute-reason, #ban-reason, #mute-time, [role="listbox"]')
      );
    }
    isMuteDurationListboxControl(el) {
      return Boolean(
        el && el.id === "mute-time" && el.tagName === "BUTTON"
      );
    }
    isNativeTimeSelect(el) {
      return Boolean(el && el.tagName === "SELECT");
    }
    scanDialogs() {
      if (!this.enabled) {
        return;
      }
      this.document.querySelectorAll('[role="dialog"]').forEach((dialog) => {
        const muteReason = dialog.querySelector("#mute-reason");
        const banReason = dialog.querySelector("#ban-reason");
        if (muteReason) {
          const muteTime = dialog.querySelector("#mute-time");
          this.bindForm("mute", muteReason, muteTime, dialog);
          if (muteTime) {
            this.bindTimeSelectListener(muteReason, muteTime);
            this.observeMuteTimeOptions(muteReason, muteTime);
          }
        }
        if (banReason) {
          this.bindForm("ban", banReason, dialog.querySelector("#ban-time"));
        }
      });
    }
    bindForm(type, reasonSelect, timeControl, dialog = null) {
      if (!reasonSelect || !timeControl) {
        return;
      }
      if (!this.boundReasonSelects.has(reasonSelect)) {
        this.boundReasonSelects.add(reasonSelect);
        reasonSelect.addEventListener("change", this.handleReasonChange);
        if (type === "mute") {
          void this.initializeMuteForm(reasonSelect, timeControl, dialog);
          if (dialog) {
            this.bindSteamIdListener(dialog, reasonSelect);
          }
        } else {
          this.applyDuration(reasonSelect, timeControl, type);
        }
        return;
      }
      this.syncMuteDurationAfterSiteUpdate(reasonSelect, timeControl);
    }
    hasUserDurationOverride(reasonSelect) {
      return Boolean(reasonSelect && this.userDurationOverrideByReason.get(reasonSelect));
    }
    isUserInteractingWithTimeControl(timeControl) {
      return Boolean(timeControl && this.userTimeSelectInteraction === timeControl);
    }
    isDurationRestoreSuppressed() {
      return Date.now() < this.suppressDurationRestoreUntil;
    }
    // Suppress only blocks redundant re-clicks while OUR value is already shown.
    // If the site overwrote the duration (common during first mute-form init /
    // management-tab remount), we must still restore the desired value.
    shouldSkipDurationRestore(reasonSelect, timeControl) {
      if (this.hasUserDurationOverride(reasonSelect) || this.isUserInteractingWithTimeControl(timeControl) || this.isProgrammaticSelectUpdate) {
        return true;
      }
      if (!this.isDurationRestoreSuppressed()) {
        return false;
      }
      const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
      const current = this.getTimeControlValue(timeControl);
      return desired != null && current === String(desired);
    }
    suppressDurationRestore(ms = 1200) {
      this.suppressDurationRestoreUntil = Date.now() + ms;
    }
    endProgrammaticSelectUpdate() {
      queueMicrotask(() => {
        setTimeout(() => {
          this.isProgrammaticSelectUpdate = false;
        }, 50);
      });
    }
    setUserDurationOverride(reasonSelect, enabled = true) {
      if (!reasonSelect) {
        return;
      }
      if (enabled) {
        this.userDurationOverrideByReason.set(reasonSelect, true);
      } else {
        this.userDurationOverrideByReason.delete(reasonSelect);
      }
    }
    clearUserDurationOverride(reasonSelect) {
      this.setUserDurationOverride(reasonSelect, false);
    }
    async initializeMuteForm(reasonSelect, timeControl, dialog = null) {
      this.clearUserDurationOverride(reasonSelect);
      dialog = dialog || reasonSelect.closest('[role="dialog"]');
      if (await this.applySuggestedMuteReason(reasonSelect, timeControl, dialog)) {
        await this.ensureMuteDurationSettled(dialog);
        return;
      }
      const synced = await this.syncMuteReasonFromSiteX2(
        reasonSelect,
        timeControl,
        dialog
      );
      if (synced) {
        await this.ensureMuteDurationSettled(dialog);
        return;
      }
      await this.applyDefaultMuteReason(reasonSelect, timeControl);
      await this.ensureMuteDurationSettled(dialog);
    }
    async ensureMuteDurationSettled(dialog = null) {
      const delays = [0, 250, 700, 1400, 2200];
      for (const delay of delays) {
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        const liveDialog = this.findOpenMuteDialog() || dialog;
        const reasonSelect = liveDialog?.querySelector("#mute-reason");
        const timeControl = liveDialog?.querySelector("#mute-time");
        if (!reasonSelect?.isConnected || !timeControl?.isConnected) {
          continue;
        }
        if (this.hasUserDurationOverride(reasonSelect) || this.isUserInteractingWithTimeControl(timeControl)) {
          return;
        }
        if (this.isMuteDurationAlreadyApplied(reasonSelect, timeControl, liveDialog)) {
          return;
        }
        await this.applyMuteListboxDuration(reasonSelect, timeControl);
      }
    }
    findOpenMuteDialog() {
      return Array.from(this.document.querySelectorAll('[role="dialog"]')).find((dialog) => dialog.querySelector("#mute-reason") && dialog.querySelector("#mute-time")) || null;
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
    async applySuggestedMuteReason(reasonSelect, timeControl, dialog) {
      const ticketService = this.ticketService;
      if (!ticketService) {
        return false;
      }
      const steamId = this.resolveMuteFormSteamId(dialog);
      let label = ticketService.getSuggestedMuteReason(steamId);
      if (!label && ticketService.suggestedMuteReason?.label) {
        label = ticketService.suggestedMuteReason.label;
      }
      if (!label || !this.setReasonByLabel(reasonSelect, label)) {
        return false;
      }
      if (this.isMuteDurationAlreadyApplied(reasonSelect, timeControl, dialog)) {
        return true;
      }
      await this.applyDuration(reasonSelect, timeControl, "mute");
      return true;
    }
    isMuteDurationAlreadyApplied(reasonSelect, timeControl, dialog = null) {
      if (!reasonSelect || !timeControl) {
        return false;
      }
      const current = this.getTimeControlValue(timeControl);
      if (current == null || current === "") {
        return false;
      }
      dialog = dialog || reasonSelect.closest('[role="dialog"]');
      const remembered = this.desiredDurationByReasonSelect.get(reasonSelect);
      const defaultDuration = this.getDefaultDuration("mute", reasonSelect.value);
      if (this.hasSiteX2Badge(dialog)) {
        return remembered != null && current === String(remembered);
      }
      if (defaultDuration != null && current === String(defaultDuration)) {
        this.rememberDesiredDuration(reasonSelect, defaultDuration);
        return true;
      }
      return false;
    }
    hasSiteX2Badge(dialog) {
      if (!dialog) {
        return false;
      }
      const label = dialog.querySelector('label[for="mute-time"]');
      const row = label?.parentElement;
      if (!row) {
        return false;
      }
      return Array.from(row.querySelectorAll("span")).some(
        (span) => (span.textContent || "").trim().toUpperCase() === "X2"
      );
    }
    setReasonByLabel(reasonSelect, reasonLabel) {
      if (!reasonSelect || !reasonLabel) {
        return false;
      }
      const normalized = this.normalizePunishmentReason(reasonLabel);
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
    findPreferredSiteX2Option(listbox, timeControl) {
      const x2Options = this.getDurationOptions(listbox).filter((option) => this.isX2Option(option));
      if (!x2Options.length) {
        return null;
      }
      const selected = x2Options.find((option) => option.getAttribute("aria-selected") === "true");
      if (selected) {
        return selected;
      }
      const buttonSeconds = this.parseDurationLabelToSeconds(this.getOptionPrimaryText(timeControl));
      if (buttonSeconds != null) {
        const byButton = x2Options.find((option) => this.parseDurationLabelToSeconds(this.getOptionPrimaryText(option)) === buttonSeconds);
        if (byButton) {
          return byButton;
        }
      }
      return x2Options[0];
    }
    async syncMuteReasonFromSiteX2(reasonSelect, timeControl, dialog) {
      if (!this.isMuteDurationListboxControl(timeControl)) {
        return false;
      }
      this.clearDurationRestore(reasonSelect);
      this.isProgrammaticSelectUpdate = true;
      try {
        const hasBadge = this.hasSiteX2Badge(dialog);
        const listbox = await this.waitForDurationListbox(timeControl);
        if (!listbox) {
          return false;
        }
        const x2Option = this.findPreferredSiteX2Option(listbox, timeControl);
        if (!x2Option) {
          this.closeMuteDurationListbox(timeControl);
          return hasBadge ? false : false;
        }
        const x2Reason = this.extractX2ReasonFromOption(x2Option);
        if (x2Reason) {
          this.setReasonByLabel(reasonSelect, x2Reason);
        }
        const seconds = this.parseDurationLabelToSeconds(this.getOptionPrimaryText(x2Option));
        const desired = seconds != null ? String(seconds) : `x2:${this.normalizePunishmentReason(x2Reason || "")}`;
        const needsClick = this.getTimeControlValue(timeControl) !== desired || x2Option.getAttribute("aria-selected") !== "true";
        if (needsClick) {
          x2Option.click();
          this.rememberDesiredDuration(reasonSelect, desired);
          this.suppressDurationRestore();
          await this.ensureMuteDurationListboxClosed(timeControl);
        } else {
          this.rememberDesiredDuration(reasonSelect, desired);
          this.closeMuteDurationListbox(timeControl);
          this.suppressDurationRestore();
        }
        return true;
      } finally {
        this.endProgrammaticSelectUpdate();
      }
    }
    getReasonLabel(reasonSelect) {
      const selectedOption = reasonSelect?.options?.[reasonSelect.selectedIndex];
      return selectedOption?.textContent?.trim() || "";
    }
    shouldApplyX2ForDefaultReason(reasonSelect, timeControl) {
      if (reasonSelect.value !== this.durations.defaultMuteReason) {
        return false;
      }
      const reasonLabel = this.getReasonLabel(reasonSelect);
      const x2Value = this.findX2TimeOption(timeControl, reasonLabel);
      if (x2Value == null) {
        return false;
      }
      const defaultDuration = this.getDefaultDuration("mute", reasonSelect.value);
      const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
      return defaultDuration != null && desired === String(defaultDuration);
    }
    syncMuteDurationAfterSiteUpdate(reasonSelect, timeControl) {
      if (!this.enabled || !reasonSelect?.isConnected || !timeControl?.isConnected) {
        return false;
      }
      if (this.shouldSkipDurationRestore(reasonSelect, timeControl)) {
        return false;
      }
      if (this.isMuteDurationListboxControl(timeControl)) {
        if (this.isMuteDurationAlreadyApplied(reasonSelect, timeControl)) {
          return false;
        }
        void this.applyMuteListboxDuration(reasonSelect, timeControl);
        return true;
      }
      if (this.shouldApplyX2ForDefaultReason(reasonSelect, timeControl)) {
        const reasonLabel = this.getReasonLabel(reasonSelect);
        const x2Value = this.findX2TimeOption(timeControl, reasonLabel);
        if (this.setSelectValue(timeControl, x2Value)) {
          this.rememberDesiredDuration(reasonSelect, x2Value);
        } else if (this.getTimeControlValue(timeControl) === String(x2Value)) {
          this.rememberDesiredDuration(reasonSelect, x2Value);
        }
        return true;
      }
      return this.restoreDesiredDuration(reasonSelect, timeControl);
    }
    async applyDefaultMuteReason(reasonSelect, timeControl) {
      this.clearUserDurationOverride(reasonSelect);
      const defaultReason = this.durations.defaultMuteReason;
      if (this.hasSelectOption(reasonSelect, defaultReason) && reasonSelect.value !== defaultReason) {
        this.setSelectValue(reasonSelect, defaultReason);
      }
      await this.applyDuration(reasonSelect, timeControl, "mute");
    }
    rememberDesiredDuration(reasonSelect, value) {
      if (!reasonSelect || value == null) {
        return;
      }
      this.desiredDurationByReasonSelect.set(reasonSelect, String(value));
    }
    restoreDesiredDuration(reasonSelect, timeControl) {
      if (!this.enabled || !reasonSelect?.isConnected || !timeControl?.isConnected) {
        return false;
      }
      if (this.hasUserDurationOverride(reasonSelect)) {
        return false;
      }
      const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
      if (desired == null) {
        return false;
      }
      if (!this.hasTimeControlOption(timeControl, desired)) {
        return false;
      }
      if (this.getTimeControlValue(timeControl) === String(desired)) {
        return false;
      }
      return this.setTimeControlValue(timeControl, desired);
    }
    clearDurationRestore(reasonSelect) {
      const timeouts = this.durationRestoreIds.get(reasonSelect);
      if (!timeouts) {
        return;
      }
      timeouts.forEach(clearTimeout);
      this.durationRestoreIds.delete(reasonSelect);
    }
    scheduleDurationRestore(reasonSelect, timeControl) {
      if (!this.enabled) {
        return;
      }
      if (this.shouldSkipDurationRestore(reasonSelect, timeControl)) {
        return;
      }
      this.clearDurationRestore(reasonSelect);
      const runRestore = () => {
        const dialog = reasonSelect.closest('[role="dialog"]') || this.findOpenMuteDialog();
        const currentReasonSelect = dialog?.querySelector("#mute-reason") || reasonSelect;
        const currentTimeControl = dialog?.querySelector("#mute-time") || timeControl;
        if (!currentReasonSelect?.isConnected || !currentTimeControl?.isConnected) {
          return;
        }
        if (this.shouldSkipDurationRestore(currentReasonSelect, currentTimeControl)) {
          return;
        }
        this.syncMuteDurationAfterSiteUpdate(currentReasonSelect, currentTimeControl);
      };
      const timeouts = [
        setTimeout(runRestore, 50),
        setTimeout(runRestore, 150),
        setTimeout(runRestore, 400),
        setTimeout(runRestore, 800),
        setTimeout(runRestore, 1600)
      ];
      this.durationRestoreIds.set(reasonSelect, timeouts);
    }
    bindSteamIdListener(dialog, reasonSelect) {
      const steamInput = dialog.querySelector("#mute-steamid64");
      if (!steamInput || this.boundSteamIdInputs.has(steamInput)) {
        return;
      }
      this.boundSteamIdInputs.add(steamInput);
      const handleSteamIdChange = () => {
        queueMicrotask(() => {
          void this.handleMuteSteamIdChange(dialog, reasonSelect);
        });
      };
      steamInput.addEventListener("input", handleSteamIdChange);
      steamInput.addEventListener("paste", handleSteamIdChange);
    }
    async handleMuteSteamIdChange(dialog, reasonSelect) {
      if (!this.enabled || this.hasUserDurationOverride(reasonSelect)) {
        return;
      }
      const liveDialog = this.findOpenMuteDialog() || dialog;
      if (!liveDialog?.isConnected) {
        return;
      }
      const liveReason = liveDialog.querySelector("#mute-reason") || reasonSelect;
      const timeControl = liveDialog.querySelector("#mute-time");
      if (!liveReason || !timeControl) {
        return;
      }
      this.bindTimeSelectListener(liveReason, timeControl);
      this.observeMuteTimeOptions(liveReason, timeControl);
      const suggested = this.ticketService?.suggestedMuteReason?.label;
      const currentReason = this.getReasonLabel(liveReason);
      const reasonMatchesSuggested = Boolean(
        suggested && this.normalizePunishmentReason(currentReason) === this.normalizePunishmentReason(suggested)
      );
      if (!reasonMatchesSuggested) {
        await this.applySuggestedMuteReason(liveReason, timeControl, liveDialog);
      }
      await this.applyMuteListboxDuration(liveReason, timeControl, { force: true });
    }
    bindTimeSelectListener(reasonSelect, timeControl) {
      if (this.boundTimeChangeListeners.has(timeControl)) {
        return;
      }
      this.boundTimeChangeListeners.add(timeControl);
      timeControl.addEventListener("pointerdown", () => {
        this.userTimeSelectInteraction = timeControl;
      });
      if (this.isNativeTimeSelect(timeControl)) {
        timeControl.addEventListener("change", () => {
          this.handleTimeSelectChange(reasonSelect, timeControl);
        });
        return;
      }
      if (this.isMuteDurationListboxControl(timeControl)) {
        const observer = new MutationObserver(() => {
          this.handleListboxButtonChange(reasonSelect, timeControl);
        });
        observer.observe(timeControl, {
          characterData: true,
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-expanded"]
        });
      }
    }
    handleListboxButtonChange(reasonSelect, timeControl) {
      if (this.isProgrammaticSelectUpdate) {
        return;
      }
      const expanded = timeControl.getAttribute("aria-expanded") === "true";
      const currentValue = this.getTimeControlValue(timeControl);
      if (this.userTimeSelectInteraction === timeControl) {
        if (expanded) {
          return;
        }
        this.userTimeSelectInteraction = null;
        const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
        if (currentValue && currentValue !== desired) {
          this.rememberDesiredDuration(reasonSelect, currentValue);
          this.setUserDurationOverride(reasonSelect, true);
        }
        return;
      }
      if (this.hasUserDurationOverride(reasonSelect)) {
        return;
      }
    }
    handleTimeSelectChange(reasonSelect, timeControl) {
      if (this.isProgrammaticSelectUpdate) {
        return;
      }
      const dialog = reasonSelect.closest('[role="dialog"]');
      const currentTimeControl = dialog?.querySelector("#mute-time") || timeControl;
      if (this.userTimeSelectInteraction === currentTimeControl) {
        this.userTimeSelectInteraction = null;
        const value = this.getTimeControlValue(currentTimeControl);
        this.rememberDesiredDuration(reasonSelect, value);
        this.setUserDurationOverride(reasonSelect, true);
        return;
      }
      if (this.hasUserDurationOverride(reasonSelect)) {
        return;
      }
    }
    observeMuteTimeOptions(reasonSelect, timeControl) {
      if (this.boundMuteTimeObservers.has(timeControl)) {
        return;
      }
      this.boundMuteTimeObservers.add(timeControl);
      const observer = new MutationObserver(() => {
        if (this.shouldSkipDurationRestore(reasonSelect, timeControl)) {
          return;
        }
        const desired = this.desiredDurationByReasonSelect.get(reasonSelect);
        const current = this.getTimeControlValue(timeControl);
        if (desired != null && current === String(desired)) {
          return;
        }
        this.scheduleDurationRestore(reasonSelect, timeControl);
      });
      observer.observe(timeControl, { childList: true, subtree: true, attributes: true });
      if (this.isMuteDurationListboxControl(timeControl) && this.document.body && !this.listboxBodyObserver) {
        this.listboxBodyObserver = new MutationObserver((mutations) => {
          if (this.isProgrammaticSelectUpdate) {
            return;
          }
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes || []) {
              if (node.nodeType === 1 && (node.matches?.('[role="listbox"]') || node.querySelector?.('[role="listbox"]'))) {
                const dialog = this.findOpenMuteDialog();
                const muteReason = dialog?.querySelector("#mute-reason");
                const muteTime = dialog?.querySelector("#mute-time");
                if (!muteReason || !muteTime || this.shouldSkipDurationRestore(muteReason, muteTime)) {
                  return;
                }
                const desired = this.desiredDurationByReasonSelect.get(muteReason);
                const current = this.getTimeControlValue(muteTime);
                if (desired != null && current === String(desired)) {
                  return;
                }
                this.scheduleDurationRestore(muteReason, muteTime);
                return;
              }
            }
          }
        });
        this.listboxBodyObserver.observe(this.document.body, { childList: true, subtree: true });
        console.log("[Helper] PunishmentService: listboxBodyObserver init");
      }
    }
    handleReasonChange(event) {
      const reasonSelect = event.currentTarget;
      if (this.isProgrammaticSelectUpdate) {
        return;
      }
      const dialog = reasonSelect.closest('[role="dialog"]');
      if (!dialog) {
        return;
      }
      const isMute = reasonSelect.id === "mute-reason";
      const timeControl = dialog.querySelector(isMute ? "#mute-time" : "#ban-time");
      if (!timeControl) {
        return;
      }
      this.desiredDurationByReasonSelect.delete(reasonSelect);
      this.clearUserDurationOverride(reasonSelect);
      this.clearDurationRestore(reasonSelect);
      this.applyDuration(reasonSelect, timeControl, isMute ? "mute" : "ban");
    }
    applyDuration(reasonSelect, timeControl, type) {
      if (this.isMuteDurationListboxControl(timeControl)) {
        return this.applyMuteListboxDuration(reasonSelect, timeControl);
      }
      const reasonValue = reasonSelect.value;
      const reasonLabel = this.getReasonLabel(reasonSelect);
      const targetValue = this.resolveTimeOptionValue({
        reasonValue,
        reasonLabel,
        timeControl,
        type
      });
      if (targetValue == null) {
        return false;
      }
      if (this.setSelectValue(timeControl, targetValue)) {
        this.rememberDesiredDuration(reasonSelect, targetValue);
        return true;
      }
      if (this.getTimeControlValue(timeControl) === String(targetValue)) {
        this.rememberDesiredDuration(reasonSelect, targetValue);
        return true;
      }
      return false;
    }
    async applyMuteListboxDuration(reasonSelect, timeControl, { force = false } = {}) {
      if (!this.enabled || !reasonSelect?.isConnected || !timeControl?.isConnected) {
        return false;
      }
      if (this.hasUserDurationOverride(reasonSelect) || this.isUserInteractingWithTimeControl(timeControl) || this.isProgrammaticSelectUpdate) {
        return false;
      }
      const dialog = reasonSelect.closest('[role="dialog"]') || this.findOpenMuteDialog();
      if (!force && this.isMuteDurationAlreadyApplied(reasonSelect, timeControl, dialog)) {
        return false;
      }
      const reasonValue = reasonSelect.value;
      const reasonLabel = this.getReasonLabel(reasonSelect);
      const defaultDuration = this.getDefaultDuration("mute", reasonValue);
      this.clearDurationRestore(reasonSelect);
      this.isProgrammaticSelectUpdate = true;
      try {
        const listbox = await this.waitForDurationListbox(timeControl);
        if (!listbox) {
          return false;
        }
        if (this.isUserInteractingWithTimeControl(timeControl)) {
          return false;
        }
        const x2Option = this.hasSiteX2Badge(dialog) ? this.findX2ListboxOption(reasonLabel, listbox) : null;
        let option = x2Option;
        let desired = null;
        if (x2Option) {
          const seconds = this.parseDurationLabelToSeconds(this.getOptionPrimaryText(x2Option));
          desired = seconds != null ? String(seconds) : `x2:${this.normalizePunishmentReason(reasonLabel)}`;
        } else {
          if (defaultDuration == null) {
            this.closeMuteDurationListbox(timeControl);
            return false;
          }
          option = this.findDurationListboxOptionBySeconds(Number(defaultDuration), listbox);
          desired = String(defaultDuration);
        }
        if (!option || desired == null) {
          this.closeMuteDurationListbox(timeControl);
          return false;
        }
        const alreadySelected = x2Option ? x2Option.getAttribute("aria-selected") === "true" : this.getTimeControlValue(timeControl) === desired;
        if (alreadySelected && this.getTimeControlValue(timeControl) === desired) {
          this.rememberDesiredDuration(reasonSelect, desired);
          this.clearDurationRestore(reasonSelect);
          this.suppressDurationRestore();
          this.closeMuteDurationListbox(timeControl);
          return false;
        }
        option.click();
        this.rememberDesiredDuration(reasonSelect, desired);
        this.clearDurationRestore(reasonSelect);
        this.suppressDurationRestore();
        await this.ensureMuteDurationListboxClosed(timeControl);
        return true;
      } finally {
        this.endProgrammaticSelectUpdate();
      }
    }
    normalizePunishmentReason(text) {
      return String(text || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
    }
    getDefaultDuration(type, reasonValue) {
      const map = type === "ban" ? this.durations.ban : this.durations.mute;
      return map?.[reasonValue] ?? null;
    }
    findDurationListbox() {
      return this.document.querySelector('[role="listbox"]');
    }
    getDurationOptions(listbox = this.findDurationListbox()) {
      if (!listbox) {
        return [];
      }
      return Array.from(listbox.querySelectorAll('[role="option"]'));
    }
    getOptionPrimaryText(optionEl) {
      if (!optionEl) {
        return "";
      }
      const clone = optionEl.cloneNode(true);
      clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
      return (clone.textContent || "").replace(/\s+/g, " ").trim();
    }
    getOptionSearchText(optionEl) {
      if (!optionEl) {
        return "";
      }
      const ariaLabel = optionEl.getAttribute?.("aria-label") || "";
      const sibling = optionEl.parentElement?.querySelector('[aria-hidden="true"]');
      const siblingText = sibling?.textContent || "";
      return `${ariaLabel} ${optionEl.textContent || ""} ${siblingText}`;
    }
    isX2Option(optionEl) {
      return /X2/i.test(this.getOptionSearchText(optionEl));
    }
    extractX2ReasonFromOption(optionEl) {
      const searchText = this.getOptionSearchText(optionEl);
      const ariaMatch = searchText.match(/X2\s+(.+?)\s+\d+/i) || searchText.match(/X2\s+([^\d(]+)/i);
      if (ariaMatch?.[1]) {
        return ariaMatch[1].trim();
      }
      const sibling = optionEl.parentElement?.querySelector('[aria-hidden="true"]');
      if (sibling) {
        const spans = Array.from(sibling.querySelectorAll("span"));
        const x2Index = spans.findIndex((span) => /X2/i.test(span.textContent || ""));
        if (x2Index >= 0 && spans[x2Index + 1]) {
          return (spans[x2Index + 1].textContent || "").trim();
        }
      }
      const legacyMatch = searchText.match(/—\s*(.+?)\s+X2/i);
      return legacyMatch?.[1]?.trim() || null;
    }
    parseDurationLabelToSeconds(label) {
      const text = String(label || "").trim();
      if (!text) {
        return null;
      }
      if (/навсегда/i.test(text)) {
        return 0;
      }
      if (this.utils?.parseDurationToMinutes) {
        const minutes = this.utils.parseDurationToMinutes(text);
        if (minutes > 0) {
          return minutes * 60;
        }
      }
      const normalized = text.toLowerCase();
      let totalMinutes = 0;
      const unitRegex = /(\d+)\s*(день|дня|дней|д\.|час|часа|часов|ч\.|мин|минут|м\.)/gi;
      let match;
      while ((match = unitRegex.exec(normalized)) !== null) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        if (unit.startsWith("\u0434")) totalMinutes += value * 24 * 60;
        else if (unit.startsWith("\u0447")) totalMinutes += value * 60;
        else totalMinutes += value;
      }
      return totalMinutes > 0 ? totalMinutes * 60 : null;
    }
    openMuteDurationListbox(button) {
      if (!button) {
        return this.findDurationListbox();
      }
      if (button.getAttribute("aria-expanded") === "true") {
        return this.findDurationListbox();
      }
      button.click();
      return this.findDurationListbox();
    }
    closeMuteDurationListbox(button) {
      if (!button || !this.isMuteDurationListboxControl(button)) {
        return;
      }
      if (button.getAttribute("aria-expanded") === "true") {
        button.click();
      }
    }
    isMuteDurationListboxOpen(button) {
      if (button?.getAttribute("aria-expanded") === "true") {
        return true;
      }
      return Boolean(this.findDurationListbox());
    }
    async ensureMuteDurationListboxClosed(button, attempts = 3) {
      if (!button || !this.isMuteDurationListboxControl(button)) {
        return;
      }
      for (let i = 0; i < attempts; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (!this.isMuteDurationListboxOpen(button)) {
          return;
        }
        this.closeMuteDurationListbox(button);
      }
    }
    waitForDurationListbox(button, attempts = 8) {
      return new Promise((resolve) => {
        if (button && button.getAttribute("aria-expanded") !== "true") {
          button.click();
        }
        const tryFind = (remaining) => {
          const listbox = this.findDurationListbox();
          if (listbox || remaining <= 0) {
            resolve(listbox || null);
            return;
          }
          setTimeout(() => tryFind(remaining - 1), 50);
        };
        tryFind(attempts);
      });
    }
    findX2ListboxOption(reasonLabel, listbox) {
      if (!reasonLabel || !listbox) {
        return null;
      }
      const normalizedReason = this.normalizePunishmentReason(reasonLabel);
      for (const option of this.getDurationOptions(listbox)) {
        if (!this.isX2Option(option)) {
          continue;
        }
        const x2Reason = this.extractX2ReasonFromOption(option);
        if (x2Reason && this.normalizePunishmentReason(x2Reason) === normalizedReason) {
          return option;
        }
      }
      return null;
    }
    findDurationListboxOptionBySeconds(seconds, listbox) {
      if (seconds == null || !listbox) {
        return null;
      }
      const target = Number(seconds);
      for (const option of this.getDurationOptions(listbox)) {
        if (this.isX2Option(option) && target !== 0) {
          continue;
        }
        const primary = this.getOptionPrimaryText(option);
        const parsed = this.parseDurationLabelToSeconds(primary);
        if (parsed != null && parsed === target) {
          return option;
        }
      }
      for (const option of this.getDurationOptions(listbox)) {
        const primary = this.getOptionPrimaryText(option);
        const parsed = this.parseDurationLabelToSeconds(primary);
        if (parsed != null && parsed === target) {
          return option;
        }
      }
      return null;
    }
    findX2TimeOption(timeControl, reasonLabel) {
      if (!timeControl || !reasonLabel) {
        return null;
      }
      if (this.isMuteDurationListboxControl(timeControl)) {
        const listbox = this.findDurationListbox();
        const option = this.findX2ListboxOption(reasonLabel, listbox);
        if (!option) {
          return null;
        }
        const seconds = this.parseDurationLabelToSeconds(this.getOptionPrimaryText(option));
        return seconds != null ? String(seconds) : `x2:${this.normalizePunishmentReason(reasonLabel)}`;
      }
      if (!this.isNativeTimeSelect(timeControl)) {
        return null;
      }
      const normalizedReason = this.normalizePunishmentReason(reasonLabel);
      for (const option of timeControl.options) {
        const text = option.textContent || "";
        if (!/X2/i.test(text)) {
          continue;
        }
        const match = text.match(/—\s*(.+?)\s+X2/i);
        if (!match) {
          continue;
        }
        if (this.normalizePunishmentReason(match[1]) === normalizedReason) {
          return option.value;
        }
      }
      return null;
    }
    hasSelectOption(select, value) {
      if (!select || value == null || select.tagName !== "SELECT") {
        return false;
      }
      return Array.from(select.options).some((option) => option.value === String(value));
    }
    hasTimeControlOption(timeControl, value) {
      if (!timeControl || value == null) {
        return false;
      }
      if (this.isNativeTimeSelect(timeControl)) {
        return Array.from(timeControl.options).some((option) => option.value === String(value));
      }
      if (!this.isMuteDurationListboxControl(timeControl)) {
        return false;
      }
      const listbox = this.findDurationListbox();
      if (!listbox) {
        return /^-?\d+$/.test(String(value)) || String(value).startsWith("x2:");
      }
      if (String(value).startsWith("x2:")) {
        const reasonKey = String(value).slice(3);
        return this.getDurationOptions(listbox).some((option) => {
          if (!this.isX2Option(option)) return false;
          const x2Reason = this.extractX2ReasonFromOption(option);
          return x2Reason && this.normalizePunishmentReason(x2Reason) === reasonKey;
        });
      }
      return Boolean(this.findDurationListboxOptionBySeconds(Number(value), listbox));
    }
    getTimeControlValue(timeControl) {
      if (!timeControl) {
        return "";
      }
      if (this.isNativeTimeSelect(timeControl)) {
        return String(timeControl.value || "");
      }
      if (this.isMuteDurationListboxControl(timeControl)) {
        const label = this.getOptionPrimaryText(timeControl);
        const seconds = this.parseDurationLabelToSeconds(label);
        return seconds != null ? String(seconds) : label;
      }
      return "";
    }
    resolveTimeOptionValue({ reasonValue, reasonLabel, timeControl, type }) {
      const x2Value = this.findX2TimeOption(timeControl, reasonLabel);
      if (x2Value != null) {
        return x2Value;
      }
      const defaultDuration = this.getDefaultDuration(type, reasonValue);
      if (defaultDuration == null) {
        return null;
      }
      if (this.isMuteDurationListboxControl(timeControl)) {
        return String(defaultDuration);
      }
      if (!this.hasSelectOption(timeControl, defaultDuration)) {
        return null;
      }
      return String(defaultDuration);
    }
    async setMuteDurationByValue(button, value) {
      if (!button || value == null) {
        return false;
      }
      if (this.isUserInteractingWithTimeControl(button) || this.isProgrammaticSelectUpdate) {
        return false;
      }
      const dialog = button.closest('[role="dialog"]');
      const reasonSelect = dialog?.querySelector("#mute-reason");
      if (reasonSelect && this.hasUserDurationOverride(reasonSelect)) {
        return false;
      }
      const nextValue = String(value);
      const current = this.getTimeControlValue(button);
      if (current === nextValue) {
        return false;
      }
      if (reasonSelect) {
        this.clearDurationRestore(reasonSelect);
      }
      this.isProgrammaticSelectUpdate = true;
      try {
        let listbox = this.findDurationListbox();
        if (!listbox || button.getAttribute("aria-expanded") !== "true") {
          listbox = await this.waitForDurationListbox(button);
        }
        if (!listbox) {
          return false;
        }
        if (this.isUserInteractingWithTimeControl(button)) {
          return false;
        }
        const reasonLabel = reasonSelect ? this.getReasonLabel(reasonSelect) : "";
        let option = null;
        if (nextValue.startsWith("x2:")) {
          const reasonKey = nextValue.slice(3);
          option = this.getDurationOptions(listbox).find((opt) => {
            if (!this.isX2Option(opt)) {
              return false;
            }
            const x2Reason = this.extractX2ReasonFromOption(opt);
            return x2Reason && this.normalizePunishmentReason(x2Reason) === reasonKey;
          }) || null;
        } else {
          const x2Option = this.findX2ListboxOption(reasonLabel, listbox);
          const x2Seconds = x2Option ? this.parseDurationLabelToSeconds(this.getOptionPrimaryText(x2Option)) : null;
          if (x2Option && x2Seconds != null && String(x2Seconds) === nextValue) {
            option = x2Option;
          } else {
            option = this.findDurationListboxOptionBySeconds(Number(nextValue), listbox);
          }
        }
        if (!option) {
          this.closeMuteDurationListbox(button);
          return false;
        }
        option.click();
        if (reasonSelect) {
          this.clearDurationRestore(reasonSelect);
        }
        this.suppressDurationRestore();
        await this.ensureMuteDurationListboxClosed(button);
        return true;
      } finally {
        this.endProgrammaticSelectUpdate();
      }
    }
    setTimeControlValue(timeControl, value) {
      if (!timeControl || value == null) {
        return false;
      }
      if (this.isMuteDurationListboxControl(timeControl)) {
        const current = this.getTimeControlValue(timeControl);
        if (current === String(value)) {
          return false;
        }
        void this.setMuteDurationByValue(timeControl, value);
        return true;
      }
      return this.setSelectValue(timeControl, value);
    }
    setSelectValue(select, value) {
      if (!select || value == null) {
        return false;
      }
      if (select.tagName !== "SELECT") {
        return false;
      }
      const nextValue = String(value);
      if (select.value === nextValue) {
        return false;
      }
      this.isProgrammaticSelectUpdate = true;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          "value"
        );
        if (descriptor?.set) {
          descriptor.set.call(select, nextValue);
        } else {
          select.value = nextValue;
        }
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } finally {
        this.isProgrammaticSelectUpdate = false;
      }
    }
  };

  // IoHelper/modules/DOMCoordinator.js
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
      this.complaintQueueTableObservers = /* @__PURE__ */ new Map();
      this.ticketPanelVisibilityObserver = null;
      this.ticketPanelVisibilityDebounceId = null;
      this.observedTicketPanelRoots = /* @__PURE__ */ new WeakSet();
    }
    on(event, handler) {
      const list = this.listeners.get(event) || [];
      list.push(handler);
      this.listeners.set(event, list);
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
      if (this.tablesRowsRafId) {
        cancelAnimationFrame(this.tablesRowsRafId);
        this.tablesRowsRafId = null;
      }
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
      for (const mutation of mutations) {
        if (isIohNode(mutation.target)) {
          continue;
        }
        for (const node of mutation.addedNodes || []) {
          if (!node || node.nodeType !== 1 || isIohNode(node)) {
            continue;
          }
          if (node.matches?.("tr")) {
            newRows.add(node);
            continue;
          }
          const nestedRows = node.querySelectorAll?.("tr") || [];
          nestedRows.forEach((row2) => newRows.add(row2));
        }
        const target = mutation.target;
        const row = target?.nodeType === 1 ? target.closest?.("tbody tr") : target?.parentElement?.closest?.("tbody tr");
        if (row && !newRows.has(row)) {
          updatedRows.add(row);
        }
      }
      if (newRows.size) {
        newRows.forEach((row) => this.app._applyRowHighlights(row));
      }
      if (updatedRows.size) {
        this.scheduleRowHighlights(updatedRows);
      }
    }
    observeComplaintQueueTable(table) {
      if (this.complaintQueueTableObservers.has(table)) {
        return;
      }
      const tbody = table.querySelector("tbody");
      if (!tbody) {
        return;
      }
      const observer = new MutationObserver((mutations) => {
        this.handleComplaintQueueTableMutations(mutations);
      });
      observer.observe(tbody, {
        childList: true,
        subtree: true,
        characterData: true
      });
      this.complaintQueueTableObservers.set(table, observer);
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
      if (this.isRelevantNotificationNode(node)) {
        this.emit("notification");
      }
      if (this.isRelevantTicketMountNode(node)) {
        this.emit("ticketMounted");
      }
      if (this.isCurrentServerNode(node) || node.querySelector?.('a[href*="cybershoke.net/"]')) {
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
      if (this.tablesRowsRafId) {
        cancelAnimationFrame(this.tablesRowsRafId);
      }
      const rowsToUpdate = rows;
      this.tablesRowsRafId = requestAnimationFrame(() => {
        this.tablesRowsRafId = null;
        rowsToUpdate.forEach((row) => this.app._applyRowHighlights(row));
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

  // IoHelper/modules/App.js
  var App = class {
    constructor({ window: window2, document: document2, chrome: chrome2, config }) {
      this.window = window2;
      this.document = document2;
      this.chrome = chrome2;
      this.rules = config.muteRules || [];
      this.muteExceptions = config.muteExceptions || {};
      this.templates = config.templates || {};
      this.settings = config.settings;
      this.features = this.settings.features;
      this.reasonTriggers = this.settings.reasonTriggers;
      this.reasonTriggersAutoconnect = this.settings.reasonTriggersAutoconnect;
      this.ipTrackTimeoutId = null;
      this.ticketChatHistoryObservers = /* @__PURE__ */ new Map();
      this.visibilityCatchUpInstalled = false;
      this.visibilityCatchUpDebounceId = null;
      this.navigationWatcherInstalled = false;
      this._lastHref = this.window?.location?.href || "";
      this._lastTicketSectionPath = "";
      this._lastVisibleTicketTextarea = null;
      this._lastAutoConnectTicketKey = null;
      this._wasOnComplaintDetail = this.isComplaintDetailPage();
      this.utils = new Utils({ document: document2 });
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
        muteExceptions: this.muteExceptions,
        chrome: chrome2
      });
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
        durations: config.punishmentDurations,
        utils: this.utils,
        ticketService: this.ticketService
      });
      this.domCoordinator = new DOMCoordinator(this);
      this.messageService.ticketService = this.ticketService;
      this.bindCoordinatorEvents();
    }
    bindCoordinatorEvents() {
      this.domCoordinator.on("notification", () => this.initNotificationPanels());
      this.domCoordinator.on("ticketMounted", () => {
        this.initTicketSectionFeatures();
        this.domCoordinator.refreshComplaintQueueVisibilityObserver();
        if (this.features.highlightNewAccounts || this.features.highlightComplaintTriggers) {
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
        if (this.features.autoPunishmentDuration !== false) {
          this.punishmentService.scheduleScan();
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
            chrome: this.chrome
          });
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
    start() {
      fetch(chrome.runtime.getURL("icons/icons.json")).then((r) => r.json()).then((data) => {
        window.Icons = data;
        this.runDOMUpdates();
      });
      this.chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !changes.helperSettings) {
          return;
        }
        const settings = changes.helperSettings.newValue || {};
        this.updateSettings(settings);
      });
      this.initNavigationWatcher();
      this.domCoordinator.init();
      this.initPunishmentFormObserver();
      this.ticketService.initMuteIssueFeature();
      this.initVisibilityCatchUpListener();
      this.handleTrackOffenderLoop();
    }
    updateSettings(settings) {
      const previousSettings = structuredClone(this.settings);
      const previousFeatures = previousSettings?.features || {};
      const newAccountHoursChanged = previousSettings?.newAccountHours !== settings.newAccountHours;
      const newAccountsReenabled = !previousFeatures.highlightNewAccounts && settings.features?.highlightNewAccounts;
      this.settings = {
        ...this.settings,
        ...settings,
        features: {
          ...this.settings.features,
          ...settings.features || {}
        }
      };
      if (settings.reasonTriggersAutoconnect) {
        this.settings.reasonTriggersAutoconnect = settings.reasonTriggersAutoconnect;
      }
      this.features = this.settings.features;
      this.reasonTriggers = this.settings.reasonTriggers;
      this.reasonTriggersAutoconnect = this.settings.reasonTriggersAutoconnect;
      this.messageService.settings = this.settings;
      this.ticketService.settings = this.settings;
      this.ticketService.rules = this.rules;
      this.ticketService.muteExceptions = this.muteExceptions;
      this.ticketService.recompileRuleMatcher();
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
      this.punishmentService.setEnabled(this.features.autoPunishmentDuration !== false);
      if (this.features.autoPunishmentDuration !== false) {
        this.initPunishmentFormObserver();
      }
      this.runDOMUpdates();
      this.domCoordinator.init();
      this.handleTrackOffenderLoop(previousSettings);
    }
    handleTrackOffenderLoop(previousSettings = null) {
      const isEnabled = this.features.trackOffenderServer;
      const currentInterval = this.settings.trackOffenderInterval || 5;
      const currentReviewInterval = this.settings.trackOffenderIntervalWhileReviewing || 30;
      const prevInterval = previousSettings?.trackOffenderInterval;
      const prevReviewInterval = previousSettings?.trackOffenderIntervalWhileReviewing;
      const intervalChanged = prevInterval !== void 0 && prevInterval !== currentInterval;
      const reviewIntervalChanged = prevReviewInterval !== void 0 && prevReviewInterval !== currentReviewInterval;
      if (!isEnabled || intervalChanged || reviewIntervalChanged) {
        if (this.ipTrackTimeoutId) {
          clearTimeout(this.ipTrackTimeoutId);
          this.ipTrackTimeoutId = null;
        }
      }
      if (isEnabled && !this.ipTrackTimeoutId) {
        void this.runOffenderTrackingPass();
        this.scheduleNextOffenderInterval();
      }
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
      return this.isComplaintDetailPage() ? this.settings.trackOffenderIntervalWhileReviewing || 30 : this.settings.trackOffenderInterval || 5;
    }
    syncOffenderTrackingForPage() {
      const next = this.isComplaintDetailPage();
      if (this._wasOnComplaintDetail === next) {
        return;
      }
      const exitedDetail = this._wasOnComplaintDetail && !next;
      this._wasOnComplaintDetail = next;
      if (!this.features.trackOffenderServer) {
        return;
      }
      if (this.ipTrackTimeoutId) {
        clearTimeout(this.ipTrackTimeoutId);
        this.ipTrackTimeoutId = null;
      }
      if (exitedDetail) {
        void (async () => {
          await this.runOffenderTrackingPass();
          this.scheduleNextOffenderInterval();
        })();
        return;
      }
      this.scheduleNextOffenderInterval();
    }
    async runOffenderTrackingPass() {
      if (!this.features.trackOffenderServer) {
        return;
      }
      if (this.document.hidden) {
        return;
      }
      try {
        const cacheIntervalMs = this.getOffenderTrackIntervalSec() * 1e3;
        if (this.isComplaintDetailPage()) {
          await this.ticketService.trackOpenTicketOffenderServer(cacheIntervalMs);
        }
        await this.ticketService.checkOffendersServers(cacheIntervalMs, {
          singleRowPerPass: this.isComplaintDetailPage()
        });
      } catch (err) {
        console.error(err);
      }
    }
    scheduleNextOffenderInterval() {
      if (!this.features.trackOffenderServer) {
        return;
      }
      const intervalMs = this.getOffenderTrackIntervalSec() * 1e3;
      this.ipTrackTimeoutId = setTimeout(async () => {
        this.ipTrackTimeoutId = null;
        await this.runOffenderTrackingPass();
        this.scheduleNextOffenderInterval();
      }, intervalMs);
    }
    cleanupChangedSettings(previousSettings, nextSettings) {
      const previousFeatures = previousSettings?.features || {};
      const nextFeatures = nextSettings.features;
      const triggersChanged = JSON.stringify(previousSettings?.reasonTriggers || []) !== JSON.stringify(nextSettings.reasonTriggers);
      const newAccountHoursChanged = previousSettings?.newAccountHours !== nextSettings.newAccountHours;
      if (!nextFeatures.highlightComplaintTriggers || triggersChanged) {
        this.messageService.clearComplaintTriggerHighlights();
      }
      if (!nextFeatures.highlightNewAccounts || newAccountHoursChanged) {
        this.messageService.clearNewAccountHighlights();
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
      const intervalChanged = previousSettings?.trackOffenderInterval !== nextSettings.trackOffenderInterval || previousSettings?.trackOffenderIntervalWhileReviewing !== nextSettings.trackOffenderIntervalWhileReviewing;
      if ((!nextFeatures.trackOffenderServer || intervalChanged) && this.ipTrackTimeoutId) {
        clearTimeout(this.ipTrackTimeoutId);
        this.ipTrackTimeoutId = null;
      }
      if (!nextFeatures.trackOffenderServer && previousFeatures.trackOffenderServer || !nextFeatures.showOffenderVipBadge && previousFeatures.showOffenderVipBadge !== false) {
        this.ticketService.clearOffenderVipBadges();
      }
      if (!nextFeatures.trackOffenderServer && previousFeatures.trackOffenderServer) {
        this.ticketService.clearOffenderProfileVerification();
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
      const ticketPath = window.location.pathname || window.location.href;
      if (this._lastTicketSectionPath !== ticketPath) {
        this._lastTicketSectionPath = ticketPath;
        this.ticketService.resetChatAnalysisCache();
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
      this.ticketService.refreshComplaintPunishmentButtons();
      this.syncOffenderTrackingForPage();
    }
    maybeAutoConnectOnTicketMount() {
      if (!this.features.autoConnectServer) {
        return;
      }
      const key = this.ticketService.getAutoConnectTicketKey();
      if (!key) {
        return;
      }
      if (this._lastAutoConnectTicketKey === key) {
        return;
      }
      this._lastAutoConnectTicketKey = key;
      console.log("[Helper] \u0410\u0432\u0442\u043E-\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435: mount \u0442\u0438\u043A\u0435\u0442\u0430", key);
      this.ticketService.connectToCurrentServer();
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
      if (this.features.autoPunishmentDuration === false) {
        this.punishmentService.teardown();
        return;
      }
      this.punishmentService.init();
    }
    initTableFeatures() {
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
      this.ticketService.resetChatAnalysisCache();
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
      this.ticketService.resetChatAnalysisCache();
    }
    _findChatHistoryBlockScoped(scopeEl) {
      return this._findHistoryBlockScoped(scopeEl, ["\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0427\u0430\u0442\u0430"]);
    }
    _findWarningHistoryBlockScoped(scopeEl) {
      return this._findHistoryBlockScoped(scopeEl, ["\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439", "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439"]);
    }
    _findHistoryBlockScoped(scopeEl, headerTexts) {
      const containers = [];
      if (scopeEl) {
        containers.push(scopeEl);
        const closestSection = scopeEl.closest?.('section, article, main, [role="main"]');
        if (closestSection && !containers.includes(closestSection)) {
          containers.push(closestSection);
        }
      }
      containers.push(this.document.body);
      for (const container of containers) {
        for (const headerText of headerTexts) {
          const block = this.ticketService.getBlockByHeaderScoped(headerText, container);
          if (block) {
            return block;
          }
          const card = this.ticketService.getHistorySectionCard(headerText, container);
          if (card) {
            return card;
          }
        }
      }
      return null;
    }
    ensureTicketChatHistoryObserver(textarea) {
      if (this.ticketChatHistoryObservers.has(textarea)) return;
      if (!this.document.contains(textarea)) return;
      if (!this.ticketService.isVisibleTicketTextarea(textarea)) return;
      console.log("[Helper] ticketChatHistoryObserver: mount");
      const scopeEl = textarea.closest('section, article, main, [role="main"]') || textarea.parentElement || this.document.body;
      const entry = {
        observer: null,
        waitObserver: null,
        debounceTimerId: null,
        idleId: null,
        chatAttached: false,
        warningAttached: false
      };
      const observer = new MutationObserver((mutations) => {
        if (mutations.every((mutation) => isIohNode(mutation.target))) {
          return;
        }
        if (!this.features.processTicketRules) return;
        if (!this.ticketService.isVisibleTicketTextarea(textarea)) return;
        this.domCoordinator.notify("chatChanged");
        this._debouncedProcessTicketRules(textarea);
      });
      entry.observer = observer;
      const tryAttachBlocks = () => {
        const blocks = this.ticketService.getHistoryBlocks(scopeEl);
        const chatHistoryBlock = blocks.chat || this._findChatHistoryBlockScoped(scopeEl);
        const warningHistoryBlock = blocks.warning || this._findWarningHistoryBlockScoped(scopeEl);
        if (chatHistoryBlock && !entry.chatAttached) {
          observer.observe(chatHistoryBlock, { childList: true, subtree: true });
          entry.chatAttached = true;
          console.log("[Helper] ticketChatHistoryObserver: attached chat history");
        }
        if (warningHistoryBlock && !entry.warningAttached) {
          observer.observe(warningHistoryBlock, { childList: true, subtree: true });
          entry.warningAttached = true;
          console.log("[Helper] ticketChatHistoryObserver: attached warning history");
        }
        return entry.chatAttached;
      };
      const finishWaitObserver = (reason = "done") => {
        if (entry.waitObserver) {
          entry.waitObserver.disconnect();
          entry.waitObserver = null;
          console.log(`[Helper] ticketChatHistoryObserver: wait finish (${reason})`);
        }
      };
      if (tryAttachBlocks()) {
        this.ticketChatHistoryObservers.set(textarea, entry);
        this._runTicketChatAnalysis(textarea);
        if (!entry.warningAttached) {
          console.log("[Helper] ticketChatHistoryObserver: wait start (warning)");
          const waitObserver2 = new MutationObserver((mutations) => {
            if (mutations.every((mutation) => isIohNode(mutation.target))) {
              return;
            }
            if (!this.document.contains(textarea)) {
              finishWaitObserver("textarea gone");
              return;
            }
            tryAttachBlocks();
            if (entry.warningAttached) {
              finishWaitObserver("warning attached");
            }
          });
          entry.waitObserver = waitObserver2;
          waitObserver2.observe(this.document.body, { childList: true, subtree: true });
        }
        return;
      }
      console.log("[Helper] ticketChatHistoryObserver: wait start (chat)");
      const waitObserver = new MutationObserver((mutations) => {
        if (mutations.every((mutation) => isIohNode(mutation.target))) {
          return;
        }
        if (!this.document.contains(textarea)) {
          finishWaitObserver("textarea gone");
          return;
        }
        if (!tryAttachBlocks()) return;
        finishWaitObserver("chat attached");
        if (!this.ticketChatHistoryObservers.has(textarea)) {
          this.ticketChatHistoryObservers.set(textarea, entry);
        }
        this._runTicketChatAnalysis(textarea);
        if (!entry.warningAttached) {
          console.log("[Helper] ticketChatHistoryObserver: wait start (warning)");
          const warningWaitObserver = new MutationObserver((mutations2) => {
            if (mutations2.every((mutation) => isIohNode(mutation.target))) {
              return;
            }
            if (!this.document.contains(textarea)) {
              warningWaitObserver.disconnect();
              entry.waitObserver = null;
              console.log("[Helper] ticketChatHistoryObserver: wait finish (textarea gone)");
              return;
            }
            tryAttachBlocks();
            if (entry.warningAttached) {
              warningWaitObserver.disconnect();
              entry.waitObserver = null;
              console.log("[Helper] ticketChatHistoryObserver: wait finish (warning attached)");
            }
          });
          entry.waitObserver = warningWaitObserver;
          warningWaitObserver.observe(this.document.body, { childList: true, subtree: true });
        }
      });
      entry.waitObserver = waitObserver;
      this.ticketChatHistoryObservers.set(textarea, entry);
      waitObserver.observe(this.document.body, { childList: true, subtree: true });
    }
    _debouncedProcessTicketRules(textarea, delayMs = 100) {
      const entry = this.ticketChatHistoryObservers.get(textarea);
      if (!entry) return;
      if (!this.features.processTicketRules) return;
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
      if (!this.document.contains(textarea)) return;
      if (!this.ticketService.isVisibleTicketTextarea(textarea)) return;
      this.domCoordinator.notify("chatChanged");
      const settled = await this.ticketService.waitForSettledChatHistory(textarea);
      if (!settled) {
        console.log("[Helper] ticket chat analysis: history not settled, skip voice-fallback path");
      }
      const result = await this.ticketService.processTicketRules(textarea);
      await this.ticketService.maybeAutoConnectAfterChatAnalysis(result, textarea);
    }
    _getHighlightTargetRows() {
      if (this.messageService._isComplaintQueuePage()) {
        return this.messageService._getComplaintQueueRows();
      }
      return Array.from(this.document.querySelectorAll("table tbody tr"));
    }
    _reapplyTicketRowHighlights() {
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

  // IoHelper/content.js
  chrome.storage.local.get(["scriptEnabled", "helperSettings"], (result) => {
    const isEnabled = result.scriptEnabled !== false;
    if (!isEnabled) {
      return;
    }
    (async () => {
      const config = await ConfigService.load(chrome);
      config.settings = {
        ...config.settings,
        ...result.helperSettings || {}
      };
      config.settings.features = {
        ...config.settings.features,
        ...result.helperSettings?.features || {}
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
})();
//# sourceMappingURL=content.js.map
