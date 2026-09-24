import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Archive, CalendarPlus, Mail, Phone, RefreshCw, Save, FolderOpen, Trash2
} from 'lucide-react'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import QuestionnaireForm from '../components/QuestionnaireForm'
import { EmptyState, Field, PageLoader, Select, Spinner, Textarea } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { currentTaxYear, IS_DEMO } from '../lib/config'
import { formatDate, fullName } from '../lib/format'

export default function SpecialistClient() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [client, setClient] = useState(null)
  const [cases, setCases] = useState([])
  const [tab, setTab] = useState('years')
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [newYear, setNewYear] = useState(String(currentTaxYear()))
  const [addingYear, setAddingYear] = useState(false)
  const [resending, setResending] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletingClient, setDeletingClient] = useState(false)

  const load = useCallback(async () => {
    const [row, rows] = await Promise.all([api.getClient(clientId), api.listCases(clientId)])
    setClient(row)
    setNotes(row?.internal_notes || '')
    setCases(rows)
    setLoading(false)
  }, [clientId])

  useEffect(() => {
    load()
  }, [load])

  const saveNotes = async () => {
    setSavingNotes(true)
    try {
      await api.updateClient(clientId, { internal_notes: notes })
      toast.success(t('common.saved'))
    } catch (error) {
      toast.error(error.message || t('common.error'))
    } finally {
      setSavingNotes(false)
    }
  }

  const addYear = async () => {
    setAddingYear(true)
    try {
      await api.createCase(clientId, newYear)
      setCases(await api.listCases(clientId))
      toast.success(t('common.saved'))
    } catch (error) {
      toast.error(
        error.message === 'YEAR_EXISTS' ? t('specialist.yearExists') : error.message || t('common.error')
      )
    } finally {
      setAddingYear(false)
    }
  }

  const resendInvite = async () => {
    setResending(true)
    try {
      if (IS_DEMO || !api.resendInvite) {
        toast.info(t('common.demoBadge'))
        return
      }
      await api.resendInvite(clientId)
      toast.success(t('specialist.inviteSent', { email: client.email }))
    } catch (error) {
      toast.error(error.message || t('specialist.inviteFailed'))
    } finally {
      setResending(false)
    }
  }

  const toggleArchive = async () => {
    const next = client.status === 'archived' ? 'active' : 'archived'
    const row = await api.updateClient(clientId, { status: next })
    setClient((c) => ({ ...c, ...row }))
    toast.success(t('common.saved'))
  }

  const cancelDelete = () => {
    if (deletingClient) return
    setConfirmingDelete(false)
  }

  const confirmDelete = async () => {
    setDeletingClient(true)
    try {
      await api.deleteClient(clientId)
      toast.success(t('common.saved'))
      navigate('/clients')
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
      setDeletingClient(false)
    }
  }

  if (loading) return <PageLoader label={t('common.loading')} />
  if (!client) return <EmptyState icon={FolderOpen} title={t('common.error')} />

  const years = Array.from({ length: 6 }, (_, i) => currentTaxYear() + 1 - i)

  return (
    <div className="space-y-6">
      <Link
        to="/clients"
        className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {t('specialist.backToClients')}
      </Link>

      <header className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{t('specialist.client')}</p>
            <h1 className="display mt-1 text-[30px] leading-tight sm:text-[36px]">
              {fullName(client) || client.email}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14.5px] text-ink-500">
              <a className="inline-flex items-center gap-1.5 hover:text-gold-700" href={`mailto:${client.email}`}>
                <Mail size={15} aria-hidden="true" />
                {client.email}
              </a>
              {client.phone ? (
                <a className="inline-flex items-center gap-1.5 hover:text-gold-700" href={`tel:${client.phone}`}>
                  <Phone size={15} aria-hidden="true" />
                  {client.phone}
                </a>
              ) : null}
              {client.canton ? <span>· {client.canton}</span> : null}
              <span>· {t('specialist.createdOn', { date: formatDate(client.created_at, lang) })}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {client.status === 'invited' ? (
              <button type="button" className="btn-secondary btn-sm" onClick={resendInvite} disabled={resending}>
                {resending ? <Spinner size={15} /> : <RefreshCw size={15} aria-hidden="true" />}
                {t('specialist.resendInvite')}
              </button>
            ) : null}
            <button type="button" className="btn-secondary btn-sm" onClick={toggleArchive}>
              <Archive size={15} aria-hidden="true" />
              {client.status === 'archived' ? t('specialist.unarchive') : t('specialist.archive')}
            </button>
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={15} aria-hidden="true" />
              {t('specialist.deleteClient')}
            </button>
          </div>
        </div>

        {client.status === 'invited' ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-3.5 py-2 text-[14px] text-amber-900">
            {t('specialist.invited')}
          </p>
        ) : null}
      </header>

      <nav className="flex gap-1 border-b border-line" aria-label="Sections">
        {[
          ['years', t('specialist.years')],
          ['questionnaire', t('specialist.questionnaire')],
          ['notes', t('case.internalNotes')]
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[15px] font-medium transition ${
              tab === key
                ? 'border-gold-600 text-gold-800'
                : 'border-transparent text-ink-500 hover:text-ink-800'
            }`}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'years' ? (
        <section className="space-y-4">
          <div className="card flex flex-wrap items-end gap-3 p-4">
            <Field label={t('specialist.addYear')} htmlFor="new-year" className="w-[150px]">
              <Select id="new-year" value={newYear} onChange={(e) => setNewYear(e.target.value)}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </Field>
            <button type="button" className="btn-primary" onClick={addYear} disabled={addingYear}>
              {addingYear ? <Spinner size={17} /> : <CalendarPlus size={17} aria-hidden="true" />}
              {t('common.add')}
            </button>
          </div>

          {cases.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cases.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/year/${c.id}`}
                    className="card group flex h-full flex-col gap-3 px-5 py-4 transition hover:border-gold-300 hover:shadow-lift"
                  >
                    <div className="flex items-center justify-between">
                      <span className="display text-2xl text-ink-900">{c.tax_year}</span>
                      <StatusBadge status={c.status} size="sm" />
                    </div>
                    <p className="text-[13.5px] text-ink-400">
                      {t('home.documentsUploaded', { count: c.client_documents ?? 0 })} ·{' '}
                      {t('home.documentsFromUs', { count: c.specialist_documents ?? 0 })}
                    </p>
                    <span className="mt-auto inline-flex items-center gap-1 text-[14px] font-medium text-gold-700">
                      {t('specialist.openFile')}
                      <ArrowRight size={15} className="transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={FolderOpen} title={t('specialist.noYears')} />
          )}
        </section>
      ) : null}

      {tab === 'questionnaire' ? (
        <section>
          <p className="section-sub mb-4">{t('specialist.questionnaireHelp')}</p>
          <QuestionnaireForm clientId={clientId} />
        </section>
      ) : null}

      {tab === 'notes' ? (
        <section className="card card-pad">
          <h2 className="section-title text-xl">{t('specialist.internalNotes')}</h2>
          <p className="section-sub mb-4">{t('case.internalNotesHelp')}</p>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={8} />
          <div className="mt-3 flex justify-end">
            <button type="button" className="btn-primary btn-sm" onClick={saveNotes} disabled={savingNotes}>
              <Save size={16} aria-hidden="true" />
              {savingNotes ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </section>
      ) : null}

      <Modal
        open={confirmingDelete}
        onClose={cancelDelete}
        title={t('specialist.deleteClientConfirm')}
        description={t('specialist.deleteClientConfirmBody', { name: fullName(client) || client.email })}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={cancelDelete}
              disabled={deletingClient}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={confirmDelete}
              disabled={deletingClient}
            >
              {deletingClient ? <Spinner size={16} /> : <Trash2 size={16} aria-hidden="true" />}
              {deletingClient ? t('common.deleting') : t('common.delete')}
            </button>
          </>
        }
      />
    </div>
  )
}
