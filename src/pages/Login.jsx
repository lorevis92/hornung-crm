import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LogIn, Mail, ArrowLeft, UserRound, Briefcase, UserPlus } from 'lucide-react'
import Brand from '../components/Brand'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { PlainLayout } from '../components/Layout'
import { Field, Spinner, TextInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { IS_DEMO } from '../lib/config'

export default function Login() {
  const { t } = useI18n()
  const toast = useToast()
  const { profile, loading, signIn, signInDemo, sendResetEmail } = useAuth()
  const [mode, setMode] = useState('signin') // signin | reset
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!loading && profile) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'reset') {
        await sendResetEmail(email)
        toast.success(t('auth.resetSent'))
        setMode('signin')
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      console.error(err)
      setError(mode === 'reset' ? err.message : t('auth.wrongCredentials'))
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
          <h1 className="display text-[26px] leading-tight">
            {mode === 'reset' ? t('auth.forgot') : t('auth.signIn')}
          </h1>
          <p className="mt-1 text-[15px] text-ink-500">
            {mode === 'reset' ? t('auth.resetSent') : t('auth.signInSubtitle')}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label={t('auth.email')} htmlFor="email">
              <TextInput
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.ch"
              />
            </Field>

            {mode === 'signin' ? (
              <Field label={t('auth.password')} htmlFor="password">
                <TextInput
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            ) : null}

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? <Spinner size={18} /> : mode === 'reset' ? <Mail size={18} /> : <LogIn size={18} />}
              {mode === 'reset' ? t('auth.sendReset') : t('auth.signInBtn')}
            </button>
          </form>

          <div className="mt-4 text-center">
            {mode === 'signin' ? (
              <button type="button" className="link text-[14px]" onClick={() => setMode('reset')}>
                {t('auth.forgot')}
              </button>
            ) : (
              <button
                type="button"
                className="link inline-flex items-center gap-1 text-[14px]"
                onClick={() => setMode('signin')}
              >
                <ArrowLeft size={14} /> {t('auth.signIn')}
              </button>
            )}
          </div>

          {!IS_DEMO ? (
            <div className="mt-6 rounded-xl bg-sand px-4 py-3.5">
              <p className="text-[14px] font-semibold text-ink-700">{t('auth.newClientPrompt')}</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-500">
                {t('auth.newClientPromptHelp')}
              </p>
              <Link to="/register" className="btn-secondary btn-sm mt-3">
                <UserPlus size={16} aria-hidden="true" />
                {t('auth.createAccess')}
              </Link>
            </div>
          ) : null}

          {IS_DEMO ? (
            <div className="mt-5 border-t border-line pt-5">
              <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-400">
                {t('auth.demoTitle')}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" className="btn-secondary" onClick={() => signInDemo('client')}>
                  <UserRound size={17} aria-hidden="true" />
                  {t('auth.demoClient')}
                </button>
                <button type="button" className="btn-secondary" onClick={() => signInDemo('specialist')}>
                  <Briefcase size={17} aria-hidden="true" />
                  {t('auth.demoSpecialist')}
                </button>
              </div>
              <p className="hint mt-2">{t('auth.demoHint')}</p>
            </div>
          ) : null}
        </div>

        <p className="mt-5 text-center text-[13px] text-ink-400">{t('common.confidential')}</p>
      </div>
    </PlainLayout>
  )
}
