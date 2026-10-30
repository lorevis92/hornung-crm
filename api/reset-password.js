// POST /api/reset-password
//   { email, preferred_language }
//
// Public (no auth required — this is exactly the "I forgot my password" flow,
// called before the person has a session). Issues a single-use recovery
// token (auth_tokens, valid 1 hour — see api/_auth.js) and sends the
// /set-password link through our own Hornung-branded e-mail (emailLayout +
// Resend). Using the link (POST /api/auth/set-password) signs every other
// session of that account out.
//
// Never reveals whether the address exists: a missing/unknown e-mail simply
// results in no e-mail being sent, but the response is identical either way.
import { emailLayout, httpError, readBody, sendEmail, serviceClient, siteUrl } from './_lib.js'
import { assertSameOrigin, findAccountByEmail, issueToken, normalizeEmail, setPasswordLink } from './_auth.js'

const COPY = {
  en: {
    subject: 'Reset your Hornung Consulting password',
    title: 'Reset your password',
    intro: 'We received a request to reset the password for your client portal access. Click below to choose a new one.',
    cta: 'Reset my password',
    footer: 'If you did not request this, you can safely ignore this e-mail — your password will not change.'
  },
  de: {
    subject: 'Setzen Sie Ihr Hornung-Consulting-Passwort zurück',
    title: 'Passwort zurücksetzen',
    intro: 'Wir haben eine Anfrage erhalten, das Passwort für Ihr Kundenportal zurückzusetzen. Klicken Sie unten, um ein neues zu wählen.',
    cta: 'Passwort zurücksetzen',
    footer: 'Falls Sie dies nicht angefordert haben, können Sie diese E-Mail ignorieren — Ihr Passwort ändert sich nicht.'
  },
  fr: {
    subject: 'Réinitialisez votre mot de passe Hornung Consulting',
    title: 'Réinitialiser votre mot de passe',
    intro: "Nous avons reçu une demande de réinitialisation du mot de passe de votre accès au portail client. Cliquez ci-dessous pour en choisir un nouveau.",
    cta: 'Réinitialiser mon mot de passe',
    footer: "Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail — votre mot de passe ne changera pas."
  },
  it: {
    subject: 'Reimposta la tua password di Hornung Consulting',
    title: 'Reimposta la tua password',
    intro: 'Abbiamo ricevuto una richiesta di reimpostazione della password per il tuo accesso al portale clienti. Clicca qui sotto per sceglierne una nuova.',
    cta: 'Reimposta la mia password',
    footer: 'Se non hai richiesto tu questa operazione, puoi ignorare questa e-mail — la tua password non cambierà.'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    assertSameOrigin(req)
    const body = readBody(req)
    const email = normalizeEmail(body.email)
    if (!email) throw httpError(400, 'EMAIL_REQUIRED', 'An e-mail address is required.')

    const language = ['en', 'de', 'fr', 'it'].includes(body.preferred_language)
      ? body.preferred_language
      : 'en'
    const copy = COPY[language]

    const admin = serviceClient()
    const account = await findAccountByEmail(admin, email)

    // Unknown e-mail: nothing is sent, and the answer is the same as below —
    // the caller can never tell the two apart.
    if (account) {
      const token = await issueToken(admin, account.id, 'recovery')
      const mail = await sendEmail({
        to: account.email,
        subject: copy.subject,
        html: emailLayout({
          title: copy.title,
          intro: copy.intro,
          ctaLabel: copy.cta,
          ctaUrl: setPasswordLink(siteUrl(), token),
          footerNote: copy.footer
        })
      })
      if (!mail.sent) console.error('[reset-password] e-mail not sent', mail.reason)
    }

    return res.status(200).json({ sent: true })
  } catch (error) {
    console.error('[reset-password]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
