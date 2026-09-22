import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { EmptyState } from '../components/ui'
import { useI18n } from '../i18n'
import { useAuth } from '../context/AuthContext'

export default function NotFound() {
  const { t } = useI18n()
  const { isStaff } = useAuth()

  return (
    <EmptyState
      icon={Compass}
      title="404"
      description={t('common.error')}
      action={
        <Link to={isStaff ? '/clients' : '/'} className="btn-primary btn-sm">
          {t('nav.home')}
        </Link>
      }
    />
  )
}
