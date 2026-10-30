// POST /api/invite-client
//   { first_name, last_name, email, phone, preferred_language, canton }  -> create + invite
//   { clientId, resend: true }                                           -> resend the link
//
// If the e-mail already has a login (auth_accounts — e.g. a colleague, or a
// client deleted and invited again), NO second login is created: the person
// keeps their password and simply receives a brand new, isolated profile and
// client record. Otherwise a password-less account is created and the e-mail
// carries a single-use /set-password link (valid 7 days, see api/_auth.js).
import { APP_ID, emailLayout, httpError, readBody, requireStaff, sendEmail, siteUrl } from './_lib.js'
import { findAccountById, findOrCreateInvitedAccount, issueToken, normalizeEmail, setPasswordLink } from './_auth.js'

const COPY = {
  en: {
    subject: 'Your access to the Hornung Consulting client portal',
    title: 'Welcome to your client portal',
    intro:
      'Hornung Consulting has created your personal access. There you can upload the documents for your tax return and follow its progress at any time.',
    cta: 'Activate my access',
    existingIntro:
      'Hornung Consulting has given your existing account access to the tax portal. Sign in with the password you already use.',
    existingCta: 'Open the portal',
    footer: 'You received this e-mail because a tax file was opened for you.'
  },
  de: {
    subject: 'Ihr Zugang zum Kundenportal von Hornung Consulting',
    title: 'Willkommen in Ihrem Kundenportal',
    intro:
      'Hornung Consulting hat Ihren persönlichen Zugang erstellt. Dort können Sie die Unterlagen für Ihre Steuererklärung hochladen und den Stand jederzeit verfolgen.',
    cta: 'Zugang aktivieren',
    existingIntro:
      'Hornung Consulting hat Ihrem bestehenden Konto Zugang zum Steuerportal gegeben. Melden Sie sich mit Ihrem bisherigen Passwort an.',
    existingCta: 'Portal öffnen',
    footer: 'Sie erhalten diese E-Mail, weil für Sie ein Steuerdossier eröffnet wurde.'
  },
  fr: {
    subject: 'Votre accès au portail client de Hornung Consulting',
    title: 'Bienvenue sur votre portail client',
    intro:
      "Hornung Consulting a créé votre accès personnel. Vous pouvez y déposer les documents de votre déclaration d'impôt et suivre son avancement à tout moment.",
    cta: 'Activer mon accès',
    existingIntro:
      "Hornung Consulting a donné à votre compte existant l'accès au portail fiscal. Connectez-vous avec votre mot de passe habituel.",
    existingCta: 'Ouvrir le portail',
    footer: "Vous recevez cet e-mail car un dossier fiscal a été ouvert à votre nom."
  },
  it: {
    subject: 'Il tuo accesso al portale clienti di Hornung Consulting',
    title: 'Benvenuto nel tuo portale clienti',
    intro:
      'Hornung Consulting ha creato il tuo accesso personale. Da lì puoi caricare i documenti per la dichiarazione dei redditi e seguire in ogni momento lo stato di avanzamento.',
    cta: 'Attiva il mio accesso',
    existingIntro:
      'Hornung Consulting ha abilitato il tuo account esistente al portale fiscale. Accedi con la password che usi già.',
    existingCta: 'Apri il portale',
    footer: 'Ricevi questa e-mail perché è stata aperta una pratica fiscale a tuo nome.'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin, profile: staffProfile } = await requireStaff(req)
    const body = readBody(req)

    // ---------------------------------------------------------- resend ----
    if (body.resend && body.clientId) {
      const { data: client } = await admin
        .from('clients')
        .select('*')
        .eq('id', body.clientId)
        .maybeSingle()
      if (!client) throw httpError(404, 'CLIENT_NOT_FOUND', 'Client not found.')

      const copy = COPY[client.preferred_language] || COPY.en
      // A fresh single-use link for the login this client's profile points at.
      let account = null
      if (client.profile_id) {
        const { data: profileRow } = await admin
          .from('app_profiles')
          .select('user_id')
          .eq('id', client.profile_id)
          .maybeSingle()
        if (profileRow?.user_id) account = await findAccountById(admin, profileRow.user_id)
      }
      if (!account) throw httpError(400, 'LINK_FAILED', 'This client has no login to send a link for.')
      const linkUrl = setPasswordLink(siteUrl(), await issueToken(admin, account.id, 'invite'))

      const mail = await sendEmail({
        to: client.email,
        subject: copy.subject,
        html: emailLayout({
          title: copy.title,
          intro: copy.intro,
          ctaLabel: copy.cta,
          ctaUrl: linkUrl,
          footerNote: copy.footer
        })
      })
      return res.status(200).json({ client, emailSent: mail.sent, reason: mail.reason })
    }

    // ------------------------------------------------------- create -------
    const email = normalizeEmail(body.email)
    if (!email) throw httpError(400, 'EMAIL_REQUIRED', 'An e-mail address is required.')

    const { data: existingClient } = await admin
      .from('clients')
      .select('id')
      .eq('app_id', APP_ID)
      .ilike('email', email)
      .maybeSingle()
    if (existingClient) throw httpError(409, 'CLIENT_EXISTS', 'A client with this e-mail already exists.')

    const language = ['en', 'de', 'fr', 'it'].includes(body.preferred_language)
      ? body.preferred_language
      : 'en'
    const copy = COPY[language]
    const displayName = [body.first_name, body.last_name].filter(Boolean).join(' ').trim() || email

    // Does this person already have a login?
    const { account, isNewAccount } = await findOrCreateInvitedAccount(admin, email)
    const userId = account.id
    const actionLink = isNewAccount ? setPasswordLink(siteUrl(), await issueToken(admin, userId, 'invite')) : null

    // Profile scoped to THIS app (unique per user_id + app_id)
    const { data: appProfile, error: profileError } = await admin
      .from('app_profiles')
      .upsert(
        {
          user_id: userId,
          app_id: APP_ID,
          role: 'client',
          full_name: displayName,
          email,
          phone: body.phone || null,
          locale: language
        },
        { onConflict: 'user_id,app_id' }
      )
      .select()
      .single()
    if (profileError) throw httpError(400, 'PROFILE_FAILED', profileError.message)

    const { data: client, error: clientError } = await admin
      .from('clients')
      .insert({
        app_id: APP_ID,
        profile_id: appProfile.id,
        email,
        first_name: body.first_name || null,
        last_name: body.last_name || null,
        phone: body.phone || null,
        canton: body.canton || null,
        preferred_language: language,
        status: 'invited',
        invited_at: new Date().toISOString(),
        created_by: staffProfile.id
      })
      .select()
      .single()
    if (clientError) throw httpError(400, 'CLIENT_FAILED', clientError.message)

    const mail = await sendEmail({
      to: email,
      subject: copy.subject,
      html: emailLayout({
        title: copy.title,
        intro: isNewAccount ? copy.intro : copy.existingIntro,
        ctaLabel: isNewAccount ? copy.cta : copy.existingCta,
        ctaUrl: actionLink || `${siteUrl()}/login`,
        footerNote: copy.footer
      })
    })

    return res.status(200).json({
      client,
      profile: appProfile,
      reusedExistingLogin: !isNewAccount,
      emailSent: mail.sent,
      reason: mail.reason
    })
  } catch (error) {
    console.error('[invite-client]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
