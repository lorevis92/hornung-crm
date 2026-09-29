import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, AlignJustify, ArrowLeft, Calculator, Eye, FileDown, FolderOpen, Info, Landmark, List,
  Pencil, PiggyBank, Plus, Receipt, Trash2
} from 'lucide-react'
import CompactFieldRow from '../components/CompactFieldRow'
import ExtractedFieldRow from '../components/ExtractedFieldRow'
import Modal from '../components/Modal'
import { EmptyState, Field, PageLoader, Select, Spinner, Stat, Textarea, TextInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { docTypeLabel } from '../lib/labels'
import { mergeFieldsWithDefinitions, verifiedFieldsByDocument } from '../lib/extraction'
import { formatAmountSwiss, formatChfSwiss, formatDate, formatDateTime, fullName } from '../lib/format'
import { resolvePersonDisplayOrder } from '../lib/personOrder'
import {
  recalculateInBackground, syncChildSuggestionsInBackground, syncPersonalDetailsInBackground,
  syncPropertySuggestionInBackground
} from '../lib/recalc'
import { resolveTaxSummaryView } from '../lib/taxSummaryView'

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

// Which kind of open question a flagged component represents — drives which
// actions the "Needs verification" row offers (see src/lib/taxCalculation.js
// for the note text each check produces). Kept as a plain regex match on
// the persisted field_label rather than a dedicated column: the label
// already carries this exactly, and adding a parallel enum column would
// just be a second place for the two to drift apart.
function classifyVerificationItem(fieldLabel) {
  const label = fieldLabel || ''
  if (/re-extract this document/.test(label)) return 'legacyFormat'
  if (/foreign currency/.test(label)) return 'foreignCurrency'
  if (/missing tax parameter/.test(label)) return 'missingParam'
  if (/marital status unknown/.test(label)) return 'missingRegistry'
  if (/separately taxed|no cantonal depreciation/.test(label)) return 'separate'
  if (/possible double deduction/.test(label)) return 'doubleDeduction'
  if (/not deductible —/.test(label)) return 'consideration'
  return 'generic'
}

const MANUAL_ENTRY_TYPES = ['income', 'deduction', 'wealth', 'debt']

function emptyManualEntryForm() {
  return { id: null, componentType: 'deduction', description: '', currencyCode: '', originalAmount: '', rate: '', amount: '', note: '' }
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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [caseRow, setCaseRow] = useState(null)
  const [categories, setCategories] = useState([])
  const [documents, setDocuments] = useState([])
  const [fields, setFields] = useState([])

  // Driven by the URL (?view=source), not bare local state — so pressing
  // the browser's own back button, not just this page's own "back" click,
  // returns to the Tax Summary list instead of skipping past it to
  // whatever page was open before Tax Summary (the case, or the client
  // page) — see resolveTaxSummaryView and viewSource/backToList below.
  const [sourceField, setSourceField] = useState(null)
  const view = resolveTaxSummaryView(searchParams.get('view'), Boolean(sourceField))
  // Whether the current source view was actually pushed onto browser
  // history by THIS page (an in-app click) — as opposed to being reached
  // directly (a shared link, or a hard refresh landing on a stale
  // ?view=source URL). Only in the first case is popping real history
  // (navigate(-1)) the right way back; otherwise there may be nothing of
  // this page's own to pop, so backToList just clears the query param.
  const enteredSourceViaClick = useRef(false)
  const [fieldLayout, setFieldLayoutState] = useState(readStoredFieldLayout)
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
  const [markingNotRelevantId, setMarkingNotRelevantId] = useState(null)

  const [manualEntries, setManualEntries] = useState([])
  const [manualEntryForm, setManualEntryForm] = useState(null)
  const [savingManualEntry, setSavingManualEntry] = useState(false)
  const [deletingManualEntryId, setDeletingManualEntryId] = useState(null)
  const [confirmDeleteManualEntry, setConfirmDeleteManualEntry] = useState(null)
  const [decidingKey, setDecidingKey] = useState(null)
  const [invertingOrder, setInvertingOrder] = useState(false)
  const [amountEdits, setAmountEdits] = useState({})

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

      const [docs, cats, allDefs, existingAggregate, questionnaire, manual] = await Promise.all([
        api.listClientDocuments(row.client_id, row.tax_year),
        api.listDocumentCategories(),
        api.listFieldDefinitions(),
        api.getTaxAggregate(row.client_id, row.tax_year),
        api.getQuestionnaire(row.client_id),
        api.listManualAggregateEntries(row.client_id, row.tax_year)
      ])
      if (!active) return
      const categorized = docs.filter((d) => d.category_code)
      setAllDocuments(docs)
      setDocuments(categorized)
      setManualEntries(manual)
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
      // A specialist's own "exclude" decision resolves the field (it's no
      // longer needs_verification), but it still never counts — it belongs
      // in the verification/decisions list below, not in the "totals = sum
      // of these rows" reconciliation this table guarantees.
      components: result.components.filter((c) => c.section_key === key && !c.needs_verification && c.decision !== 'exclude')
    })).filter((s) => s.components.length)
  }, [result])

  // Every component that ever needed a specialist's attention — still open
  // (needs_verification) or already resolved one way or the other
  // (decision set) — shown together so a resolved item's final status is
  // just as visible as an unresolved one, never silently indistinguishable
  // from "never had a question at all" (see src/lib/taxCalculation.js).
  const verificationItems = useMemo(
    () => (result?.components || []).filter((c) => c.needs_verification || c.decision),
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
  // Husband-first presentation order (src/lib/personOrder.js) — used
  // wherever both people are shown together on this page and in the PDF;
  // never changes which figures are attributed to whom.
  const personOrder = useMemo(
    () =>
      resolvePersonDisplayOrder({
        primaryPerson: registryPrimary,
        spousePerson: registrySpouse,
        overrideOrder: caseRow?.client?.person_order_override || null
      }),
    [registryPrimary, registrySpouse, caseRow]
  )
  // Both names, husband first, for the header/PDF — never just the account
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

  const retryFailedExtraction = async (doc, { force = false } = {}) => {
    setRetryingDocId(doc.id)
    try {
      await api.retryExtraction(doc.id, { force })
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

  // "Re-extract this document" — the action offered on a "needs
  // verification" row flagged as extracted under the old suffix-based field
  // model (src/lib/rowBasedFields.js's legacySuffixBaseKey): the document
  // already reached 'extracted' once, so the ordinary retry path (which
  // only accepts a non-terminal status) refuses it — force:true bypasses
  // that specifically for this case.
  const reExtractDocument = (documentId) => {
    const doc = allDocuments.find((d) => d.id === documentId)
    if (!doc) return
    return retryFailedExtraction(doc, { force: true })
  }

  // An orphaned document's own "View document" action — same idea as
  // viewComponentSource, but for a whole document rather than one field's
  // exact page/quote (there isn't one yet — that's the whole problem this
  // banner is about), so it just opens the file from the top.
  const viewOrphanedDocument = (doc) =>
    viewSource({
      document_id: doc.id,
      file_name: doc.file_name,
      isPdf: doc.mime_type === 'application/pdf',
      isText: doc.mime_type === 'text/plain'
    })

  const markDocumentNotRelevant = async (doc) => {
    setMarkingNotRelevantId(doc.id)
    try {
      await api.updateClientDocumentStatus(doc.id, 'rejected')
      // orphanedDocuments (and every other completeness check) reads from
      // `documents`, not `allDocuments` — both need the new status or the
      // banner keeps citing a document that was just resolved.
      const applyRejected = (list) => list.map((d) => (d.id === doc.id ? { ...d, status: 'rejected' } : d))
      setAllDocuments(applyRejected)
      setDocuments(applyRejected)
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setMarkingNotRelevantId(null)
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

  // A specialist's explicit include/exclude call on one flagged field —
  // persists to tax_field_decisions (survives recalculation, unlike the
  // component row itself), snapshotting the amount it was decided against
  // so a later, materially different re-extraction reverts it to needing
  // verification again instead of silently keeping a stale call (see
  // src/lib/taxCalculation.js).
  const decideField = async (component, decision) => {
    const key = fieldKey(component)
    setDecidingKey(key)
    try {
      await api.saveFieldDecision({
        clientId: caseRow.client_id,
        taxYear: caseRow.tax_year,
        documentId: component.document_id,
        fieldKey: component.field_key,
        rowKey: component.row_key || '',
        decision,
        decidedAmount: component.amount
      })
      const computed = await recalculateInBackground(caseRow.client_id, caseRow.tax_year, lang)
      if (computed) setResult(computed)
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setDecidingKey(null)
    }
  }

  // The generic "edit amount" action offered on every needs-verification
  // row — reuses the exact same save path as editing a value in the
  // "Extracted data" sections above (confirmField), just scoped to a
  // single inline input instead of requiring a scroll back up to find the
  // field there.
  const saveAmountEdit = async (component) => {
    const key = fieldKey(component)
    const original = fields.find(
      (f) =>
        f.document_id === component.document_id &&
        f.field_key === component.field_key &&
        (f.row_key || '') === (component.row_key || '')
    )
    if (!original) return
    const value = amountEdits[key]
    if (value == null || !String(value).trim()) return
    await confirmField({ ...original, field_value: String(value).trim() })
    setAmountEdits((edits) => {
      const { [key]: _discard, ...rest } = edits
      return rest
    })
  }

  const openManualEntryForAdd = () => setManualEntryForm(emptyManualEntryForm())

  const openManualEntryForEdit = (component) => {
    const entry = manualEntries.find((m) => m.id === component.manual_entry_id)
    if (!entry) return
    setManualEntryForm({
      id: entry.id,
      componentType: entry.component_type,
      description: entry.description,
      currencyCode: entry.currency_code || '',
      originalAmount: entry.original_amount != null ? String(entry.original_amount) : '',
      rate: '',
      amount: String(entry.amount),
      note: entry.note || ''
    })
  }

  const saveManualEntry = async () => {
    const form = manualEntryForm
    if (!form) return
    const amount = parseFloat(form.amount)
    if (!form.description.trim() || !Number.isFinite(amount)) return
    setSavingManualEntry(true)
    try {
      const originalAmount = form.currencyCode.trim() && form.originalAmount !== '' ? parseFloat(form.originalAmount) : null
      await api.saveManualAggregateEntry({
        id: form.id || undefined,
        clientId: caseRow.client_id,
        taxYear: caseRow.tax_year,
        componentType: form.componentType,
        description: form.description.trim(),
        amount,
        currencyCode: form.currencyCode.trim() ? form.currencyCode.trim().toUpperCase() : null,
        originalAmount: Number.isFinite(originalAmount) ? originalAmount : null,
        note: form.note.trim() || null
      })
      setManualEntryForm(null)
      setManualEntries(await api.listManualAggregateEntries(caseRow.client_id, caseRow.tax_year))
      const computed = await recalculateInBackground(caseRow.client_id, caseRow.tax_year, lang)
      if (computed) setResult(computed)
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setSavingManualEntry(false)
    }
  }

  const deleteManualEntry = async (entry) => {
    setDeletingManualEntryId(entry.id)
    try {
      await api.deleteManualAggregateEntry(entry.id)
      setManualEntries((list) => list.filter((m) => m.id !== entry.id))
      const computed = await recalculateInBackground(caseRow.client_id, caseRow.tax_year, lang)
      if (computed) setResult(computed)
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setDeletingManualEntryId(null)
      setConfirmDeleteManualEntry(null)
    }
  }

  // Shared by every place a calculation component (a row in the main "how
  // this was calculated" breakdown, or in the "needs verification" table)
  // needs to jump to the exact document/page/quote it came from — every
  // tax_aggregate_components row already carries its own document_id/
  // field_key (see api/_recalc.js's insert), so this is just matching it
  // back to the extracted_document_fields row that actually has the
  // page/quote to show. A synthetic entry (a flat deduction, the wealth
  // exemption, ...) has no document_id at all — nothing to jump to, so
  // callers check for one before ever offering this.
  const viewComponentSource = (component) => {
    const original = fields.find(
      (f) =>
        f.document_id === component.document_id &&
        f.field_key === component.field_key &&
        (f.row_key || '') === (component.row_key || '')
    )
    if (!original) return
    viewSource(original)
  }

  const viewUncertainSource = (component) => {
    dismissUncertaintyModal()
    viewComponentSource(component)
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

  // A row_key ('' for a document-level field) makes the identity — several
  // rows can legitimately share the same field_key (e.g. "annual_premium"
  // once per insured person), so field_key alone is no longer unique.
  const fieldKey = (field) => `${field.document_id}:${field.field_key}:${field.row_key || ''}`
  const sameField = (a, b) =>
    a.document_id === b.document_id && a.field_key === b.field_key && (a.row_key || '') === (b.row_key || '')

  const updateValue = (target, value) => {
    setFields((list) => list.map((f) => (sameField(f, target) ? { ...f, field_value: value } : f)))
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
      setFields((list) =>
        list.map((f) =>
          sameField(f, field)
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
      await exportTaxSummaryPdf({ caseRow, sections, result, lang, t, clientName: coupleDisplayName })
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
    enteredSourceViaClick.current = true
    // A real history entry (default push, not replace) — so the browser's
    // own back button lands back on this exact list/scroll position too,
    // not just this page's own "back" button.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('view', 'source')
      return next
    })
  }

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
            {t('summary.subtitle', { name: coupleDisplayName, year: caseRow.tax_year })}
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
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => viewOrphanedDocument(doc)}>
                    <Eye size={13} aria-hidden="true" />
                    {t('summary.incompleteViewDocument')}
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={openManualEntryForAdd}>
                    <Plus size={13} aria-hidden="true" />
                    {t('summary.manualEntryAdd')}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => markDocumentNotRelevant(doc)}
                    disabled={markingNotRelevantId === doc.id}
                  >
                    {markingNotRelevantId === doc.id ? <Spinner size={13} /> : null}
                    {t('summary.incompleteMarkNotRelevant')}
                  </button>
                </span>
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
            isText={sourceField?.isText}
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
                    {catDocuments.map((docGroup) => {
                      const rowGroups = groupFieldsByRow(docGroup.fields)
                      return fieldLayout === 'compact' ? (
                        <div key={docGroup.documentId} className="overflow-hidden rounded-xl border border-line bg-white">
                          <p className="border-b border-line/70 bg-sand/40 px-2 py-1 text-[12.5px] font-medium text-ink-500">
                            {docGroup.fileName}
                          </p>
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
                        </div>
                      ) : (
                        <div key={docGroup.documentId} className="space-y-2 rounded-xl bg-sand/40 p-3">
                          <p className="px-1 text-[12.5px] font-medium text-ink-500">{docGroup.fileName}</p>
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
                        </div>
                      )
                    })}
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

          <Modal
            open={Boolean(manualEntryForm)}
            onClose={() => setManualEntryForm(null)}
            title={t('summary.manualEntryAdd')}
            size="md"
            footer={
              <>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setManualEntryForm(null)}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="btn-primary btn-sm" onClick={saveManualEntry} disabled={savingManualEntry}>
                  {savingManualEntry ? <Spinner size={14} /> : null}
                  {t('common.save')}
                </button>
              </>
            }
          >
            {manualEntryForm ? (
              <div className="space-y-3">
                <Field label={t('summary.manualEntryType')} htmlFor="manual-entry-type">
                  <Select
                    id="manual-entry-type"
                    value={manualEntryForm.componentType}
                    onChange={(e) => setManualEntryForm((f) => ({ ...f, componentType: e.target.value }))}
                  >
                    {MANUAL_ENTRY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(
                          type === 'income'
                            ? 'summary.sectionIncome'
                            : type === 'deduction'
                              ? 'summary.sectionDeductions'
                              : type === 'wealth'
                                ? 'summary.sectionWealth'
                                : 'summary.manualEntryTypeDebt'
                        )}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={t('summary.manualEntryDescription')} htmlFor="manual-entry-description">
                  <TextInput
                    id="manual-entry-description"
                    value={manualEntryForm.description}
                    onChange={(e) => setManualEntryForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder={t('summary.manualEntryDescriptionPlaceholder')}
                  />
                </Field>

                <Field label={t('summary.manualEntryCurrency')} htmlFor="manual-entry-currency">
                  <TextInput
                    id="manual-entry-currency"
                    value={manualEntryForm.currencyCode}
                    onChange={(e) => setManualEntryForm((f) => ({ ...f, currencyCode: e.target.value }))}
                    placeholder="CHF"
                  />
                </Field>

                {manualEntryForm.currencyCode.trim() && manualEntryForm.currencyCode.trim().toUpperCase() !== 'CHF' ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label={t('summary.manualEntryOriginalAmount')} className="w-[150px]">
                      <TextInput
                        type="number"
                        step="0.01"
                        value={manualEntryForm.originalAmount}
                        onChange={(e) => {
                          const originalAmount = e.target.value
                          setManualEntryForm((f) => {
                            const rate = parseFloat(f.rate)
                            const orig = parseFloat(originalAmount)
                            const amount = Number.isFinite(rate) && Number.isFinite(orig) ? String(Math.round(orig * rate * 100) / 100) : f.amount
                            return { ...f, originalAmount, amount }
                          })
                        }}
                      />
                    </Field>
                    <Field label={t('summary.uncertaintyExchangeRate')} className="w-[130px]">
                      <TextInput
                        type="number"
                        step="0.0001"
                        value={manualEntryForm.rate}
                        onChange={(e) => {
                          const rate = e.target.value
                          setManualEntryForm((f) => {
                            const r = parseFloat(rate)
                            const orig = parseFloat(f.originalAmount)
                            const amount = Number.isFinite(r) && Number.isFinite(orig) ? String(Math.round(orig * r * 100) / 100) : f.amount
                            return { ...f, rate, amount }
                          })
                        }}
                      />
                    </Field>
                  </div>
                ) : null}

                <Field label={t('summary.manualEntryAmount')} htmlFor="manual-entry-amount">
                  <TextInput
                    id="manual-entry-amount"
                    type="number"
                    step="0.01"
                    value={manualEntryForm.amount}
                    onChange={(e) => setManualEntryForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </Field>

                <Field label={t('summary.manualEntryNote')} htmlFor="manual-entry-note">
                  <Textarea
                    id="manual-entry-note"
                    value={manualEntryForm.note}
                    onChange={(e) => setManualEntryForm((f) => ({ ...f, note: e.target.value }))}
                    rows={2}
                  />
                </Field>
              </div>
            ) : null}
          </Modal>

          <Modal
            open={Boolean(confirmDeleteManualEntry)}
            onClose={() => (deletingManualEntryId ? null : setConfirmDeleteManualEntry(null))}
            title={t('summary.manualEntryDeleteConfirmTitle')}
            description={t('summary.manualEntryDeleteConfirmBody')}
            size="sm"
            footer={
              <>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirmDeleteManualEntry(null)} disabled={Boolean(deletingManualEntryId)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => deleteManualEntry(confirmDeleteManualEntry)}
                  disabled={Boolean(deletingManualEntryId)}
                >
                  {deletingManualEntryId ? <Spinner size={14} /> : null}
                  {t('common.delete')}
                </button>
              </>
            }
          />

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

          {componentsBySection.length || manualEntries.length ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[15px] font-semibold text-ink-700">{t('summary.componentsTitle')}</h3>
                <button type="button" className="btn-secondary btn-sm" onClick={openManualEntryForAdd}>
                  <Plus size={14} aria-hidden="true" />
                  {t('summary.manualEntryAdd')}
                </button>
              </div>
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
                        {section.components.map((c) => {
                          const hasSource = Boolean(c.document_id)
                          const loadingSource = viewingKey === fieldKey(c)
                          return (
                            <tr
                              key={c.id}
                              className={clsx(hasSource && 'cursor-pointer hover:bg-sand/50')}
                              onClick={hasSource ? () => viewComponentSource(c) : undefined}
                              onKeyDown={
                                hasSource
                                  ? (e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        viewComponentSource(c)
                                      }
                                    }
                                  : undefined
                              }
                              tabIndex={hasSource ? 0 : undefined}
                              role={hasSource ? 'button' : undefined}
                              title={hasSource ? t('extraction.viewSource') : undefined}
                            >
                              <td className="px-4 py-2.5 text-ink-800">
                                {c.field_label || c.label}
                                {hasSource ? (
                                  loadingSource ? (
                                    <Spinner size={13} className="ml-1.5 inline align-[-2px]" />
                                  ) : (
                                    <Eye size={13} aria-hidden="true" className="ml-1.5 inline align-[-2px] text-ink-300" />
                                  )
                                ) : null}
                                {c.is_manual ? (
                                  <span className="chip ml-1.5 bg-sand text-ink-500 ring-line">{t('summary.manualEntryBadge')}</span>
                                ) : null}
                              </td>
                              <td
                                className={clsx(
                                  'px-4 py-2.5 text-right font-medium tabular-nums',
                                  c.component_type === 'income' || c.component_type === 'wealth'
                                    ? 'text-emerald-700'
                                    : 'text-red-700'
                                )}
                              >
                                <span className="inline-flex items-center gap-2">
                                  {c.component_type === 'deduction' || c.component_type === 'debt' ? '−' : '+'}
                                  {formatChfSwiss(Math.abs(c.amount))}
                                  {c.is_manual ? (
                                    <span className="inline-flex items-center gap-0.5">
                                      <button
                                        type="button"
                                        className="btn-ghost btn-sm !p-1"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          openManualEntryForEdit(c)
                                        }}
                                        title={t('common.edit')}
                                      >
                                        <Pencil size={13} aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-ghost btn-sm !p-1"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setConfirmDeleteManualEntry(manualEntries.find((m) => m.id === c.manual_entry_id) || { id: c.manual_entry_id })
                                        }}
                                        title={t('common.delete')}
                                      >
                                        <Trash2 size={13} aria-hidden="true" />
                                      </button>
                                    </span>
                                  ) : null}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {verificationItems.length ? (
            <div className="space-y-2">
              <h3 className="text-[15px] font-semibold text-ink-700">{t('summary.needsVerificationTitle')}</h3>
              <p className="text-[13px] text-ink-400">{t('summary.needsVerificationHelp')}</p>
              <div className="space-y-2">
                {verificationItems.map((c) => {
                  const kind = classifyVerificationItem(c.field_label)
                  const hasSource = Boolean(c.document_id)
                  const loadingSource = viewingKey === fieldKey(c)
                  const key = fieldKey(c)
                  const busy = decidingKey === key
                  const resolved = Boolean(c.decision)
                  const original = fields.find(
                    (f) =>
                      f.document_id === c.document_id &&
                      f.field_key === c.field_key &&
                      (f.row_key || '') === (c.row_key || '')
                  )

                  return (
                    <div
                      key={c.id}
                      className={clsx(
                        'rounded-xl border px-3.5 py-3',
                        resolved
                          ? c.decision === 'include'
                            ? 'border-emerald-200 bg-emerald-50/50'
                            : 'border-ink-200 bg-sand/40'
                          : 'border-amber-200 bg-amber-50/40'
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="flex items-start gap-1.5 text-[13.5px] text-ink-800">
                          <AlertTriangle
                            size={13}
                            className={clsx('mt-0.5 shrink-0', resolved ? 'text-ink-400' : 'text-amber-600')}
                            aria-hidden="true"
                          />
                          {c.field_label || c.label}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-medium tabular-nums text-ink-800">
                            {c.currency_code ? formatAmountSwiss(Math.abs(c.amount), c.currency_code) : formatChfSwiss(Math.abs(c.amount))}
                          </span>
                          {hasSource ? (
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              onClick={() => viewComponentSource(c)}
                              title={t('extraction.viewSource')}
                            >
                              {loadingSource ? <Spinner size={13} /> : <Eye size={13} aria-hidden="true" />}
                            </button>
                          ) : null}
                        </span>
                      </div>

                      {resolved ? (
                        <p className={clsx('mt-1.5 text-[12.5px] font-medium', c.decision === 'include' ? 'text-emerald-700' : 'text-ink-500')}>
                          {c.decision === 'include' ? t('summary.verificationDecidedIncluded') : t('summary.verificationDecidedExcluded')}
                        </p>
                      ) : null}

                      {hasSource ? (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          {kind === 'legacyFormat' ? (
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              onClick={() => reExtractDocument(c.document_id)}
                              disabled={retryingDocId === c.document_id}
                            >
                              {retryingDocId === c.document_id ? <Spinner size={14} /> : null}
                              {t('summary.reExtractDocument')}
                            </button>
                          ) : kind === 'foreignCurrency' ? (
                            <>
                              <Field label={t('summary.uncertaintyExchangeRate')} className="w-[150px]">
                                <TextInput
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  placeholder="0.00"
                                  value={fxEdits[key]?.rate || ''}
                                  onChange={(e) => setFxEdits((edits) => ({ ...edits, [key]: { rate: e.target.value, amount: '' } }))}
                                />
                              </Field>
                              <span className="pb-2.5 text-[12.5px] text-ink-400">{t('summary.uncertaintyOr')}</span>
                              <Field label={t('summary.uncertaintyChfAmount')} className="w-[150px]">
                                <TextInput
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  value={fxEdits[key]?.amount || ''}
                                  onChange={(e) => setFxEdits((edits) => ({ ...edits, [key]: { rate: '', amount: e.target.value } }))}
                                />
                              </Field>
                              <button type="button" className="btn-primary btn-sm" onClick={() => resolveForeignCurrencyItem(c)} disabled={busy || resolvingUncertainKey === key}>
                                {resolvingUncertainKey === key ? <Spinner size={14} /> : null}
                                {t('common.save')}
                              </button>
                              <button type="button" className="btn-secondary btn-sm" onClick={() => decideField(c, 'exclude')} disabled={busy}>
                                {busy ? <Spinner size={14} /> : null}
                                {t('summary.verificationActionExcludeCurrency')}
                              </button>
                            </>
                          ) : kind === 'missingParam' ? (
                            <>
                              <button type="button" className="btn-secondary btn-sm" onClick={() => confirmUncertainFieldAsIs(c)} disabled={resolvingUncertainKey === key}>
                                {resolvingUncertainKey === key ? <Spinner size={14} /> : null}
                                {t('summary.uncertaintyConfirmAsIs')}
                              </button>
                              <Link to="/tax-settings" className="text-[12.5px] font-medium underline">
                                {t('summary.uncertaintyGoToTaxSettings')}
                              </Link>
                            </>
                          ) : kind === 'doubleDeduction' ? (
                            <>
                              <button type="button" className="btn-primary btn-sm" onClick={() => decideField(c, 'include')} disabled={busy}>
                                {busy ? <Spinner size={14} /> : null}
                                {t('summary.verificationActionInclude')}
                              </button>
                              <button type="button" className="btn-secondary btn-sm" onClick={() => decideField(c, 'exclude')} disabled={busy}>
                                {busy ? <Spinner size={14} /> : null}
                                {t('summary.verificationActionExclude')}
                              </button>
                            </>
                          ) : kind === 'consideration' ? (
                            <>
                              <button type="button" className="btn-secondary btn-sm" onClick={() => decideField(c, 'exclude')} disabled={busy}>
                                {busy ? <Spinner size={14} /> : null}
                                {t('summary.verificationActionExcludeConfirmed')}
                              </button>
                              <button type="button" className="btn-primary btn-sm" onClick={() => decideField(c, 'include')} disabled={busy}>
                                {busy ? <Spinner size={14} /> : null}
                                {t('summary.verificationActionIncludeAnyway')}
                              </button>
                            </>
                          ) : kind === 'missingRegistry' || kind === 'separate' ? (
                            <button type="button" className="text-[12.5px] font-medium underline" onClick={() => viewComponentSource(c)}>
                              {t('summary.uncertaintyViewSource')}
                            </button>
                          ) : (
                            <>
                              <button type="button" className="btn-primary btn-sm" onClick={() => decideField(c, 'include')} disabled={busy}>
                                {busy ? <Spinner size={14} /> : null}
                                {t('summary.verificationActionInclude')}
                              </button>
                              <button type="button" className="btn-secondary btn-sm" onClick={() => decideField(c, 'exclude')} disabled={busy}>
                                {busy ? <Spinner size={14} /> : null}
                                {t('summary.verificationActionExclude')}
                              </button>
                              {original ? (
                                <>
                                  <Field label={t('summary.verificationEditAmount')} className="w-[130px]">
                                    <TextInput
                                      type="number"
                                      step="0.01"
                                      value={amountEdits[key] ?? original.field_value ?? ''}
                                      onChange={(e) => setAmountEdits((edits) => ({ ...edits, [key]: e.target.value }))}
                                    />
                                  </Field>
                                  <button type="button" className="btn-secondary btn-sm" onClick={() => saveAmountEdit(c)} disabled={busyKey === fieldKey(original)}>
                                    {busyKey === fieldKey(original) ? <Spinner size={14} /> : null}
                                    {t('common.save')}
                                  </button>
                                </>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
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
