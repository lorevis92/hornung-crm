import { AlertTriangle, RefreshCw } from 'lucide-react'
import { PageLoader } from './ui'
import { useI18n } from '../i18n'
import { describeLoadError } from '../lib/loadState'

// What a page shows while useLoad (src/lib/useLoad.js) is not 'ready': the
// spinner, or — when loading failed — a plain message with a "Riprova"
// button. Staff also get the technical detail (what the database said),
// which is what they need to report or fix it; clients never see it.
export function LoadError({ error, onRetry, showDetail = false }) {
  const { t } = useI18n()
  const detail = showDetail ? describeLoadError(error) : ''
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 px-5 py-5 text-center">
      <AlertTriangle size={22} className="mx-auto text-red-700" aria-hidden="true" />
      <p className="mt-2 font-medium text-red-900">{t('common.loadFailed')}</p>
      <p className="mt-1 text-[14px] text-red-800">{t('common.loadFailedHelp')}</p>
      {detail ? (
        <p className="mt-3 break-words rounded-lg bg-white/70 px-3 py-2 text-left font-mono text-[12px] text-red-900">
          {t('common.technicalDetail')}: {detail}
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" className="btn-secondary btn-sm mt-4" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  )
}

// One line per page: `if (load.status !== 'ready') return <LoadGate load={load} />`.
export function LoadGate({ load, showDetail = false }) {
  const { t } = useI18n()
  if (load.status === 'error') {
    return <LoadError error={load.error} onRetry={load.reload} showDetail={showDetail} />
  }
  return <PageLoader label={t('common.loading')} />
}
