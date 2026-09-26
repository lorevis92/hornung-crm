import { CircleCheck, Eye } from 'lucide-react'
import clsx from 'clsx'
import { Checkbox, Spinner, Textarea } from './ui'
import { useI18n } from '../i18n'
import { formatDateTime } from '../lib/format'

// One editable/verifiable extracted-field row — shared by
// DocumentVerificationPanel (scoped to a single document) and TaxSummary
// (every document of a client/tax year, hence the optional file name badge).
export default function ExtractedFieldRow({
  field,
  showDocument = false,
  saving = false,
  viewingSource = false,
  togglingInclude = false,
  onChange,
  onConfirm,
  onViewSource,
  onToggleInclude,
  innerRef
}) {
  const { t, lang } = useI18n()
  const canViewSource = field.source_quote || field.isPdf
  const excluded = field.included_in_calculation === false

  return (
    <li ref={innerRef} className="rounded-xl border border-line bg-white p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14.5px] font-medium text-ink-900">{field.field_label}</p>
          {showDocument && field.file_name ? (
            <p className="text-[12px] text-ink-400">{field.file_name}</p>
          ) : null}
          {field.verified_by_specialist ? (
            <>
              <p
                className={clsx(
                  'mt-0.5 flex items-center gap-1 text-[12.5px]',
                  excluded ? 'text-amber-700' : 'text-emerald-700'
                )}
              >
                <CircleCheck size={13} aria-hidden="true" />
                {t('extraction.verifiedOn', { date: formatDateTime(field.verified_at, lang) })}
                {excluded ? ` · ${t('extraction.excludedBadge')}` : ''}
              </p>
              {onToggleInclude ? (
                <div className="mt-1">
                  <Checkbox
                    id={`include-${field.document_id}-${field.field_key}`}
                    checked={excluded}
                    disabled={togglingInclude}
                    onChange={onToggleInclude}
                    label={t('extraction.excludeFromCalculation')}
                  />
                </div>
              ) : null}
            </>
          ) : field.field_value ? (
            <p className="mt-0.5 text-[12.5px] font-medium text-amber-700">
              {t('extraction.needsReview')}
              {field.confidence != null
                ? ` · ${t('extraction.confidence', { percent: Math.round(field.confidence * 100) })}`
                : ''}
            </p>
          ) : (
            <p className="mt-0.5 text-[12.5px] text-ink-400">{t('extraction.notFound')}</p>
          )}
        </div>
        {canViewSource ? (
          <button
            type="button"
            className="btn-ghost btn-sm shrink-0"
            onClick={onViewSource}
            disabled={viewingSource}
            title={t('extraction.viewSource')}
          >
            {viewingSource ? <Spinner size={15} /> : <Eye size={15} aria-hidden="true" />}
            {t('extraction.viewSource')}
          </button>
        ) : null}
      </div>

      <div className="mt-2 flex items-end gap-2">
        <Textarea
          rows={1}
          className="min-h-0 py-2"
          value={field.field_value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('extraction.notFoundPlaceholder')}
        />
        <button
          type="button"
          className="btn-secondary btn-sm shrink-0"
          onClick={onConfirm}
          disabled={saving || !field.field_value.trim()}
        >
          {saving ? <Spinner size={15} /> : <CircleCheck size={15} aria-hidden="true" />}
          {t('extraction.confirm')}
        </button>
      </div>
    </li>
  )
}
