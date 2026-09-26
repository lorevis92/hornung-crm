import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck } from 'lucide-react'
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

export default function DocumentVerificationPanel({ open, onClose, doc, categories = [] }) {
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [fields, setFields] = useState([])
  const [fileUrl, setFileUrl] = useState(null)
  const [view, setView] = useState('list')
  const [sourceField, setSourceField] = useState(null)
  const [savingKey, setSavingKey] = useState(null)
  const [bulkSaving, setBulkSaving] = useState(false)
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

  const pendingCount = useMemo(
    () => fields.filter((f) => f.field_value.trim() && !f.verified_by_specialist).length,
    [fields]
  )

  if (!doc) return null

  const updateValue = (key, value) => {
    setFields((list) => list.map((f) => (f.field_key === key ? { ...f, field_value: value } : f)))
  }

  const persistField = async (field) => {
    const saved = await api.saveExtractedField(doc.id, {
      field_key: field.field_key,
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
        f.field_key === field.field_key
          ? { ...f, verified_by_specialist: true, verified_at: saved.verified_at || new Date().toISOString() }
          : f
      )
    )
  }

  const confirmField = async (field) => {
    if (!field.field_value.trim()) return
    setSavingKey(field.field_key)
    try {
      await persistField(field)
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setSavingKey(null)
    }
  }

  const confirmAll = async () => {
    const pending = fields.filter((f) => f.field_value.trim() && !f.verified_by_specialist)
    if (!pending.length) return
    setBulkSaving(true)
    try {
      for (const field of pending) {
        // Sequential, not Promise.all: keeps state updates predictable and
        // avoids hammering the DB with a burst of concurrent upserts.
        await persistField(field)
      }
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setBulkSaving(false)
    }
  }

  const toggleInclude = async (field) => {
    setTogglingKey(field.field_key)
    try {
      const saved = await api.saveExtractedField(doc.id, {
        field_key: field.field_key,
        field_value: field.field_value,
        confidence: field.confidence,
        source_quote: field.source_quote,
        source_page: field.source_page,
        verified_by_specialist: true,
        verified_at: field.verified_at,
        verified_by: field.verified_by,
        included_in_calculation: field.included_in_calculation === false
      })
      setFields((list) =>
        list.map((f) =>
          f.field_key === field.field_key
            ? { ...f, included_in_calculation: saved.included_in_calculation }
            : f
        )
      )
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setTogglingKey(null)
    }
  }

  const viewSource = (field) => {
    setSourceField(field)
    setView('source')
  }

  const backToList = () => {
    setView('list')
    const key = sourceField?.field_key
    requestAnimationFrame(() => {
      fieldRefs.current[key]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  const handleClose = () => {
    if (savingKey || bulkSaving) return
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
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={handleClose}>
              {t('common.close')}
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={confirmAll}
              disabled={bulkSaving || !pendingCount}
            >
              {bulkSaving ? <Spinner size={16} /> : <CheckCheck size={16} aria-hidden="true" />}
              {t('extraction.confirmAll', { count: pendingCount })}
            </button>
          </>
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
        <ul className="space-y-3">
          {fields.map((field) => (
            <ExtractedFieldRow
              key={field.field_key}
              innerRef={(el) => {
                fieldRefs.current[field.field_key] = el
              }}
              field={field}
              saving={savingKey === field.field_key}
              togglingInclude={togglingKey === field.field_key}
              onChange={(value) => updateValue(field.field_key, value)}
              onConfirm={() => confirmField(field)}
              onViewSource={() => viewSource(field)}
              onToggleInclude={() => toggleInclude(field)}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[14.5px] text-ink-400">
          {t('extraction.noFieldDefs')}
        </p>
      )}
    </Modal>
  )
}
