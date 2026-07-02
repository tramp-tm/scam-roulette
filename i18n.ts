import i18n from 'i18next';

const DEFAULT_LANG = 'en';
const FALLBACK_LANG = 'en';

export const AVAILABLE_LANGUAGES: Record<string, string> = {
    en: 'English',
    ru: 'Русский',
};

i18n.init({
    lng: DEFAULT_LANG,
    fallbackLng: FALLBACK_LANG,
    debug: false,
    interpolation: {
        escapeValue: false,
    },
    resources: {
        en: {
            translation: {
                // ── Page ──
                'page.title': 'Scam Roulette',

                // ── Lots panel ──
                'lots.title': '📋 Lots',
                'lots.placeholderName': 'Lot Name',
                'lots.placeholderAmount': '$',

                // ── Sort ──
                'sort.byName': '🅰️ Name',
                'sort.byAmount': '💵 Amount',
                'sort.titleByName': 'Sort by name (A-Z)',
                'sort.titleByAmount': 'Sort by amount ($ low-high)',

                // ── Main panel ──
                'main.title': '🎰 Scam Roulette 🎰',
                'stats.totalLots': 'Total Lots',
                'stats.activeLots': 'Active Lots',

                // ── Controls ──
                'controls.title': 'Controls',
                'controls.spin': '🎲 SPIN!',
                'controls.reset': '🔄 Reset',
                'controls.import': '📥 Import',
                'controls.clear': '🗑️ Clear',

                // ── Settings ──
                'settings.title': '⚙️ Settings',
                'settings.gameMode': 'Game Mode',
                'settings.modeNormal': 'Normal (Higher amount = Higher chance)',
                'settings.modeSurvival': 'Survival (Lower amount = Eliminated first)',
                'settings.visualization': 'Visualization',
                'settings.vizWheel': 'Wheel',
                'settings.vizStrip': 'Strip',
                'settings.animationDuration': 'Animation Duration',
                'settings.additionalOptions': 'Additional Options',
                'settings.soundEffects': 'Sound Effects',
                'settings.soundOn': 'On',
                'settings.soundOff': 'Off',
                'settings.theme': 'Theme',
                'settings.themeDark': 'Dark',
                'settings.themeLight': 'Light',
                'settings.easingFunction': 'Easing Function',
                'settings.easingRoulette': 'Roulette Ease Out (Default)',
                'settings.easingCubic': 'Cubic Ease Out',
                'settings.easingQuart': 'Quartic Ease Out',
                'settings.easingQuint': 'Quintic Ease Out',
                'settings.easingExpo': 'Exponential Ease Out',
                'settings.easingLinear': 'Linear (No Easing)',

                // ── Modes ──
                'mode.normal.name': 'Normal',
                'mode.normal.description': 'Higher amount = Higher chance to win',
                'mode.normal.resultWinner': 'Winner: {{name}}',
                'mode.survival.name': 'Survival',
                'mode.survival.description': 'Lower amount = Higher chance to be eliminated',
                'mode.survival.resultEliminated': 'Eliminated: {{name}}',
                'mode.survival.completionMessage': '🏆 SURVIVAL COMPLETE! 🏆\n\nThe last lot standing is:\n{{name}}',

                // ── Import strategies ──
                'importStrategy.replace.label': '🔄 Replace',
                'importStrategy.replace.description': 'Remove all existing lots and import new ones',
                'importStrategy.merge.label': '🔗 Merge',
                'importStrategy.merge.description': 'Keep existing lots and add new ones',

                // ── Import dialog ──
                'importDialog.title': 'Import Lots',
                // ── Import dialog (additional keys) ──
                'importDialog.tabCsv': 'CSV Import',
                'importDialog.tabLink': 'Link Import',
                'importDialog.instruction': 'Paste your lots below (name, amount per line):',
                'importDialog.placeholder': 'Paste your lots below (name, amount per line):',
                'importDialog.separatorComma': 'Comma (,)',
                'importDialog.separatorTab': 'Tab (↹)',
                'importDialog.validLots': 'valid lots',
                'importDialog.errors': 'errors',
                'importDialog.previewBtn': '👁️ Preview',
                'importDialog.importBtn': '📥 Import',
                'importDialog.previewTitle': 'Preview',
                'importDialog.linkPlaceholder': 'Link import coming soon...',
                'importDialog.clickPreviewFirst': 'Please click "Preview" first to parse the CSV data.',
                'importDialog.noValidLots': 'No valid lots to import.',

                // ── Link Import (new keys) ──
                'importDialog.linkInstruction': 'Введите URL для получения данных CSV:',
                'importDialog.linkUrlPlaceholder': 'https://example.com/lots.csv',
                'importDialog.fetchBtn': '📡 Загрузить',
                'importDialog.loading': 'Загрузка...',
                'importDialog.fetchSuccess': '✓ Успешно загружено {{count}} лотов!',
                'importDialog.fetchError': '✗ Не удалось загрузить данные',
                'importDialog.corsError': '✗ Ошибка CORS - сервер может не разрешать cross-origin запросы. Попробуйте использовать прокси или разместить файл на сервере с включенным CORS.',
                'importDialog.invalidUrl': 'Пожалуйста, введите корректный URL',
                'importDialog.fetching': 'Загрузка...',
                'importDialog.linkTextareaPlaceholder': 'Сюда будет загружен контент...',

                // ── Import conflict dialog ──
                'importConflict.title': 'Import Conflict',
                'importConflict.existingLotsMessage': 'There are already {{count}} existing lots.',
                'importConflict.proceedQuestion': 'How would you like to proceed?',
                'importConflict.cancelDescription': 'Do not import anything, keep current lots unchanged',

                // ── Dialogs / buttons ──
                'dialog.errorTitle': '⚠️ Error',
                'button.ok': 'OK',
                'button.cancel': 'Cancel',

                // ── Validation / confirmation ──
                'validation.noLotsToSpin': 'Add at least one lot to spin!',
                'validation.noLotsToClear': 'No lots to clear.',
                'confirmation.deleteLot': 'Are you sure you want to delete this lot?',
                'confirmation.clearAllLots': 'Are you sure you want to clear all {{count}} lots?',

                // ── Import summary ──
                'import.summaryTitle': 'Import Summary',
                'import.summaryWithTruncation': 'Added {{lotsAdded}} lots. {{lotsTruncated}} lots were skipped due to the maximum limit of {{maxLots}}. Total lots: {{totalLots}}.',

                // ── Lot errors ──
                'error.invalidName': 'Please enter a lot name.',
                'error.invalidAmount': 'Please enter a valid amount greater than zero.',
                'error.maxLotsReached': 'Maximum lot limit reached ({{max}} lots). Please delete some existing lots before adding new ones.',
            }
        },
        ru: {
            translation: {
                // ── Страница ──
                'page.title': 'Скам Рулетка',

                // ── Панель лотов ──
                'lots.title': '📋 Лоты',
                'lots.placeholderName': 'Название лота',
                'lots.placeholderAmount': '₽',

                // ── Сортировка ──
                'sort.byName': '🅰️ Имя',
                'sort.byAmount': '💵 Сумма',
                'sort.titleByName': 'Сортировать по имени (А-Я)',
                'sort.titleByAmount': 'Сортировать по сумме (↑)',

                // ── Главная панель ──
                'main.title': '🎰 Скам Рулетка 🎰',
                'stats.totalLots': 'Всего лотов',
                'stats.activeLots': 'Активных лотов',

                // ── Управление ──
                'controls.title': 'Управление',
                'controls.spin': '🎲 КРУТИТЬ!',
                'controls.reset': '🔄 Сброс',
                'controls.import': '📥 Импорт',
                'controls.clear': '🗑️ Очистить',

                // ── Настройки ──
                'settings.title': '⚙️ Настройки',
                'settings.gameMode': 'Режим игры',
                'settings.modeNormal': 'Обычный (Больше сумма = выше шанс)',
                'settings.modeSurvival': 'Выживание (Меньше сумма = выше шанс вылета)',
                'settings.visualization': 'Визуализация',
                'settings.vizWheel': 'Колесо',
                'settings.vizStrip': 'Лента',
                'settings.animationDuration': 'Длительность анимации',
                'settings.additionalOptions': 'Дополнительные параметры',
                'settings.soundEffects': 'Звуковые эффекты',
                'settings.soundOn': 'Вкл',
                'settings.soundOff': 'Выкл',
                'settings.theme': 'Тема',
                'settings.themeDark': 'Тёмная',
                'settings.themeLight': 'Светлая',
                'settings.easingFunction': 'Функция сглаживания',
                'settings.easingRoulette': 'Рулеточное замедление (по умолчанию)',
                'settings.easingCubic': 'Кубическое замедление',
                'settings.easingQuart': 'Квартальное замедление',
                'settings.easingQuint': 'Квинтическое замедление',
                'settings.easingExpo': 'Экспоненциальное замедление',
                'settings.easingLinear': 'Линейное (без сглаживания)',

                // ── Режимы ──
                'mode.normal.name': 'Обычный',
                'mode.normal.description': 'Больше сумма = выше шанс выиграть',
                'mode.normal.resultWinner': 'Победитель: {{name}}',
                'mode.survival.name': 'Выживание',
                'mode.survival.description': 'Меньше сумма = выше шанс вылета',
                'mode.survival.resultEliminated': 'Выбыл: {{name}}',
                'mode.survival.completionMessage': '🏆 ВЫЖИВАНИЕ ЗАВЕРШЕНО! 🏆\n\nПоследний оставшийся лот:\n{{name}}',

                // ── Стратегии импорта ──
                'importStrategy.replace.label': '🔄 Заменить',
                'importStrategy.replace.description': 'Удалить все существующие лоты и импортировать новые',
                'importStrategy.merge.label': '🔗 Объединить',
                'importStrategy.merge.description': 'Сохранить существующие лоты и добавить новые',

                // ── Диалог импорта ──
                'importDialog.title': 'Импорт лотов',
                // ── Диалог импорта (дополнительные ключи) ──
                'importDialog.tabCsv': 'Импорт CSV',
                'importDialog.tabLink': 'Импорт по ссылке',
                'importDialog.instruction': 'Вставьте лоты ниже (имя, сумма в каждой строке):',
                'importDialog.placeholder': 'Вставьте лоты ниже (имя, сумма в каждой строке):',
                'importDialog.separatorComma': 'Запятая (,)',
                'importDialog.separatorTab': 'Табуляция (↹)',
                'importDialog.validLots': 'валидных лотов',
                'importDialog.errors': 'ошибок',
                'importDialog.previewBtn': '👁️ Просмотр',
                'importDialog.importBtn': '📥 Импортировать',
                'importDialog.previewTitle': 'Предпросмотр',
                'importDialog.linkPlaceholder': 'Импорт по ссылке скоро...',
                'importDialog.clickPreviewFirst': 'Нажмите «Просмотр» для парсинга CSV-данных.',
                'importDialog.noValidLots': 'Нет валидных лотов для импорта.',

                // ── Диалог конфликта импорта ──
                'importConflict.title': 'Конфликт импорта',
                'importConflict.existingLotsMessage': 'Уже есть {{count}} существующих лотов.',
                'importConflict.proceedQuestion': 'Как хотите продолжить?',
                'importConflict.cancelDescription': 'Не импортировать, оставить текущие лоты без изменений',

                // ── Диалоги / кнопки ──
                'dialog.errorTitle': '⚠️ Ошибка',
                'button.ok': 'ОК',
                'button.cancel': 'Отмена',

                // ── Валидация / подтверждение ──
                'validation.noLotsToSpin': 'Добавьте хотя бы один лот для вращения!',
                'validation.noLotsToClear': 'Нет лотов для очистки.',
                'confirmation.deleteLot': 'Вы уверены, что хотите удалить этот лот?',
                'confirmation.clearAllLots': 'Вы уверены, что хотите очистить все {{count}} лотов?',

                // ── Сводка импорта ──
                'import.summaryTitle': 'Итоги импорта',
                'import.summaryWithTruncation': 'Добавлено {{lotsAdded}} лотов. {{lotsTruncated}} лотов пропущено из-за лимита в {{maxLots}}. Всего лотов: {{totalLots}}.',

                // ── Ошибки лотов ──
                'error.invalidName': 'Пожалуйста, введите название лота.',
                'error.invalidAmount': 'Пожалуйста, введите сумму больше нуля.',
                'error.maxLotsReached': 'Достигнут лимит лотов ({{max}} шт.). Удалите существующие лоты перед добавлением новых.',
            }
        }
    },
});

/**
 * Translates all elements with [data-i18n] attribute in the DOM.
 * Attribute value = i18n key. Supports [data-i18n-placeholder] for input placeholders
 * and [data-i18n-title] for title attributes.
 */
export function translateDOM(): void {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = i18n.t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) el.setAttribute('placeholder', i18n.t(key));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (key) el.setAttribute('title', i18n.t(key));
    });
}

/**
 * Re-translates all currently open modals
 */
export function retranslateAllModals(): void {
    const manager = ModalManager.getInstance();
    manager.retranslateAllOpenModals();
}

export default i18n;

/** Named export of translation function for convenience */
export const t = i18n.t.bind(i18n);
