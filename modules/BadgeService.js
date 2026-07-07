class BadgeService {
    constructor({ document }) {
        this.document = document;
    }

    updateInfoBadge(elementId, variant, innerHTML, targetTextarea) {
        let badge = this.document.getElementById(elementId);
        if (!badge) {
            badge = this.document.createElement('div');
            badge.id = elementId;
            if (targetTextarea && targetTextarea.parentNode) {
                targetTextarea.parentNode.insertBefore(badge, targetTextarea);
            }
        }
        badge.className = `ioh-info-badge ioh-info-badge--${variant}`;
        badge.innerHTML = innerHTML;
    }

    async translateText(text, targetLang = 'RU') {
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang.toLowerCase()}&dt=t&q=${encodeURIComponent(text)}`;
            const response = await fetch(url);
            const data = await response.json();
            return data && data[0] ? { translated: data[0].map(item => item[0]).join('') } : null;
        } catch (err) { console.log("Google api error: ", err);return null; }
    }
}

window.BadgeService = BadgeService;
