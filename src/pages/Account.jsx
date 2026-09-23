import { useState } from 'react'
import { KeyRound, Save, ShieldCheck, UserCircle2, UserPlus } from 'lucide-react'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { Field, PasswordInput, Spinner, TextInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useI18n } from '../i18n'
import { api } from '../lib/data'
import { IS_DEMO } from '../lib/config'

const emptyInvite = { full_name: '', email: '' }

function splitFullName(fullName = '') {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return { first: parts[0] || '', last: parts.slice(1).join(' ') }
}

export default function Account() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const { profile, client, isStaff, updatePassword, updateProfileName } = useAuth()

  const initialName = client
    ? { first: client.first_name || '', last: client.last_name || '' }
    : splitFullName(profile?.full_name)
  const [firstName, setFirstName] = useState(initialName.first)
  const [lastName, setLastName] = useState(initialName.last)
  const [savingName, setSavingName] = useState(false)

  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [pwError, setPwError] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const [invite, setInvite] = useState(emptyInvite)
  const [inviting, setInviting] = useState(false)

  const roleLabel =
    profile?.role === 'client'
      ? t('account.roleClient')
      : profile?.role === 'admin'
        ? t('account.roleAdmin')
        : t('account.roleSpecialist')

  const submitName = async (e) => {
    e.preventDefault()
    setSavingName(true)
    try {
      await updateProfileName(firstName.trim(), lastName.trim())
      toast.success(t('common.saved'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setSavingName(false)
    }
  }

  const submitPassword = async (e) => {
    e.preventDefault()
    setPwError('')
    if (password.length < 8) return setPwError(t('auth.passwordTooShort'))
    if (password !== repeat) return setPwError(t('auth.passwordMismatch'))

    if (IS_DEMO) {
      toast.info(t('auth.demoHint'))
      return
    }

    setSavingPassword(true)
    try {
      await updatePassword(password)
      toast.success(t('account.passwordUpdated'))
      setPassword('')
      setRepeat('')
    } catch (error) {
      console.error(error)
      setPwError(error.message || t('common.error'))
    } finally {
      setSavingPassword(false)
    }
  }

  const submitInvite = async (e) => {
    e.preventDefault()
    setInviting(true)
    try {
      const result = await api.inviteStaff({ ...invite, preferred_language: lang })
      setInvite(emptyInvite)
      if (result.emailSent) toast.success(t('account.inviteSent', { email: invite.email }))
      else toast.info(t('account.inviteFailed'))
    } catch (error) {
      console.error(error)
      toast.error(error.message || t('common.error'))
    } finally {
      setInviting(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">{t('common.portal')}</p>
        <h1 className="display mt-1 text-[32px] leading-tight sm:text-[38px]">{t('account.title')}</h1>
        <p className="mt-1 max-w-2xl text-[16px] text-ink-500">{t('account.subtitle')}</p>
      </header>

      <section className="card card-pad">
        <div className="mb-4 flex items-start gap-2.5">
          <UserCircle2 size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
          <h2 className="section-title text-xl">{t('account.details')}</h2>
        </div>

        <form onSubmit={submitName} className="grid gap-4 sm:grid-cols-2">
          <Field label={t('data.f.firstName')} htmlFor="acc-first">
            <TextInput
              id="acc-first"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </Field>
          <Field label={t('data.f.lastName')} htmlFor="acc-last">
            <TextInput
              id="acc-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </Field>
          <Field label={t('auth.email')}>
            <p className="text-[15px] text-ink-800">{profile?.email}</p>
          </Field>
          <Field label={t('account.role')}>
            <p className="text-[15px] text-ink-800">{roleLabel}</p>
          </Field>
          <Field label={t('common.language')}>
            <LanguageSwitcher />
          </Field>
          <div className="flex items-end">
            <button type="submit" className="btn-primary" disabled={savingName}>
              {savingName ? <Spinner size={18} /> : <Save size={18} aria-hidden="true" />}
              {savingName ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </section>

      <section className="card card-pad">
        <div className="mb-4 flex items-start gap-2.5">
          <KeyRound size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
          <div>
            <h2 className="section-title text-xl">{t('account.changePassword')}</h2>
            <p className="section-sub">{t('account.changePasswordHelp')}</p>
          </div>
        </div>

        <form onSubmit={submitPassword} className="grid max-w-md gap-4">
          <Field label={t('auth.newPassword')} htmlFor="acc-pw">
            <PasswordInput
              id="acc-pw"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label={t('auth.repeatPassword')} htmlFor="acc-pw2">
            <PasswordInput
              id="acc-pw2"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </Field>

          {pwError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800" role="alert">
              {pwError}
            </p>
          ) : null}

          <button type="submit" className="btn-primary" disabled={savingPassword}>
            {savingPassword ? <Spinner size={18} /> : <KeyRound size={18} aria-hidden="true" />}
            {savingPassword ? t('common.saving') : t('account.changePassword')}
          </button>
        </form>
      </section>

      {isStaff ? (
        <section className="card card-pad">
          <div className="mb-4 flex items-start gap-2.5">
            <ShieldCheck size={20} className="mt-1 shrink-0 text-gold-600" aria-hidden="true" />
            <div>
              <h2 className="section-title text-xl">{t('account.inviteColleague')}</h2>
              <p className="section-sub">{t('account.inviteColleagueHelp')}</p>
            </div>
          </div>

          <form onSubmit={submitInvite} className="grid max-w-md gap-4">
            <Field label={t('account.colleagueName')} htmlFor="inv-name">
              <TextInput
                id="inv-name"
                required
                value={invite.full_name}
                onChange={(e) => setInvite((f) => ({ ...f, full_name: e.target.value }))}
              />
            </Field>
            <Field label={t('account.colleagueEmail')} htmlFor="inv-email">
              <TextInput
                id="inv-email"
                type="email"
                required
                value={invite.email}
                onChange={(e) => setInvite((f) => ({ ...f, email: e.target.value }))}
              />
            </Field>

            <button type="submit" className="btn-primary" disabled={inviting}>
              {inviting ? <Spinner size={18} /> : <UserPlus size={18} aria-hidden="true" />}
              {inviting ? t('common.saving') : t('account.sendInvite')}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  )
}
