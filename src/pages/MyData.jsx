import { useState } from 'react'
import { MapPin, Save, UserRound } from 'lucide-react'
import QuestionnaireForm from '../components/QuestionnaireForm'
import { EmptyState, Field, Select, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { CANTONS } from '../lib/constants'

export default function MyData() {
  const { t } = useI18n()
  const toast = useToast()
  const { client, refreshClient, updateMyCanton } = useAuth()
  const [canton, setCanton] = useState(client?.canton || '')
  const [savingCanton, setSavingCanton] = useState(false)

  if (!client) {
    return <EmptyState icon={UserRound} title={t('common.error')} description={t('auth.inviteOnlyHelp')} />
  }

  const submitCanton = async (e) => {
    e.preventDefault()
    setSavingCanton(true)
    try {
      await updateMyCanton(canton || null)
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setSavingCanton(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">{t('common.portal')}</p>
        <h1 className="display mt-1 text-[32px] leading-tight sm:text-[38px]">{t('data.title')}</h1>
        <p className="mt-1 max-w-2xl text-[16px] text-ink-500">{t('data.subtitle')}</p>
      </header>

      <section className="card card-pad">
        <div className="mb-4 flex items-start gap-2.5">
          <MapPin size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
          <div>
            <h2 className="section-title text-xl">{t('data.cantonTitle')}</h2>
            <p className="section-sub">{t('data.cantonHelp')}</p>
          </div>
        </div>
        <form onSubmit={submitCanton} className="flex flex-wrap items-end gap-4">
          <Field label={t('data.f.canton')} htmlFor="my-canton" className="w-[260px]">
            <Select id="my-canton" value={canton} onChange={(e) => setCanton(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {CANTONS.map((c) => (
                <option key={c} value={c}>
                  {t(`canton.${c}`)} ({c})
                </option>
              ))}
            </Select>
          </Field>
          <button type="submit" className="btn-primary" disabled={savingCanton}>
            {savingCanton ? <Spinner size={18} /> : <Save size={18} aria-hidden="true" />}
            {savingCanton ? t('common.saving') : t('common.save')}
          </button>
        </form>
      </section>

      <QuestionnaireForm clientId={client.id} client={client} onSaved={refreshClient} />
    </div>
  )
}
