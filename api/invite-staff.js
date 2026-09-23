// POST /api/invite-staff
//   { full_name, email, preferred_language }
//
// Lets an existing Hornung Consulting specialist invite a second one. Only
// creates an app_profiles row (role 'specialist') — never a `clients` row.
// Reuses the shared-database behaviour of api/invite-client.js: if the
// e-mail already has an auth.users account (e.g. from WisiHealth, or already
// a client here), no second login is created — the person keeps their
// password and simply gets an extra, specialist-level profile.
import { APP_ID, emailLayout, httpError, readBody, requireStaff, sendEmail, siteUrl } from './_lib.js'

const COPY = {
  en: {
    subject: 'You have been invited to Hornung Consulting',
    title: 'Welcome to the team',
    intro:
      'You have been invited to collaborate with Hornung Consulting on the client portal. There you can see every client file and manage tax declarations.',
    cta: 'Activate my access',
    existingIntro:
      'Your existing account has been given specialist access to the Hornung Consulting client portal. Sign in with the password you already use.',
    existingCta: 'Open the portal',
    footer: 'You received this e-mail because Hornung Consulting invited you to collaborate.'
  },
  de: {
    subject: 'Sie wurden zu Hornung Consulting eingeladen',
    title: 'Willkommen im Team',
    intro:
      'Sie wurden eingeladen, mit Hornung Consulting im Kundenportal zusammenzuarbeiten. Dort sehen Sie alle Kundendossiers und verwalten Steuererklärungen.',
    cta: 'Zugang aktivieren',
    existingIntro:
      'Ihr bestehendes Konto wurde mit Spezialisten-Zugang zum Kundenportal von Hornung Consulting versehen. Melden Sie sich mit Ihrem bisherigen Passwort an.',
    existingCta: 'Portal öffnen',
    footer: 'Sie erhalten diese E-Mail, weil Hornung Consulting Sie zur Zusammenarbeit eingeladen hat.'
  },
  fr: {
    subject: 'Vous avez été invité(e) chez Hornung Consulting',
    title: "Bienvenue dans l'équipe",
    intro:
      'Vous avez été invité(e) à collaborer avec Hornung Consulting sur le portail client. Vous y voyez tous les dossiers clients et gérez les déclarations fiscales.',
    cta: 'Activer mon accès',
    existingIntro:
      "Votre compte existant a reçu l'accès spécialiste au portail client de Hornung Consulting. Connectez-vous avec votre mot de passe habituel.",
    existingCta: 'Ouvrir le portail',
    footer: 'Vous recevez cet e-mail car Hornung Consulting vous a invité(e) à collaborer.'
  },
  it: {
    subject: 'Sei stato invitato a collaborare con Hornung Consulting',
    title: 'Benvenuto nel team',
    intro:
      'Sei stato invitato a collaborare con Hornung Consulting nel portale clienti. Da lì vedi tutte le pratiche dei clienti e gestisci le dichiarazioni fiscali.',
    cta: 'Attiva il mio accesso',
    existingIntro:
      'Il tuo account esistente ha ricevuto l\'accesso da specialista al portale clienti di Hornung Consulting. Accedi con la password che usi già.',
    existingCta: 'Apri il portale',
    footer: 'Ricevi questa e-mail perché Hornung Consulting ti ha invitato a collaborare.'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin } = await requireStaff(req)
    const body = readBody(req)
    const redirectTo = `${siteUrl()}/set-password`

    const email = String(body.email || '').trim().toLowerCase()
    if (!email) throw httpError(400, 'EMAIL_REQUIRED', 'An e-mail address is required.')

    const language = ['en', 'de', 'fr', 'it'].includes(body.preferred_language)
      ? body.preferred_language
      : 'en'
    const copy = COPY[language]
    const displayName = String(body.full_name || '').trim() || email

    // Does this person already have a login (possibly from another app, or
    // as an existing client of this one)?
    const { data: existingUserId } = await admin.rpc('auth_user_id_by_email', { p_email: email })

    let userId = existingUserId || null
    let actionLink = null
    let isNewAccount = false

    if (!userId) {
      const { data: invite, error: inviteError } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo, data: { full_name: displayName } }
      })
      if (inviteError) throw httpError(400, 'INVITE_FAILED', inviteError.message)
      userId = invite.user.id
      actionLink = invite.properties.action_link
      isNewAccount = true
    }

    // Profile scoped to THIS app — upsert so re-inviting an existing client
    // (or a colleague invited twice) simply promotes them to specialist.
    const { data: appProfile, error: profileError } = await admin
      .from('app_profiles')
      .upsert(
        {
          user_id: userId,
          app_id: APP_ID,
          role: 'specialist',
          full_name: displayName,
          email,
          locale: language
        },
        { onConflict: 'user_id,app_id' }
      )
      .select()
      .single()
    if (profileError) throw httpError(400, 'PROFILE_FAILED', profileError.message)

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
      profile: appProfile,
      reusedExistingLogin: !isNewAccount,
      emailSent: mail.sent,
      reason: mail.reason
    })
  } catch (error) {
    console.error('[invite-staff]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
