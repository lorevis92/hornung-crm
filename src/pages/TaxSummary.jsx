import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, AlignJustify, ArrowLeft, Eye, FileText, FolderOpen, Layers, List
} from 'lucide-react'
import CaseAssistant from '../components/CaseAssistant'
import CompactFieldRow from '../components/CompactFieldRow'
import ExtractedFieldRow from '../components/ExtractedFieldRow'
import { EmptyState, PageLoader, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { docTypeLabel } from '../lib/labels'
import { mergeFieldsWithDefinitions } from '../lib/extraction'
import { buildQualityFindings } from '../lib/extractionQuality'
import OtherFindingsList from '../components/OtherFindingsList'
import CategoryEntityView from '../components/CategoryEntityView'
import { buildCategoryEntities, sortedPair, suggestionsAsQualityFindings } from '../lib/categoryEntities'
import { formatDate, fullName } from '../lib/format'
import { resolvePersonDisplayOrder } from '../lib/personOrder'
import {
  syncChildSuggestionsInBackground, syncPersonalDetailsInBackground, syncPropertySuggestionInBackground
} from '../lib/recalc'
import { resolveTaxSummaryView } from '../lib/taxSummaryView'

// pdfjs-dist is a large dependency — only fetched when a specialist actually
// opens the source view, not on every page load.
const PdfSourceViewer = lazy(() => import('../components/PdfSourceViewer'))

// Section order + which document_categories.group_key values feed each one.
// Purely how the document list is arranged on screen — this app doesn't
// compute anything from these groups.
const SECTIONS = [
  { key: 'base', groups: ['base'], titleKey: 'summary.sectionBase' },
  { key: 'income', groups: ['income'], titleKey: 'summary.sectionIncome' },
  { key: 'deductions', groups: ['deductions'], titleKey: 'summary.sectionDeductions' },
  { key: 'wealth', groups: ['assets', 'property'], titleKey: 'summary.sectionWealth' },
  { key: 'other', groups: ['other'], titleKey: 'summary.sectionOther' }
]

// Same mapping CasePage uses for a document's own extraction state.
const EXTRACTION_STATUS_LABEL_KEY = {
  uploaded: 'extraction.statusUploaded',
  extracting: 'extraction.statusExtracting',
  extracted: 'extraction.statusExtracted',
  extraction_failed: 'extraction.statusExtractionFailed',
  verified_by_specialist: 'extraction.statusVerifiedBySpecialist',
  rejected: 'extraction.statusRejected'
}
const EXTRACTION_STATUS_TONE = {
  uploaded: 'text-ink-400',
  extracting: 'text-gold-700',
  extracted: 'text-emerald-700',
  extraction_failed: 'text-red-700',
  verified_by_specialist: 'text-emerald-700',
  rejected: 'text-ink-400'
}

function groupBy(list, key) {
  return list.reduce((acc, item) => {
    ;(acc[item[key]] ||= []).push(item)
    return acc
  }, {})
}

// A document's fields, grouped into rows (one account, one insurance
// premium, one mortgage, ...) instead of a flat list — mergeFieldsWithDefinitions
// (src/lib/extraction.js) already emits them in row order, so this only
// needs to chunk on row_key changing, not re-sort anything. The
// document-level row (row_key '') never gets its own header — it describes
// the document itself, not a repeatable entity.
function groupFieldsByRow(fields) {
  const groups = []
  for (const field of fields) {
    const rowKey = field.row_key || ''
    const last = groups[groups.length - 1]
    if (last && last.rowKey === rowKey) {
      last.fields.push(field)
    } else {
      groups.push({ rowKey, rowLabel: field.row_label || null, legacyFormat: Boolean(field.legacyFormat), fields: [field] })
    }
  }
  return groups
}

// Which of the two field-review layouts a specialist last picked — same
// remembered-choice pattern as DocumentList's list/grid toggle.
const FIELD_LAYOUT_KEY = 'hornung.fieldLayout'
// And which of the two READINGS of the same extraction they last used:
// by document ("what does this file say") or by category ("how many
// properties does this client have"). Remembered the same way.
const DATA_VIEW_KEY = 'hornung.dataView'

function readStoredDataView() {
  try {
    return localStorage.getItem(DATA_VIEW_KEY) === 'category' ? 'category' : 'document'
  } catch {
    return 'document'
  }
}

function storeDataView(view) {
  try {
    localStorage.setItem(DATA_VIEW_KEY, view)
  } catch {
    /* localStorage unavailable — ignore, the app still works */
  }
}

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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [caseRow, setCaseRow] = useState(null)
  const [categories, setCategories] = useState([])
  const [documents, setDocuments] = useState([])
  const [allDocuments, setAllDocuments] = useState([])
  const [fieldDefs, setFieldDefs] = useState([])
  // Two views of the same extraction: `fields` is the display/edit shape
  // (every defined field, empty ones included, grouped per row), `rawFields`
  // is exactly what the database holds — the quality checks below run on
  // the raw rows so the on-screen findings and the ones the assistant is
  // told about (api/case-assistant.js) can never disagree.
  const [fields, setFields] = useState([])
  const [rawFields, setRawFields] = useState([])
  // "Other information found": what the documents hold that no whitelist
  // field covers (document_other_findings — see src/lib/otherFindings.js).
  const [otherFindings, setOtherFindings] = useState([])
  const [questionnaire, setQuestionnaire] = useState(null)
  const [childrenCount, setChildrenCount] = useState(0)

  // Driven by the URL (?view=source), not bare local state — so pressing
  // the browser's own back button, not just this page's own "back" click,
  // returns to the Tax Summary list instead of skipping past it to
  // whatever page was open before — see resolveTaxSummaryView and
  // viewSource/backToList below.
  const [sourceField, setSourceField] = useState(null)
  const view = resolveTaxSummaryView(searchParams.get('view'), Boolean(sourceField))
  // Whether the current source view was actually pushed onto browser
  // history by THIS page (an in-app click) — as opposed to being reached
  // directly (a shared link, or a hard refresh landing on a stale
  // ?view=source URL). Only in the first case is popping real history
  // (navigate(-1)) the right way back.
  const enteredSourceViaClick = useRef(false)
  const [fieldLayout, setFieldLayoutState] = useState(readStoredFieldLayout)
  const [dataView, setDataViewState] = useState(readStoredDataView)
  const [mergeDecisions, setMergeDecisions] = useState([])
  const [savingPairKey, setSavingPairKey] = useState(null)
  const [fileUrls, setFileUrls] = useState({})
  const [busyKey, setBusyKey] = useState(null)
  const [togglingKey, setTogglingKey] = useState(null)
  const [viewingKey, setViewingKey] = useState(null)
  const fieldRefs = useRef({})

  const [retryingDocId, setRetryingDocId] = useState(null)
  const [invertingOrder, setInvertingOrder] = useState(false)

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

      const [docs, cats, allDefs, questionnaireRow] = await Promise.all([
        api.listClientDocuments(row.client_id, row.tax_year),
        api.listDocumentCategories(),
        api.listFieldDefinitions(),
        api.getQuestionnaire(row.client_id)
      ])
      if (!active) return
      const categorized = docs.filter((d) => d.category_code)
      setAllDocuments(docs)
      setDocuments(categorized)
      setCategories(cats)
      setFieldDefs(allDefs)
      setChildrenCount((questionnaireRow?.children || []).length)
      setQuestionnaire(questionnaireRow)

      const [extractedByDoc, findings, merges] = await Promise.all([
        Promise.all(categorized.map((d) => api.listExtractedFieldsForDocument(d.id))),
        api.listOtherFindingsForDocuments(categorized.map((d) => d.id)),
        api.listEntityMergeDecisions(row.client_id, row.tax_year)
      ])
      if (!active) return
      setOtherFindings(findings)
      setMergeDecisions(merges)

      const flat = []
      const raw = []
      categorized.forEach((doc, i) => {
        const defs = allDefs.filter((d) => d.category_code === doc.category_code)
        const category = cats.find((c) => c.code === doc.category_code)
        extractedByDoc[i].forEach((f) => raw.push({ ...f, document_id: doc.id }))
        mergeFieldsWithDefinitions(defs, extractedByDoc[i], doc).forEach((field) => {
          flat.push({ ...field, category_code: doc.category_code, group_key: category?.group_key || 'other' })
        })
      })
      setFields(flat)
      setRawFields(raw)
      setLoading(false)
    }
    run()
    return () => {
      active = false
    }
  }, [caseId])

  const findingsByDoc = useMemo(() => groupBy(otherFindings, 'document_id'), [otherFindings])

  // Built from the DOCUMENTS, not from the extracted fields: since a field
  // the document doesn't mention no longer produces a row at all, a
  // document can legitimately have no whitelist fields and still have
  // something to show — its other findings. Keying off the fields would
  // have made exactly that document disappear.
  const sections = useMemo(() => {
    return SECTIONS.map((section) => {
      const sectionCategories = categories
        .filter((c) => section.groups.includes(c.group_key))
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((category) => {
          const fieldsByDoc = groupBy(
            fields.filter((f) => f.category_code === category.code),
            'document_id'
          )
          const docGroups = documents
            .filter((d) => d.category_code === category.code)
            .map((doc) => {
              const docFields = fieldsByDoc[doc.id] || []
              const docFindings = findingsByDoc[doc.id] || []
              if (!docFields.length && !docFindings.length) return null
              return { documentId: doc.id, fileName: doc.file_name, fields: docFields, findings: docFindings }
            })
            .filter(Boolean)
          return docGroups.length ? { category, documents: docGroups } : null
        })
        .filter(Boolean)
      return { ...section, categories: sectionCategories }
    }).filter((s) => s.categories.length)
  }, [categories, documents, fields, findingsByDoc])

  // Open questions about the extracted data itself — whose row is this, was
  // a line read twice, is a row missing (src/lib/extractionQuality.js).
  // Recomputed from the current data on every render, never stored, so a
  // finding disappears the moment the specialist fixes what caused it.
  // The same extraction read by category instead of by document, with the
  // cross-document merges already applied (src/lib/categoryEntities.js).
  const { groups: categoryGroups, suggestions: mergeSuggestions } = useMemo(
    () =>
      buildCategoryEntities({
        documents,
        extractedFields: rawFields,
        fieldDefs,
        categories,
        mergeDecisions
      }),
    [documents, rawFields, fieldDefs, categories, mergeDecisions]
  )

  // One list of open questions for BOTH views: the data-quality findings
  // and the still-unanswered "possibly the same thing" suggestions, which
  // are a question about the same extraction and belong in the same place.
  const qualityFindings = useMemo(
    () => [
      ...buildQualityFindings({ documents, extractedFields: rawFields, fieldDefs, otherFindings }),
      ...suggestionsAsQualityFindings(mergeSuggestions, documents)
    ],
    [documents, rawFields, fieldDefs, otherFindings, mergeSuggestions]
  )

  // Documents the extraction never finished on — a genuine gap in what this
  // case knows, shown for as long as it lasts.
  const failedDocuments = useMemo(
    () => allDocuments.filter((d) => d.status === 'extraction_failed'),
    [allDocuments]
  )
  // Still mid-pipeline: not even classified yet, or claimed but never
  // finished (including one stuck there by a crashed/timed-out run).
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
  const completenessIssueCount = failedDocuments.length + processingDocuments.length + (childrenMismatch ? 1 : 0)

  const registryPrimary = useMemo(
    () => (questionnaire?.persons || []).find((p) => p.person_type === 'primary') || null,
    [questionnaire]
  )
  const registrySpouse = useMemo(
    () => (questionnaire?.persons || []).find((p) => p.person_type === 'spouse') || null,
    [questionnaire]
  )
  // Husband-first presentation order (src/lib/personOrder.js) — never
  // changes which data belongs to whom, only the order it is shown in.
  const personOrder = useMemo(
    () =>
      resolvePersonDisplayOrder({
        primaryPerson: registryPrimary,
        spousePerson: registrySpouse,
        overrideOrder: caseRow?.client?.person_order_override || null
      }),
    [registryPrimary, registrySpouse, caseRow]
  )
  // Both names, husband first, for the header — never just the account
  // holder's own name or email (that's whoever has the login, not
  // necessarily either spouse's own identity). Falls back to the account
  // name/email only when the registry has no named person at all yet.
  const coupleDisplayName =
    personOrder.ordered.map((o) => fullName(o.person)).filter(Boolean).join(' & ') ||
    fullName(caseRow?.client) ||
    caseRow?.client?.email ||
    ''

  const invertPersonOrder = async () => {
    if (!caseRow?.client_id) return
    const next = personOrder.ordered[0]?.kind === 'primary' ? 'spouse_first' : 'primary_first'
    setInvertingOrder(true)
    try {
      const updatedClient = await api.updateClient(caseRow.client_id, { person_order_override: next })
      setCaseRow((row) => (row ? { ...row, client: { ...row.client, ...updatedClient } } : row))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setInvertingOrder(false)
    }
  }

  const reloadExtraction = async () => {
    const docs = await api.listClientDocuments(caseRow.client_id, caseRow.tax_year)
    setAllDocuments(docs)
    const categorized = docs.filter((d) => d.category_code)
    setDocuments(categorized)
    const extractedByDoc = await Promise.all(categorized.map((d) => api.listExtractedFieldsForDocument(d.id)))
    setOtherFindings(await api.listOtherFindingsForDocuments(categorized.map((d) => d.id)))
    // Re-read after a re-extraction too: a merge the specialist confirmed
    // is keyed by the entity's own identifier, not by a row id, so it must
    // still apply to the freshly extracted rows (see migration 48).
    setMergeDecisions(await api.listEntityMergeDecisions(caseRow.client_id, caseRow.tax_year))
    const allDefs = await api.listFieldDefinitions()
    setFieldDefs(allDefs)
    const flat = []
    const raw = []
    categorized.forEach((d, i) => {
      const defs = allDefs.filter((def) => def.category_code === d.category_code)
      const category = categories.find((c) => c.code === d.category_code)
      extractedByDoc[i].forEach((f) => raw.push({ ...f, document_id: d.id }))
      mergeFieldsWithDefinitions(defs, extractedByDoc[i], d).forEach((field) => {
        flat.push({ ...field, category_code: d.category_code, group_key: category?.group_key || 'other' })
      })
    })
    setFields(flat)
    setRawFields(raw)
  }

  const retryExtraction = async (doc, { force = false } = {}) => {
    setRetryingDocId(doc.id)
    try {
      await api.retryExtraction(doc.id, { force })
      toast.success(t('common.saved'))
      await reloadExtraction()
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setRetryingDocId(null)
    }
  }

  // "Re-extract this document" — for a document extracted under the old
  // suffix-based field model (src/lib/rowBasedFields.js's
  // legacySuffixBaseKey): it already reached 'extracted' once, so the
  // ordinary retry path (which only accepts a non-terminal status) refuses
  // it — force:true bypasses that specifically for this case.
  const reExtractDocument = (documentId) => {
    const doc = allDocuments.find((d) => d.id === documentId)
    if (!doc) return
    return retryExtraction(doc, { force: true })
  }

  // Opens a document from the top, with no specific field/quote to
  // highlight — used by the document list, the per-document headers and
  // the assistant's own document references.
  const viewDocument = (documentId) => {
    const doc = allDocuments.find((d) => d.id === documentId)
    if (!doc) return
    viewSource({
      document_id: doc.id,
      file_name: doc.file_name,
      isPdf: doc.mime_type === 'application/pdf',
      isText: doc.mime_type === 'text/plain'
    })
  }

  // Arriving with ?doc=<id> opens that document's source straight away.
  // This is how a document reference in an assistant answer works when the
  // chat is opened from the case page, which has no viewer of its own
  // (CasePage's viewDocumentInSummary) — the consultant lands on the
  // document itself rather than on the list with the answer lost behind.
  // Guarded by a ref because viewDocument writes ?view=source back into
  // the URL, which would otherwise re-run this on every change.
  const openedDocParam = useRef(null)
  const requestedDocId = searchParams.get('doc')
  useEffect(() => {
    if (!requestedDocId || loading) return
    if (openedDocParam.current === requestedDocId) return
    openedDocParam.current = requestedDocId
    viewDocument(requestedDocId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedDocId, loading, allDocuments])

  // A row_key ('' for a document-level field) makes the identity — several
  // rows can legitimately share the same field_key (e.g. "annual_premium"
  // once per insured person), so field_key alone is not unique.
  const fieldKey = (field) => `${field.document_id}:${field.field_key}:${field.row_key || ''}`
  const sameField = (a, b) =>
    a.document_id === b.document_id && a.field_key === b.field_key && (a.row_key || '') === (b.row_key || '')

  // Jumps to the first field of one extracted row — the fix for a row
  // nobody can attribute is to type the missing name/IBAN into that row's
  // own identity field, which lives in the per-document section below.
  const scrollToRow = (documentId, rowKey) => {
    const target = fields.find((f) => f.document_id === documentId && (f.row_key || '') === (rowKey || ''))
    if (!target) return
    fieldRefs.current[fieldKey(target)]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const updateValue = (target, value) => {
    setFields((list) => list.map((f) => (sameField(f, target) ? { ...f, field_value: value } : f)))
  }

  const applySavedField = (field, saved) => {
    setFields((list) =>
      list.map((f) =>
        sameField(f, field)
          ? {
              ...f,
              ...saved,
              field_value: saved.field_value ?? f.field_value,
              verified_by_specialist: true,
              verified_at: saved.verified_at || new Date().toISOString()
            }
          : f
      )
    )
    setRawFields((list) => {
      const exists = list.some((f) => sameField(f, field))
      const next = { ...(list.find((f) => sameField(f, field)) || {}), ...saved, document_id: field.document_id }
      return exists ? list.map((f) => (sameField(f, field) ? next : f)) : [...list, next]
    })
  }

  const confirmField = async (field) => {
    if (!field.field_value.trim()) return
    const key = fieldKey(field)
    setBusyKey(key)
    try {
      const saved = await api.saveExtractedFieldForDocument(field.document_id, {
        field_key: field.field_key,
        row_key: field.row_key || '',
        field_value: field.field_value.trim(),
        confidence: field.confidence,
        source_quote: field.source_quote,
        source_page: field.source_page,
        verified_by_specialist: true,
        verified_at: new Date().toISOString(),
        verified_by: profile?.id || null
      })
      applySavedField(field, saved)
      toast.success(t('common.saved'))
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

  // Marks one extracted value as not relevant (or brings it back). The
  // database column is still called included_in_calculation — it now means
  // "this value is real data for this case", the only sense it ever had
  // here once the declaration itself moved out of this app.
  const toggleInclude = async (field) => {
    const key = fieldKey(field)
    setTogglingKey(key)
    try {
      const saved = await api.saveExtractedFieldForDocument(field.document_id, {
        field_key: field.field_key,
        row_key: field.row_key || '',
        field_value: field.field_value,
        confidence: field.confidence,
        source_quote: field.source_quote,
        source_page: field.source_page,
        verified_by_specialist: true,
        verified_at: new Date().toISOString(),
        verified_by: profile?.id || field.verified_by,
        included_in_calculation: field.included_in_calculation === false
      })
      applySavedField(field, saved)
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setTogglingKey(null)
    }
  }

  const viewSource = async (field) => {
    const key = fieldKey(field)
    let url = fileUrls[field.document_id]
    if (!url) {
      setViewingKey(key)
      try {
        const doc = allDocuments.find((d) => d.id === field.document_id)
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
    enteredSourceViaClick.current = true
    // A real history entry (default push, not replace) — so the browser's
    // own back button lands back on this exact list/scroll position too.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('view', 'source')
      return next
    })
  }

  // A finding has no field_key/row_key of its own — it isn't a whitelist
  // field — so it borrows the same identity shape viewSource expects, with
  // its own id standing in for the field key.
  const viewFindingSource = (finding) => {
    const doc = allDocuments.find((d) => d.id === finding.document_id)
    return viewSource({
      document_id: finding.document_id,
      field_key: finding.id,
      row_key: '',
      file_name: doc?.file_name || null,
      source_quote: finding.source_quote,
      source_page: finding.source_page,
      isPdf: doc?.mime_type === 'application/pdf',
      isText: doc?.mime_type === 'text/plain'
    })
  }
  const findingViewKey = (finding) => `${finding.document_id}:${finding.id}:`

  const setDataView = (view) => {
    setDataViewState(view)
    storeDataView(view)
  }

  // "Yes, these are one thing" / "No, they are different". Stored against
  // the derived entity keys so the answer survives re-extraction.
  const resolveSuggestion = async (suggestion, decision) => {
    const [entityKeyA, entityKeyB] = sortedPair(suggestion.keys[0], suggestion.keys[1])
    const pair = suggestion.keys.join('::')
    setSavingPairKey(pair)
    try {
      const saved = await api.saveEntityMergeDecision(caseRow.client_id, caseRow.tax_year, {
        category_code: suggestion.categoryCode,
        entity_key_a: entityKeyA,
        entity_key_b: entityKeyB,
        decision,
        decided_by: profile?.id || null
      })
      setMergeDecisions((list) => [
        ...list.filter((d) => !(d.entity_key_a === entityKeyA && d.entity_key_b === entityKeyB)),
        saved
      ])
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setSavingPairKey(null)
    }
  }

  // The findings that belong to one extracted row, as plain text — the
  // by-category view shows them on the entity that row ended up in, so the
  // same question is visible whichever way the data is being read.
  const findingsByMember = (documentId, rowKey) =>
    qualityFindings
      .filter(
        (f) =>
          f.kind !== 'possibleSameEntity' &&
          f.documentId === documentId &&
          (f.rowKey || '') === (rowKey || '')
      )
      .map((f) => ({ ...f, text: qualityFindingText(f) }))

  const setFieldLayout = (layout) => {
    setFieldLayoutState(layout)
    storeFieldLayout(layout)
  }

  const backToList = () => {
    if (enteredSourceViaClick.current) {
      navigate(-1)
    } else {
      // Reached the source view directly (a shared link, or a hard
      // refresh) — nothing of this page's own to pop, so just drop the
      // query param instead of navigating away from Tax Summary entirely.
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('view')
        return next
      })
    }
    const key = sourceField ? fieldKey(sourceField) : null
    requestAnimationFrame(() => {
      fieldRefs.current[key]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  const qualityFindingText = (finding) => {
    if (finding.kind === 'unidentifiedRow') return t('summary.qualityUnidentifiedRow')
    if (finding.kind === 'duplicateSource') {
      return t('summary.qualityDuplicateSource', { quote: finding.detail?.quote || '' })
    }
    if (finding.kind === 'reportedTotalMismatch') {
      return t('summary.qualityTotalMismatch', {
        stated: finding.detail?.reportedTotal ?? '',
        sum: finding.detail?.rowsSum ?? ''
      })
    }
    if (finding.kind === 'legacyFormat') return t('summary.qualityLegacyFormat')
    if (finding.kind === 'possibleSameEntity') {
      return finding.detail?.reason === 'missingIdentifier'
        ? t('summary.qualityPossibleSameEntityMissing', { identified: (finding.detail?.labels || []).find(Boolean) || '' })
        : t('summary.qualityPossibleSameEntitySimilar', {
            a: finding.detail?.labels?.[0] || '',
            b: finding.detail?.labels?.[1] || ''
          })
    }
    if (finding.kind === 'otherFindingNeedsReview') {
      return t('summary.qualityOtherFindingNeedsReview', {
        label: finding.detail?.label || '',
        value: finding.detail?.value || ''
      })
    }
    return ''
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
          {t('summary.subtitle', { name: coupleDisplayName, year: caseRow.tax_year })}
        </h1>
        <p className="mt-1 text-[14.5px] text-ink-500">{t('summary.pageHelp')}</p>
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
                  onClick={() => retryExtraction(doc)}
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
                  onClick={() => retryExtraction(doc)}
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
            isText={sourceField?.isText}
            fileName={sourceField?.file_name}
            page={sourceField?.source_page}
            quote={sourceField?.source_quote}
            onBack={backToList}
          />
        </Suspense>
      ) : (
        <div className="space-y-8">
          {/* The canonical record — client_persons/client_children/
              client_properties, the same source the Questionnaire reads.
              Shown first and separately from the per-document extraction
              cards below, which are the SOURCE that feeds this via sync,
              never an alternate reading of the client's own data. */}
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

              {registrySpouse && personOrder.needsVerification ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[13px] text-amber-800">
                  <span>{t('data.personOrderUnknown')}</span>
                  <button type="button" className="btn-secondary btn-sm" onClick={invertPersonOrder} disabled={invertingOrder}>
                    {invertingOrder ? <Spinner size={13} /> : null}
                    {t('data.personOrderInvert', { name: fullName(personOrder.ordered[1]?.person) || t('data.spouse') })}
                  </button>
                </div>
              ) : null}

              {/* Husband-first order (src/lib/personOrder.js) — the grid
                  always has a taxpayer column and a spouse column, each
                  keeping its own label/data; only their left-to-right
                  sequence changes. */}
              <div className="grid gap-4 sm:grid-cols-2">
                {(personOrder.ordered.some((o) => o.kind === 'spouse')
                  ? personOrder.ordered.map((o) => o.kind)
                  : [...personOrder.ordered.map((o) => o.kind), 'spouse']
                ).map((kind) =>
                  kind === 'primary' ? (
                    <div key="primary">
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
                  ) : (
                    <div key="spouse">
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
                  )
                )}

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

          {/* Every document on this case/year, with what the extraction made
              of it and a click straight into the file itself. */}
          {allDocuments.length ? (
            <section className="card card-pad space-y-3">
              <div>
                <h2 className="section-title text-xl">{t('summary.documentsTitle')}</h2>
                <p className="section-sub">{t('summary.documentsHelp', { count: allDocuments.length })}</p>
              </div>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                {allDocuments.map((doc) => {
                  const category = categories.find((c) => c.code === doc.category_code)
                  return (
                    <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 text-left text-[13.5px] font-medium text-gold-700 underline decoration-gold-300 underline-offset-2 hover:text-gold-800"
                        onClick={() => viewDocument(doc.id)}
                        title={t('extraction.viewSource')}
                      >
                        <FileText size={13} aria-hidden="true" />
                        {doc.file_name}
                      </button>
                      <span className="flex items-center gap-3 text-[12.5px]">
                        <span className="text-ink-400">
                          {category ? docTypeLabel(category, lang) : t('summary.documentUncategorized')}
                        </span>
                        <span className={clsx('font-medium', EXTRACTION_STATUS_TONE[doc.status] || 'text-ink-400')}>
                          {t(EXTRACTION_STATUS_LABEL_KEY[doc.status] || 'extraction.statusUploaded')}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          {/* The only open questions this app still tracks: about the
              extracted data itself, never about how a figure is taxed. */}
          {qualityFindings.length ? (
            <section className="card card-pad space-y-3">
              <div>
                <h2 className="section-title text-xl">{t('summary.qualityTitle', { count: qualityFindings.length })}</h2>
                <p className="section-sub">{t('summary.qualityHelp')}</p>
              </div>
              <ul className="space-y-2">
                {qualityFindings.map((finding, idx) => (
                  <li
                    key={`${finding.documentId}:${finding.kind}:${finding.rowKey}:${finding.fieldKey || ''}:${idx}`}
                    className="rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="flex items-start gap-1.5 text-[13.5px] text-ink-800">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                        <span>
                          {qualityFindingText(finding)}
                          <button
                            type="button"
                            className="ml-1 inline-flex items-center gap-1 font-medium text-gold-700 underline decoration-gold-300 underline-offset-2 hover:text-gold-800"
                            onClick={() => viewDocument(finding.documentId)}
                          >
                            <FileText size={11} aria-hidden="true" />
                            {finding.fileName}
                          </button>
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center gap-2">
                        {finding.kind === 'legacyFormat' ? (
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => reExtractDocument(finding.documentId)}
                            disabled={retryingDocId === finding.documentId}
                          >
                            {retryingDocId === finding.documentId ? <Spinner size={13} /> : null}
                            {t('summary.reExtractDocument')}
                          </button>
                        ) : finding.kind === 'otherFindingNeedsReview' ||
                          finding.kind === 'possibleSameEntity' ? null : (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => scrollToRow(finding.documentId, finding.rowKey)}
                          >
                            {t('summary.qualityGoToData')}
                          </button>
                        )}
                        <button type="button" className="btn-secondary btn-sm" onClick={() => viewDocument(finding.documentId)}>
                          <Eye size={13} aria-hidden="true" />
                          {t('summary.qualityOpenDocument')}
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {sections.length ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="section-title text-xl">
                    {t(dataView === 'category' ? 'summary.categoryDataTitle' : 'summary.documentDataTitle')}
                  </h2>
                  <p className="section-sub">
                    {t(dataView === 'category' ? 'summary.categoryDataHelp' : 'summary.documentDataHelp')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {/* Two readings of the same extraction — by document
                      ("what does this file say") and by category ("how
                      many properties does this client have"). Neither
                      replaces the other; the choice is remembered. */}
                  <div className="flex items-center gap-1 rounded-lg bg-sand/60 p-0.5" role="group" aria-label={t('summary.dataViewToggle')}>
                    <button
                      type="button"
                      className={clsx('btn-ghost btn-sm', dataView === 'document' && 'bg-white text-ink-900 shadow-sm')}
                      onClick={() => setDataView('document')}
                      aria-pressed={dataView === 'document'}
                    >
                      <FileText size={14} aria-hidden="true" />
                      {t('summary.dataViewByDocument')}
                    </button>
                    <button
                      type="button"
                      className={clsx('btn-ghost btn-sm', dataView === 'category' && 'bg-white text-ink-900 shadow-sm')}
                      onClick={() => setDataView('category')}
                      aria-pressed={dataView === 'category'}
                    >
                      <Layers size={14} aria-hidden="true" />
                      {t('summary.dataViewByCategory')}
                    </button>
                  </div>
                  {dataView === 'document' ? (
                <div className="flex items-center gap-1" role="group" aria-label={t('summary.fieldViewToggle')}>
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
                  ) : null}
                </div>
              </div>

              {dataView === 'category' ? (
                <CategoryEntityView
                  groups={categoryGroups}
                  suggestions={mergeSuggestions}
                  findingsByMember={findingsByMember}
                  documents={allDocuments}
                  savingPairKey={savingPairKey}
                  viewingKey={viewingKey}
                  onViewDocument={viewDocument}
                  onViewSource={(entry) =>
                    viewSource({
                      document_id: entry.documentId,
                      field_key: entry.fieldKey,
                      row_key: entry.rowKey,
                      file_name: entry.fileName,
                      source_quote: entry.sourceQuote,
                      source_page: entry.sourcePage,
                      isPdf: allDocuments.find((d) => d.id === entry.documentId)?.mime_type === 'application/pdf',
                      isText: allDocuments.find((d) => d.id === entry.documentId)?.mime_type === 'text/plain'
                    })
                  }
                  onResolveSuggestion={resolveSuggestion}
                />
              ) : null}

              {dataView === 'document' ? sections.map((section) => (
                <section key={section.key} className="space-y-4">
                  <div>
                    <h3 className="section-title text-lg">{t(section.titleKey)}</h3>
                    {section.key === 'base' ? <p className="section-sub">{t('summary.sectionBaseHelp')}</p> : null}
                  </div>
                  <div className="space-y-5">
                    {section.categories.map(({ category, documents: catDocuments }) => (
                      <div key={category.code} className="space-y-3">
                        <h4 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-700">
                          {docTypeLabel(category, lang)}
                          {catDocuments.length > 1 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                              <AlertTriangle size={11} aria-hidden="true" />
                              {t('case.duplicateCategoryBadge', { count: catDocuments.length })}
                            </span>
                          ) : null}
                        </h4>
                        {catDocuments.map((docGroup) => {
                          const rowGroups = groupFieldsByRow(docGroup.fields)
                          return fieldLayout === 'compact' ? (
                            <div key={docGroup.documentId} className="overflow-hidden rounded-xl border border-line bg-white">
                              <button
                                type="button"
                                className="flex w-full items-center gap-1 border-b border-line/70 bg-sand/40 px-2 py-1 text-left text-[12.5px] font-medium text-gold-700 underline decoration-gold-300 underline-offset-2 hover:text-gold-800"
                                onClick={() => viewDocument(docGroup.documentId)}
                                title={t('extraction.viewSource')}
                              >
                                <FileText size={12} aria-hidden="true" />
                                {docGroup.fileName}
                              </button>
                              {rowGroups.map((rowGroup) => (
                                <div key={rowGroup.rowKey}>
                                  {rowGroup.legacyFormat ? (
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50/60 px-2 py-1.5 text-[12.5px] text-amber-800">
                                      <span>{t('summary.legacyFormatBanner')}</span>
                                      <button
                                        type="button"
                                        className="btn-secondary btn-sm"
                                        onClick={() => reExtractDocument(docGroup.documentId)}
                                        disabled={retryingDocId === docGroup.documentId}
                                      >
                                        {retryingDocId === docGroup.documentId ? <Spinner size={13} /> : null}
                                        {t('summary.reExtractDocument')}
                                      </button>
                                    </div>
                                  ) : rowGroup.rowLabel ? (
                                    <p className="border-b border-line/70 bg-white px-2 py-1 text-[12px] font-medium text-ink-600">
                                      {rowGroup.rowLabel}
                                    </p>
                                  ) : rowGroup.rowKey ? (
                                    <p className="border-b border-line/70 bg-white px-2 py-1 text-[12px] font-medium text-amber-700">
                                      {t('summary.rowUnidentified')}
                                    </p>
                                  ) : null}
                                  <ul>
                                    {rowGroup.fields.map((field) => (
                                      <CompactFieldRow
                                        key={fieldKey(field)}
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
                              ))}
                              {docGroup.findings.length ? (
                                <div className="p-2">
                                  <OtherFindingsList
                                    findings={docGroup.findings}
                                    compact
                                    viewingKey={viewingKey}
                                    keyOf={findingViewKey}
                                    onViewSource={viewFindingSource}
                                  />
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div key={docGroup.documentId} className="space-y-2 rounded-xl bg-sand/40 p-3">
                              <button
                                type="button"
                                className="flex items-center gap-1 px-1 text-[12.5px] font-medium text-gold-700 underline decoration-gold-300 underline-offset-2 hover:text-gold-800"
                                onClick={() => viewDocument(docGroup.documentId)}
                                title={t('extraction.viewSource')}
                              >
                                <FileText size={12} aria-hidden="true" />
                                {docGroup.fileName}
                              </button>
                              {rowGroups.map((rowGroup) => (
                                <div key={rowGroup.rowKey} className="space-y-2">
                                  {rowGroup.legacyFormat ? (
                                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12.5px] text-amber-800">
                                      <span>{t('summary.legacyFormatBanner')}</span>
                                      <button
                                        type="button"
                                        className="btn-secondary btn-sm"
                                        onClick={() => reExtractDocument(docGroup.documentId)}
                                        disabled={retryingDocId === docGroup.documentId}
                                      >
                                        {retryingDocId === docGroup.documentId ? <Spinner size={13} /> : null}
                                        {t('summary.reExtractDocument')}
                                      </button>
                                    </div>
                                  ) : rowGroup.rowLabel ? (
                                    <p className="px-1 text-[12px] font-medium text-ink-600">{rowGroup.rowLabel}</p>
                                  ) : rowGroup.rowKey ? (
                                    <p className="px-1 text-[12px] font-medium text-amber-700">{t('summary.rowUnidentified')}</p>
                                  ) : null}
                                  <ul className="space-y-3">
                                    {rowGroup.fields.map((field) => (
                                      <ExtractedFieldRow
                                        key={fieldKey(field)}
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
                              ))}
                              <OtherFindingsList
                                findings={docGroup.findings}
                                viewingKey={viewingKey}
                                keyOf={findingViewKey}
                                onViewSource={viewFindingSource}
                              />
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </section>
              )) : null}
            </>
          ) : (
            <EmptyState icon={FolderOpen} title={t('summary.noData')} />
          )}
        </div>
      )}

      <CaseAssistant caseId={caseId} onViewDocument={viewDocument} />
    </div>
  )
}
