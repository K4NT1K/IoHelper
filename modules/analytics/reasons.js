// Display names from the native Russian interface; this does not choose punishments.
const names = {
    Reason_Ban_Cheat:'Использование/хранение запрещенного ПО',
    Reason_Ban_BypassBan:'Обход блокировки',
    Reason_Ban_Unsport:'Неспортивное поведение',
    Reason_Ban_AHK:'Использование/хранение AHK скриптов',
    Reason_Ban_IgnoreAdmin:'Игнорирование администрации',
    Reason_Ban_Fraud:'Мошенничество',
    Reason_Mute_Toxic:'Токсичность',
    Reason_Mute_Spam:'Спам в микрофон/чат',
    Reason_Mute_Insult:'Оскорбление',
    Reason_Mute_Trolling:'Троллинг/провокация',
    Reason_Mute_Rasism:'Расизм/дискриминация',
    Reason_Mute_Monitoring:'Мониторинг',
    Reason_Mute_Advertising:'Реклама',
    Reason_Mute_VoiceChange:'Изменение голоса программами',
    Reason_Mute_Begging:'Попрошайничество',
    Reason_Mute_BypassMute:'Обход мута'
};
export const reasonLabel = reason => Object.hasOwn(names, reason) ? names[reason] : (/^Reason_(Ban|Mute)_/.test(reason) ? 'Другая причина' : reason || 'Без причины');
