import { useCallback, useState } from 'react'
import clsx from 'clsx'
import { Receipt, Sparkle } from 'lucide-react'
import { LoadGate } from '../components/LoadState'
import FeeEstimatePanel from '../components/FeeEstimatePanel'
import { useAuth } from '../context/AuthContext'
import { viewerCopy } from '../lib/viewerCopy'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { useLoad } from '../lib/useLoad'
import { currentTaxYear, FEATURES } from '../lib/config'
import { formatChf } from '../lib/format'
import { pricingDescription, pricingLabel } from '../lib/pricing'

function PriceTable({ items, lang, t }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full">
        <thead className="bg-sand">
          <tr>
            <th className="table-head">{t('pricing.service')}</th>
            <th className="table-head text-right">{t('pricing.price')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-white">
          {items.map((item) => (
            <tr key={item.code}>
              <td className="table-cell text-ink-700">
                {pricingLabel(item, lang)}
                {pricingDescription(item, lang) ? (
                  <p className="mt-0.5 text-[12.5px] text-ink-400">{pricingDescription(item, lang)}</p>
                ) : null}
              </td>
              <td className="table-cell whitespace-nowrap text-right font-semibold tabular-nums text-ink-900">
                {item.on_request ? t('pricing.onRequest') : formatChf(item.price, lang)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Pricing() {
  const { t, lang } = useI18n()
  const { client, isStaff } = useAuth()
  // The price list itself is the same for both; only the subtitle spoke of
  // "your tax return" — see src/lib/viewerCopy.js.
  const copy = viewerCopy(isStaff)
  const [pricing, setPricing] = useState([])
  const [questionnaire, setQuestionnaire] = useState(null)
  const [caseRow, setCaseRow] = useState(null)

  const loadState = useLoad(
    useCallback(
      async (isCurrent) => {
        const items = await api.listPricing()
        if (!isCurrent()) return
        setPricing(items)

        if (FEATURES.clientFeeEstimate && client?.id) {
          const [quest, cases] = await Promise.all([
            api.getQuestionnaire(client.id),
            api.listCases(client.id)
          ])
          if (!isCurrent()) return
          setQuestionnaire(quest)
          setCaseRow(cases.find((c) => c.tax_year === currentTaxYear()) || cases[0] || null)
        }
      },
      [client?.id]
    )
  )

  if (loadState.status !== 'ready') return <LoadGate load={loadState} showDetail={isStaff} />

  const base = pricing.filter((p) => ['base', 'per_unit', 'tier'].includes(p.kind))
  const surcharges = pricing.filter((p) => p.kind === 'surcharge')
  const services = pricing.filter((p) => p.kind === 'service')
  const showEstimate = FEATURES.clientFeeEstimate && !isStaff && questionnaire

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">{t('common.appName')}</p>
        <h1 className="display mt-1 text-[32px] leading-tight sm:text-[38px]">{t('pricing.title')}</h1>
        <p className="mt-1 max-w-2xl text-[16px] text-ink-500">{t(copy.pricingSubtitle)}</p>
      </header>

      <div className={clsx('grid gap-6', showEstimate && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
        <div className="space-y-6">
          <section className="card card-pad">
            <div className="mb-4 flex items-start gap-2.5">
              <Receipt size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
              <h2 className="section-title text-xl">{t('pricing.base')}</h2>
            </div>
            <PriceTable items={base} lang={lang} t={t} />
          </section>

          <section className="card card-pad">
            <h2 className="section-title mb-4 text-xl">{t('pricing.surcharges')}</h2>
            <PriceTable items={surcharges} lang={lang} t={t} />
          </section>

          <section className="card card-pad">
            <div className="mb-4 flex items-start gap-2.5">
              <Sparkle size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
              <h2 className="section-title text-xl">{t('pricing.furtherServices')}</h2>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {services.map((item) => (
                <li
                  key={item.code}
                  className="flex items-center justify-between gap-3 rounded-xl bg-sand px-4 py-3 text-[15px]"
                >
                  <span className="text-ink-700">
                    {pricingLabel(item, lang)}
                    {pricingDescription(item, lang) ? (
                      <p className="mt-0.5 text-[12.5px] font-normal text-ink-400">{pricingDescription(item, lang)}</p>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[13px] font-medium uppercase tracking-wide text-gold-700">
                    {item.on_request ? t('pricing.onRequest') : formatChf(item.price, lang)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {showEstimate ? (
          <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
            <p className="eyebrow">{t('pricing.yourEstimate')}</p>
            <FeeEstimatePanel
              pricing={pricing}
              questionnaire={questionnaire}
              caseRow={caseRow}
              compact
            />
            <p className="hint">
              {t('pricing.estimateHelp', { year: caseRow?.tax_year || currentTaxYear() })}
            </p>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
