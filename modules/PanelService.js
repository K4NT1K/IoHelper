class PanelService {
    constructor({ document }) {
        this.document = document;
    }

    getCommentText(name, clickCount, defaultText) {
        if (clickCount === 1) {
            return defaultText;
        }

        if (clickCount >= 3 && name === "Оск") {
            return "Мут за токсичность";
        }

        if (clickCount >= 2) {
            const action = ["Препятствие", "Ник"].includes(name)
                ? "Бан"
                : "Мут";

            return defaultText.replace("Выдан пред", action);
        }

        return defaultText;
    }

    createPanel(templates, target, panelId) {
        if (typeof templates === 'undefined') return this.document.createElement('div');
        const panel = this.document.createElement('div');
        panel.id = panelId;
        panel.className = 'moderhlpr-panel';
        Object.entries(templates).forEach(([name, text]) => {
            const btn = this.document.createElement('button');
            btn.className = 'moderhlpr-panel-btn';
            const icon = this.document.createElement('span');
            icon.className = 'moderhlpr-panel-btn-icon';
            icon.setAttribute('aria-hidden', 'true');

            const label = this.document.createElement('span');
            label.innerText = name;
            btn.append(icon, label);

            let clickCount = 0;
            let clickTimer = null;
            btn.onclick = (e) => {
                e.preventDefault();
                clickCount++;
                clearTimeout(clickTimer);
                clickTimer = setTimeout(() => {
                    const comment = this.getCommentText(name, clickCount, text);
                    const currentValue = target.value.trim();
                    target.value = currentValue ? `${currentValue}\n${comment}` : comment;
                    target.dispatchEvent(new Event('input', { bubbles: true }));
                    clickCount = 0;
                }, 250);
            };
            panel.appendChild(btn);
        });
        return panel;
    }
}

window.PanelService = PanelService;
