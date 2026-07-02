// ============================================================
//  popup.js — управление настройками расширения
// ============================================================

// ---------- ДЕФОЛТНЫЕ ЗНАЧЕНИЯ ----------
const DEFAULTS = {
    features: {
        scanSchedulePage: true,
        highlightComplaintTriggers: true,
        highlightNewAccounts: true,
        processTicketRules: true,
        manageEmptyBlocks: true,
        translateText: true
    },
    newAccountHours: 7,
    complaintTriggers: [
        "крутилка", "крутилкой", "крутится", "krutilka", "krutilkoy",
        "hvh", "hwh", "хвх", "rage", "рейдж"
    ]
};

// ---------- ЭЛЕМЕНТЫ DOM ----------
const featureTogglesEl = document.getElementById('featureToggles');
const hoursInput = document.getElementById('newAccountHours');
const triggersContainer = document.getElementById('triggersContainer');
const triggerInput = document.getElementById('triggerInput');
const addBtn = document.getElementById('addTriggerBtn');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetDefaultsBtn');
const toast = document.getElementById('toastMsg');

// ---------- СОСТОЯНИЕ ----------
let currentSettings = {};

// ---------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ----------
function showToast(message, duration = 2000) {
    toast.textContent = message || '✓ Настройки сохранены';
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ---------- ОТРИСОВКА UI ----------
function renderToggles(features) {
    featureTogglesEl.innerHTML = '';
    const entries = [
        { key: 'scanSchedulePage', label: 'Сканировать расписание', desc: 'scanSchedulePage' },
        { key: 'highlightComplaintTriggers', label: 'Подсветка триггеров жалоб', desc: 'highlightComplaintTriggers' },
        { key: 'highlightNewAccounts', label: 'Подсветка новых аккаунтов', desc: 'highlightNewAccounts' },
        { key: 'processTicketRules', label: 'Анализ тикетов', desc: 'processTicketRules' },
        { key: 'manageEmptyBlocks', label: 'Скрывать пустые блоки', desc: 'manageEmptyBlocks' },
        { key: 'translateText', label: 'Перевод сообщений', desc: 'translateText' }
    ];

    entries.forEach(({ key, label, desc }) => {
        const item = document.createElement('div');
        item.className = 'toggle-item';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'toggle-label';
        labelSpan.innerHTML = `${label} <small>${desc}</small>`;

        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch-ios';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = features[key] !== undefined ? features[key] : true;
        input.dataset.feature = key;
        const slider = document.createElement('span');
        slider.className = 'slider';

        switchLabel.appendChild(input);
        switchLabel.appendChild(slider);
        item.appendChild(labelSpan);
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
        removeBtn.innerHTML = '✕';
        removeBtn.dataset.index = index;
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(removeBtn.dataset.index, 10);
            currentSettings.complaintTriggers.splice(idx, 1);
            renderTriggers(currentSettings.complaintTriggers);
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

    // Часы
    hoursInput.value = settings.newAccountHours || DEFAULTS.newAccountHours;

    // Триггеры
    const triggers = settings.complaintTriggers || DEFAULTS.complaintTriggers;
    currentSettings.complaintTriggers = triggers.slice(); // копия
    renderTriggers(currentSettings.complaintTriggers);
}

// ---------- СБОР ДАННЫХ ИЗ UI ----------
function collectSettingsFromUI() {
    const features = {};
    const checkboxes = featureTogglesEl.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        features[cb.dataset.feature] = cb.checked;
    });

    const hours = parseInt(hoursInput.value, 10) || DEFAULTS.newAccountHours;

    // Триггеры уже лежат в currentSettings.complaintTriggers, но мы их берем из рендера
    // Они обновляются при добавлении/удалении
    const triggers = currentSettings.complaintTriggers || [];

    return {
        features: features,
        newAccountHours: hours,
        complaintTriggers: triggers
    };
}

// ---------- СОХРАНЕНИЕ В CHROME.STORAGE ----------
function saveSettings(settings) {
    chrome.storage.local.set({ helperSettings: settings }, () => {
        showToast('✓ Настройки сохранены');
        console.log('[Popup] Settings saved:', settings);
    });
}

// ---------- ЗАГРУЗКА ИЗ ХРАНИЛИЩА ----------
function loadSettings() {
    chrome.storage.local.get(['helperSettings'], (result) => {
        const stored = result.helperSettings;
        if (stored) {
            // Мержим с дефолтами на случай отсутствия полей
            const merged = {
                features: { ...DEFAULTS.features, ...(stored.features || {}) },
                newAccountHours: stored.newAccountHours ?? DEFAULTS.newAccountHours,
                complaintTriggers: stored.complaintTriggers ? stored.complaintTriggers.slice() : DEFAULTS.complaintTriggers.slice()
            };
            currentSettings = merged;
            loadSettingsToUI(merged);
        } else {
            // Если нет сохранений — используем дефолты
            currentSettings = {
                features: { ...DEFAULTS.features },
                newAccountHours: DEFAULTS.newAccountHours,
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
        showToast('⚠️ Такой триггер уже есть', 1500);
        return;
    }
    currentSettings.complaintTriggers.push(text);
    renderTriggers(currentSettings.complaintTriggers);
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

// Сохранение
saveBtn.addEventListener('click', () => {
    const settings = collectSettingsFromUI();
    // Обновляем currentSettings перед сохранением
    currentSettings = settings;
    saveSettings(settings);
});

// Сброс к дефолтам
resetBtn.addEventListener('click', () => {
    if (confirm('Сбросить все настройки к значениям по умолчанию?')) {
        currentSettings = {
            features: { ...DEFAULTS.features },
            newAccountHours: DEFAULTS.newAccountHours,
            complaintTriggers: DEFAULTS.complaintTriggers.slice()
        };
        loadSettingsToUI(currentSettings);
        // Сохраняем сброшенные
        saveSettings(currentSettings);
        showToast('↺ Сброшено к заводским', 1500);
    }
});

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
document.addEventListener('DOMContentLoaded', loadSettings);