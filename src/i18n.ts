import i18n from 'i18next';

// Default language and fallback
const DEFAULT_LANG = 'en';
const FALLBACK_LANG = 'en';

// Available languages
export const AVAILABLE_LANGUAGES: Record<string, string> = {
    en: 'English',
    ru: 'Русский',
};

i18n.init({
    lng: DEFAULT_LANG,
    fallbackLng: FALLBACK_LANG,
    debug: false,
    interpolation: {
        escapeValue: false, // not needed for vanilla JS
    },
    resources: {
        en: { translation: {} },
        ru: { translation: {} },
    },
});

export default i18n;
