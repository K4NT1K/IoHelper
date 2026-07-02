class PanelService {
    constructor({ document }) {
        this.document = document;
        this.templateIcons = {
            'Оск': '',
            'Провокация': '',
            'Обход': '',
            'Препятствие': '',
            'Ник': '',
            'Спам': ''
        };
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
            icon.innerText = this.templateIcons[name] || '';

            const label = this.document.createElement('span');
            label.innerText = name;

            btn.append(icon, label);
            btn.onclick = (e) => {
                e.preventDefault();
                const currentValue = target.value.trim();
                target.value = currentValue ? `${currentValue}\n${text}` : text;
                target.dispatchEvent(new Event('input', { bubbles: true }));
            };
            panel.appendChild(btn);
        });
        return panel;
    }
}

window.PanelService = PanelService;
window.ModerHLPRPanelService = PanelService;

