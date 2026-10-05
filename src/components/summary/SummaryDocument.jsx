import clsx from 'clsx'
import { AlertTriangle, ChevronDown, ChevronUp, FileText, RefreshCw, UserRound } from 'lucide-react'
import OtherFindingsList from '../OtherFindingsList'
import ExtractedRows from './ExtractedRows'
import { Spinner } from '../ui'
import { useI18n } from '../../i18n'
import { docTypeLabel } from '../../lib/labels'

const STATUS_LABEL_KEY = {
  uploaded: 'extraction.statusUploaded',
  extracting: 'extraction.statusExtracting',
  extracted: 'extraction.statusExtracted',
  extraction_failed: 'extraction.statusExtractionFailed',
  verified_by_specialist: 'extraction.statusExtracted',
  rejected: 'extraction.statusRejected'
}
const STATUS_TONE = {
  uploaded: 'text-ink-400',
  extracting: 'text-gold-700',
  extracted: 'text-emerald-700',
  extraction_failed: 'text-red-700',
  verified_by_specialist: 'text-emerald-700',
  rejected: 'text-ink-400'
}

// "Luca Bianchi · Figlio/a", "Entrambi i coniugi", "Non determinabile"...
export function personText(person, t) {
  const kind = t(`summary.person.${person.kind}`)
  return person.name ? `${person.name} · ${kind}` : kind
}

// One document of Tax Summary: a closed row saying whom it refers to, what
// it is and how its extraction went; opened, everything that was read from
// it. Read-only — the only action is "Riprova estrazione".
// item: one entry of buildDocumentList() (src/lib/taxSummaryData.js).
// onViewSource(document, { source_page, source_quote }) opens the viewer;
// without a page and quote it opens the document from the start.
export default function SummaryDocument({ item, open, onToggle, onViewSource, onRetry, retrying, innerRef }) {
  const { t, lang } = useI18n()
  const { doc, category, person, rows, findings, notes, needsReview } = item
  const viewAt = (source) => onViewSource(doc, source)
  const pending = doc.status === 'uploaded' || doc.status === 'extracting'

  return (
    <li ref={innerRef} className="overflow-hidden rounded-xl border border-line bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-sand/50"
      >
        <div className="min-w-0 flex-1">
          <p
            className={clsx(
              'flex items-center gap-1.5 text-[14.5px] font-semibold',
              person.kind === 'unknown' || person.kind === 'pending' ? 'text-ink-400' : 'text-ink-900'
            )}
          >
            <UserRound size={15} className="shrink-0" aria-hidden="true" />
            {personText(person, t)}
          </p>
          <p className="mt-0.5 truncate text-[13.5px] text-ink-700">{doc.file_name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            <span className="text-ink-400">
              {category ? docTypeLabel(category, lang) : t('summary.documentUncategorized')}
            </span>
            <span className={clsx('font-medium', STATUS_TONE[doc.status] || 'text-ink-400')}>
              {t(STATUS_LABEL_KEY[doc.status] || 'extraction.statusUploaded')}
            </span>
            {needsReview ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                <AlertTriangle size={11} aria-hidden="true" />
                {t('summary.needsReview')}
              </span>
            ) : null}
          </p>
        </div>
        {open ? (
          <ChevronUp size={20} className="mt-1 shrink-0 text-ink-400" aria-hidden="true" />
        ) : (
          <ChevronDown size={20} className="mt-1 shrink-0 text-ink-400" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div className="space-y-3 border-t border-line bg-sand/20 px-4 py-4">
          {doc.status === 'extraction_failed' ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[13.5px] text-red-800">
              {t('summary.failed')}
              {doc.extraction_error ? <span className="block text-[12px] text-red-700/80">{doc.extraction_error}</span> : null}
            </p>
          ) : null}
          {pending ? <p className="text-[13.5px] text-ink-500">{t('summary.pending')}</p> : null}

          {doc.person_quote ? (
            <p className="text-[13px] text-ink-500">
              {t('summary.personWhy')}{' '}
              <button
                type="button"
                className="text-left italic text-gold-800 hover:underline"
                onClick={() => viewAt({ source_page: doc.person_page, source_quote: doc.person_quote })}
              >
                «{doc.person_quote}»
              </button>
            </p>
          ) : null}

          {rows.length ? <ExtractedRows rows={rows} notes={notes} onViewSource={viewAt} /> : null}
          <OtherFindingsList findings={findings} onViewSource={viewAt} />
          {!rows.length && !findings.length && !pending && doc.status !== 'extraction_failed' ? (
            <p className="text-[13.5px] text-ink-400">{t('summary.nothingFound')}</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary btn-sm" onClick={() => viewAt({})}>
              <FileText size={14} aria-hidden="true" />
              {t('summary.openDocument')}
            </button>
            {doc.status !== 'rejected' ? (
              <button type="button" className="btn-secondary btn-sm" onClick={onRetry} disabled={retrying}>
                {retrying ? <Spinner size={14} /> : <RefreshCw size={14} aria-hidden="true" />}
                {t('summary.retryExtraction')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  )
}
