import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useI18n } from '../../i18n'
import { formatDate, fullName } from '../../lib/format'

function Column({ title, children }) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">{title}</p>
      <div className="mt-1 space-y-0.5 text-[14.5px] text-ink-800">{children}</div>
    </div>
  )
}

// The household as the Questionnaire records it — taxpayer, spouse,
// children, properties — shown above the documents so every "refers to"
// below can be read against it. Read-only: changes are made in the
// Questionnaire. `personOrder` is resolvePersonDisplayOrder() (husband first).
export default function HouseholdCard({ clientId, household, properties = [], personOrder }) {
  const { t, lang } = useI18n()
  const { primary, spouse, children } = household
  const kinds = personOrder.ordered.some((o) => o.kind === 'spouse')
    ? personOrder.ordered.map((o) => o.kind)
    : ['primary', 'spouse']
  const none = <p className="text-[13.5px] text-ink-400">{t('common.notProvided')}</p>

  return (
    <section className="card card-pad space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title text-xl">{t('summary.registryTitle')}</h2>
          <p className="section-sub">{t('summary.registryHelp')}</p>
        </div>
        <Link to={`/clients/${clientId}?tab=questionnaire`} className="btn-secondary btn-sm shrink-0">
          {t('summary.registryEdit')}
        </Link>
      </div>

      {!primary ? (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[13.5px] text-red-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('summary.registryEmpty')}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {kinds.map((kind) => {
          const person = kind === 'primary' ? primary : spouse
          return (
            <Column key={kind} title={t(kind === 'primary' ? 'data.taxpayer' : 'data.spouse')}>
              {person ? (
                <>
                  <p className="font-medium">{fullName(person) || t('summary.registryUnnamed')}</p>
                  {person.date_of_birth ? <p className="text-ink-500">{formatDate(person.date_of_birth, lang)}</p> : null}
                  {kind === 'primary' ? (
                    <p className="text-ink-500">
                      {person.marital_status ? t(`marital.${person.marital_status}`) : t('summary.registryUnknown')}
                    </p>
                  ) : null}
                  {kind === 'primary' && person.current_address ? (
                    <p className="text-ink-500">{person.current_address}</p>
                  ) : null}
                </>
              ) : (
                none
              )}
            </Column>
          )
        })}

        <Column title={t('data.children')}>
          {children.length
            ? children.map((c) => (
                <p key={c.id || c.full_name}>
                  {c.full_name || t('summary.registryUnnamed')}
                  {c.date_of_birth ? ` — ${formatDate(c.date_of_birth, lang)}` : ''}
                </p>
              ))
            : none}
        </Column>

        <Column title={t('data.properties')}>
          {properties.length ? properties.map((p) => <p key={p.id || p.address}>{p.address}</p>) : none}
        </Column>
      </div>
    </section>
  )
}
