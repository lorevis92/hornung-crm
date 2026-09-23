// POST /api/register  { email, password, preferred_language } -> self sign-up
//
// Why this exists instead of calling supabase.auth.signUp() straight from the
// browser (which the app used to do): that client-side call is at the mercy
// of the "Confirm email" toggle in the Supabase dashboard — when it's on,
// Supabase sends its own generic "Confirm your email address" mail and the
// confirmation link depends on the Site URL / Redirect URLs configured
// there, which is exactly what broke on 2026-09-22 (a corrupted env var
// produced a dead link, wrapped in an unbranded email).
//
// This endpoint uses the service-role ("admin") API instead, which gives us
// full control and removes that whole class of failure:
//   - REQUIRE_EMAIL_CONFIRMATION unset/"false" (the current default): the
//     account is created already confirmed (email_confirm: true) and no
//     e-mail is sent by Supabase at all — the client signs the person in
//     immediately with the password they just chose. Nothing depends on
//     Supabase's mailer or its Site URL setting, so there is nothing left to
//     break.
//   - REQUIRE_EMAIL_CONFIRMATION="true" (for later, if ever needed): the
//     account is created unconfirmed and we generate the confirmation link
//     ourselves, then send it through our own Resend-based, Hornung-branded
//     e-mail (emailLayout) — the same pattern already used for client
//     invites in invite-client.js — instead of Supabase's default template.
//     The redirect target is computed from PUBLIC_SITE_URL server-side
//     (siteUrl()), so it always matches the domain this API is actually
//     deployed on.
import { emailLayout, httpError, readBody, sendEmail, serviceClient, siteUrl } from './_lib.js'

const COPY = {
  en: {
    subject: 'Confirm your Hornung Consulting access',
    title: 'Confirm your e-mail address',
    intro: 'One last step: confirm your e-mail address to activate your client portal access.',
    cta: 'Confirm my e-mail',
    footer: 'You received this e-mail because you registered on the Hornung Consulting client portal.'
  },
  de: {
    subject: 'Bestätigen Sie Ihren Zugang zu Hornung Consulting',
    title: 'Bestätigen Sie Ihre E-Mail-Adresse',
    intro: 'Nur noch ein Schritt: Bestätigen Sie Ihre E-Mail-Adresse, um Ihren Zugang zum Kundenportal zu aktivieren.',
    cta: 'E-Mail bestätigen',
    footer: 'Sie erhalten diese E-Mail, weil Sie sich im Kundenportal von Hornung Consulting registriert haben.'
  },
  fr: {
    subject: 'Confirmez votre accès à Hornung Consulting',
    title: 'Confirmez votre adresse e-mail',
    intro: "Dernière étape : confirmez votre adresse e-mail pour activer votre accès au portail client.",
    cta: 'Confirmer mon e-mail',
    footer: 'Vous recevez cet e-mail car vous vous êtes inscrit sur le portail client de Hornung Consulting.'
  },
  it: {
    subject: 'Conferma il tuo accesso a Hornung Consulting',
    title: 'Conferma il tuo indirizzo e-mail',
    intro: 'Ultimo passo: conferma il tuo indirizzo e-mail per attivare il tuo accesso al portale clienti.',
    cta: 'Conferma la mia e-mail',
    footer: 'Ricevi questa e-mail perché ti sei registrato sul portale clienti di Hornung Consulting.'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const body = readBody(req)
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')

    if (!email) throw httpError(400, 'EMAIL_REQUIRED', 'An e-mail address is required.')
    if (password.length < 8) throw httpError(400, 'PASSWORD_TOO_SHORT', 'Password must be at least 8 characters.')

    const admin = serviceClient()

    const { data: existingUserId } = await admin.rpc('auth_user_id_by_email', { p_email: email })
    if (existingUserId) throw httpError(409, 'EMAIL_IN_USE', 'An account with this e-mail already exists.')

    const language = ['en', 'de', 'fr', 'it'].includes(body.preferred_language) ? body.preferred_language : 'en'
    const requireConfirmation = process.env.REQUIRE_EMAIL_CONFIRMATION === 'true'
    const redirectTo = `${siteUrl()}/login`

    if (requireConfirmation) {
      // Creates the (unconfirmed) user and hands back a one-time link, all in
      // one call — we never let Supabase send its own mail for it.
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: 'signup',
        email,
        password,
        options: { redirectTo }
      })
      if (linkError) throw httpError(400, 'SIGNUP_FAILED', linkError.message)

      const copy = COPY[language]
      const mail = await sendEmail({
        to: email,
        subject: copy.subject,
        html: emailLayout({
          title: copy.title,
          intro: copy.intro,
          ctaLabel: copy.cta,
          ctaUrl: link?.properties?.action_link,
          footerNote: copy.footer
        })
      })
      return res.status(200).json({ needsConfirmation: true, emailSent: mail.sent })
    }

    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })
    if (createError) {
      if (/registered|exists/i.test(createError.message)) {
        throw httpError(409, 'EMAIL_IN_USE', 'An account with this e-mail already exists.')
      }
      throw httpError(400, 'SIGNUP_FAILED', createError.message)
    }

    return res.status(200).json({ needsConfirmation: false })
  } catch (error) {
    console.error('[register]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
