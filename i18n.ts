// @ts-ignore
import i18n from 'i18next';

import { ModalManager } from './modalManager.js';

import enTranslations from './locales/en.json';
import ruTranslations from './locales/ru.json';

// Detect user's preferred language
const userLang = navigator.language || navigator.languages[0] || 'en';
const DEFAULT_LANG = userLang.split('-')[0]; // Get just the language code (e.g., "ru" from "ru-RU")
const FALLBACK_LANG = 'en';

export const AVAILABLE_LANGUAGES: Record<string, string> = {
    en: 'English',
    ru: 'Русский',
};

// This will be replaced by build process or runtime loading
i18n.init({
    lng: DEFAULT_LANG,
    fallbackLng: FALLBACK_LANG,
    debug: false,
    interpolation: {
        escapeValue: false,
    },
    resources: {
        en: { translation: enTranslations },
        ru: { translation: ruTranslations }
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
