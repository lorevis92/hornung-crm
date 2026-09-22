import QuestionnaireForm from '../components/QuestionnaireForm'
import { EmptyState } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n'
import { UserRound } from 'lucide-react'

export default function MyData() {
  const { t } = useI18n()
  const { client, refreshClient } = useAuth()

  if (!client) {
    return <EmptyState icon={UserRound} title={t('common.error')} description={t('auth.inviteOnlyHelp')} />
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">{t('common.portal')}</p>
        <h1 className="display mt-1 text-[32px] leading-tight sm:text-[38px]">{t('data.title')}</h1>
        <p className="mt-1 max-w-2xl text-[16px] text-ink-500">{t('data.subtitle')}</p>
      </header>

      <QuestionnaireForm clientId={client.id} onSaved={refreshClient} />
    </div>
  )
}
