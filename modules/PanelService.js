class PanelService {
    constructor({ document }) {
        this.document = document;
    }

    buildCommentText(name, clickCount, defaultText) {
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

            return defaultText.replace("Пред", action);
        }

        return defaultText;
    }

    readTrackedMessages(target) {
        try {
            return JSON.parse(target.dataset.iohTrackedMessages || '{}');
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

            return result.replace(/\s{2,}/g, ' ').replace(/\s+\./g, '.').trim();
        }

        const lines = textValue.split('\n');
        const lineIndex = lines.lastIndexOf(messageToRemove);

        if (lineIndex === -1) {
            return textValue;
        }

        lines.splice(lineIndex, 1);
        return lines.join('\n');
    }

    normalizeTextareaValue(textValue, { inline = false } = {}) {
        if (inline) {
            return String(textValue || '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        return textValue
            .split('\n')
            .map(line => line.trimEnd())
            .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
            .join('\n')
            .trim();
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
                nextValue = trimmedValue ? `${trimmedValue}\n${nextMessage}` : nextMessage;
            }
            trackedMessages[messageKey] = nextMessage;
        } else {
            delete trackedMessages[messageKey];
        }

        target.value = this.normalizeTextareaValue(nextValue, { inline });
        this.writeTrackedMessages(target, trackedMessages);
        target.dispatchEvent(new Event('input', { bubbles: true }));
    }

    createPanel(templates, target, panelId) {
        if (typeof templates === 'undefined' || templates === null) {
            return this.document.createElement('div');
        }

        const panel = this.document.createElement('div');
        panel.id = panelId;
        panel.className = 'ioh-panel';
        const inline = panelId === 'mod-notif-panel';
        const entries = this.normalizeTemplateEntries(templates);

        entries.forEach(([name, text]) => {
            const btn = this.document.createElement('button');
            btn.className = 'ioh-panel-btn';
            const icon = this.document.createElement('span');
            icon.className = 'ioh-panel-btn-icon';
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
            return templates
                .map(item => {
                    if (!item || typeof item !== 'object') {
                        return null;
                    }
                    const name = item.name ?? item.label;
                    const text = item.text ?? item.value;
                    if (!name || text == null) {
                        return null;
                    }
                    return [String(name), String(text)];
                })
                .filter(Boolean);
        }

        if (typeof templates === 'object') {
            const preferredOrder = [
                'Здравствуйте',
                'Оск',
                'Провокация',
                'Обход',
                'Препятствие',
                'Мониторинг',
                'Ник',
                'Расизм',
                'Спам'
            ];
            const entries = [];
            const used = new Set();

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
}

window.PanelService = PanelService;
