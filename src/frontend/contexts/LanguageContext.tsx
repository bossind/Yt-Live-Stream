import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppLanguage } from '../../shared/types/system';
import { getDictionary, type TranslationDictionary } from '../i18n/translations';

const LANGUAGE_STORAGE_KEY = 'ylas_language';

export interface LanguageContextValue {
  language: AppLanguage;
  setLanguage: (nextLang: AppLanguage) => void;
  toggleLanguage: () => void;
  t: TranslationDictionary;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

function getInitialLanguage(): AppLanguage {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'en' || saved === 'hi') {
      return saved;
    }
  } catch {
    // Ignore storage read errors
  }
  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(getInitialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Ignore storage write errors
    }
  }, [language]);

  const setLanguage = useCallback((nextLang: AppLanguage) => {
    setLanguageState(nextLang);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => (prev === 'en' ? 'hi' : 'en'));
  }, []);

  const t = useMemo(() => getDictionary(language), [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
