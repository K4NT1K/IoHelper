// ============================================================
//  popup.js — управление настройками расширения
// ============================================================

// ---------- ДЕФОЛТНЫЕ ЗНАЧЕНИЯ ----------
const DEFAULTS = {
    features: {
        scanSchedulePage: true,
        highlightComplaintTriggers: true,
        highlightNewAccounts: true,
        highlightDuplicateServers: true,
        processTicketRules: true,
        manageEmptyBlocks: true,
        translateText: true
    },
    newAccountHours: 7,
    serverRefreshInterval: 30,
    complaintTriggers: [
        "крутилка", "крутилкой", "крутится", "krutilka", "krutilkoy",
        "hvh", "hwh", "хвх", "rage", "рейдж"
    ]
};

// ---------- ЭЛЕМЕНТЫ DOM ----------
const featureTogglesEl = document.getElementById('featureToggles');
const hoursInput = document.getElementById('newAccountHours');
const refreshIntervalInput = document.getElementById('serverRefreshInterval');
const triggersContainer = document.getElementById('triggersContainer');
const triggerInput = document.getElementById('triggerInput');
const addBtn = document.getElementById('addTriggerBtn');
const resetBtn = document.getElementById('resetDefaultsBtn');
const toast = document.getElementById('toastMsg');

// ---------- СОСТОЯНИЕ ----------
let currentSettings = {};

const storage = {
    get(keys, callback) {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.get(keys, callback);
            return;
        }

        const result = {};
        keys.forEach(key => {
            const value = localStorage.getItem(key);
            result[key] = value ? JSON.parse(value) : undefined;
        });
        callback(result);
    },
    set(data, callback) {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.set(data, callback);
            return;
        }

        Object.entries(data).forEach(([key, value]) => {
            localStorage.setItem(key, JSON.stringify(value));
        });
        callback?.();
    }
};

// ---------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ----------
function showToast(message, duration = 2000) {
    toast.textContent = message || 'Настройки сохранены';
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ---------- ОТРИСОВКА UI ----------
function renderToggles(features) {
    featureTogglesEl.innerHTML = '';
    const entries = [
        {
            key: 'scanSchedulePage',
            label: 'Сканировать расписание',
            desc: 'scanSchedulePage',
            help: 'Сохраняет модераторов при открытии страницы "Таймлайн" для подсветки в тикетах.'
        },
        {
            key: 'highlightComplaintTriggers',
            label: 'Подсветка триггеров жалоб',
            desc: 'highlightComplaintTriggers',
            help: 'Подсвечивает слова из списка триггеров в причине жалобы.'
        },
        {
            key: 'highlightNewAccounts',
            label: 'Подсветка новых аккаунтов',
            desc: 'highlightNewAccounts',
            help: 'Выделяет часы CYBERSHOKE меньше указанного порога.'
        },
        {
            key: 'highlightDuplicateServers',
            label: 'Дубликаты серверов',
            desc: 'highlightDuplicateServers',
            help: 'Подсвечивает жалобы, пришедшие с одного сервера.'
        },
        {
            key: 'processTicketRules',
            label: 'Анализ тикетов',
            desc: 'processTicketRules',
            help: 'Анализирует историю чата в тикете и показывает подсказку по нарушению и наказанию.'
        },
        {
            key: 'manageEmptyBlocks',
            label: 'Скрывать пустые блоки',
            desc: 'manageEmptyBlocks',
            help: 'Скрывает пустые блоки истории тикетов, банов, мутов и чата.'
        },
        {
            key: 'translateText',
            label: 'Перевод сообщений',
            desc: 'translateText',
            help: 'Добавляет перевод нерусских сообщений в истории чата при наведении на них курсором.'
        }
    ];

    entries.forEach(({ key, label, desc, help }) => {
        const item = document.createElement('div');
        item.className = 'toggle-item';

        const copyWrap = document.createElement('div');
        copyWrap.className = 'toggle-copy';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'toggle-label';
        labelSpan.textContent = label;
        const descEl = document.createElement('small');
        descEl.textContent = desc;
        labelSpan.appendChild(descEl);

        const helpDot = document.createElement('span');
        helpDot.className = 'info-dot';
        helpDot.tabIndex = 0;
        helpDot.setAttribute('aria-label', help);
        helpDot.textContent = 'i';

        const tooltip = document.createElement('span');
        tooltip.className = 'info-tooltip';
        tooltip.textContent = help;
        helpDot.appendChild(tooltip);

        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch-ios';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', saveCurrentSettings);
        input.checked = features[key] !== undefined ? features[key] : true;
        input.dataset.feature = key;
        const slider = document.createElement('span');
        slider.className = 'slider';

        switchLabel.appendChild(input);
        switchLabel.appendChild(slider);
        copyWrap.appendChild(labelSpan);
        copyWrap.appendChild(helpDot);
        item.appendChild(copyWrap);
        item.appendChild(switchLabel);
        featureTogglesEl.appendChild(item);
    });
}

function renderTriggers(triggers) {
    triggersContainer.innerHTML = '';
    triggers.forEach((trigger, index) => {
        const tag = document.createElement('span');
        tag.className = 'trigger-tag';
        tag.textContent = trigger;
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-trigger';
        removeBtn.textContent = 'x';
        removeBtn.dataset.index = index;
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(removeBtn.dataset.index, 10);
            currentSettings.complaintTriggers.splice(idx, 1);
            renderTriggers(currentSettings.complaintTriggers);
            saveCurrentSettings();
        });
        tag.appendChild(removeBtn);
        triggersContainer.appendChild(tag);
    });
}

function loadSettingsToUI(settings) {
    // Обновляем переключатели
    const checkboxes = featureTogglesEl.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        const feature = cb.dataset.feature;
        if (settings.features && settings.features[feature] !== undefined) {
            cb.checked = settings.features[feature];
        } else {
            cb.checked = DEFAULTS.features[feature] !== undefined ? DEFAULTS.features[feature] : true;
        }
    });

    hoursInput.value = settings.newAccountHours || DEFAULTS.newAccountHours;

    refreshIntervalInput.value =
        settings.serverRefreshInterval ?? DEFAULTS.serverRefreshInterval;

    const triggers = settings.complaintTriggers || DEFAULTS.complaintTriggers;
    currentSettings.complaintTriggers = triggers.slice();
    renderTriggers(currentSettings.complaintTriggers);
}

// ---------- СБОР ДАННЫХ ИЗ UI ----------
function collectSettingsFromUI() {
    const features = {};
    const checkboxes = featureTogglesEl.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        features[cb.dataset.feature] = cb.checked;
    });

    const hoursValue = parseInt(hoursInput.value, 10);
    const hours = Number.isNaN(hoursValue) ? DEFAULTS.newAccountHours : Math.min(Math.max(hoursValue, 1), 1000);

    const refreshValue = parseInt(refreshIntervalInput.value, 10);
    const refreshInterval = Number.isNaN(refreshValue) ? DEFAULTS.serverRefreshInterval : Math.min(Math.max(refreshValue, 0), 600);

    const triggers = currentSettings.complaintTriggers || [];

    return {
        features: features,
        newAccountHours: hours,
        serverRefreshInterval: refreshInterval,
        complaintTriggers: triggers
    };
}

// ---------- СОХРАНЕНИЕ В CHROME.STORAGE ----------
function saveSettings(settings) {
    storage.set({ helperSettings: settings }, () => {
        showToast('Сохранено', 1000);
        console.log('[Popup] Settings saved:', settings);
    });
}

function saveCurrentSettings() {
    currentSettings = collectSettingsFromUI();
    saveSettings(currentSettings);
}

// ---------- ЗАГРУЗКА ИЗ ХРАНИЛИЩА ----------
function loadSettings() {
    renderToggles(DEFAULTS.features);

    storage.get(['helperSettings'], (result) => {
        const stored = result.helperSettings;
        if (stored) {
            // Мержим с дефолтами на случай отсутствия полей
            const merged = {
                features: { ...DEFAULTS.features, ...(stored.features || {}) },
                newAccountHours: stored.newAccountHours ?? DEFAULTS.newAccountHours,
                serverRefreshInterval:
                    stored.serverRefreshInterval ?? DEFAULTS.serverRefreshInterval,
                complaintTriggers: stored.complaintTriggers ? stored.complaintTriggers.slice() : DEFAULTS.complaintTriggers.slice()
            };
            currentSettings = merged;
            loadSettingsToUI(merged);
        } else {
            // Если нет сохранений — используем дефолты
            currentSettings = {
                features: { ...DEFAULTS.features },
                newAccountHours: DEFAULTS.newAccountHours,
                serverRefreshInterval: DEFAULTS.serverRefreshInterval,
                complaintTriggers: DEFAULTS.complaintTriggers.slice()
            };
            loadSettingsToUI(currentSettings);
        }
    });
}

// ---------- ОБРАБОТЧИКИ СОБЫТИЙ ----------
// Добавление триггера
addBtn.addEventListener('click', () => {
    const text = triggerInput.value.trim();
    if (!text) return;
    if (currentSettings.complaintTriggers.includes(text)) {
        showToast('Такой триггер уже есть', 1500);
        return;
    }
    currentSettings.complaintTriggers.push(text);
    renderTriggers(currentSettings.complaintTriggers);
    saveCurrentSettings();
    triggerInput.value = '';
    triggerInput.focus();
});

// Добавление по Enter
triggerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        addBtn.click();
    }
});

hoursInput.addEventListener('input', saveCurrentSettings);
refreshIntervalInput.addEventListener('input', saveCurrentSettings);

// Сброс к дефолтам
resetBtn.addEventListener('click', () => {
    if (confirm('Сбросить все настройки?')) {
        currentSettings = {
            features: { ...DEFAULTS.features },
            newAccountHours: DEFAULTS.newAccountHours,
            serverRefreshInterval: DEFAULTS.serverRefreshInterval,
            complaintTriggers: DEFAULTS.complaintTriggers.slice()
        };
        loadSettingsToUI(currentSettings);
        // Сохраняем сброшенные
        saveSettings(currentSettings);
        showToast('Сброшено к стандартным', 1500);
    }
});

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
document.addEventListener('DOMContentLoaded', loadSettings);
