import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronUp, ClipboardList, FileCheck2, FolderOpen, Info,
  Mail, MessageSquare, RefreshCw, Save, ShieldCheck, Sparkles, Upload, X
} from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import StatusStepper from '../components/StatusStepper'
import Uploader from '../components/Uploader'
import DocumentList from '../components/DocumentList'
import ChecklistPanel from '../components/ChecklistPanel'
import FeeEstimatePanel from '../components/FeeEstimatePanel'
import CaseTimeline from '../components/CaseTimeline'
import Modal from '../components/Modal'
import { EmptyState, Field, PageLoader, Select, Spinner, Textarea, TextInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { CANTONS, CASE_STATUSES, CLIENT_DELETE_OPEN_STATUSES, MARITAL_STATUSES } from '../lib/constants'
import { fullName } from '../lib/format'
import { docTypeLabel } from '../lib/labels'
import { computeQuestionnaireConsistency, computeQuestionnaireCompleteness } from '../lib/questionnaireConsistency'
import { describeSuggestion } from '../lib/suggestions'
import { viewerCopy } from '../lib/viewerCopy'

// Maps client_documents.status to its i18n key + a badge tone — the
// extraction pipeline's own states (see supabase/migrations/
// 20260101000007_tax_extraction_schema.sql's check constraint), distinct
// from a case's own status (StatusBadge).
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

export default function CasePage() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const toast = useToast()
  const { isStaff, profile, client: myClient } = useAuth()
  // Headings and status sentences written from the client's point of view
  // ("Your documents") have a staff-side twin — see src/lib/viewerCopy.js.
  const copy = viewerCopy(isStaff)
  // A link from elsewhere (e.g. Tax Summary's children-count mismatch
  // banner) can ask this page to open the consistency review directly,
  // instead of sending the specialist to type the fix in by hand.
  const [searchParams] = useSearchParams()
  const openConsistencyOnLoad = searchParams.get('fix') === 'consistency'

  const [loading, setLoading] = useState(true)
  const [caseRow, setCaseRow] = useState(null)
  const [documents, setDocuments] = useState([])
  const [requested, setRequested] = useState([])
  const [documentTypes, setDocumentTypes] = useState([])
  const [documentCategories, setDocumentCategories] = useState([])
  const [events, setEvents] = useState([])
  // staff only
  const [pricing, setPricing] = useState([])
  const [questionnaire, setQuestionnaire] = useState(null)
  const [clientDocuments, setClientDocuments] = useState([])
  const [pendingSuggestions, setPendingSuggestions] = useState([])
  const [currentTaxSheetFields, setCurrentTaxSheetFields] = useState([])
  const [consistencyOpen, setConsistencyOpen] = useState(false)
  const [resolvingSuggestionId, setResolvingSuggestionId] = useState(null)
  const [confirmingReprocess, setConfirmingReprocess] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const [statusDraft, setStatusDraft] = useState('opened')
  const [messageDraft, setMessageDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [notify, setNotify] = useState(true)
  const [savingStatus, setSavingStatus] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  // Collapsible document sections: default open on whichever one is the
  // current viewer's own primary upload zone, collapsed on the other
  // (secondary/informational) one — see the primary/secondary styling below.
  const [clientDocsOpen, setClientDocsOpen] = useState(!isStaff)
  const [specialistDocsOpen, setSpecialistDocsOpen] = useState(isStaff)

  const load = useCallback(async () => {
    const row = await api.getCase(caseId)
    if (!row) {
      setLoading(false)
      return
    }
    setCaseRow(row)
    setStatusDraft(row.status)
    setMessageDraft(row.client_message || '')

    // Remember the last case the client actually opened, so ClientHome can
    // feature it instead of always defaulting to the current tax year.
    if (!isStaff) {
      try {
        localStorage.setItem(`hornung.lastCase.${row.client_id}`, caseId)
      } catch {
        /* private browsing — ignore, ClientHome just falls back */
      }
    }
    setNotesDraft(row.specialist_notes || '')

    const [docs, req, types, evts] = await Promise.all([
      api.listDocuments(caseId),
      api.listRequested(caseId),
      api.listDocumentTypes(),
      api.listEvents(caseId)
    ])
    setDocuments(docs)
    setRequested(req)
    setDocumentTypes(types)
    setEvents(evts)

    if (isStaff) {
      const clientId = row.client_id
      const [prices, quest, clientDocs, cats, suggestions] = await Promise.all([
        api.listPricing(),
        api.getQuestionnaire(clientId),
        api.listClientDocuments(clientId, row.tax_year),
        api.listDocumentCategories(),
        api.listFieldSuggestions(clientId)
      ])
      setPricing(prices)
      setQuestionnaire(quest)
      setClientDocuments(clientDocs)
      setDocumentCategories(cats)
      setPendingSuggestions(suggestions)

      // Only ever one "current tax sheet" document per case in practice —
      // its children_count is the one Questionnaire-vs-documents check that
      // isn't already covered by a client_field_suggestions row (there's no
      // single target field a bare count could safely overwrite).
      const sheetDoc = docs.find((d) => d.category_code === 'current_tax_sheet')
      setCurrentTaxSheetFields(sheetDoc ? await api.listExtractedFields(sheetDoc.id) : [])
    }
    setLoading(false)
  }, [caseId, isStaff])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const clientDocs = useMemo(
    () => documents.filter((d) => d.direction === 'client_upload'),
    [documents]
  )
  const specialistDocs = useMemo(
    () => documents.filter((d) => d.direction === 'specialist_upload'),
    [documents]
  )

  const consistency = useMemo(
    () =>
      isStaff && questionnaire
        ? computeQuestionnaireConsistency({
            questionnaire,
            documents,
            currentTaxSheetFields,
            pendingSuggestions
          })
        : { discrepancies: [], missingDocuments: [] },
    [isStaff, questionnaire, documents, currentTaxSheetFields, pendingSuggestions]
  )
  const consistencyIssueCount = consistency.discrepancies.length + consistency.missingDocuments.length

  // Whether the Questionnaire itself has what a case can't be considered
  // ready without — checked independently of any document (unlike the
  // consistency check above, which only ever compares against one), so a
  // brand new case with nothing uploaded yet still gets pointed at the
  // Questionnaire as the explicit first step, not left to a background
  // sync that may or may not have run.
  const completeness = useMemo(
    () => (isStaff && questionnaire ? computeQuestionnaireCompleteness(questionnaire) : { isComplete: true, missing: [] }),
    [isStaff, questionnaire]
  )

  useEffect(() => {
    if (openConsistencyOnLoad && consistencyIssueCount) setConsistencyOpen(true)
  }, [openConsistencyOnLoad, consistencyIssueCount])

  const resolveConsistencySuggestion = async (suggestion, accept) => {
    setResolvingSuggestionId(suggestion.id)
    try {
      await api.resolveFieldSuggestion(suggestion, accept)
      setPendingSuggestions((list) => list.filter((s) => s.id !== suggestion.id))
      setSuggestionEdits((edits) => {
        const { [suggestion.id]: _discard, ...rest } = edits
        return rest
      })
      if (accept) {
        // The client_persons/client_children/clients row this targeted may
        // have just changed — the consistency check above is computed from
        // this same `questionnaire` state, so it has to be refetched or the
        // banner would keep citing a gap this exact action just closed.
        setQuestionnaire(await api.getQuestionnaire(caseRow.client_id))
      }
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setResolvingSuggestionId(null)
    }
  }

  // Lets a specialist correct a proposed value before applying it, instead
  // of only being able to accept it verbatim or ignore it outright —
  // keyed by suggestion id since several can be open in the modal at once.
  // client_children carries its proposal as a JSON payload (full_name is
  // the only part worth editing inline; client_properties' richer payload
  // stays edit-elsewhere for now), everything else is a plain scalar.
  const [suggestionEdits, setSuggestionEdits] = useState({})

  const suggestionEditValue = (s) => {
    if (s.target_table === 'client_children') {
      return suggestionEdits[s.id] ?? JSON.parse(s.suggested_value).full_name ?? ''
    }
    return suggestionEdits[s.id] ?? s.suggested_value ?? ''
  }

  const setSuggestionEditValue = (s, value) => {
    setSuggestionEdits((edits) => ({ ...edits, [s.id]: value }))
  }

  const suggestionToApply = (s) => {
    if (!(s.id in suggestionEdits)) return s
    if (s.target_table === 'client_children') {
      return { ...s, suggested_value: JSON.stringify({ ...JSON.parse(s.suggested_value), full_name: suggestionEdits[s.id] }) }
    }
    return { ...s, suggested_value: suggestionEdits[s.id] }
  }

  // A client can always upload (see the "documents: client upload" RLS
  // policy) — this only gates deleting their own documents, matching
  // "documents: client delete own" / case_is_open_for_client() exactly.
  const locked = !CLIENT_DELETE_OPEN_STATUSES.includes(caseRow?.status)
  const clientRecord = caseRow?.client || myClient

  const upload = async (file, meta, direction) => {
    const doc = await api.uploadDocument(caseId, file, {
      ...meta,
      direction,
      clientId: caseRow.client_id,
      taxYear: caseRow.tax_year,
      profileId: profile?.id
    })
    setDocuments((list) => [doc, ...list])
    toast.success(t('common.saved'))

    // The client uploaded to their own case (not staff acting on their
    // behalf) while it's already in review/finished — RLS lets this through
    // on purpose, so alert staff instead of silently accepting it.
    if (direction === 'client_upload' && !isStaff && locked) {
      api.notifyLateUpload({ caseId, fileName: file.name }).catch((err) => {
        console.error('[notifyLateUpload]', err)
      })
    }
  }

  const removeDocument = async (doc) => {
    await api.deleteDocument(doc)
    setDocuments((list) => list.filter((d) => d.id !== doc.id))
    toast.success(t('common.saved'))
  }

  const changeDocumentCategory = async (doc, categoryCode) => {
    await api.setDocumentCategory(doc.id, categoryCode)
    setDocuments((list) =>
      list.map((d) => (d.id === doc.id ? { ...d, category_code: categoryCode } : d))
    )
    toast.success(t('common.saved'))
  }

  const saveChecklist = async (ids) => {
    const rows = await api.setRequested(caseId, ids)
    setRequested(rows)
    toast.success(t('case.checklistSaved'))
  }

  const saveStatus = async () => {
    setSavingStatus(true)
    try {
      const result = await api.setCaseStatus(caseId, {
        status: statusDraft,
        client_message: messageDraft,
        notify,
        actorId: profile?.id
      })
      setCaseRow((row) => ({ ...row, ...(result.case || {}) }))
      setEvents(await api.listEvents(caseId))
      toast.success(
        result.emailSent ? `${t('case.statusUpdated')} · ${t('case.emailSent')}` : t('case.statusUpdated')
      )
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('case.emailFailed'))
    } finally {
      setSavingStatus(false)
    }
  }

  const saveNotes = async () => {
    setSavingNotes(true)
    try {
      const row = await api.updateCase(caseId, { specialist_notes: notesDraft })
      setCaseRow((current) => ({ ...current, ...row }))
      toast.success(t('common.saved'))
    } catch (error) {
      toast.error(error.message || t('common.error'))
    } finally {
      setSavingNotes(false)
    }
  }

  const toggleCaseOption = async (patch) => {
    const row = await api.updateCase(caseId, patch)
    setCaseRow((current) => ({ ...current, ...row }))
  }

  // "Reload everything from what's actually written in the documents" —
  // one action instead of retrying documents one at a time and hoping the
  // Questionnaire/suggestions/calculation catch up on their own. Re-runs
  // full extraction for every document of this year (even already-
  // extracted ones, so a schema change made after they were first
  // processed actually gets picked up), which re-syncs everything derived
  // from them as a side effect — see api/reprocess-client-year.js.
  const reprocessAll = async () => {
    setConfirmingReprocess(false)
    setReprocessing(true)
    try {
      const result = await api.reprocessClientYear(caseRow.client_id, caseRow.tax_year)
      if (result.failed) {
        toast.error(t('case.reprocessPartial', { processed: result.processed, failed: result.failed }))
      } else {
        toast.success(t('case.reprocessDone', { processed: result.processed }))
      }
      await load()
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setReprocessing(false)
    }
  }

  if (loading) return <PageLoader label={t('common.loading')} />
  if (!caseRow) {
    return (
      <EmptyState
        icon={FolderOpen}
        title={t('common.error')}
        action={
          <button type="button" className="btn-secondary btn-sm" onClick={() => navigate(-1)}>
            {t('common.back')}
          </button>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="no-print">
        <Link
          to={isStaff ? `/clients/${caseRow.client_id}` : '/'}
          className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {isStaff ? t('specialist.openFile') : t('nav.home')}
        </Link>
      </div>

      {/* ---------------------------------------------------------- header -- */}
      <header className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {isStaff && clientRecord ? (
              <p className="eyebrow">{fullName(clientRecord) || clientRecord.email}</p>
            ) : (
              <p className="eyebrow">{t('home.yourFile')}</p>
            )}
            <h1 className="display mt-1 text-[30px] leading-tight sm:text-[36px]">
              {t('case.title', { year: caseRow.tax_year })}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {isStaff ? (
              <>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setConfirmingReprocess(true)}
                  disabled={reprocessing}
                >
                  {reprocessing ? <Spinner size={15} /> : <RefreshCw size={15} aria-hidden="true" />}
                  {t('case.reprocessAll')}
                </button>
                <Link to={`/year/${caseId}/summary`} className="btn-secondary btn-sm">
                  <ClipboardList size={15} aria-hidden="true" />
                  {t('case.taxSummary')}
                </Link>
              </>
            ) : null}
            <StatusBadge status={caseRow.status} />
          </div>
        </div>

        <div className="mt-6 max-w-3xl">
          <StatusStepper status={caseRow.status} />
        </div>

        <p className="mt-5 text-[15px] leading-relaxed text-ink-600">
          {t(`${copy.statusDescPrefix}.${caseRow.status}`)}
        </p>

        {caseRow.client_message ? (
          <div className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <MessageSquare size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-wide text-amber-800">
                {t('case.messageFromUs')}
              </p>
              <p className="mt-0.5 text-[15px] leading-relaxed text-amber-900">
                {caseRow.client_message}
              </p>
            </div>
          </div>
        ) : null}
      </header>

      {/* ---------------------------------- questionnaire completeness (staff) -- */}
      {/* Deliberately not dismissible and not a document-comparison check
          (that's the one below) — this is the explicit "is the case ready
          to work on" gate the Questionnaire is meant to be, checked
          regardless of whether any document has been uploaded/synced yet. */}
      {isStaff && !completeness.isComplete ? (
        <Link
          to={`/clients/${caseRow.client_id}?tab=questionnaire`}
          className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14.5px] text-red-900 transition hover:border-red-400"
        >
          <AlertTriangle size={18} className="shrink-0 text-red-700" aria-hidden="true" />
          <span className="font-medium">{t('case.questionnaireIncomplete')}</span>
          <span className="ml-auto shrink-0 text-[13px] text-red-700 underline">{t('case.questionnaireCompleteAction')}</span>
        </Link>
      ) : null}

      {/* ------------------------------------------ consistency check (staff) -- */}
      {isStaff && consistencyIssueCount ? (
        <button
          type="button"
          onClick={() => setConsistencyOpen(true)}
          className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-[14.5px] text-amber-900 transition hover:border-amber-300"
        >
          <AlertTriangle size={18} className="shrink-0 text-amber-700" aria-hidden="true" />
          {consistency.discrepancies.length ? (
            <span className="font-medium">
              {t('case.consistencyDiscrepancies', { count: consistency.discrepancies.length })}
            </span>
          ) : null}
          {consistency.discrepancies.length && consistency.missingDocuments.length ? <span>·</span> : null}
          {consistency.missingDocuments.length ? (
            <span className="font-medium">
              {t('case.consistencyMissingDocs', { count: consistency.missingDocuments.length })}
            </span>
          ) : null}
          <span className="ml-auto text-[13px] text-amber-700 underline">{t('case.consistencyReview')}</span>
        </button>
      ) : null}

      {/* ------------------------------------------------ client documents -- */}
      {/* This is the client's own upload zone — primary/prominent for them,
          secondary/muted for staff, who can still use it on the client's
          behalf but shouldn't mistake it for their own upload flow below. */}
      <section className={clsx('card card-pad', isStaff && 'border-dashed bg-sand/30')}>
        <button
          type="button"
          onClick={() => setClientDocsOpen((v) => !v)}
          className="flex w-full items-start justify-between gap-3 text-left"
          aria-expanded={clientDocsOpen}
        >
          <div className="flex items-start gap-2.5">
            <Upload
              size={20}
              className={clsx('mt-1 shrink-0', isStaff ? 'text-ink-400' : 'text-gold-600')}
              aria-hidden="true"
            />
            <div>
              <h2 className="section-title text-xl">{t(copy.caseDocumentsTitle)}</h2>
              <p className="section-sub">{t(copy.caseDocumentsHelp)}</p>
            </div>
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-2 text-ink-400">
            {clientDocs.length ? (
              <span className="text-[13px] font-medium">{clientDocs.length}</span>
            ) : null}
            {clientDocsOpen ? (
              <ChevronUp size={20} aria-hidden="true" />
            ) : (
              <ChevronDown size={20} aria-hidden="true" />
            )}
          </div>
        </button>

        {clientDocsOpen ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              {isStaff ? (
                <div className="space-y-2">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">
                    {t('case.staffUploadOnBehalf')}
                  </p>
                  <Uploader
                    compact
                    documentTypes={documentTypes}
                    onUpload={(file, meta) => upload(file, meta, 'client_upload')}
                  />
                </div>
              ) : (
                <>
                  {locked ? (
                    <div className="flex items-center gap-2 rounded-xl bg-sand px-4 py-3 text-[14.5px] text-ink-500">
                      <Info size={16} aria-hidden="true" />
                      {t('case.lateUploadNotice')}
                    </div>
                  ) : null}
                  <Uploader
                    documentTypes={documentTypes}
                    onUpload={(file, meta) => upload(file, meta, 'client_upload')}
                  />
                </>
              )}

              {clientDocs.length ? (
                <DocumentList
                  documents={clientDocs}
                  documentTypes={documentTypes}
                  categories={documentCategories}
                  canAssignCategory={isStaff}
                  onCategoryChange={changeDocumentCategory}
                  canDelete={isStaff || !locked}
                  onDelete={removeDocument}
                  clientId={caseRow.client_id}
                  taxYear={caseRow.tax_year}
                />
              ) : (
                <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[14.5px] text-ink-400">
                  {t('case.noDocuments')}
                </p>
              )}
            </div>

            <ChecklistPanel
              documentTypes={documentTypes}
              requested={requested}
              documents={clientDocs}
              canEdit={isStaff}
              onSave={saveChecklist}
            />
          </div>
        ) : null}
      </section>

      {/* -------------------------------------------- specialist documents -- */}
      {/* Staff's own upload zone — primary/prominent for them, secondary/
          view-only for the client (who never gets an uploader here). */}
      <section className={clsx('card card-pad', !isStaff && 'border-dashed bg-sand/30')}>
        <button
          type="button"
          onClick={() => setSpecialistDocsOpen((v) => !v)}
          className="flex w-full items-start justify-between gap-3 text-left"
          aria-expanded={specialistDocsOpen}
        >
          <div className="flex items-start gap-2.5">
            <FileCheck2
              size={20}
              className={clsx('mt-1 shrink-0', !isStaff ? 'text-ink-400' : 'text-gold-600')}
              aria-hidden="true"
            />
            <div>
              <h2 className="section-title text-xl">{t('case.fromSpecialist')}</h2>
              <p className="section-sub">{t(copy.caseSpecialistDocsHelp)}</p>
            </div>
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-2 text-ink-400">
            {specialistDocs.length ? (
              <span className="text-[13px] font-medium">{specialistDocs.length}</span>
            ) : null}
            {specialistDocsOpen ? (
              <ChevronUp size={20} aria-hidden="true" />
            ) : (
              <ChevronDown size={20} aria-hidden="true" />
            )}
          </div>
        </button>

        {specialistDocsOpen ? (
          <div className="mt-4 space-y-4">
            {isStaff ? (
              <Uploader
                documentTypes={[]}
                onUpload={(file, meta) => upload(file, meta, 'specialist_upload')}
              />
            ) : null}

            {specialistDocs.length ? (
              <DocumentList
                documents={specialistDocs}
                documentTypes={documentTypes}
                categories={documentCategories}
                canAssignCategory={isStaff}
                onCategoryChange={changeDocumentCategory}
                canDelete={isStaff}
                onDelete={removeDocument}
                clientId={caseRow.client_id}
                taxYear={caseRow.tax_year}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[14.5px] text-ink-400">
                {t(copy.caseNoSpecialistDocs)}
              </p>
            )}
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------------ staff area -- */}
      {isStaff ? (
        <section className="space-y-4 rounded-2xl border-2 border-dashed border-gold-300 bg-gold-50/40 p-4 sm:p-6">
          <div className="flex items-start gap-2.5">
            <ShieldCheck size={20} className="mt-0.5 shrink-0 text-gold-700" aria-hidden="true" />
            <div>
              <h2 className="section-title text-xl">{t('case.staffArea')}</h2>
              <p className="section-sub">{t('case.staffAreaHelp')}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* status control */}
            <div className="rounded-xl border border-line bg-white p-4">
              <h3 className="mb-3 text-[15px] font-semibold text-ink-900">{t('case.changeStatus')}</h3>
              <div className="space-y-3">
                <Field label={t('status.label')} htmlFor="status">
                  <Select id="status" value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)}>
                    {CASE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`status.${s}`)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={t('case.clientMessage')} htmlFor="client-message">
                  <Textarea
                    id="client-message"
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    placeholder={t('case.clientMessagePlaceholder')}
                  />
                </Field>

                <label className="flex cursor-pointer items-center gap-2 text-[14.5px] text-ink-700">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={notify}
                    onChange={(e) => setNotify(e.target.checked)}
                  />
                  <Mail size={15} aria-hidden="true" />
                  {t('case.notifyClient')}
                </label>

                <button type="button" className="btn-primary w-full" onClick={saveStatus} disabled={savingStatus}>
                  <Save size={17} aria-hidden="true" />
                  {savingStatus ? t('common.saving') : t('case.saveStatus')}
                </button>
              </div>
            </div>

            {/* internal notes */}
            <div className="flex flex-col rounded-xl border border-line bg-white p-4">
              <h3 className="text-[15px] font-semibold text-ink-900">{t('case.internalNotes')}</h3>
              <p className="mb-3 text-[13px] text-ink-400">{t('case.internalNotesHelp')}</p>
              <Textarea
                className="flex-1"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={6}
              />
              <button
                type="button"
                className="btn-secondary btn-sm mt-3 self-end"
                onClick={saveNotes}
                disabled={savingNotes}
              >
                {savingNotes ? t('common.saving') : t('common.save')}
              </button>
            </div>

            <FeeEstimatePanel
              pricing={pricing}
              questionnaire={questionnaire}
              caseRow={caseRow}
              editable
              onToggle={toggleCaseOption}
            />

            <CaseTimeline events={events} />
          </div>

          <div className="rounded-xl border border-line bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Sparkles size={19} className="mt-0.5 shrink-0 text-gold-600" aria-hidden="true" />
                <div>
                  <p className="text-[15px] font-semibold text-ink-900">{t('case.extractionStatusTitle')}</p>
                  <p className="text-[13px] text-ink-400">{t('case.extractionStatusHelp')}</p>
                </div>
              </div>
              <Link to={`/year/${caseId}/summary`} className="btn-secondary btn-sm shrink-0">
                <ClipboardList size={15} aria-hidden="true" />
                {t('case.taxSummary')}
              </Link>
            </div>
            {clientDocuments.length ? (
              <ul className="divide-y divide-line">
                {clientDocuments.map((doc) => {
                  const category = documentCategories.find((c) => c.code === doc.category_code)
                  return (
                    <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink-700">{doc.file_name}</span>
                        {category ? <span className="text-[12px] text-ink-400">{docTypeLabel(category, lang)}</span> : null}
                      </span>
                      <span className={clsx('shrink-0 font-medium', EXTRACTION_STATUS_TONE[doc.status] || 'text-ink-400')}>
                        {t(EXTRACTION_STATUS_LABEL_KEY[doc.status] || doc.status)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-[13.5px] text-ink-400">{t('case.extractionStatusEmpty')}</p>
            )}
          </div>
        </section>
      ) : null}

      <Modal
        open={confirmingReprocess}
        onClose={() => (reprocessing ? null : setConfirmingReprocess(false))}
        title={t('case.reprocessConfirmTitle')}
        description={t('case.reprocessConfirmBody')}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setConfirmingReprocess(false)}
              disabled={reprocessing}
            >
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={reprocessAll} disabled={reprocessing}>
              {reprocessing ? <Spinner size={16} /> : <RefreshCw size={16} aria-hidden="true" />}
              {t('case.reprocessAll')}
            </button>
          </>
        }
      />

      <Modal
        open={consistencyOpen}
        onClose={() => setConsistencyOpen(false)}
        title={t('case.consistencyTitle')}
        description={t('case.consistencyHelp')}
        size="lg"
      >
        <div className="space-y-5">
          {consistency.discrepancies.length ? (
            <div className="space-y-2">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">
                {t('case.consistencyDiscrepanciesTitle')}
              </p>
              {consistency.discrepancies.map((d) => {
                if (d.kind !== 'suggestion') {
                  return (
                    <div
                      key={d.key}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-900"
                    >
                      {t('case.consistencyChildrenCount', {
                        documentValue: d.documentValue,
                        questionnaireValue: d.questionnaireValue
                      })}
                    </div>
                  )
                }
                const s = d.suggestion
                const editable = s.target_table !== 'client_properties'
                return (
                  <div
                    key={d.key}
                    className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-900"
                  >
                    <p>{describeSuggestion(s, t)}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {editable ? (
                        <div className="w-full max-w-xs sm:w-auto">
                          {s.target_field === 'marital_status' ? (
                            <Select
                              value={suggestionEditValue(s)}
                              onChange={(e) => setSuggestionEditValue(s, e.target.value)}
                            >
                              {MARITAL_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {t(`marital.${status}`)}
                                </option>
                              ))}
                            </Select>
                          ) : s.target_field === 'canton' ? (
                            <Select
                              value={suggestionEditValue(s)}
                              onChange={(e) => setSuggestionEditValue(s, e.target.value)}
                            >
                              <option value="">{t('common.none')}</option>
                              {CANTONS.map((c) => (
                                <option key={c} value={c}>
                                  {t(`canton.${c}`)} ({c})
                                </option>
                              ))}
                            </Select>
                          ) : s.target_field === 'date_of_birth' ? (
                            <TextInput
                              type="date"
                              value={suggestionEditValue(s)}
                              onChange={(e) => setSuggestionEditValue(s, e.target.value)}
                            />
                          ) : (
                            <TextInput
                              value={suggestionEditValue(s)}
                              onChange={(e) => setSuggestionEditValue(s, e.target.value)}
                              placeholder={
                                s.target_table === 'client_children' ? t('data.f.childName') : undefined
                              }
                            />
                          )}
                        </div>
                      ) : null}
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => resolveConsistencySuggestion(s, false)}
                          disabled={resolvingSuggestionId === s.id}
                        >
                          <X size={14} aria-hidden="true" />
                          {t('specialist.ignoreSuggestion')}
                        </button>
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={() => resolveConsistencySuggestion(suggestionToApply(s), true)}
                          disabled={
                            resolvingSuggestionId === s.id ||
                            (s.target_table === 'client_children' && !suggestionEditValue(s).trim())
                          }
                        >
                          {resolvingSuggestionId === s.id ? (
                            <Spinner size={14} />
                          ) : (
                            <Check size={14} aria-hidden="true" />
                          )}
                          {t('specialist.acceptSuggestion')}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}

          {consistency.missingDocuments.length ? (
            <div className="space-y-2">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">
                {t('case.consistencyMissingDocsTitle')}
              </p>
              {consistency.missingDocuments.map((m) => (
                <div
                  key={m.key}
                  className="rounded-xl border border-line bg-sand/50 px-4 py-3 text-[14px] text-ink-700"
                >
                  {m.kind === 'missingProperty'
                    ? t('case.consistencyMissingProperty', { count: m.count })
                    : t('case.consistencyMissingSpouseSalary')}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
