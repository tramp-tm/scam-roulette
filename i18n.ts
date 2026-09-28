// @ts-ignore
import i18n from './i18next.js';

import { ModalManager } from './modalManager.js';

const userLang = navigator.language || navigator.languages[0] || 'en';
const DEFAULT_LANG = userLang.split('-')[0];
const FALLBACK_LANG = 'en';

export const AVAILABLE_LANGUAGES: Record<string, string> = {
    en: 'English',
    ru: 'Русский',
};

/**
 * Initialises i18n by loading the locale files via fetch.
 */
export async function initI18n(): Promise<void> {
    // Download the language files from the locales folder in parallel
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

    // Run the initial DOM translation as soon as i18n is ready
    translateDOM();

    // Keep <html lang> aligned with the resolved language from the very start
    syncDocumentLang();
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

/**
 * Synchronises the <html lang> attribute with the currently active i18n
 * language, so screen readers and font shaping use the correct locale.
 *
 * Call after initI18n() and after every i18n.changeLanguage(...).
 */
export function syncDocumentLang(): void {
    const lang = i18n.language || DEFAULT_LANG || FALLBACK_LANG;
    if (lang) {
        document.documentElement.setAttribute('lang', lang);
    }
}

export function retranslateAllModals(): void {
    const manager = ModalManager.getInstance();
    manager.retranslateAllOpenModals();
}

export default i18n;
export const t = i18n.t.bind(i18n);
