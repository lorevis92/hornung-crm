import { Eye } from 'lucide-react'
import { useI18n } from '../../i18n'
import { formatFieldValue } from '../../lib/fieldFormat'

// The notes that concern one row, as short sentences (see
// src/lib/extractionQuality.js). Uncertain "other findings" are marked in
// their own list, so they are not repeated here.
function noteText(note, t) {
  if (note.kind === 'unidentifiedRow') return t('summary.note.unidentifiedRow')
  if (note.kind === 'duplicateSource') return t('summary.note.duplicateSource')
  if (note.kind === 'reportedTotalMismatch') {
    return t('summary.note.reportedTotalMismatch', {
      stated: note.detail?.reportedTotal ?? '',
      sum: note.detail?.rowsSum ?? ''
    })
  }
  return null
}

function SourceButton({ onClick }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-gold-700 hover:text-gold-800 hover:underline"
      onClick={onClick}
    >
      <Eye size={12} aria-hidden="true" />
      {t('extraction.viewSource')}
    </button>
  )
}

// One document's extracted values, read-only: a block per row (one account,
// one premium...), each with its readable name and its person, every value
// formatted and linked to the exact point of the document it came from.
// rows: groupDocumentRows() output. notes: this document's quality notes.
// onViewSource({ source_page, source_quote }).
export default function ExtractedRows({ rows, notes = [], onViewSource }) {
  const { t, lang } = useI18n()
  let unnamed = 0

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const title = row.rowKey ? row.label || t('summary.rowUntitled', { n: ++unnamed }) : t('summary.documentLevel')
        const rowNotes = notes
          .filter((n) => (n.rowKey || '') === row.rowKey)
          .map((n) => noteText(n, t))
          .filter(Boolean)
        return (
          <div key={row.rowKey || '__document'} className="rounded-xl border border-line bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line/70 bg-sand/40 px-3 py-2">
              <p className="text-[13.5px] font-semibold text-ink-800">{title}</p>
              {row.person ? (
                <p className="text-[12.5px] text-ink-500">{t('summary.rowPerson', { name: row.person })}</p>
              ) : null}
            </div>
            <dl className="divide-y divide-line/60">
              {row.fields.map((field) => (
                <div
                  key={field.field_key}
                  className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]"
                >
                  <dt className="text-[13px] text-ink-500">{field.label}</dt>
                  <dd className="text-[14px] font-medium tabular-nums text-ink-900">
                    {formatFieldValue(
                      { value: field.value, valueType: field.value_type, fieldKey: field.field_key, currency: row.currency },
                      lang
                    )}
                  </dd>
                  <dd>
                    {field.source_quote || field.source_page ? (
                      <SourceButton onClick={() => onViewSource({ source_page: field.source_page, source_quote: field.source_quote })} />
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
            {rowNotes.length ? (
              <ul className="border-t border-line/70 px-3 py-2 text-[12.5px] text-amber-800">
                {rowNotes.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
