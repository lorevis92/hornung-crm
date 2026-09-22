import { Globe } from 'lucide-react'
import { useI18n } from '../i18n'
import { LANGUAGES } from '../lib/constants'

export default function LanguageSwitcher({ compact = false }) {
  const { lang, setLang, t } = useI18n()

  return (
    <div className="flex items-center gap-2">
      <Globe size={17} className="text-ink-400" aria-hidden="true" />
      <label className="sr-only" htmlFor="lang-select">
        {t('common.language')}
      </label>
      <select
        id="lang-select"
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        className={`rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm font-medium text-ink-700
                    focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-200 ${
                      compact ? '' : 'min-w-[112px]'
                    }`}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {compact ? l.code.toUpperCase() : l.label}
          </option>
        ))}
      </select>
    </div>
  )
}
