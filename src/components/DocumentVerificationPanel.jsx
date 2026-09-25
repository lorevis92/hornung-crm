import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, CircleCheck, Eye } from 'lucide-react'
import Modal from './Modal'
import { Spinner, Textarea } from './ui'

// pdfjs-dist is a large dependency (~1 MB) — only fetched when a specialist
// actually opens the source view, not on every page load.
const PdfSourceViewer = lazy(() => import('./PdfSourceViewer'))
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { docTypeLabel } from '../lib/labels'
import { formatDateTime } from '../lib/format'

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
  const fieldRefs = useRef({})

  const category = categories.find((c) => c.code === doc?.category_code) || null
  const isPdf = doc?.mime_type === 'application/pdf'

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
      const categoryDefs = defs
        .filter((d) => d.category_code === doc.category_code)
        .sort((a, b) => a.sort_order - b.sort_order)
      const byKey = Object.fromEntries((extracted || []).map((e) => [e.field_key, e]))
      setFields(
        categoryDefs.map((d) => {
          const e = byKey[d.field_key]
          return {
            field_key: d.field_key,
            field_label: d.field_label || d.field_key,
            field_value: e?.field_value || '',
            confidence: e?.confidence ?? null,
            source_quote: e?.source_quote || null,
            source_page: e?.source_page || null,
            verified_by_specialist: e?.verified_by_specialist || false,
            verified_at: e?.verified_at || null
          }
        })
      )
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
            isPdf={isPdf}
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
            <li
              key={field.field_key}
              ref={(el) => {
                fieldRefs.current[field.field_key] = el
              }}
              className="rounded-xl border border-line bg-white p-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-medium text-ink-900">{field.field_label}</p>
                  {field.verified_by_specialist ? (
                    <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-emerald-700">
                      <CircleCheck size={13} aria-hidden="true" />
                      {t('extraction.verifiedOn', { date: formatDateTime(field.verified_at, lang) })}
                    </p>
                  ) : field.confidence != null ? (
                    <p className="mt-0.5 text-[12.5px] text-ink-400">
                      {t('extraction.confidence', { percent: Math.round(field.confidence * 100) })}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[12.5px] text-ink-400">{t('extraction.notFound')}</p>
                  )}
                </div>
                {field.source_quote || isPdf ? (
                  <button
                    type="button"
                    className="btn-ghost btn-sm shrink-0"
                    onClick={() => viewSource(field)}
                    title={t('extraction.viewSource')}
                  >
                    <Eye size={15} aria-hidden="true" />
                    {t('extraction.viewSource')}
                  </button>
                ) : null}
              </div>

              <div className="mt-2 flex items-end gap-2">
                <Textarea
                  rows={1}
                  className="min-h-0 py-2"
                  value={field.field_value}
                  onChange={(e) => updateValue(field.field_key, e.target.value)}
                  placeholder={t('extraction.notFoundPlaceholder')}
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm shrink-0"
                  onClick={() => confirmField(field)}
                  disabled={savingKey === field.field_key || !field.field_value.trim()}
                >
                  {savingKey === field.field_key ? <Spinner size={15} /> : <CircleCheck size={15} aria-hidden="true" />}
                  {t('extraction.confirm')}
                </button>
              </div>
            </li>
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
