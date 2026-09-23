import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { UserPlus, MailCheck, FlaskConical } from 'lucide-react'
import Brand from '../components/Brand'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { PlainLayout } from '../components/Layout'
import { Field, Spinner, TextInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n'
import { IS_DEMO } from '../lib/config'
import { supabase } from '../lib/supabaseClient'

export default function Register() {
  const { t } = useI18n()
  const { profile, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [emailInUse, setEmailInUse] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)

  if (!loading && profile) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setEmailInUse(false)
    if (password.length < 8) return setError(t('auth.passwordTooShort'))
    if (password !== repeat) return setError(t('auth.passwordMismatch'))

    setBusy(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/login` }
      })
      if (signUpError) {
        if (/registered|exists/i.test(signUpError.message)) {
          setEmailInUse(true)
        } else {
          setError(signUpError.message || t('common.error'))
        }
        return
      }
      // Supabase returns a user with no identities (and no error) when the
      // e-mail is already registered and confirmed.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setEmailInUse(true)
        return
      }
      setCheckEmail(true)
    } catch (err) {
      console.error(err)
      setError(err.message || t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PlainLayout>
      <div className="w-full max-w-[26rem]">
        <div className="mb-5 flex items-center justify-between">
          <Brand size="lg" showTagline={false} />
          <LanguageSwitcher compact />
        </div>

        <div className="card card-pad">
          <h1 className="display text-[26px] leading-tight">{t('auth.registerTitle')}</h1>
          <p className="mt-1 text-[15px] text-ink-500">{t('auth.registerSubtitle')}</p>

          {IS_DEMO ? (
            <div className="mt-6 flex gap-3 rounded-xl bg-sand px-4 py-3.5">
              <FlaskConical size={18} className="mt-0.5 shrink-0 text-gold-600" aria-hidden="true" />
              <div>
                <p className="text-[14px] font-semibold text-ink-700">{t('auth.registerDemoNotice')}</p>
                <Link to="/login" className="link mt-2 inline-block text-[14px]">
                  {t('auth.signIn')}
                </Link>
              </div>
            </div>
          ) : checkEmail ? (
            <div className="mt-6 flex gap-3 rounded-xl bg-emerald-50 px-4 py-3.5">
              <MailCheck size={18} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" />
              <div>
                <p className="text-[14px] font-semibold text-emerald-900">{t('auth.registerCheckEmail')}</p>
                <Link to="/login" className="link mt-2 inline-block text-[14px]">
                  {t('auth.signIn')}
                </Link>
              </div>
            </div>
          ) : (
            <>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <Field label={t('auth.email')} htmlFor="reg-email">
                  <TextInput
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.ch"
                  />
                </Field>
                <Field label={t('auth.password')} htmlFor="reg-password">
                  <TextInput
                    id="reg-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Field label={t('auth.repeatPassword')} htmlFor="reg-password2">
                  <TextInput
                    id="reg-password2"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                  />
                </Field>

                {error ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800" role="alert">
                    {error}
                  </p>
                ) : null}

                {emailInUse ? (
                  <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-[14px] text-amber-900" role="alert">
                    <p>{t('auth.emailInUse')}</p>
                    <p className="mt-1.5 flex flex-wrap gap-x-3">
                      <Link to="/login" className="link">
                        {t('auth.signIn')}
                      </Link>
                    </p>
                  </div>
                ) : null}

                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy ? <Spinner size={18} /> : <UserPlus size={18} aria-hidden="true" />}
                  {t('auth.createAccess')}
                </button>
              </form>

              <div className="mt-4 text-center">
                <Link to="/login" className="link text-[14px]">
                  {t('auth.signIn')}
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="mt-5 text-center text-[13px] text-ink-400">{t('common.confidential')}</p>
      </div>
    </PlainLayout>
  )
}
