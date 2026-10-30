import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { IS_DEMO } from '../lib/config'
import { api } from '../lib/data'
import { useI18n } from '../i18n'

const AuthContext = createContext(null)
const DEMO_KEY = 'hornung.demo.session'

const DEMO_USERS = {
  specialist: {
    profile: {
      id: 'profile-specialist',
      app_id: 'hornung_crm',
      role: 'specialist',
      full_name: 'Hornung Consulting',
      email: 'hornungconsulting@gmail.com'
    },
    client: null
  },
  client: {
    profile: {
      id: 'profile-client-1',
      app_id: 'hornung_crm',
      role: 'client',
      full_name: 'Marco Bianchi',
      email: 'marco.bianchi@example.ch'
    }
  }
}

// Our own login (api/auth/[action].js). The session lives in an httpOnly
// cookie the page can't read — the browser just sends it along; there is no
// token to store or refresh here.
async function authRequest(action, { method = 'POST', body } = {}) {
  const res = await fetch(`/api/auth/${action}`, {
    method,
    credentials: 'same-origin',
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || 'REQUEST_FAILED')
    err.code = json.code
    err.status = res.status
    throw err
  }
  return json
}

export function AuthProvider({ children }) {
  const { lang } = useI18n()
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  }, [lang])

  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [client, setClient] = useState(null)
  // 'ok' | 'no-profile' — a valid login that has no profile in THIS app
  const [access, setAccess] = useState('ok')
  // Guards the one-time self-registration / owner claim call per user id.
  const claimAttempted = useRef(new Set())

  // ------------------------------------------------------------------ demo --
  const loadDemoSession = useCallback(async () => {
    let role = null
    try {
      role = localStorage.getItem(DEMO_KEY)
    } catch {
      /* ignore */
    }
    if (!role || !DEMO_USERS[role]) {
      setSession(null)
      setProfile(null)
      setClient(null)
      setLoading(false)
      return
    }
    const demo = DEMO_USERS[role]
    setSession({ demo: true, role })
    setProfile(demo.profile)
    setClient(role === 'client' ? await api.getMyClient(demo.profile.id) : null)
    setLoading(false)
  }, [])

  // Attempts, at most once per user id, to turn a bare login into an
  // app_profiles row (self sign-up on /register, or the owner's first
  // login). Best-effort: any failure (network, 4xx…) is swallowed and the
  // caller falls back to the existing 'no-profile' behaviour.
  const claimProfile = useCallback(async (userId) => {
    if (!userId || claimAttempted.current.has(userId)) return null
    claimAttempted.current.add(userId)
    try {
      const res = await fetch('/api/claim-profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: langRef.current })
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        console.error('[claimProfile] /api/claim-profile responded with an error', res.status, body)
        return null
      }
      const json = await res.json().catch(() => null)
      return json?.profile || null
    } catch (err) {
      console.error('[claimProfile] request failed', err)
      return null
    }
  }, [])

  // ------------------------------------------------------------- session --
  // `me` is what /api/auth/me, /login and /set-password answer:
  // { user, profile, client } — the server has already flipped an invited
  // client to 'active' (what mark_client_active() used to do).
  const applyMe = useCallback(
    async (me) => {
      if (!me?.user) {
        setSession(null)
        setProfile(null)
        setClient(null)
        setAccess('ok')
        setLoading(false)
        return
      }
      setSession({ user: me.user })

      if (!me.profile) {
        const claimed = await claimProfile(me.user.id)
        if (claimed) {
          // Re-read so a freshly linked/created clients row comes back too.
          const again = await authRequest('me', { method: 'GET' }).catch(() => null)
          setAccess('ok')
          setProfile(again?.profile || claimed)
          setClient(again?.client || null)
          setLoading(false)
          return
        }
        // Authenticated, but this person has no profile in this app.
        setProfile(null)
        setClient(null)
        setAccess('no-profile')
        setLoading(false)
        return
      }

      setAccess('ok')
      setProfile(me.profile)
      setClient(me.profile.role === 'client' ? me.client || null : null)
      setLoading(false)
    },
    [claimProfile]
  )

  const loadSession = useCallback(async () => {
    try {
      await applyMe(await authRequest('me', { method: 'GET' }))
    } catch (err) {
      console.error('[auth] could not load the session', err)
      await applyMe(null)
    }
  }, [applyMe])

  useEffect(() => {
    if (IS_DEMO) {
      loadDemoSession()
      return undefined
    }
    loadSession()
    return undefined
  }, [loadDemoSession, loadSession])

  // ----------------------------------------------------------------- api ----
  const signIn = useCallback(
    async (email, password) => {
      const me = await authRequest('login', { body: { email, password } })
      setLoading(true)
      await applyMe(me)
    },
    [applyMe]
  )

  const signInDemo = useCallback(
    async (role) => {
      try {
        localStorage.setItem(DEMO_KEY, role)
      } catch {
        /* ignore */
      }
      setLoading(true)
      await loadDemoSession()
    },
    [loadDemoSession]
  )

  const signOut = useCallback(async () => {
    if (IS_DEMO) {
      try {
        localStorage.removeItem(DEMO_KEY)
      } catch {
        /* ignore */
      }
      setSession(null)
      setProfile(null)
      setClient(null)
      return
    }
    try {
      await authRequest('logout')
    } catch (err) {
      console.error('[auth] logout failed', err)
    }
    await applyMe(null)
  }, [applyMe])

  // Our own /api/reset-password: branded e-mail through Resend with a
  // single-use /set-password link. In demo mode there is nothing to send;
  // pretend it worked so the caller's toast.success(auth.resetSent) still
  // makes sense.
  const sendResetEmail = useCallback(async (email) => {
    if (IS_DEMO) return
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, preferred_language: langRef.current })
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error || 'REQUEST_FAILED')
    }
  }, [])

  // Whether an invite / reset link (the token in /set-password#token=...)
  // can still be used.
  const checkPasswordLink = useCallback(async (token) => {
    if (!token) return { valid: false }
    try {
      return await authRequest('check-link', { body: { token } })
    } catch {
      return { valid: false }
    }
  }, [])

  // With a link token (invite / reset): sets the password and signs in.
  // Without (Account page): the signed-in user changes their own; every other
  // browser signed in as them is signed out.
  const updatePassword = useCallback(
    async (password, token = null) => {
      if (token) {
        const me = await authRequest('set-password', { body: { token, password } })
        setLoading(true)
        await applyMe(me)
        return
      }
      await authRequest('change-password', { body: { password } })
    },
    [applyMe]
  )

  // Lets the signed-in user (client or staff) set their own display name —
  // for a client also on their clients row (server-side, own record only).
  const updateProfileName = useCallback(async (firstName, lastName) => {
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

    if (IS_DEMO) {
      setProfile((p) => (p ? { ...p, full_name: fullName || p.full_name } : p))
      setClient((c) => (c ? { ...c, first_name: firstName || c.first_name, last_name: lastName || c.last_name } : c))
      return
    }

    await api.updateMyContact({ first_name: firstName || null, last_name: lastName || null })

    setProfile((p) => (p ? { ...p, full_name: fullName || p.full_name } : p))
    if (profile?.role === 'client') {
      setClient(await api.getMyClient(profile.id))
    }
  }, [profile])

  const refreshClient = useCallback(async () => {
    if (!profile || profile.role !== 'client') return
    setClient(await api.getMyClient(profile.id))
  }, [profile])

  // A client sets their own canton (own clients row only, server-side).
  const updateMyCanton = useCallback(async (canton) => {
    if (IS_DEMO) {
      // Goes through api.updateClient (the same call the specialist's own
      // "Edit info" modal uses) so it actually lands in the demo store —
      // not just local React state — and everything that reads
      // client.canton straight from that store sees it too.
      if (client) {
        const updated = await api.updateClient(client.id, { canton })
        setClient((c) => (c ? { ...c, ...updated } : c))
      }
      return
    }
    await api.updateMyContact({ canton: canton || null })
    setClient((c) => (c ? { ...c, canton } : c))
  }, [client])

  const value = useMemo(
    () => ({
      loading,
      session,
      profile,
      client,
      access,
      isDemo: IS_DEMO,
      isStaff: profile?.role === 'specialist' || profile?.role === 'admin',
      isClient: profile?.role === 'client',
      signIn,
      signInDemo,
      signOut,
      sendResetEmail,
      checkPasswordLink,
      updatePassword,
      updateProfileName,
      updateMyCanton,
      refreshClient
    }),
    [
      loading, session, profile, client, access,
      signIn, signInDemo, signOut, sendResetEmail, checkPasswordLink, updatePassword, updateProfileName,
      updateMyCanton, refreshClient
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
