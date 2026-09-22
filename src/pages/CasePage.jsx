import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, FileCheck2, FolderOpen, Lock, Mail, MessageSquare, Save, ShieldCheck, Upload
} from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import StatusStepper from '../components/StatusStepper'
import Uploader from '../components/Uploader'
import DocumentList from '../components/DocumentList'
import ChecklistPanel from '../components/ChecklistPanel'
import AiPanel from '../components/AiPanel'
import FeeEstimatePanel from '../components/FeeEstimatePanel'
import CaseTimeline from '../components/CaseTimeline'
import { EmptyState, Field, PageLoader, Select, Textarea } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { CASE_STATUSES } from '../lib/constants'
import { fullName } from '../lib/format'

export default function CasePage() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const toast = useToast()
  const { isStaff, profile, client: myClient } = useAuth()

  const [loading, setLoading] = useState(true)
  const [caseRow, setCaseRow] = useState(null)
  const [documents, setDocuments] = useState([])
  const [requested, setRequested] = useState([])
  const [documentTypes, setDocumentTypes] = useState([])
  const [events, setEvents] = useState([])
  // staff only
  const [pricing, setPricing] = useState([])
  const [questionnaire, setQuestionnaire] = useState(null)
  const [extracted, setExtracted] = useState([])
  const [statusDraft, setStatusDraft] = useState('opened')
  const [messageDraft, setMessageDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [notify, setNotify] = useState(true)
  const [savingStatus, setSavingStatus] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)

  const load = useCallback(async () => {
    const row = await api.getCase(caseId)
    if (!row) {
      setLoading(false)
      return
    }
    setCaseRow(row)
    setStatusDraft(row.status)
    setMessageDraft(row.client_message || '')
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
      const [prices, quest, ext] = await Promise.all([
        api.listPricing(),
        api.getQuestionnaire(clientId),
        api.listExtracted(caseId)
      ])
      setPricing(prices)
      setQuestionnaire(quest)
      setExtracted(ext)
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

  const locked = caseRow?.status === 'finished'
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
  }

  const removeDocument = async (doc) => {
    await api.deleteDocument(doc)
    setDocuments((list) => list.filter((d) => d.id !== doc.id))
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
          <StatusBadge status={caseRow.status} />
        </div>

        <div className="mt-6 max-w-3xl">
          <StatusStepper status={caseRow.status} />
        </div>

        <p className="mt-5 text-[15px] leading-relaxed text-ink-600">
          {t(`status.desc.${caseRow.status}`)}
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

      {/* ------------------------------------------------ client documents -- */}
      <section className="card card-pad">
        <div className="mb-4 flex items-start gap-2.5">
          <Upload size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
          <div>
            <h2 className="section-title text-xl">{t('case.yourDocuments')}</h2>
            <p className="section-sub">{t('case.yourDocumentsHelp')}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {locked && !isStaff ? (
              <div className="flex items-center gap-2 rounded-xl bg-sand px-4 py-3 text-[14.5px] text-ink-500">
                <Lock size={16} aria-hidden="true" />
                {t('case.lockedNotice')}
              </div>
            ) : (
              <Uploader
                documentTypes={documentTypes}
                onUpload={(file, meta) => upload(file, meta, 'client_upload')}
              />
            )}

            {clientDocs.length ? (
              <DocumentList
                documents={clientDocs}
                documentTypes={documentTypes}
                canDelete={isStaff || !locked}
                onDelete={removeDocument}
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
      </section>

      {/* -------------------------------------------- specialist documents -- */}
      <section className="card card-pad">
        <div className="mb-4 flex items-start gap-2.5">
          <FileCheck2 size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
          <div>
            <h2 className="section-title text-xl">{t('case.fromSpecialist')}</h2>
            <p className="section-sub">{t('case.fromSpecialistHelp')}</p>
          </div>
        </div>

        <div className="space-y-4">
          {isStaff ? (
            <Uploader
              compact
              documentTypes={[]}
              onUpload={(file, meta) => upload(file, meta, 'specialist_upload')}
            />
          ) : null}

          {specialistDocs.length ? (
            <DocumentList
              documents={specialistDocs}
              documentTypes={documentTypes}
              canDelete={isStaff}
              onDelete={removeDocument}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[14.5px] text-ink-400">
              {t('case.noSpecialistDocs')}
            </p>
          )}
        </div>
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

          <AiPanel fields={extracted} />
        </section>
      ) : null}
    </div>
  )
}
