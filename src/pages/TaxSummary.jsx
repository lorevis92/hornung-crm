import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle, AlignJustify, ArrowLeft, Calculator, FileDown, FolderOpen, Info, Landmark, List, PiggyBank, Receipt
} from 'lucide-react'
import CompactFieldRow from '../components/CompactFieldRow'
import ExtractedFieldRow from '../components/ExtractedFieldRow'
import Modal from '../components/Modal'
import { EmptyState, Field, PageLoader, Spinner, Stat, TextInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { docTypeLabel } from '../lib/labels'
import { mergeFieldsWithDefinitions, verifiedFieldsByDocument } from '../lib/extraction'
import { formatAmountSwiss, formatChfSwiss, formatDate, formatDateTime, fullName } from '../lib/format'
import {
  recalculateInBackground, syncChildSuggestionsInBackground, syncPersonalDetailsInBackground,
  syncPropertySuggestionInBackground
} from '../lib/recalc'

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

// The three sections that make up the exportable tax calculation document —
// "base"/"other" (personal details, misc.) stay screen-only, same scope
// pdfExport.js uses.
const CALC_SECTION_KEYS = ['income', 'deductions', 'wealth']

function groupBy(list, key) {
  return list.reduce((acc, item) => {
    ;(acc[item[key]] ||= []).push(item)
    return acc
  }, {})
}

// Which of the two field-review layouts a specialist last picked — same
// remembered-choice pattern as DocumentList's list/grid toggle.
const FIELD_LAYOUT_KEY = 'hornung.fieldLayout'

function readStoredFieldLayout() {
  try {
    return localStorage.getItem(FIELD_LAYOUT_KEY) === 'compact' ? 'compact' : 'spacious'
  } catch {
    return 'spacious'
  }
}

function storeFieldLayout(layout) {
  try {
    localStorage.setItem(FIELD_LAYOUT_KEY, layout)
  } catch {
    /* localStorage unavailable — ignore, the app still works */
  }
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
  const [fieldLayout, setFieldLayoutState] = useState(readStoredFieldLayout)
  const [sourceField, setSourceField] = useState(null)
  const [fileUrls, setFileUrls] = useState({})
  const [busyKey, setBusyKey] = useState(null)
  const [togglingKey, setTogglingKey] = useState(null)
  const [viewingKey, setViewingKey] = useState(null)
  const fieldRefs = useRef({})

  const [result, setResult] = useState(null)
  const [calculating, setCalculating] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [allDocuments, setAllDocuments] = useState([])
  const [childrenCount, setChildrenCount] = useState(0)
  // The canonical anagraphic record (client_persons/client_children/
  // client_properties) — same source Questionnaire and the calculation
  // engine read. Kept in full, not just children.length, so the "Personal
  // details" section below can show what's ACTUALLY on file instead of
  // only what a specific document's own extraction happened to say —
  // those two silently disagreeing (this client's registry sync never
  // having run) is exactly what made this section look right while
  // Questionnaire and the calculation stayed empty/wrong.
  const [questionnaire, setQuestionnaire] = useState(null)
  const [retryingDocId, setRetryingDocId] = useState(null)

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

      const [docs, cats, allDefs, existingAggregate, questionnaire] = await Promise.all([
        api.listClientDocuments(row.client_id, row.tax_year),
        api.listDocumentCategories(),
        api.listFieldDefinitions(),
        api.getTaxAggregate(row.client_id, row.tax_year),
        api.getQuestionnaire(row.client_id)
      ])
      if (!active) return
      const categorized = docs.filter((d) => d.category_code)
      setAllDocuments(docs)
      setDocuments(categorized)
      setCategories(cats)
      setResult(existingAggregate)
      setChildrenCount((questionnaire?.children || []).length)
      setQuestionnaire(questionnaire)

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

  // "How this was calculated" grouped by section — only the fields that
  // actually feed the total (already exactly what tax_aggregate_components
  // holds), two columns only: the item (document identifier baked into its
  // text) and the signed amount.
  const componentsBySection = useMemo(() => {
    if (!result?.components?.length) return []
    return CALC_SECTION_KEYS.map((key) => ({
      key,
      titleKey: SECTIONS.find((s) => s.key === key)?.titleKey,
      components: result.components.filter((c) => c.section_key === key && !c.needs_verification)
    })).filter((s) => s.components.length)
  }, [result])

  // Capped entries whose tax parameter couldn't be found for this client's
  // canton/year — excluded from the totals above (not part of the
  // reconciliation the section above guarantees), listed separately so the
  // specialist can see what's missing and decide whether to include it
  // anyway (editing/confirming the field, or its include toggle, is what
  // makes it count — see src/lib/taxCalculation.js).
  const needsVerificationComponents = useMemo(
    () => (result?.components || []).filter((c) => c.needs_verification),
    [result]
  )

  // Data the calculation is silently missing, as opposed to data it has but
  // flags as uncertain (the popup below) — a document AI extraction never
  // finished on, or a stated number of children the registry doesn't
  // actually have records for. Unlike the uncertainty popup, this is never
  // dismissed: it stays visible for as long as the underlying gap does.
  const failedDocuments = useMemo(
    () => allDocuments.filter((d) => d.status === 'extraction_failed'),
    [allDocuments]
  )
  // Still mid-pipeline — not even classified yet, or claimed but never
  // finished (including one stuck there by a crashed/timed-out run). The
  // aggregate itself never claims to be ready while any of these exist
  // (see api/_recalc.js) — this just makes that visible instead of the
  // report silently sitting on stale or partial numbers.
  const processingDocuments = useMemo(
    () => allDocuments.filter((d) => ['uploaded', 'extracting'].includes(d.status)),
    [allDocuments]
  )
  const extractedChildrenCount = useMemo(() => {
    const field = fields.find(
      (f) => f.category_code === 'current_tax_sheet' && f.field_key === 'children_count' && f.field_value
    )
    const n = field ? parseInt(field.field_value, 10) : null
    return Number.isFinite(n) ? n : null
  }, [fields])
  const childrenMismatch = extractedChildrenCount != null && extractedChildrenCount !== childrenCount

  const registryPrimary = useMemo(
    () => (questionnaire?.persons || []).find((p) => p.person_type === 'primary') || null,
    [questionnaire]
  )
  const registrySpouse = useMemo(
    () => (questionnaire?.persons || []).find((p) => p.person_type === 'spouse') || null,
    [questionnaire]
  )

  // A document extracted successfully, categorized under a group that
  // normally produces income/wealth (not just reference data), with at
  // least one filled-in field — yet none of its fields show up in ANY
  // aggregate component, included or not. Catches a broken document/field
  // link regardless of cause: the report should never present itself as
  // final while data it clearly has access to went silently unused.
  const orphanedDocuments = useMemo(() => {
    if (!result) return []
    const componentDocIds = new Set((result.components || []).map((c) => c.document_id).filter(Boolean))
    const calcGroups = new Set(['income', 'deductions', 'assets', 'property'])
    return documents.filter((doc) => {
      if (doc.status !== 'extracted' || componentDocIds.has(doc.id)) return false
      return fields.some((f) => f.document_id === doc.id && calcGroups.has(f.group_key) && f.field_value)
    })
  }, [documents, fields, result])

  const completenessIssueCount =
    failedDocuments.length + processingDocuments.length + (childrenMismatch ? 1 : 0) + orphanedDocuments.length

  const retryFailedExtraction = async (doc) => {
    setRetryingDocId(doc.id)
    try {
      await api.retryExtraction(doc.id)
      toast.success(t('common.saved'))
      const docs = await api.listClientDocuments(caseRow.client_id, caseRow.tax_year)
      setAllDocuments(docs)
      const categorized = docs.filter((d) => d.category_code)
      setDocuments(categorized)
      const extractedByDoc = await Promise.all(categorized.map((d) => api.listExtractedFieldsForDocument(d.id)))
      const allDefs = await api.listFieldDefinitions()
      const flat = []
      categorized.forEach((d, i) => {
        const defs = allDefs.filter((def) => def.category_code === d.category_code)
        const category = categories.find((c) => c.code === d.category_code)
        mergeFieldsWithDefinitions(defs, extractedByDoc[i], d).forEach((field) => {
          flat.push({ ...field, category_code: d.category_code, group_key: category?.group_key || 'other' })
        })
      })
      setFields(flat)
      const computed = await api.calculateAggregates(caseRow.client_id, caseRow.tax_year, lang)
      setResult(computed)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setRetryingDocId(null)
    }
  }

  // Proactive "things to verify" index — structured, not just descriptive
  // strings, so the popup can offer the specific action that actually
  // resolves each kind instead of only naming the problem:
  //  - parameter: a tax_parameters row flagged "da confermare" that this
  //    calculation actually used — not tied to one document/field, fixed
  //    in Tax settings, so the action is a link there;
  //  - missingParam: a field excluded because no matching tax parameter
  //    was found for this canton/year — the specialist can confirm the
  //    field as-is right here (same effect as confirming it in the
  //    breakdown below);
  //  - foreignCurrency: a foreign-currency field excluded because it was
  //    never converted — enter a rate or the converted CHF amount right
  //    here instead of going to find the field elsewhere;
  //  - separate: separately-taxed or reference-only items (pension
  //    withdrawals, inheritances, a vehicle's purchase price, ...) — not
  //    really "wrong", nothing to fix, just point at the source document;
  //  - missingRegistry: client_persons has no data at all for this client
  //    yet (the sync never having reached them) — not a document-level
  //    fix, so the action is a link to the case page's "Reload everything
  //    from the documents" action instead.
  const uncertainItems = useMemo(() => {
    if (!result) return []
    const paramItems = (result.aggregate?.uncertain_parameters || []).map((label) => ({
      kind: 'parameter',
      key: `param:${label}`,
      label
    }))
    const flagged = (result.components || []).filter((c) => c.needs_verification)
    const missingParamItems = flagged
      .filter((c) => (c.field_label || '').includes('missing tax parameter'))
      .map((c) => ({ kind: 'missingParam', key: `missing:${c.document_id}:${c.field_key}`, label: c.field_label, component: c }))
    const foreignCurrencyItems = flagged
      .filter((c) => /foreign currency/.test(c.field_label || ''))
      .map((c) => ({ kind: 'foreignCurrency', key: `fx:${c.document_id}:${c.field_key}`, label: c.field_label, component: c }))
    const missingRegistryItems = flagged
      .filter((c) => /marital status unknown/.test(c.field_label || ''))
      .map((c) => ({ kind: 'missingRegistry', key: `registry:${c.document_id}:${c.field_key}`, label: c.field_label }))
    const separateItems = flagged
      .filter((c) => /separately taxed|no cantonal depreciation/.test(c.field_label || ''))
      .map((c) => ({ kind: 'separate', key: `sep:${c.document_id}:${c.field_key}`, label: c.field_label, component: c }))
    return [...paramItems, ...missingParamItems, ...foreignCurrencyItems, ...missingRegistryItems, ...separateItems]
  }, [result])

  // Stable signature for "has the set of uncertain items changed since the
  // specialist last dismissed the popup for this exact calculation" — a
  // sorted join is enough, no real hashing needed for an equality check.
  const uncertaintySignature = useMemo(() => uncertainItems.map((i) => i.key).sort().join('|'), [uncertainItems])

  const [uncertaintyModalOpen, setUncertaintyModalOpen] = useState(false)
  const [fxEdits, setFxEdits] = useState({})
  const [resolvingUncertainKey, setResolvingUncertainKey] = useState(null)
  const uncertaintySeenKey = caseRow ? `hornung.uncertaintySeen.${caseRow.client_id}.${caseRow.tax_year}` : null

  useEffect(() => {
    if (!uncertaintySeenKey || !uncertainItems.length) {
      setUncertaintyModalOpen(false)
      return
    }
    let seen = null
    try {
      seen = localStorage.getItem(uncertaintySeenKey)
    } catch {
      /* private mode — always show */
    }
    setUncertaintyModalOpen(seen !== uncertaintySignature)
  }, [uncertaintySeenKey, uncertaintySignature, uncertainItems.length])

  const dismissUncertaintyModal = () => {
    if (uncertaintySeenKey) {
      try {
        localStorage.setItem(uncertaintySeenKey, uncertaintySignature)
      } catch {
        /* private mode — nothing to persist, the popup will just show again next time */
      }
    }
    setUncertaintyModalOpen(false)
  }

  // Shared by every actionable uncertain-item kind below: save the field
  // (with verified_by_specialist so taxCalculation.js trusts it) and
  // refresh both `fields` and the calculation, exactly what confirming a
  // field in the breakdown further down the page already does — reused
  // here instead of duplicated, just aimed at whichever field an item in
  // the popup points at.
  const saveUncertainField = async (component, patch) => {
    const original = fields.find((f) => f.document_id === component.document_id && f.field_key === component.field_key)
    if (!original) return null
    const saved = await api.saveExtractedFieldForDocument(component.document_id, {
      field_key: component.field_key,
      field_value: original.field_value,
      confidence: original.confidence,
      source_quote: original.source_quote,
      source_page: original.source_page,
      verified_by_specialist: true,
      verified_at: new Date().toISOString(),
      verified_by: profile?.id || null,
      ...patch
    })
    setFields((list) =>
      list.map((f) =>
        f.document_id === component.document_id && f.field_key === component.field_key
          ? { ...f, field_value: saved.field_value, verified_by_specialist: true, verified_at: saved.verified_at }
          : f
      )
    )
    const computed = await recalculateInBackground(caseRow.client_id, caseRow.tax_year, lang)
    if (computed) setResult(computed)
    return saved
  }

  const uncertainFieldKey = (component) => `${component.document_id}:${component.field_key}`

  const resolveForeignCurrencyItem = async (component) => {
    const key = uncertainFieldKey(component)
    const edit = fxEdits[key] || {}
    const rate = parseFloat(edit.rate)
    const amount = parseFloat(edit.amount)
    const convertedAmount = Number.isFinite(amount)
      ? amount
      : Number.isFinite(rate)
        ? component.amount * rate
        : null
    if (convertedAmount == null) return
    setResolvingUncertainKey(key)
    try {
      await saveUncertainField(component, { field_value: String(Math.round(convertedAmount * 100) / 100) })
      setFxEdits((edits) => {
        const { [key]: _discard, ...rest } = edits
        return rest
      })
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setResolvingUncertainKey(null)
    }
  }

  const confirmUncertainFieldAsIs = async (component) => {
    const key = uncertainFieldKey(component)
    setResolvingUncertainKey(key)
    try {
      await saveUncertainField(component, {})
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setResolvingUncertainKey(null)
    }
  }

  const viewUncertainSource = (component) => {
    const original = fields.find((f) => f.document_id === component.document_id && f.field_key === component.field_key)
    if (!original) return
    dismissUncertaintyModal()
    viewSource(original)
  }

  // "Document data" reference — every verified field, grouped by document,
  // regardless of whether it feeds the calculation above.
  const documentDataGroups = useMemo(
    () =>
      sections
        .filter((s) => CALC_SECTION_KEYS.includes(s.key))
        .flatMap((s) => verifiedFieldsByDocument(s, lang)),
    [sections, lang]
  )

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
      recalculateInBackground(caseRow.client_id, caseRow.tax_year, lang).then((computed) => {
        if (computed) setResult(computed)
      })
      if (field.category_code === 'current_tax_sheet') syncPersonalDetailsInBackground(field.document_id)
      if (field.category_code === 'property_tax_value') syncPropertySuggestionInBackground(field.document_id)
      if (field.category_code === 'current_tax_sheet' || field.category_code === 'childcare_costs') {
        syncChildSuggestionsInBackground(caseRow.client_id, caseRow.tax_year)
      }
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setBusyKey(null)
    }
  }

  const toggleInclude = async (field) => {
    const key = fieldKey(field)
    setTogglingKey(key)
    try {
      // Toggling include/exclude is itself an explicit, per-field
      // specialist action — same as editing the value — so it also counts
      // as "this field has been reviewed" for the tax-parameter-missing
      // safeguard below.
      const saved = await api.saveExtractedFieldForDocument(field.document_id, {
        field_key: field.field_key,
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
          f.document_id === field.document_id && f.field_key === field.field_key
            ? {
                ...f,
                included_in_calculation: saved.included_in_calculation,
                verified_by_specialist: true,
                verified_at: saved.verified_at || new Date().toISOString()
              }
            : f
        )
      )
      recalculateInBackground(caseRow.client_id, caseRow.tax_year, lang).then((computed) => {
        if (computed) setResult(computed)
      })
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setTogglingKey(null)
    }
  }

  const calculate = async () => {
    setCalculating(true)
    try {
      const computed = await api.calculateAggregates(caseRow.client_id, caseRow.tax_year, lang)
      setResult(computed)
      if (computed.cantonMissing) {
        toast.error(t('summary.cantonMissing'))
      } else {
        toast.success(t('common.saved'))
      }
      if (computed.warnings?.length) {
        computed.warnings.forEach((w) => console.warn('[calculate-aggregates]', w))
      }
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setCalculating(false)
    }
  }

  const downloadPdf = async () => {
    setExportingPdf(true)
    try {
      // jsPDF + autotable are only fetched when a specialist actually
      // generates a PDF, not on every page load — same reasoning as the
      // lazy-loaded PdfSourceViewer above.
      const { exportTaxSummaryPdf } = await import('../lib/pdfExport')
      await exportTaxSummaryPdf({ caseRow, sections, result, lang, t })
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setExportingPdf(false)
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

  const setFieldLayout = (layout) => {
    setFieldLayoutState(layout)
    storeFieldLayout(layout)
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

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('summary.title')}</p>
          <h1 className="display mt-1 text-[30px] leading-tight sm:text-[36px]">
            {t('summary.subtitle', { name: fullName(caseRow.client) || caseRow.client?.email, year: caseRow.tax_year })}
          </h1>
        </div>
        {view === 'list' ? (
          <button type="button" className="btn-primary btn-sm" onClick={calculate} disabled={calculating}>
            {calculating ? <Spinner size={16} /> : <Calculator size={16} aria-hidden="true" />}
            {result ? t('summary.recalculate') : t('summary.calculate')}
          </button>
        ) : null}
      </div>

      {view === 'list' && completenessIssueCount ? (
        <div className="space-y-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
          <p className="flex items-center gap-2 text-[14.5px] font-semibold text-red-900">
            <AlertTriangle size={17} aria-hidden="true" />
            {t('summary.incompleteTitle', { count: completenessIssueCount })}
          </p>
          <ul className="space-y-1.5">
            {failedDocuments.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px] text-red-800">
                <span>
                  {t('summary.incompleteFailedDoc', { name: doc.file_name })}
                  {doc.extraction_error ? (
                    <span className="block text-[12px] text-red-700/80">{doc.extraction_error}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-sm shrink-0"
                  onClick={() => retryFailedExtraction(doc)}
                  disabled={retryingDocId === doc.id}
                >
                  {retryingDocId === doc.id ? <Spinner size={14} /> : null}
                  {t('summary.retryExtraction')}
                </button>
              </li>
            ))}
            {processingDocuments.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px] text-red-800">
                <span>{t('summary.incompleteProcessingDoc', { name: doc.file_name })}</span>
                <button
                  type="button"
                  className="btn-secondary btn-sm shrink-0"
                  onClick={() => retryFailedExtraction(doc)}
                  disabled={retryingDocId === doc.id}
                >
                  {retryingDocId === doc.id ? <Spinner size={14} /> : null}
                  {t('summary.retryExtraction')}
                </button>
              </li>
            ))}
            {childrenMismatch ? (
              <li className="flex flex-wrap items-center justify-between gap-2 text-[13.5px] text-red-800">
                <span>
                  {t('summary.incompleteChildrenMismatch', { extracted: extractedChildrenCount, registered: childrenCount })}
                </span>
                <Link to={`/year/${caseId}?fix=consistency`} className="btn-secondary btn-sm shrink-0">
                  {t('summary.fixChildren')}
                </Link>
              </li>
            ) : null}
            {orphanedDocuments.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px] text-red-800">
                <span>{t('summary.incompleteOrphanedDoc', { name: doc.file_name })}</span>
                <button type="button" className="btn-secondary btn-sm shrink-0" onClick={calculate} disabled={calculating}>
                  {calculating ? <Spinner size={14} /> : null}
                  {t('summary.recalculate')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
          {/* The canonical record — client_persons/client_children/
              client_properties, the same source Questionnaire and the
              calculation engine read. Shown first and separately from the
              per-document extraction cards below, which are the SOURCE
              that feeds this via sync, never an alternate reading of the
              client's actual anagraphic data. */}
          {questionnaire ? (
            <section className="card card-pad space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="section-title text-xl">{t('summary.registryTitle')}</h2>
                  <p className="section-sub">{t('summary.registryHelp')}</p>
                </div>
                <Link to={`/clients/${caseRow.client_id}?tab=questionnaire`} className="btn-secondary btn-sm shrink-0">
                  {t('summary.registryEdit')}
                </Link>
              </div>

              {!registryPrimary ? (
                <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[13.5px] text-red-800">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {t('summary.registryEmpty')}
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">{t('data.taxpayer')}</p>
                  {registryPrimary ? (
                    <div className="mt-1 space-y-0.5 text-[14.5px] text-ink-800">
                      <p className="font-medium">{fullName(registryPrimary) || t('summary.registryUnnamed')}</p>
                      {registryPrimary.date_of_birth ? (
                        <p className="text-ink-500">{formatDate(registryPrimary.date_of_birth, lang)}</p>
                      ) : null}
                      <p className="text-ink-500">
                        {registryPrimary.marital_status ? t(`marital.${registryPrimary.marital_status}`) : t('summary.registryUnknown')}
                      </p>
                      {registryPrimary.current_address ? <p className="text-ink-500">{registryPrimary.current_address}</p> : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-[13.5px] text-ink-400">{t('common.notProvided')}</p>
                  )}
                </div>

                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">{t('data.spouse')}</p>
                  {registrySpouse ? (
                    <div className="mt-1 space-y-0.5 text-[14.5px] text-ink-800">
                      <p className="font-medium">{fullName(registrySpouse) || t('summary.registryUnnamed')}</p>
                      {registrySpouse.date_of_birth ? (
                        <p className="text-ink-500">{formatDate(registrySpouse.date_of_birth, lang)}</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-[13.5px] text-ink-400">{t('common.notProvided')}</p>
                  )}
                </div>

                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">{t('data.children')}</p>
                  {questionnaire.children?.length ? (
                    <ul className="mt-1 space-y-0.5 text-[14.5px] text-ink-800">
                      {questionnaire.children.map((c, i) => (
                        <li key={i}>
                          {c.full_name || t('summary.registryUnnamed')}
                          {c.date_of_birth ? ` — ${formatDate(c.date_of_birth, lang)}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[13.5px] text-ink-400">{t('common.notProvided')}</p>
                  )}
                </div>

                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">{t('data.properties')}</p>
                  {questionnaire.properties?.length ? (
                    <ul className="mt-1 space-y-0.5 text-[14.5px] text-ink-800">
                      {questionnaire.properties.map((p, i) => (
                        <li key={i}>{p.address}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[13.5px] text-ink-400">{t('common.notProvided')}</p>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          <div className="flex items-center justify-end gap-1" role="group" aria-label={t('summary.fieldViewToggle')}>
            <button
              type="button"
              className={clsx('btn-ghost btn-sm', fieldLayout === 'spacious' && 'bg-ink-100 text-ink-900')}
              onClick={() => setFieldLayout('spacious')}
              aria-pressed={fieldLayout === 'spacious'}
              aria-label={t('summary.fieldViewSpacious')}
              title={t('summary.fieldViewSpacious')}
            >
              <List size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={clsx('btn-ghost btn-sm', fieldLayout === 'compact' && 'bg-ink-100 text-ink-900')}
              onClick={() => setFieldLayout('compact')}
              aria-pressed={fieldLayout === 'compact'}
              aria-label={t('summary.fieldViewCompact')}
              title={t('summary.fieldViewCompact')}
            >
              <AlignJustify size={16} aria-hidden="true" />
            </button>
          </div>
          {sections.map((section) => (
            <section key={section.key} className="space-y-4">
              <div>
                <h2 className="section-title text-xl">{t(section.titleKey)}</h2>
                {section.key === 'base' ? <p className="section-sub">{t('summary.sectionBaseHelp')}</p> : null}
              </div>
              <div className="space-y-5">
                {section.categories.map(({ category, documents: catDocuments }) => (
                  <div key={category.code} className="space-y-3">
                    <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-700">
                      {docTypeLabel(category, lang)}
                      {catDocuments.length > 1 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                          <AlertTriangle size={11} aria-hidden="true" />
                          {t('case.duplicateCategoryBadge', { count: catDocuments.length })}
                        </span>
                      ) : null}
                    </h3>
                    {catDocuments.map((docGroup) =>
                      fieldLayout === 'compact' ? (
                        <div key={docGroup.documentId} className="overflow-hidden rounded-xl border border-line bg-white">
                          <p className="border-b border-line/70 bg-sand/40 px-2 py-1 text-[12.5px] font-medium text-ink-500">
                            {docGroup.fileName}
                          </p>
                          <ul>
                            {docGroup.fields.map((field) => (
                              <CompactFieldRow
                                key={field.field_key}
                                innerRef={(el) => {
                                  fieldRefs.current[fieldKey(field)] = el
                                }}
                                field={field}
                                showDocument={false}
                                saving={busyKey === fieldKey(field)}
                                togglingInclude={togglingKey === fieldKey(field)}
                                viewingSource={viewingKey === fieldKey(field)}
                                onChange={(value) => updateValue(field, value)}
                                onConfirm={() => confirmField(field)}
                                onViewSource={() => viewSource(field)}
                                onToggleInclude={() => toggleInclude(field)}
                              />
                            ))}
                          </ul>
                        </div>
                      ) : (
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
                                togglingInclude={togglingKey === fieldKey(field)}
                                viewingSource={viewingKey === fieldKey(field)}
                                onChange={(value) => updateValue(field, value)}
                                onConfirm={() => confirmField(field)}
                                onViewSource={() => viewSource(field)}
                                onToggleInclude={() => toggleInclude(field)}
                              />
                            ))}
                          </ul>
                        </div>
                      )
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState icon={FolderOpen} title={t('summary.noData')} />
      )}

      {view === 'list' && result ? (
        <section className="card card-pad space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="section-title text-xl">{t('summary.resultsTitle')}</h2>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-ink-400">
                {t('summary.computedOn', { date: formatDateTime(result.aggregate.computed_at, lang) })}
              </p>
              {uncertainItems.length ? (
                <button
                  type="button"
                  className="btn-secondary btn-sm border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                  onClick={() => setUncertaintyModalOpen(true)}
                >
                  <AlertTriangle size={15} aria-hidden="true" />
                  {t('summary.uncertaintyBadge', { count: uncertainItems.length })}
                </button>
              ) : null}
              <button type="button" className="btn-secondary btn-sm" onClick={downloadPdf} disabled={exportingPdf}>
                {exportingPdf ? <Spinner size={15} /> : <FileDown size={15} aria-hidden="true" />}
                {t('summary.generatePdf')}
              </button>
            </div>
          </div>

          <Modal
            open={uncertaintyModalOpen}
            onClose={dismissUncertaintyModal}
            title={t('summary.uncertaintyModalTitle')}
            description={t('summary.uncertaintyModalHelp')}
            size="lg"
            footer={
              <button type="button" className="btn-primary btn-sm" onClick={dismissUncertaintyModal}>
                {t('summary.uncertaintyModalClose')}
              </button>
            }
          >
            <ul className="space-y-2.5">
              {uncertainItems.map((item) => {
                const original =
                  item.component &&
                  fields.find(
                    (f) => f.document_id === item.component.document_id && f.field_key === item.component.field_key
                  )
                const busy = resolvingUncertainKey === item.key
                return (
                  <li key={item.key} className="rounded-lg bg-amber-50 px-3 py-2.5 text-[13.5px] text-amber-900">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="flex-1">{item.label}</span>
                    </div>

                    {item.kind === 'parameter' ? (
                      <div className="mt-1.5 pl-[22px]">
                        <Link to="/tax-settings" className="text-[12.5px] font-medium underline">
                          {t('summary.uncertaintyGoToTaxSettings')}
                        </Link>
                      </div>
                    ) : null}

                    {item.kind === 'foreignCurrency' ? (
                      <div className="mt-2 space-y-2 pl-[22px]">
                        {original ? (
                          <>
                            <div className="flex flex-wrap items-end gap-2">
                              <Field label={t('summary.uncertaintyExchangeRate')} className="w-[160px]">
                                <TextInput
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  placeholder="0.00"
                                  value={fxEdits[uncertainFieldKey(item.component)]?.rate || ''}
                                  onChange={(e) =>
                                    setFxEdits((edits) => ({
                                      ...edits,
                                      [uncertainFieldKey(item.component)]: { rate: e.target.value, amount: '' }
                                    }))
                                  }
                                />
                              </Field>
                              <span className="pb-2.5 text-[12.5px] text-amber-700">{t('summary.uncertaintyOr')}</span>
                              <Field label={t('summary.uncertaintyChfAmount')} className="w-[160px]">
                                <TextInput
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  value={fxEdits[uncertainFieldKey(item.component)]?.amount || ''}
                                  onChange={(e) =>
                                    setFxEdits((edits) => ({
                                      ...edits,
                                      [uncertainFieldKey(item.component)]: { rate: '', amount: e.target.value }
                                    }))
                                  }
                                />
                              </Field>
                              <button
                                type="button"
                                className="btn-primary btn-sm"
                                onClick={() => resolveForeignCurrencyItem(item.component)}
                                disabled={busy}
                              >
                                {busy ? <Spinner size={14} /> : null}
                                {t('common.save')}
                              </button>
                            </div>
                            {fxEdits[uncertainFieldKey(item.component)]?.rate ? (
                              <p className="text-[12px] text-amber-700">
                                {t('summary.uncertaintyPreview', {
                                  amount: formatChfSwiss(
                                    Math.round(
                                      item.component.amount * parseFloat(fxEdits[uncertainFieldKey(item.component)].rate || 0) * 100
                                    ) / 100
                                  )
                                })}
                              </p>
                            ) : null}
                            <button
                              type="button"
                              className="text-[12.5px] font-medium underline"
                              onClick={() => viewUncertainSource(item.component)}
                            >
                              {t('summary.uncertaintyViewSource')}
                            </button>
                          </>
                        ) : (
                          <p className="text-[12.5px] text-amber-700">{t('summary.uncertaintyRecalculateFirst')}</p>
                        )}
                      </div>
                    ) : null}

                    {item.kind === 'missingParam' ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[22px]">
                        {original ? (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => confirmUncertainFieldAsIs(item.component)}
                            disabled={busy}
                          >
                            {busy ? <Spinner size={14} /> : null}
                            {t('summary.uncertaintyConfirmAsIs')}
                          </button>
                        ) : (
                          <p className="text-[12.5px] text-amber-700">{t('summary.uncertaintyRecalculateFirst')}</p>
                        )}
                        <Link to="/tax-settings" className="text-[12.5px] font-medium underline">
                          {t('summary.uncertaintyGoToTaxSettings')}
                        </Link>
                      </div>
                    ) : null}

                    {item.kind === 'separate' ? (
                      <div className="mt-1.5 pl-[22px]">
                        {original ? (
                          <button
                            type="button"
                            className="text-[12.5px] font-medium underline"
                            onClick={() => viewUncertainSource(item.component)}
                          >
                            {t('summary.uncertaintyViewSource')}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {item.kind === 'missingRegistry' ? (
                      <div className="mt-1.5 pl-[22px]">
                        <Link to={`/year/${caseId}`} className="text-[12.5px] font-medium underline">
                          {t('summary.uncertaintyReloadFromDocuments')}
                        </Link>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </Modal>

          {result.cantonMissing ? (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-[14px] text-amber-900">
              {t('summary.cantonMissing')}
            </div>
          ) : null}

          <div className="rounded-2xl border border-gold-200/70 bg-gold-50/30 p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat
                icon={Landmark}
                label={t('summary.taxableIncomeCantonal')}
                value={formatChfSwiss(result.aggregate.taxable_income_cantonal)}
                tone="gold"
              />
              <Stat
                icon={PiggyBank}
                label={t('summary.taxableWealthCantonal')}
                value={formatChfSwiss(result.aggregate.taxable_wealth_cantonal)}
                tone="gold"
              />
              <Stat
                icon={Receipt}
                label={t('summary.taxableIncomeFederal')}
                value={formatChfSwiss(result.aggregate.taxable_income_federal)}
                tone="gold"
              />
            </div>
          </div>

          {componentsBySection.length ? (
            <div className="space-y-4">
              <h3 className="text-[15px] font-semibold text-ink-700">{t('summary.componentsTitle')}</h3>
              {componentsBySection.map((section) => (
                <div key={section.key} className="space-y-1.5">
                  <p className="text-[13px] font-medium text-ink-500">{t(section.titleKey)}</p>
                  <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full text-[13.5px]">
                      <thead className="bg-sand/60 text-left text-[11.5px] font-medium uppercase tracking-wide text-ink-400">
                        <tr>
                          <th className="px-4 py-2.5">{t('summary.colItem')}</th>
                          <th className="px-4 py-2.5 text-right">{t('summary.colAmount')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line bg-white">
                        {section.components.map((c) => (
                          <tr key={c.id}>
                            <td className="px-4 py-2.5 text-ink-800">{c.field_label || c.label}</td>
                            <td
                              className={clsx(
                                'px-4 py-2.5 text-right font-medium tabular-nums',
                                c.component_type === 'income' || c.component_type === 'wealth'
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              )}
                            >
                              {c.component_type === 'deduction' || c.component_type === 'debt' ? '−' : '+'}
                              {formatChfSwiss(Math.abs(c.amount))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {needsVerificationComponents.length ? (
            <div className="space-y-2">
              <h3 className="text-[15px] font-semibold text-ink-700">{t('summary.needsVerificationTitle')}</h3>
              <p className="text-[13px] text-ink-400">{t('summary.needsVerificationHelp')}</p>
              <div className="overflow-x-auto rounded-xl border border-amber-200">
                <table className="w-full text-[13.5px]">
                  <thead className="bg-amber-50 text-left text-[11.5px] font-medium uppercase tracking-wide text-amber-800">
                    <tr>
                      <th className="px-4 py-2.5">{t('summary.colItem')}</th>
                      <th className="px-4 py-2.5 text-right">{t('summary.colAmount')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 bg-amber-50/40">
                    {needsVerificationComponents.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2.5 text-amber-900">
                          <span className="flex items-center gap-1.5">
                            <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />
                            {c.field_label || c.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-amber-900">
                          {c.currency_code
                            ? formatAmountSwiss(Math.abs(c.amount), c.currency_code)
                            : formatChfSwiss(Math.abs(c.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {documentDataGroups.length ? (
            <div className="space-y-2">
              <h3 className="text-[15px] font-semibold text-ink-700">{t('summary.documentDataTitle')}</h3>
              <p className="text-[13px] text-ink-400">{t('summary.documentDataHelp')}</p>
              <div className="space-y-3">
                {documentDataGroups.map((group) => (
                  <div key={group.documentId} className="rounded-xl border border-line bg-sand/30 p-3.5">
                    <p className="mb-2 text-[13px] font-medium text-ink-600">{group.heading}</p>
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                      {group.fields.map((f) => (
                        <div key={f.label} className="flex justify-between gap-3 text-[13px]">
                          <dt className="text-ink-400">{f.label}</dt>
                          <dd className="text-right text-ink-700">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <h3 className="text-[15px] font-semibold text-ink-700">{t('summary.taxEstimateTitle')}</h3>
            <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-line bg-sand/40 px-4 py-3 text-[13.5px] text-ink-500">
              <Info size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden="true" />
              <p>{t('summary.taxEstimatePlaceholder')}</p>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
