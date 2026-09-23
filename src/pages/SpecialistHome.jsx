import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Clock, FolderOpen, Search, UserPlus, Users
} from 'lucide-react'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import { EmptyState, Field, PageLoader, Select, Spinner, Stat, TextInput } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { currentTaxYear } from '../lib/config'
import { CASE_STATUSES, CANTONS, LANGUAGES } from '../lib/constants'
import { formatDate, fullName } from '../lib/format'

const emptyForm = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  preferred_language: 'en',
  canton: ''
}

const PAGE_SIZE = 10

export default function SpecialistHome() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const year = currentTaxYear()

  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState([])
  const [stats, setStats] = useState(null)
  const [query, setQuery] = useState('')
  // Defaults to "All" — a client with no case for the current tax year (e.g.
  // just invited, or only worked on in a previous year) must not disappear
  // from the list until the specialist actively filters for a year.
  const [yearFilter, setYearFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const [rows, kpi] = await Promise.all([
      api.listClients({
        q: query,
        year: yearFilter || null,
        status: statusFilter || null
      }),
      api.getStats(year)
    ])
    setClients(rows)
    setStats(kpi)
    setLoading(false)
  }, [query, yearFilter, statusFilter, year])

  useEffect(() => {
    const timer = setTimeout(load, 180)
    return () => clearTimeout(timer)
  }, [load])

  // Any filter change invalidates the current page — go back to the top.
  useEffect(() => {
    setPage(1)
  }, [query, yearFilter, statusFilter])

  const totalPages = Math.max(1, Math.ceil(clients.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageClients = clients.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const createClient = async (e) => {
    e.preventDefault()
    setCreating(true)
    try {
      const result = await api.createClient(form)
      setModalOpen(false)
      setForm(emptyForm)
      await load()
      if (result.emailSent) toast.success(t('specialist.inviteSent', { email: form.email }))
      else toast.info(t('specialist.inviteFailed'))
    } catch (error) {
      console.error(error)
      toast.error(
        error.message === 'CLIENT_EXISTS' || error.code === 'CLIENT_EXISTS'
          ? t('specialist.clientExists')
          : error.message || t('common.error')
      )
    } finally {
      setCreating(false)
    }
  }

  const years = Array.from({ length: 5 }, (_, i) => year - i)

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t('specialist.dashboard')}</p>
          <h1 className="display mt-1 text-[32px] leading-tight sm:text-[38px]">
            {t('specialist.clients')}
          </h1>
        </div>
        <button type="button" className="btn-primary" onClick={() => setModalOpen(true)}>
          <UserPlus size={18} aria-hidden="true" />
          {t('specialist.newClient')}
        </button>
      </header>

      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t('specialist.kpiOpen')} value={stats.open} icon={FolderOpen} tone="gold" />
          <Stat label={t('specialist.kpiWaiting')} value={stats.waiting} icon={Clock} tone="amber" />
          <Stat label={t('specialist.kpiFinished', { year })} value={stats.finished} icon={CheckCircle2} tone="emerald" />
          <Stat label={t('specialist.kpiClients')} value={stats.clients} icon={Users} />
        </div>
      ) : null}

      <section className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <Field label={t('common.search')} htmlFor="search" className="min-w-[200px] flex-1">
            <div className="relative">
              <Search
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300"
                aria-hidden="true"
              />
              <TextInput
                id="search"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('specialist.searchPlaceholder')}
              />
            </div>
          </Field>

          <Field label={t('specialist.filterYear')} htmlFor="year-filter" className="w-[130px]">
            <Select id="year-filter" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('specialist.filterStatus')} htmlFor="status-filter" className="w-[190px]">
            <Select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {CASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {loading ? (
          <PageLoader label={t('common.loading')} />
        ) : clients.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-sand">
                <tr>
                  <th className="table-head">{t('specialist.client')}</th>
                  <th className="table-head">{t('specialist.year')}</th>
                  <th className="table-head">{t('status.label')}</th>
                  <th className="table-head">{t('specialist.updated')}</th>
                  <th className="table-head" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pageClients.map((client) => {
                  const latest = client.latest_case
                  return (
                    <tr key={client.id} className="transition hover:bg-sand/60">
                      <td className="table-cell">
                        <Link to={`/clients/${client.id}`} className="font-medium text-ink-900 hover:text-gold-700">
                          {fullName(client) || client.email}
                        </Link>
                        <p className="text-[13px] text-ink-400">{client.email}</p>
                        {client.status === 'invited' ? (
                          <span className="chip mt-1 bg-ink-100 text-ink-600 ring-ink-200">
                            {t('specialist.invited')}
                          </span>
                        ) : null}
                      </td>
                      <td className="table-cell tabular-nums text-ink-700">{latest?.tax_year || '—'}</td>
                      <td className="table-cell">
                        {latest ? <StatusBadge status={latest.status} size="sm" /> : <span className="text-ink-300">—</span>}
                      </td>
                      <td className="table-cell text-[14px] text-ink-500">
                        {formatDate(client.updated_at, lang)}
                      </td>
                      <td className="table-cell text-right">
                        <Link to={`/clients/${client.id}`} className="btn-ghost btn-sm">
                          {t('specialist.openFile')}
                          <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {!loading && clients.length > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
            <p className="text-[13.5px] text-ink-400">
              {t('specialist.pageOf', { page: currentPage, pages: totalPages })}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                {t('common.previous')}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
              >
                {t('common.next')}
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        {!loading && !clients.length ? (
          <div className="p-6">
            <EmptyState icon={Users} title={t('specialist.noClients')} />
          </div>
        ) : null}
      </section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('specialist.inviteClient')}
        description={t('specialist.inviteHelp')}
        footer={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="new-client" className="btn-primary btn-sm" disabled={creating}>
              {creating ? <Spinner size={16} /> : <UserPlus size={16} aria-hidden="true" />}
              {t('specialist.createAndInvite')}
            </button>
          </>
        }
      >
        <form id="new-client" onSubmit={createClient} className="grid gap-4 sm:grid-cols-2">
          <Field label={t('specialist.firstName')} htmlFor="c-first" required>
            <TextInput
              id="c-first"
              required
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            />
          </Field>
          <Field label={t('specialist.lastName')} htmlFor="c-last" required>
            <TextInput
              id="c-last"
              required
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            />
          </Field>
          <Field label={t('specialist.email')} htmlFor="c-email" required className="sm:col-span-2">
            <TextInput
              id="c-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label={t('specialist.phone')} htmlFor="c-phone">
            <TextInput
              id="c-phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label={t('specialist.canton')} htmlFor="c-canton">
            <Select
              id="c-canton"
              value={form.canton}
              onChange={(e) => setForm({ ...form, canton: e.target.value })}
            >
              <option value="">{t('common.none')}</option>
              {CANTONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('specialist.language')} htmlFor="c-lang" className="sm:col-span-2">
            <Select
              id="c-lang"
              value={form.preferred_language}
              onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </Modal>
    </div>
  )
}
