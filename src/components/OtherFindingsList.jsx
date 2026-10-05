import { Eye, Lightbulb, AlertTriangle } from 'lucide-react'
import { useI18n } from '../i18n'

// "Other information found in this document" — values a document holds that
// no category_field_definitions field covers (document_other_findings, see
// migration 46 and src/lib/otherFindings.js). Kept visually separate from the
// fields, so it is always clear which is which. Read-only: the only action
// is opening the source.
export default function OtherFindingsList({ findings = [], onViewSource }) {
  const { t } = useI18n()
  if (!findings.length) return null

  return (
    <div className="rounded-xl border border-dashed border-gold-300 bg-gold-50/40 p-3">
      <div className="flex items-start gap-2">
        <Lightbulb size={15} className="mt-0.5 shrink-0 text-gold-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink-800">
            {t('summary.otherFindingsTitle', { count: findings.length })}
          </p>
          <p className="text-[12px] text-ink-500">{t('summary.otherFindingsHelp')}</p>

          <ul className="mt-2 space-y-1.5">
            {findings.map((finding) => (
              <li
                key={finding.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1 text-[13.5px] leading-snug text-ink-900">
                  <span className="font-medium">{finding.label}</span>: {finding.finding_value}
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
                    className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-gold-700 hover:text-gold-800 hover:underline"
                    onClick={() => onViewSource?.(finding)}
                  >
                    <Eye size={12} aria-hidden="true" />
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
