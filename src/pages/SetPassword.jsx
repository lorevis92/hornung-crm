import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import Brand from '../components/Brand'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { PlainLayout } from '../components/Layout'
import { Field, Spinner, TextInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { IS_DEMO } from '../lib/config'
import { supabase } from '../lib/supabaseClient'

export default function SetPassword() {
  const { t } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const { updatePassword } = useAuth()
  const [ready, setReady] = useState(IS_DEMO)
  const [linkValid, setLinkValid] = useState(true)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (IS_DEMO) return
    // Supabase parses the invite/recovery token from the URL automatically
    // (detectSessionInUrl), we only have to wait for the resulting session.
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setLinkValid(Boolean(data.session))
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError(t('auth.passwordTooShort'))
    if (password !== repeat) return setError(t('auth.passwordMismatch'))

    setBusy(true)
    try {
      if (IS_DEMO) {
        toast.info(t('auth.demoHint'))
        navigate('/login')
        return
      }
      await updatePassword(password)
      toast.success(t('common.saved'))
      navigate('/')
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
          <h1 className="display text-[26px] leading-tight">{t('auth.setPassword')}</h1>
          <p className="mt-1 text-[15px] text-ink-500">{t('auth.setPasswordHelp')}</p>

          {!ready ? (
            <div className="py-8">
              <Spinner className="mx-auto text-ink-400" />
            </div>
          ) : !linkValid ? (
            <div className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-[14px] text-amber-900">
              {t('auth.linkExpired')}
              <button type="button" className="link ml-1" onClick={() => navigate('/login')}>
                {t('auth.signIn')}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <Field label={t('auth.newPassword')} htmlFor="pw">
                <TextInput
                  id="pw"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label={t('auth.repeatPassword')} htmlFor="pw2">
                <TextInput
                  id="pw2"
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

              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? <Spinner size={18} /> : <KeyRound size={18} />}
                {t('auth.activate')}
              </button>
            </form>
          )}
        </div>
      </div>
    </PlainLayout>
  )
}
