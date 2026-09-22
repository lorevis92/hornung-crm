import logo from '../assets/logo.png'
import { useI18n } from '../i18n'

export default function Brand({ size = 'md', showTagline = true }) {
  const { t } = useI18n()
  const heights = { sm: 'h-9', md: 'h-11', lg: 'h-16' }

  return (
    <span className="flex items-center gap-3">
      <img
        src={logo}
        alt={t('common.appName')}
        className={`${heights[size]} w-auto object-contain`}
      />
      {showTagline ? (
        <span className="hidden sm:block">
          <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-ink-400">
            {t('common.portal')}
          </span>
        </span>
      ) : null}
    </span>
  )
}
