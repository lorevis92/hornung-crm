// POST /api/claim-profile
//   {} | { locale }
//
// Called once by the client app right after a successful login when no
// app_profiles row exists yet for this app (see AuthContext.jsx). Turns a
// bare Supabase auth user (created either by self sign-up on /register or by
// the invite-client / invite-staff flows) into an app_profiles row:
//   - OWNER_EMAIL (case-insensitive match)              -> role 'specialist'
//   - everyone else                                      -> role 'client'
//     + a matching `clients` row (or linking to one already created by a
//       staff invite that hasn't been accepted yet, to avoid duplicates).
//
// This does NOT replace api/invite-client.js or api/invite-staff.js — it is
// the self-service path a person reaches by signing up directly.
import { APP_ID, httpError, readBody, requireUser, sendEmail } from './_lib.js'

// Mirrors FEATURES.notifySpecialistOnSelfRegistration in src/lib/config.js.
// Kept as a plain constant here because this file runs as a Node serverless
// function and cannot import Vite's `import.meta.env`-based config module.
const NOTIFY_SPECIALIST_ON_SELF_REGISTRATION = false

const LOCALES = ['en', 'de', 'fr', 'it']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { user, admin } = await requireUser(req)

    const { data: existing, error: existingError } = await admin
      .from('app_profiles')
      .select('*')
      .eq('user_id', user.id)
      .eq('app_id', APP_ID)
      .maybeSingle()
    if (existingError) throw httpError(400, 'LOOKUP_FAILED', existingError.message)
    if (existing) return res.status(200).json({ profile: existing })

    const email = String(user.email || '').trim().toLowerCase()
    const ownerEmail = String(process.env.OWNER_EMAIL || '').trim().toLowerCase()
    const isOwner = Boolean(ownerEmail) && email === ownerEmail
    const displayName = user.user_metadata?.full_name || email

    if (isOwner) {
      const { data: profile, error } = await admin
        .from('app_profiles')
        .insert({ user_id: user.id, app_id: APP_ID, role: 'specialist', email, full_name: displayName })
        .select()
        .single()
      if (error) throw httpError(400, 'PROFILE_FAILED', error.message)
      return res.status(200).json({ profile })
    }

    const { data: profile, error: profileError } = await admin
      .from('app_profiles')
      .insert({ user_id: user.id, app_id: APP_ID, role: 'client', email, full_name: displayName })
      .select()
      .single()
    if (profileError) throw httpError(400, 'PROFILE_FAILED', profileError.message)

    const { locale } = readBody(req)
    const preferredLanguage = LOCALES.includes(locale) ? locale : 'en'

    const { data: existingClient, error: clientLookupError } = await admin
      .from('clients')
      .select('id, profile_id')
      .eq('app_id', APP_ID)
      .ilike('email', email)
      .maybeSingle()
    if (clientLookupError) throw httpError(400, 'LOOKUP_FAILED', clientLookupError.message)

    if (existingClient) {
      // A staff invite for this e-mail already exists (not yet accepted) —
      // link it instead of creating a duplicate client row.
      if (!existingClient.profile_id) {
        await admin.from('clients').update({ profile_id: profile.id }).eq('id', existingClient.id)
      }
    } else {
      // Status is left at the schema default ('invited'); mark_client_active()
      // already flips it to 'active' on the client's first login.
      await admin.from('clients').insert({
        app_id: APP_ID,
        profile_id: profile.id,
        email,
        preferred_language: preferredLanguage
      })
    }

    if (NOTIFY_SPECIALIST_ON_SELF_REGISTRATION && ownerEmail) {
      await sendEmail({
        to: process.env.OWNER_EMAIL,
        subject: 'Nuova registrazione cliente',
        html: `<p>Nuova registrazione cliente: ${email}</p>`
      }).catch(() => {})
    }

    return res.status(200).json({ profile })
  } catch (error) {
    console.error('[claim-profile]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
