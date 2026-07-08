// @ts-ignore
import i18n from './i18next.js';

import { ModalManager } from './modalManager.js';

// Удалите статические импорты JSON, заменяем их на асинхронную функцию init

const userLang = navigator.language || navigator.languages[0] || 'en';
const DEFAULT_LANG = userLang.split('-')[0];
const FALLBACK_LANG = 'en';

export const AVAILABLE_LANGUAGES: Record<string, string> = {
    en: 'English',
    ru: 'Русский',
};

/**
 * Асинхронная инициализация i18n с загрузкой локальных файлов через fetch
 */
export async function initI18n(): Promise<void> {
    // Скачиваем языковые файлы из папки locales параллельно
    const [enRes, ruRes] = await Promise.all([
        fetch('./locales/en.json').then(res => res.json()),
                                             fetch('./locales/ru.json').then(res => res.json())
    ]);

    await i18n.init({
        lng: DEFAULT_LANG,
        fallbackLng: FALLBACK_LANG,
        debug: false,
        interpolation: {
            escapeValue: false,
        },
        resources: {
            en: { translation: enRes },
            ru: { translation: ruRes }
        },
    });

    // Делаем первичный перевод DOM сразу после готовности
    translateDOM();
}

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

export function retranslateAllModals(): void {
    const manager = ModalManager.getInstance();
    manager.retranslateAllOpenModals();
}

export default i18n;
export const t = i18n.t.bind(i18n);
