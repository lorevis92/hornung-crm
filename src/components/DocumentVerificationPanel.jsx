import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import ExtractedFieldRow from './ExtractedFieldRow'
import { Spinner } from './ui'

// pdfjs-dist is a large dependency (~1 MB) — only fetched when a specialist
// actually opens the source view, not on every page load.
const PdfSourceViewer = lazy(() => import('./PdfSourceViewer'))
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { docTypeLabel } from '../lib/labels'
import { mergeFieldsWithDefinitions } from '../lib/extraction'
import { recalculateInBackground, syncPersonalDetailsInBackground } from '../lib/recalc'

// Extracted values already feed the calculation as soon as they exist — no
// bulk "confirm all" step needed here either. This panel is for reviewing,
// correcting, excluding, or manually adding a value on a single document.
export default function DocumentVerificationPanel({ open, onClose, doc, categories = [], clientId, taxYear }) {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [fields, setFields] = useState([])
  const [fileUrl, setFileUrl] = useState(null)
  const [view, setView] = useState('list')
  const [sourceField, setSourceField] = useState(null)
  const [savingKey, setSavingKey] = useState(null)
  const [togglingKey, setTogglingKey] = useState(null)
  const fieldRefs = useRef({})

  const category = categories.find((c) => c.code === doc?.category_code) || null

  useEffect(() => {
    if (!open || !doc) return undefined
    let active = true
    setLoading(true)
    setView('list')
    const run = async () => {
      const [defs, extracted, url] = await Promise.all([
        api.listFieldDefinitions(),
        api.listExtractedFields(doc.id),
        api.getDownloadUrl(doc, { download: false })
      ])
      if (!active) return
      const categoryDefs = defs.filter((d) => d.category_code === doc.category_code)
      setFields(mergeFieldsWithDefinitions(categoryDefs, extracted, doc))
      setFileUrl(url)
      setLoading(false)
    }
    run()
    return () => {
      active = false
    }
  }, [open, doc])

  if (!doc) return null

  // A row_key ('' for a document-level field) makes the identity now — a
  // row-based category can have several rows sharing the same field_key
  // (e.g. "annual_premium" once per insured person), so field_key alone is
  // no longer unique within this document.
  const rowKeyOf = (field) => field.row_key || ''
  const identityOf = (field) => `${field.field_key}:${rowKeyOf(field)}`
  const sameField = (a, b) => a.field_key === b.field_key && rowKeyOf(a) === rowKeyOf(b)

  const updateValue = (key, value) => {
    setFields((list) => list.map((f) => (identityOf(f) === key ? { ...f, field_value: value } : f)))
  }

  const saveField = async (field) => {
    if (!field.field_value.trim()) return
    const key = identityOf(field)
    setSavingKey(key)
    try {
      const saved = await api.saveExtractedField(doc.id, {
        field_key: field.field_key,
        row_key: rowKeyOf(field),
        field_value: field.field_value.trim(),
        confidence: field.confidence,
        source_quote: field.source_quote,
        source_page: field.source_page,
        verified_by_specialist: true,
        verified_at: new Date().toISOString(),
        verified_by: profile?.id || null
      })
      setFields((list) =>
        list.map((f) =>
          sameField(f, field)
            ? { ...f, verified_by_specialist: true, verified_at: saved.verified_at || new Date().toISOString() }
            : f
        )
      )
      toast.success(t('common.saved'))
      recalculateInBackground(clientId, taxYear, lang)
      if (doc.category_code === 'current_tax_sheet') syncPersonalDetailsInBackground(doc.id)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setSavingKey(null)
    }
  }

  const toggleInclude = async (field) => {
    const key = identityOf(field)
    setTogglingKey(key)
    try {
      // Toggling include/exclude is itself an explicit, per-field
      // specialist action — same as editing the value — so it also counts
      // as "this field has been reviewed" for the tax-parameter-missing
      // safeguard.
      const saved = await api.saveExtractedField(doc.id, {
        field_key: field.field_key,
        row_key: rowKeyOf(field),
        field_value: field.field_value,
        confidence: field.confidence,
        source_quote: field.source_quote,
        source_page: field.source_page,
        verified_by_specialist: true,
        verified_at: new Date().toISOString(),
        verified_by: profile?.id || field.verified_by,
        included_in_calculation: field.included_in_calculation === false
      })
      setFields((list) =>
        list.map((f) =>
          sameField(f, field)
            ? {
                ...f,
                included_in_calculation: saved.included_in_calculation,
                verified_by_specialist: true,
                verified_at: saved.verified_at || new Date().toISOString()
              }
            : f
        )
      )
      recalculateInBackground(clientId, taxYear, lang)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setTogglingKey(null)
    }
  }

  const reExtract = async () => {
    setSavingKey('__reextract__')
    try {
      await api.retryExtraction(doc.id, { force: true })
      toast.success(t('common.saved'))
      const [defs, extracted] = await Promise.all([api.listFieldDefinitions(), api.listExtractedFields(doc.id)])
      const categoryDefs = defs.filter((d) => d.category_code === doc.category_code)
      setFields(mergeFieldsWithDefinitions(categoryDefs, extracted, doc))
      recalculateInBackground(clientId, taxYear, lang)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setSavingKey(null)
    }
  }

  const viewSource = (field) => {
    setSourceField(field)
    setView('source')
  }

  const backToList = () => {
    setView('list')
    const key = sourceField ? identityOf(sourceField) : null
    requestAnimationFrame(() => {
      fieldRefs.current[key]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  const handleClose = () => {
    if (savingKey) return
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('extraction.title')}
      description={
        view === 'list'
          ? t('extraction.subtitle', { category: category ? docTypeLabel(category, lang) : '', name: doc.file_name })
          : doc.file_name
      }
      size="xl"
      footer={
        view === 'list' ? (
          <button type="button" className="btn-secondary btn-sm" onClick={handleClose}>
            {t('common.close')}
          </button>
        ) : null
      }
    >
      {view === 'source' ? (
        <Suspense
          fallback={
            <div className="flex min-h-[30vh] items-center justify-center">
              <Spinner size={22} />
            </div>
          }
        >
          <PdfSourceViewer
            fileUrl={fileUrl}
            isPdf={sourceField?.isPdf}
            isText={sourceField?.isText}
            fileName={doc.file_name}
            page={sourceField?.source_page}
            quote={sourceField?.source_quote}
            onBack={backToList}
          />
        </Suspense>
      ) : loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner size={22} />
        </div>
      ) : fields.length ? (
        (() => {
          const rowGroups = []
          for (const field of fields) {
            const last = rowGroups[rowGroups.length - 1]
            if (last && last.rowKey === (field.row_key || '')) last.fields.push(field)
            else rowGroups.push({ rowKey: field.row_key || '', rowLabel: field.row_label || null, legacyFormat: Boolean(field.legacyFormat), fields: [field] })
          }
          return (
            <div className="space-y-4">
              {rowGroups.map((rowGroup) => (
                <div key={rowGroup.rowKey} className="space-y-2">
                  {rowGroup.legacyFormat ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12.5px] text-amber-800">
                      <span>{t('summary.legacyFormatBanner')}</span>
                      <button type="button" className="btn-secondary btn-sm" onClick={reExtract} disabled={savingKey === '__reextract__'}>
                        {savingKey === '__reextract__' ? <Spinner size={13} /> : null}
                        {t('summary.reExtractDocument')}
                      </button>
                    </div>
                  ) : rowGroup.rowLabel ? (
                    <p className="px-1 text-[12px] font-medium text-ink-600">{rowGroup.rowLabel}</p>
                  ) : null}
                  <ul className="space-y-3">
                    {rowGroup.fields.map((field) => (
                      <ExtractedFieldRow
                        key={identityOf(field)}
                        innerRef={(el) => {
                          fieldRefs.current[identityOf(field)] = el
                        }}
                        field={field}
                        saving={savingKey === identityOf(field)}
                        togglingInclude={togglingKey === identityOf(field)}
                        onChange={(value) => updateValue(identityOf(field), value)}
                        onConfirm={() => saveField(field)}
                        onViewSource={() => viewSource(field)}
                        onToggleInclude={() => toggleInclude(field)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )
        })()
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[14.5px] text-ink-400">
          {t('extraction.noFieldDefs')}
        </p>
      )}
    </Modal>
  )
}
