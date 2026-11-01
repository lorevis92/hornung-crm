import { ServerCrash } from 'lucide-react'
import Brand from './Brand'
import { Spinner } from './ui'
import { useI18n } from '../i18n'

// Shown instead of the whole app when /api/auth/me itself fails: the server
// isn't configured (MISSING_SUPABASE_ENV — e.g. a preview deployment without
// its environment variables), can't be reached, or can't reach the database.
// There is no offline/sample-data fallback: without the backend nothing in
// this app can work, so we say so plainly.
export default function BackendUnavailable({ error, onRetry, retrying }) {
  const { t } = useI18n()
  const notConfigured = error?.code === 'MISSING_SUPABASE_ENV'
  return (
    <div className="card card-pad w-full max-w-md text-center" role="alert">
      <div className="mb-4 flex justify-center">
        <Brand size="lg" showTagline={false} />
      </div>
      <ServerCrash size={28} className="mx-auto mb-3 text-gold-600" aria-hidden="true" />
      <h1 className="display text-2xl">
        {notConfigured ? t('common.backendNotConfiguredTitle') : t('common.backendUnavailableTitle')}
      </h1>
      <p className="mt-2 text-[15px] text-ink-500">
        {notConfigured ? t('common.backendNotConfiguredBody') : t('common.backendUnavailableBody')}
      </p>
      {error?.code ? (
        <p className="mt-3 font-mono text-[12.5px] text-ink-400">
          {error.code}
          {error.status ? ` (HTTP ${error.status})` : ''}
        </p>
      ) : null}
      <button type="button" onClick={onRetry} disabled={retrying} className="btn-secondary mt-6 w-full">
        {retrying ? <Spinner size={16} /> : null}
        {t('common.retry')}
      </button>
    </div>
  )
}
