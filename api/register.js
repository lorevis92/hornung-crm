// POST /api/register  { email, password, preferred_language } -> self sign-up
//
// Creates the login in our own auth_accounts table (api/_auth.js) — no
// Supabase Auth involved:
//   - REQUIRE_EMAIL_CONFIRMATION unset/"false" (the current default): the
//     account is created already confirmed and no e-mail is sent; the client
//     signs the person in right away (POST /api/auth/login) with the password
//     they just chose.
//   - REQUIRE_EMAIL_CONFIRMATION="true": the account is created unconfirmed
//     (login refuses it with EMAIL_NOT_CONFIRMED) and a single-use link to
//     /api/auth/confirm-email is sent through our own Resend-based,
//     Hornung-branded e-mail. The link is built from PUBLIC_SITE_URL
//     server-side (siteUrl()).
// The app_profiles / clients rows are created on first sign-in by
// api/claim-profile.js, exactly as before.
import { emailLayout, httpError, readBody, sendEmail, serviceClient, siteUrl } from './_lib.js'
import { assertSameOrigin, createAccount, findAccountByEmail, issueToken, normalizeEmail, validatePassword } from './_auth.js'

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
    assertSameOrigin(req)
    const body = readBody(req)
    const email = normalizeEmail(body.email)
    const password = String(body.password || '')

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw httpError(400, 'EMAIL_REQUIRED', 'An e-mail address is required.')
    }
    validatePassword(password)

    const admin = serviceClient()
    if (await findAccountByEmail(admin, email)) {
      throw httpError(409, 'EMAIL_IN_USE', 'An account with this e-mail already exists.')
    }

    const language = ['en', 'de', 'fr', 'it'].includes(body.preferred_language) ? body.preferred_language : 'en'
    // OWNER_EMAIL becomes a specialist on first sign-in (api/claim-profile.js),
    // so whoever registers that address must prove they own the mailbox —
    // always, whatever REQUIRE_EMAIL_CONFIRMATION says.
    const isOwnerEmail = Boolean(process.env.OWNER_EMAIL) && email === normalizeEmail(process.env.OWNER_EMAIL)
    const requireConfirmation = process.env.REQUIRE_EMAIL_CONFIRMATION === 'true' || isOwnerEmail

    const account = await createAccount(admin, { email, password, confirmed: !requireConfirmation })

    if (requireConfirmation) {
      const token = await issueToken(admin, account.id, 'confirm_email')
      const copy = COPY[language]
      const mail = await sendEmail({
        to: email,
        subject: copy.subject,
        html: emailLayout({
          title: copy.title,
          intro: copy.intro,
          ctaLabel: copy.cta,
          ctaUrl: `${siteUrl()}/api/auth/confirm-email?token=${encodeURIComponent(token)}`,
          footerNote: copy.footer
        })
      })
      return res.status(200).json({ needsConfirmation: true, emailSent: mail.sent })
    }

    return res.status(200).json({ needsConfirmation: false })
  } catch (error) {
    console.error('[register]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
