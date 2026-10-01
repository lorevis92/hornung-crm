import { Eye, Lightbulb, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { Spinner } from './ui'
import { useI18n } from '../i18n'

// "Other information found in this document" — values a document holds that
// no category_field_definitions field covers (document_other_findings, see
// migration 46 and src/lib/otherFindings.js). Deliberately its own block,
// visually separate from the extracted fields above it: those are the
// validated, structured data the app is built on, these are a free-form
// safety net, and a specialist should never have to wonder which is which.
//
// Read-only. The label is chosen by the extraction, the value is whatever
// the document says, and the only action is the same one the fields have:
// open the source and see it in context.
export default function OtherFindingsList({
  findings = [],
  compact = false,
  viewingKey = null,
  // How the caller identifies a finding in its own "which source view is
  // loading" state — Tax Summary keys that by document+field, this list
  // only ever needs the finding's own id.
  keyOf = (finding) => finding.id,
  onViewSource
}) {
  const { t } = useI18n()
  if (!findings.length) return null

  return (
    <div
      className={clsx(
        'rounded-xl border border-dashed border-gold-300 bg-gold-50/40',
        compact ? 'px-2 py-2' : 'p-3'
      )}
    >
      <div className="flex items-start gap-2">
        <Lightbulb size={15} className="mt-0.5 shrink-0 text-gold-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink-800">
            {t('summary.otherFindingsTitle', { count: findings.length })}
          </p>
          <p className="text-[12px] text-ink-500">{t('summary.otherFindingsHelp')}</p>

          <ul className={clsx('mt-2', compact ? 'space-y-1' : 'space-y-2')}>
            {findings.map((finding) => (
              <li
                key={finding.id}
                className={clsx(
                  'flex flex-wrap items-start justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5',
                  finding.needs_review && 'ring-1 ring-inset ring-amber-200'
                )}
              >
                <div className="min-w-0 flex-1 text-[13.5px] leading-snug">
                  <span className="font-medium text-ink-900">{finding.label}</span>
                  <span className="text-ink-900">: </span>
                  <span className="text-ink-900">{finding.finding_value}</span>
                  {finding.needs_review ? (
                    <span className="mt-0.5 flex items-center gap-1 text-[12px] text-amber-700">
                      <AlertTriangle size={12} aria-hidden="true" />
                      {finding.review_note || t('summary.otherFindingsUncertain')}
                    </span>
                  ) : null}
                </div>
                {finding.source_quote || finding.source_page ? (
                  <button
                    type="button"
                    className="btn-ghost btn-sm shrink-0"
                    onClick={() => onViewSource?.(finding)}
                    disabled={viewingKey === keyOf(finding)}
                    title={t('extraction.viewSource')}
                  >
                    {viewingKey === keyOf(finding) ? <Spinner size={13} /> : <Eye size={13} aria-hidden="true" />}
                    {t('extraction.viewSource')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
