import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock, FileCheck2, FolderOpen, Mail, Phone, Upload } from 'lucide-react'
import StatusBadge from '../components/StatusBadge'
import StatusStepper from '../components/StatusStepper'
import { EmptyState, PageLoader } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { CONTACT, currentTaxYear } from '../lib/config'
import { formatDate } from '../lib/format'

export default function ClientHome() {
  const { t, lang } = useI18n()
  const { client, profile } = useAuth()
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (!client?.id) {
      setLoading(false)
      return undefined
    }
    api
      .listCases(client.id)
      .then((rows) => active && setCases(rows))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [client?.id])

  const year = currentTaxYear()

  // Feature whichever case the client last actually opened (see CasePage.jsx,
  // which records this on every visit), falling back to the current tax
  // year — or the first case at all — if they haven't opened one yet.
  const lastCaseId = useMemo(() => {
    if (!client?.id) return null
    try {
      return localStorage.getItem(`hornung.lastCase.${client.id}`)
    } catch {
      return null
    }
  }, [client?.id])

  const current = useMemo(() => {
    const lastVisited = lastCaseId && cases.find((c) => c.id === lastCaseId)
    return lastVisited || cases.find((c) => c.tax_year === year) || cases[0] || null
  }, [cases, year, lastCaseId])

  const previous = useMemo(
    () => cases.filter((c) => c.id !== current?.id),
    [cases, current]
  )

  const firstName = client?.first_name || profile?.full_name?.split(' ')[0] || ''

  if (loading) return <PageLoader label={t('common.loading')} />

  return (
    <div className="space-y-9">
      <header>
        <p className="eyebrow">{t('common.portal')}</p>
        <h1 className="display mt-1 text-[34px] leading-tight sm:text-[40px]">
          {t('home.greeting', { name: firstName })}
        </h1>
        <p className="mt-1 text-[16px] text-ink-500">{t('home.subtitle')}</p>
      </header>

      {current ? (
        <section className="card overflow-hidden">
          <div className="border-b border-line bg-gradient-to-br from-gold-50 to-white px-5 py-6 sm:px-8 sm:py-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="eyebrow">{t('home.currentYearHelp')}</p>
                <h2 className="display mt-1 text-[32px] leading-none sm:text-[38px]">
                  {t('home.currentYear', { year: current.tax_year })}
                </h2>
                <div className="mt-3">
                  <StatusBadge status={current.status} />
                </div>
              </div>
              <Link to={`/year/${current.id}`} className="btn-primary">
                {current.status === 'finished' ? t('home.openCase') : t('home.continue')}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-6 max-w-2xl">
              <StatusStepper status={current.status} />
            </div>
          </div>

          <div className="px-5 py-5 sm:px-8">
            <p className="text-[15px] leading-relaxed text-ink-600">
              {t(`status.desc.${current.status}`)}
            </p>

            {current.status === 'waiting_client' && current.client_message ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-amber-800">
                  {t('case.messageFromUs')}
                </p>
                <p className="mt-1 text-[15px] leading-relaxed text-amber-900">
                  {current.client_message}
                </p>
              </div>
            ) : null}

            <dl className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-sand px-4 py-3">
                <dt className="flex items-center gap-1.5 text-[13px] text-ink-400">
                  <Upload size={14} aria-hidden="true" /> {t('case.yourDocuments')}
                </dt>
                <dd className="mt-0.5 text-[15px] font-semibold text-ink-800">
                  {t('home.documentsUploaded', { count: current.client_documents ?? 0 })}
                </dd>
              </div>
              <div className="rounded-xl bg-sand px-4 py-3">
                <dt className="flex items-center gap-1.5 text-[13px] text-ink-400">
                  <FileCheck2 size={14} aria-hidden="true" /> {t('case.fromSpecialist')}
                </dt>
                <dd className="mt-0.5 text-[15px] font-semibold text-ink-800">
                  {t('home.documentsFromUs', { count: current.specialist_documents ?? 0 })}
                </dd>
              </div>
              <div className="rounded-xl bg-sand px-4 py-3">
                <dt className="flex items-center gap-1.5 text-[13px] text-ink-400">
                  <CalendarClock size={14} aria-hidden="true" /> {t('home.deadline')}
                </dt>
                <dd className="mt-0.5 text-[15px] font-semibold text-ink-800">
                  {current.due_date ? formatDate(current.due_date, lang) : t('common.none')}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      ) : (
        <EmptyState
          icon={FolderOpen}
          title={t('home.noCases')}
          description={t('home.noCasesHelp')}
        />
      )}

      <section>
        <h2 className="section-title mb-4 text-xl">{t('home.previousYears')}</h2>
        {previous.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {previous.map((c) => (
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
                    {t('home.openCase')}
                    <ArrowRight
                      size={15}
                      className="transition group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line bg-white px-5 py-6 text-[15px] text-ink-400">
            {t('home.noPreviousYears')}
          </p>
        )}
      </section>

      <section className="card card-pad bg-gradient-to-br from-white to-gold-50">
        <h2 className="display text-xl">{t('home.needHelp')}</h2>
        <p className="mt-1 text-[15px] text-ink-500">{t('home.needHelpText')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="btn-secondary btn-sm" href={`mailto:${CONTACT.email}`}>
            <Mail size={16} aria-hidden="true" />
            {CONTACT.email}
          </a>
          <a className="btn-secondary btn-sm" href={`tel:${CONTACT.phone.replace(/\s/g, '')}`}>
            <Phone size={16} aria-hidden="true" />
            {CONTACT.phone}
          </a>
        </div>
      </section>
    </div>
  )
}
