class PanelService {
    constructor({ document }) {
        this.document = document;
    }

    createPanel(templates, target, panelId) {
        if (typeof templates === 'undefined') return this.document.createElement('div');
        const panel = this.document.createElement('div');
        panel.id = panelId;
        panel.className = 'moderhlpr-panel';
        Object.entries(templates).forEach(([name, text]) => {
            const btn = this.document.createElement('button');
            btn.innerText = name;
            btn.className = 'moderhlpr-panel-btn';
            btn.onclick = (e) => {
                e.preventDefault();
                target.value = text;
                target.dispatchEvent(new Event('input', { bubbles: true }));
            };
            panel.appendChild(btn);
        });
        return panel;
    }
}

window.PanelService = PanelService;
window.ModerHLPRPanelService = PanelService;

