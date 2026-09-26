import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FolderOpen } from 'lucide-react'
import ExtractedFieldRow from '../components/ExtractedFieldRow'
import { EmptyState, PageLoader, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { docTypeLabel } from '../lib/labels'
import { mergeFieldsWithDefinitions } from '../lib/extraction'
import { fullName } from '../lib/format'

// pdfjs-dist is a large dependency — only fetched when a specialist actually
// opens the source view, not on every page load.
const PdfSourceViewer = lazy(() => import('../components/PdfSourceViewer'))

// Section order + which document_categories.group_key values feed each one.
// assets/property are merged into one "Wealth" section per the spec.
const SECTIONS = [
  { key: 'base', groups: ['base'], titleKey: 'summary.sectionBase' },
  { key: 'income', groups: ['income'], titleKey: 'summary.sectionIncome' },
  { key: 'deductions', groups: ['deductions'], titleKey: 'summary.sectionDeductions' },
  { key: 'wealth', groups: ['assets', 'property'], titleKey: 'summary.sectionWealth' },
  { key: 'other', groups: ['other'], titleKey: 'summary.sectionOther' }
]

function groupBy(list, key) {
  return list.reduce((acc, item) => {
    ;(acc[item[key]] ||= []).push(item)
    return acc
  }, {})
}

export default function TaxSummary() {
  const { caseId } = useParams()
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [caseRow, setCaseRow] = useState(null)
  const [categories, setCategories] = useState([])
  const [documents, setDocuments] = useState([])
  const [fields, setFields] = useState([])

  const [view, setView] = useState('list')
  const [sourceField, setSourceField] = useState(null)
  const [fileUrls, setFileUrls] = useState({})
  const [busyKey, setBusyKey] = useState(null)
  const [viewingKey, setViewingKey] = useState(null)
  const fieldRefs = useRef({})

  useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true)
      const row = await api.getCase(caseId)
      if (!active || !row) {
        setLoading(false)
        return
      }
      setCaseRow(row)

      const [docs, cats, allDefs] = await Promise.all([
        api.listClientDocuments(row.client_id, row.tax_year),
        api.listDocumentCategories(),
        api.listFieldDefinitions()
      ])
      if (!active) return
      const categorized = docs.filter((d) => d.category_code)
      setDocuments(categorized)
      setCategories(cats)

      const extractedByDoc = await Promise.all(
        categorized.map((d) => api.listExtractedFieldsForDocument(d.id))
      )
      if (!active) return

      const flat = []
      categorized.forEach((doc, i) => {
        const defs = allDefs.filter((d) => d.category_code === doc.category_code)
        const category = cats.find((c) => c.code === doc.category_code)
        mergeFieldsWithDefinitions(defs, extractedByDoc[i], doc).forEach((field) => {
          flat.push({ ...field, category_code: doc.category_code, group_key: category?.group_key || 'other' })
        })
      })
      setFields(flat)
      setLoading(false)
    }
    run()
    return () => {
      active = false
    }
  }, [caseId])

  const sections = useMemo(() => {
    return SECTIONS.map((section) => {
      const sectionCategories = categories
        .filter((c) => section.groups.includes(c.group_key))
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((category) => {
          const categoryFields = fields.filter((f) => f.category_code === category.code)
          if (!categoryFields.length) return null
          const byDoc = groupBy(categoryFields, 'document_id')
          return {
            category,
            documents: Object.entries(byDoc).map(([documentId, docFields]) => ({
              documentId,
              fileName: docFields[0].file_name,
              fields: docFields
            }))
          }
        })
        .filter(Boolean)
      return { ...section, categories: sectionCategories }
    }).filter((s) => s.categories.length)
  }, [categories, fields])

  const fieldKey = (field) => `${field.document_id}:${field.field_key}`

  const updateValue = (target, value) => {
    setFields((list) =>
      list.map((f) =>
        f.document_id === target.document_id && f.field_key === target.field_key
          ? { ...f, field_value: value }
          : f
      )
    )
  }

  const confirmField = async (field) => {
    if (!field.field_value.trim()) return
    const key = fieldKey(field)
    setBusyKey(key)
    try {
      const saved = await api.saveExtractedFieldForDocument(field.document_id, {
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
          f.document_id === field.document_id && f.field_key === field.field_key
            ? { ...f, verified_by_specialist: true, verified_at: saved.verified_at || new Date().toISOString() }
            : f
        )
      )
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setBusyKey(null)
    }
  }

  const viewSource = async (field) => {
    const key = fieldKey(field)
    let url = fileUrls[field.document_id]
    if (!url) {
      setViewingKey(key)
      try {
        const doc = documents.find((d) => d.id === field.document_id)
        url = doc ? await api.getDownloadUrl(doc, { download: false }) : null
        setFileUrls((prev) => ({ ...prev, [field.document_id]: url }))
      } catch (error) {
        console.error(error)
        toast.error(error.message || t('common.error'))
        setViewingKey(null)
        return
      }
      setViewingKey(null)
    }
    setSourceField(field)
    setView('source')
  }

  const backToList = () => {
    setView('list')
    const key = sourceField ? fieldKey(sourceField) : null
    requestAnimationFrame(() => {
      fieldRefs.current[key]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  if (loading) return <PageLoader label={t('common.loading')} />
  if (!caseRow) return <EmptyState icon={FolderOpen} title={t('common.error')} />

  return (
    <div className="space-y-6">
      <Link
        to={`/year/${caseId}`}
        className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {t('summary.backToCase')}
      </Link>

      <div>
        <p className="eyebrow">{t('summary.title')}</p>
        <h1 className="display mt-1 text-[30px] leading-tight sm:text-[36px]">
          {t('summary.subtitle', { name: fullName(caseRow.client) || caseRow.client?.email, year: caseRow.tax_year })}
        </h1>
      </div>

      {view === 'source' ? (
        <Suspense
          fallback={
            <div className="flex min-h-[30vh] items-center justify-center">
              <Spinner size={22} />
            </div>
          }
        >
          <PdfSourceViewer
            fileUrl={fileUrls[sourceField?.document_id] || null}
            isPdf={sourceField?.isPdf}
            fileName={sourceField?.file_name}
            page={sourceField?.source_page}
            quote={sourceField?.source_quote}
            onBack={backToList}
          />
        </Suspense>
      ) : sections.length ? (
        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.key} className="space-y-4">
              <h2 className="section-title text-xl">{t(section.titleKey)}</h2>
              <div className="space-y-5">
                {section.categories.map(({ category, documents: catDocuments }) => (
                  <div key={category.code} className="space-y-3">
                    <h3 className="text-[15px] font-semibold text-ink-700">{docTypeLabel(category, lang)}</h3>
                    {catDocuments.map((docGroup) => (
                      <div key={docGroup.documentId} className="space-y-2 rounded-xl bg-sand/40 p-3">
                        <p className="px-1 text-[12.5px] font-medium text-ink-500">{docGroup.fileName}</p>
                        <ul className="space-y-3">
                          {docGroup.fields.map((field) => (
                            <ExtractedFieldRow
                              key={field.field_key}
                              innerRef={(el) => {
                                fieldRefs.current[fieldKey(field)] = el
                              }}
                              field={field}
                              showDocument={false}
                              saving={busyKey === fieldKey(field)}
                              viewingSource={viewingKey === fieldKey(field)}
                              onChange={(value) => updateValue(field, value)}
                              onConfirm={() => confirmField(field)}
                              onViewSource={() => viewSource(field)}
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState icon={FolderOpen} title={t('summary.noData')} />
      )}
    </div>
  )
}
