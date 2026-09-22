import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import en from './en'
import de from './de'
import fr from './fr'
import it from './it'

const DICTS = { en, de, fr, it }
const STORAGE_KEY = 'hornung.lang'

const I18nContext = createContext(null)

function detectLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && DICTS[stored]) return stored
  } catch {
    /* private mode — ignore */
  }
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase()
  return DICTS[nav] ? nav : 'en'
}

function lookup(dict, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), dict)
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectLanguage)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next) => {
    if (!DICTS[next]) return
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const t = useCallback(
    (path, vars) => {
      let value = lookup(DICTS[lang], path)
      if (value === undefined) value = lookup(DICTS.en, path)
      if (value === undefined) return path
      if (typeof value !== 'string') return value
      if (!vars) return value
      return value.replace(/\{(\w+)\}/g, (match, key) =>
        vars[key] !== undefined ? String(vars[key]) : match
      )
    },
    [lang]
  )

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
