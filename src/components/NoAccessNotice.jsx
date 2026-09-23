import { ShieldAlert } from 'lucide-react'
import Brand from './Brand'
import { useI18n } from '../i18n'
import { CONTACT } from '../lib/config'

// Shown whenever a real, authenticated session has no app_profiles row in
// this app — after App.jsx's Protected routes (access === 'no-profile'), and
// after a login/registration on Login.jsx / Register.jsx that ends up in the
// same state. Kept as one component so the message is never duplicated.
export default function NoAccessNotice({ onSignOut }) {
  const { t } = useI18n()
  return (
    <div className="card card-pad w-full max-w-md text-center">
      <div className="mb-4 flex justify-center">
        <Brand size="lg" showTagline={false} />
      </div>
      <ShieldAlert size={28} className="mx-auto mb-3 text-gold-600" aria-hidden="true" />
      <h1 className="display text-2xl">{t('auth.noAccessTitle')}</h1>
      <p className="mt-2 text-[15px] text-ink-500">
        {t('auth.noAccessBody')}{' '}
        <a className="link" href={`mailto:${CONTACT.email}`}>
          {CONTACT.email}
        </a>
        .
      </p>
      {onSignOut ? (
        <button type="button" onClick={onSignOut} className="btn-secondary mt-6 w-full">
          {t('common.logout')}
        </button>
      ) : null}
    </div>
  )
}
