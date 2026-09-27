import { useState } from 'react'
import { AlertTriangle, Copy, Pencil, Search } from 'lucide-react'
import clsx from 'clsx'
import { EmptyState, Field, PageLoader, Spinner, TextInput } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { currentTaxYear } from '../lib/config'
import { formatChfSwiss, formatDateTime } from '../lib/format'

// Plain-text rendering of the dump — built for pasting into a chat/ticket,
// not just for on-screen reading. Kept in lockstep with the on-screen
// sections below: same fields, same order, nothing summarized differently
// in one place vs the other.
function buildDiagnosticText(data) {
  const lines = []
  const push = (s = '') => lines.push(s)

  push(`DIAGNOSTIC DUMP — ${data.client.email} — tax year ${data.taxYear}`)
  push(`Generated: ${data.generatedAt}`)
  push('')
  push('CLIENT')
  push(`  ${data.client.firstName || ''} ${data.client.lastName || ''} <${data.client.email}>`)
  push(`  canton: ${data.client.canton || '—'} · status: ${data.client.status}`)
  push('')
  push(`PERSONS (${data.persons.length})`)
  data.persons.forEach((p) => {
    push(`  [${p.personType}] ${p.firstName || ''} ${p.lastName || ''}`)
    push(`      marital_status: ${p.maritalStatus || '—'} · date_of_birth: ${p.dateOfBirth || '—'} · work_percentage: ${p.workPercentage ?? '—'}`)
  })
  push('')
  push(`CHILDREN (${data.children.length})`)
  data.children.forEach((c) => {
    push(`  ${c.fullName || '—'} — date_of_birth: ${c.dateOfBirth || '—'} · until_when: ${c.untilWhen || '—'}`)
  })
  push('')
  push(`DOCUMENTS (${data.documents.length})`)
  data.documents.forEach((doc, i) => {
    push(`  [${i + 1}] ${doc.fileName} — ${doc.categoryLabel || 'uncategorized'} (${doc.status})`)
    doc.fields.forEach((f) => {
      const touched = f.handEditedBySpecialist ? `HAND-EDITED on ${f.verifiedAt || '?'}` : 'original extraction'
      const included = f.includedInCalculation ? '' : ' [EXCLUDED from calculation]'
      push(`      ${f.fieldLabel}: ${f.value ?? '—'}  — ${touched}${included}`)
    })
  })
  push('')
  if (data.aggregate) {
    push(`AGGREGATE — computed ${data.aggregate.computedAt} (status: ${data.aggregate.status})`)
    push(`  taxable_income_cantonal: ${data.aggregate.taxableIncomeCantonal}`)
    push(`  taxable_wealth_cantonal: ${data.aggregate.taxableWealthCantonal}`)
    push(`  taxable_income_federal: ${data.aggregate.taxableIncomeFederal}`)
    if (data.aggregate.uncertainParameters.length) {
      push('  uncertain_parameters:')
      data.aggregate.uncertainParameters.forEach((p) => push(`    - ${p}`))
    }
  } else {
    push('AGGREGATE — none computed yet for this client/year')
  }
  push('')
  push(`COMPONENTS (${data.components.length})`)
  data.components.forEach((c) => {
    push(
      `  [${c.componentType}/${c.sectionKey || '—'}] ${c.amount}${c.currencyCode ? ` ${c.currencyCode}` : ' CHF'}` +
        ` — ${c.includedInTotal ? 'included' : 'EXCLUDED (needs verification)'} — ${c.fieldLabel || c.label} — from ${c.sourceDocument || '—'}`
    )
  })
  push('')
  push(`HAND-EDITED FIELDS (${data.handEditedFields.length}) — everything a specialist manually touched`)
  data.handEditedFields.forEach((f) => {
    push(`  ${f.category} — ${f.document} — ${f.field}: ${f.value ?? '—'} (verified ${f.verifiedAt || '?'})`)
  })

  return lines.join('\n')
}

export default function Diagnostics() {
  const { t } = useI18n()
  const toast = useToast()

  const [email, setEmail] = useState('')
  const [taxYear, setTaxYear] = useState(String(currentTaxYear()))
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const run = async (e) => {
    e.preventDefault()
    if (!email.trim() || !taxYear) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const result = await api.diagnoseClient({ email: email.trim(), taxYear: Number(taxYear) })
      setData(result)
    } catch (err) {
      console.error(err)
      setError(err.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  const copyText = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(buildDiagnosticText(data))
      toast.success(t('diagnostics.copied'))
    } catch (err) {
      console.error(err)
      toast.error(t('common.error'))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{t('diagnostics.eyebrow')}</p>
        <h1 className="display mt-1 text-[30px] leading-tight sm:text-[36px]">{t('diagnostics.title')}</h1>
        <p className="mt-1 text-[14.5px] text-ink-500">{t('diagnostics.subtitle')}</p>
      </div>

      <form onSubmit={run} className="card card-pad flex flex-wrap items-end gap-3">
        <Field label={t('diagnostics.emailLabel')} htmlFor="diag-email" className="min-w-[240px] flex-1">
          <TextInput
            id="diag-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="client@example.com"
            required
          />
        </Field>
        <Field label={t('diagnostics.yearLabel')} htmlFor="diag-year" className="w-[120px]">
          <TextInput
            id="diag-year"
            type="number"
            value={taxYear}
            onChange={(e) => setTaxYear(e.target.value)}
            required
          />
        </Field>
        <button type="submit" className="btn-primary btn-sm" disabled={loading}>
          {loading ? <Spinner size={16} /> : <Search size={16} aria-hidden="true" />}
          {t('diagnostics.run')}
        </button>
      </form>

      {loading ? <PageLoader label={t('common.loading')} /> : null}

      {error ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-[14px] text-amber-900">{error}</div>
      ) : null}

      {data ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-ink-400">{t('diagnostics.generatedAt', { date: formatDateTime(data.generatedAt) })}</p>
            <button type="button" className="btn-secondary btn-sm" onClick={copyText}>
              <Copy size={15} aria-hidden="true" />
              {t('diagnostics.copyAsText')}
            </button>
          </div>

          <section className="card card-pad space-y-2">
            <h2 className="section-title text-lg">{t('diagnostics.sectionClient')}</h2>
            <p className="text-[14.5px] text-ink-900">
              {data.client.firstName} {data.client.lastName} — {data.client.email}
            </p>
            <p className="text-[13.5px] text-ink-500">
              {t('diagnostics.canton')}: <span className="text-ink-900">{data.client.canton || '—'}</span> · {t('diagnostics.status')}:{' '}
              <span className="text-ink-900">{data.client.status}</span>
            </p>
            <div className="mt-2 space-y-1">
              {data.persons.map((p, i) => (
                <p key={i} className="text-[13.5px] text-ink-700">
                  <span className="font-medium">[{p.personType}]</span> {p.firstName} {p.lastName} —{' '}
                  {t('diagnostics.maritalStatus')}: <span className="text-ink-900">{p.maritalStatus || '—'}</span> ·{' '}
                  {t('diagnostics.workPercentage')}: <span className="text-ink-900">{p.workPercentage ?? '—'}</span>
                </p>
              ))}
              {data.children.map((c, i) => (
                <p key={i} className="text-[13.5px] text-ink-700">
                  <span className="font-medium">[child]</span> {c.fullName} — {t('diagnostics.dateOfBirth')}:{' '}
                  <span className="text-ink-900">{c.dateOfBirth || '—'}</span> · until_when:{' '}
                  <span className="text-ink-900">{c.untilWhen || '—'}</span>
                </p>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-lg">{t('diagnostics.sectionDocuments', { count: data.documents.length })}</h2>
            {data.documents.length ? (
              data.documents.map((doc) => (
                <div key={doc.documentId} className="card overflow-hidden">
                  <p className="border-b border-line bg-sand/50 px-4 py-2 text-[13.5px] font-medium text-ink-700">
                    {doc.fileName} — {doc.categoryLabel || t('diagnostics.uncategorized')}{' '}
                    <span className="text-ink-400">({doc.status})</span>
                  </p>
                  <ul className="divide-y divide-line/70">
                    {doc.fields.map((f) => (
                      <li key={f.fieldKey} className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-[13.5px]">
                        <span>
                          <span className="font-medium text-ink-900">{f.fieldLabel}</span>
                          <span className="text-ink-900">: {f.value ?? '—'}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          {f.handEditedBySpecialist ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                              <Pencil size={10} aria-hidden="true" />
                              {t('diagnostics.handEdited')}
                            </span>
                          ) : (
                            <span className="text-[11.5px] text-ink-400">{t('diagnostics.originalExtraction')}</span>
                          )}
                          {!f.includedInCalculation ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                              <AlertTriangle size={10} aria-hidden="true" />
                              {t('diagnostics.excluded')}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <EmptyState icon={AlertTriangle} title={t('diagnostics.noDocuments')} />
            )}
          </section>

          <section className="card card-pad space-y-2">
            <h2 className="section-title text-lg">{t('diagnostics.sectionAggregate')}</h2>
            {data.aggregate ? (
              <>
                <p className="text-[13px] text-ink-400">
                  {t('diagnostics.computedAt', { date: formatDateTime(data.aggregate.computedAt) })} · status: {data.aggregate.status}
                </p>
                <div className="grid grid-cols-1 gap-2 text-[13.5px] sm:grid-cols-3">
                  <p>
                    {t('summary.taxableIncomeCantonal')}: <span className="font-medium text-ink-900">{formatChfSwiss(data.aggregate.taxableIncomeCantonal)}</span>
                  </p>
                  <p>
                    {t('summary.taxableWealthCantonal')}: <span className="font-medium text-ink-900">{formatChfSwiss(data.aggregate.taxableWealthCantonal)}</span>
                  </p>
                  <p>
                    {t('summary.taxableIncomeFederal')}: <span className="font-medium text-ink-900">{formatChfSwiss(data.aggregate.taxableIncomeFederal)}</span>
                  </p>
                </div>
                {data.aggregate.uncertainParameters.length ? (
                  <div className="mt-2 space-y-1">
                    {data.aggregate.uncertainParameters.map((p, i) => (
                      <p key={i} className="text-[13px] text-amber-800">
                        ⚠ {p}
                      </p>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-[13.5px] text-ink-400">{t('diagnostics.noAggregate')}</p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="section-title text-lg">{t('diagnostics.sectionComponents', { count: data.components.length })}</h2>
            {data.components.length ? (
              <div className="overflow-x-auto rounded-xl border border-line bg-white">
                <table className="w-full text-[13px]">
                  <thead className="bg-sand/60 text-left text-[11px] font-medium uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="px-3 py-2">{t('diagnostics.colType')}</th>
                      <th className="px-3 py-2">{t('diagnostics.colAmount')}</th>
                      <th className="px-3 py-2">{t('diagnostics.colStatus')}</th>
                      <th className="px-3 py-2">{t('diagnostics.colItem')}</th>
                      <th className="px-3 py-2">{t('diagnostics.colSource')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.components.map((c, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-ink-700">
                          {c.componentType}/{c.sectionKey || '—'}
                        </td>
                        <td className="px-3 py-2 font-medium text-ink-900">
                          {c.currencyCode ? `${c.currencyCode} ` : 'CHF '}
                          {c.amount}
                        </td>
                        <td className="px-3 py-2">
                          <span className={clsx(c.includedInTotal ? 'text-emerald-700' : 'text-amber-700')}>
                            {c.includedInTotal ? t('diagnostics.included') : t('diagnostics.excluded')}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-ink-700">{c.fieldLabel || c.label}</td>
                        <td className="px-3 py-2 text-ink-500">{c.sourceDocument || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[13.5px] text-ink-400">{t('diagnostics.noComponents')}</p>
            )}
          </section>

          <section className="card card-pad space-y-2">
            <h2 className="section-title text-lg">{t('diagnostics.sectionHandEdited', { count: data.handEditedFields.length })}</h2>
            {data.handEditedFields.length ? (
              <ul className="space-y-1">
                {data.handEditedFields.map((f, i) => (
                  <li key={i} className="text-[13.5px] text-ink-700">
                    <span className="font-medium text-ink-900">{f.category}</span> — {f.document} —{' '}
                    <span className="text-ink-900">{f.field}</span>: {f.value ?? '—'}{' '}
                    <span className="text-ink-400">({t('diagnostics.verifiedOn', { date: f.verifiedAt ? formatDateTime(f.verifiedAt) : '—' })})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-ink-400">{t('diagnostics.noHandEdits')}</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
