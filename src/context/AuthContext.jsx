import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { APP_ID, IS_DEMO } from '../lib/config'
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

  // Best-effort: flips a client's status from 'invited' to 'active' on their
  // first login. NOTE: supabase-js's `.rpc()` returns a PostgrestBuilder,
  // which is "thenable" (has `.then()`) but is NOT a real Promise — it has no
  // `.catch()` method. Calling `.catch()` on it directly throws
  // "TypeError: ...catch is not a function" *synchronously*, which — since
  // this runs inside an async function that nothing here awaits/catches from
  // the caller's caller — used to abort loadProfile() before it ever reached
  // its final `setLoading(false)`, leaving the app stuck in the loading
  // state forever for every client login. A plain try/catch avoids relying
  // on `.catch()` existing on the returned builder.
  const markClientActive = async () => {
    try {
      await supabase.rpc('mark_client_active')
    } catch (err) {
      console.error('[markClientActive] mark_client_active RPC failed', err)
    }
  }

  // Attempts, at most once per user id, to turn a bare auth user into an
  // app_profiles row (self sign-up on /register, or the owner's first
  // login). Best-effort: any failure (network, 4xx…) is swallowed and the
  // caller falls back to the existing 'no-profile' behaviour.
  const claimProfile = useCallback(async (activeSession) => {
    const userId = activeSession?.user?.id
    const token = activeSession?.access_token
    if (!userId || !token || claimAttempted.current.has(userId)) return null
    claimAttempted.current.add(userId)

    try {
      const res = await fetch('/api/claim-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

  // -------------------------------------------------------------- supabase --
  const loadProfile = useCallback(async (activeSession) => {
    if (!activeSession?.user) {
      setProfile(null)
      setClient(null)
      setAccess('ok')
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('app_profiles')
      .select('*')
      .eq('user_id', activeSession.user.id)
      .eq('app_id', APP_ID)
      .maybeSingle()

    if (error) {
      console.error(error)
      setLoading(false)
      return
    }
    if (!data) {
      const claimed = await claimProfile(activeSession)
      if (claimed) {
        setAccess('ok')
        setProfile(claimed)
        if (claimed.role === 'client') {
          await markClientActive()
          setClient(await api.getMyClient(claimed.id))
        } else {
          setClient(null)
        }
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
    setProfile(data)

    if (data.role === 'client') {
      await markClientActive()
      setClient(await api.getMyClient(data.id))
    } else {
      setClient(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (IS_DEMO) {
      loadDemoSession()
      return undefined
    }
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      loadProfile(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(true)
      loadProfile(nextSession)
    })
    return () => {
      active = false
      sub?.subscription?.unsubscribe()
    }
  }, [loadDemoSession, loadProfile])

  // ----------------------------------------------------------------- api ----
  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

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
    await supabase.auth.signOut()
  }, [])

  // Goes through our own /api/reset-password instead of calling
  // supabase.auth.resetPasswordForEmail() directly from the browser — same
  // reason as api/register.js: keeps the e-mail branded and sent through
  // Resend instead of Supabase's own generic template. In demo mode there is
  // nothing to send; pretend it worked so the caller's existing
  // toast.success(auth.resetSent) still makes sense.
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

  const updatePassword = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
  }, [])

  // Lets the signed-in user (client or staff) set their own display name.
  // Uses the same update_my_contact() RPC as saveQuestionnaire() — clients
  // have no direct UPDATE policy on `clients`, only on their own
  // app_profiles row, so this SECURITY DEFINER RPC is the only way for a
  // client to do it themselves. For staff it simply updates app_profiles.
  // full_name (my_client_id() resolves to nothing for them, so the `clients`
  // side of the RPC is a harmless no-op).
  const updateProfileName = useCallback(async (firstName, lastName) => {
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

    if (IS_DEMO) {
      setProfile((p) => (p ? { ...p, full_name: fullName || p.full_name } : p))
      setClient((c) => (c ? { ...c, first_name: firstName || c.first_name, last_name: lastName || c.last_name } : c))
      return
    }

    const { error } = await supabase.rpc('update_my_contact', {
      p_first_name: firstName || null,
      p_last_name: lastName || null,
      p_phone: null,
      p_language: null
    })
    if (error) throw error

    setProfile((p) => (p ? { ...p, full_name: fullName || p.full_name } : p))
    if (profile?.role === 'client') {
      setClient(await api.getMyClient(profile.id))
    }
  }, [profile])

  const refreshClient = useCallback(async () => {
    if (!profile || profile.role !== 'client') return
    setClient(await api.getMyClient(profile.id))
  }, [profile])

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
      updatePassword,
      updateProfileName,
      refreshClient
    }),
    [
      loading, session, profile, client, access,
      signIn, signInDemo, signOut, sendResetEmail, updatePassword, updateProfileName, refreshClient
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
