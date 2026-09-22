// POST /api/case-status
//   { caseId, status, clientMessage, notify }
// Updates the status of a tax file and notifies the client by e-mail.
// The "finished" e-mail lists the documents the client can download.
import { emailLayout, httpError, readBody, requireStaff, sendEmail, siteUrl } from './_lib.js'

const COPY = {
  en: {
    statusName: {
      opened: 'Opened',
      waiting_client: 'Waiting for documents',
      in_process: 'In process',
      review: 'Final review',
      finished: 'Finished'
    },
    subject: (year, status) => `Your tax declaration ${year} — ${status}`,
    title: (year) => `Tax declaration ${year}`,
    intro: {
      opened: 'Your tax file for this year is now open. You can upload your documents whenever you are ready.',
      waiting_client: 'We need a few more documents from you before we can continue with your declaration.',
      in_process: 'Good news — we have everything we need and your declaration is being prepared.',
      review: 'Your declaration is complete and is going through a final review.',
      finished: 'Your tax declaration is ready. You will find the documents in your client portal.'
    },
    messageLabel: 'Message from Hornung Consulting',
    docsLabel: 'Available documents',
    cta: 'Open my portal',
    footer: 'Your data is treated confidentially.'
  },
  de: {
    statusName: {
      opened: 'Eröffnet',
      waiting_client: 'Warten auf Unterlagen',
      in_process: 'In Bearbeitung',
      review: 'Schlusskontrolle',
      finished: 'Abgeschlossen'
    },
    subject: (year, status) => `Ihre Steuererklärung ${year} — ${status}`,
    title: (year) => `Steuererklärung ${year}`,
    intro: {
      opened: 'Ihr Steuerdossier für dieses Jahr ist eröffnet. Sie können Ihre Unterlagen jederzeit hochladen.',
      waiting_client: 'Wir benötigen noch einige Unterlagen von Ihnen, bevor wir weiterarbeiten können.',
      in_process: 'Gute Nachricht — wir haben alles erhalten und Ihre Steuererklärung wird erstellt.',
      review: 'Ihre Steuererklärung ist vollständig und befindet sich in der Schlusskontrolle.',
      finished: 'Ihre Steuererklärung ist fertig. Die Dokumente finden Sie in Ihrem Kundenportal.'
    },
    messageLabel: 'Nachricht von Hornung Consulting',
    docsLabel: 'Verfügbare Dokumente',
    cta: 'Portal öffnen',
    footer: 'Ihre Daten werden vertraulich behandelt.'
  },
  fr: {
    statusName: {
      opened: 'Ouverte',
      waiting_client: 'En attente de documents',
      in_process: 'En traitement',
      review: 'Contrôle final',
      finished: 'Terminée'
    },
    subject: (year, status) => `Votre déclaration d'impôt ${year} — ${status}`,
    title: (year) => `Déclaration d'impôt ${year}`,
    intro: {
      opened: "Votre dossier fiscal de cette année est ouvert. Vous pouvez déposer vos documents quand vous le souhaitez.",
      waiting_client: 'Nous avons encore besoin de quelques documents de votre part pour continuer.',
      in_process: 'Bonne nouvelle — nous avons tout reçu et votre déclaration est en préparation.',
      review: 'Votre déclaration est complète et fait l’objet d’un contrôle final.',
      finished: 'Votre déclaration est prête. Vous trouverez les documents dans votre portail client.'
    },
    messageLabel: 'Message de Hornung Consulting',
    docsLabel: 'Documents disponibles',
    cta: 'Ouvrir mon portail',
    footer: 'Vos données sont traitées de manière confidentielle.'
  },
  it: {
    statusName: {
      opened: 'Aperta',
      waiting_client: 'In attesa di documenti',
      in_process: 'In lavorazione',
      review: 'Revisione finale',
      finished: 'Completata'
    },
    subject: (year, status) => `La tua dichiarazione ${year} — ${status}`,
    title: (year) => `Dichiarazione fiscale ${year}`,
    intro: {
      opened: 'La tua pratica fiscale di quest’anno è aperta. Puoi caricare i documenti quando vuoi.',
      waiting_client: 'Ci servono ancora alcuni documenti da parte tua prima di poter continuare.',
      in_process: 'Buone notizie — abbiamo ricevuto tutto e la dichiarazione è in preparazione.',
      review: 'La dichiarazione è completa ed è in revisione finale.',
      finished: 'La tua dichiarazione è pronta. Trovi i documenti nel portale clienti.'
    },
    messageLabel: 'Messaggio da Hornung Consulting',
    docsLabel: 'Documenti disponibili',
    cta: 'Apri il portale',
    footer: 'I tuoi dati sono trattati in modo confidenziale.'
  }
}

const VALID = ['opened', 'waiting_client', 'in_process', 'review', 'finished']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { admin, profile } = await requireStaff(req)
    const { caseId, status, clientMessage = null, notify = true } = readBody(req)

    if (!caseId) throw httpError(400, 'CASE_REQUIRED', 'caseId is required.')
    if (!VALID.includes(status)) throw httpError(400, 'BAD_STATUS', 'Unknown status.')

    const { data: before } = await admin
      .from('tax_cases')
      .select('*, client:clients(*)')
      .eq('id', caseId)
      .maybeSingle()
    if (!before) throw httpError(404, 'CASE_NOT_FOUND', 'Tax file not found.')

    const patch = { status, status_updated_at: new Date().toISOString() }
    if (clientMessage !== null) patch.client_message = clientMessage
    if (status === 'finished') patch.finished_at = new Date().toISOString()

    const { data: updated, error: updateError } = await admin
      .from('tax_cases')
      .update(patch)
      .eq('id', caseId)
      .select()
      .single()
    if (updateError) throw httpError(400, 'UPDATE_FAILED', updateError.message)

    if (before.status !== status) {
      await admin.from('case_events').insert({
        case_id: caseId,
        event_type: 'status_change',
        from_status: before.status,
        to_status: status,
        actor_id: profile.id
      })
    }

    let emailSent = false
    let reason = null

    if (notify && before.client?.email) {
      const language = before.client.preferred_language || 'en'
      const copy = COPY[language] || COPY.en
      const statusLabel = copy.statusName[status]

      let bodyHtml = ''
      if (clientMessage) {
        bodyHtml += `<div style="margin:0 0 18px;padding:14px 16px;background:#FBF8F1;border:1px solid #EADCBD;border-radius:10px;">
            <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8C6D34;">
              ${copy.messageLabel}</p>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#3A3733;">${escapeHtml(clientMessage)}</p>
          </div>`
      }

      if (status === 'finished') {
        const { data: docs } = await admin
          .from('case_documents')
          .select('file_name')
          .eq('case_id', caseId)
          .eq('direction', 'specialist_upload')
          .order('created_at', { ascending: true })

        if (docs?.length) {
          bodyHtml += `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8C6D34;">
              ${copy.docsLabel}</p>
            <ul style="margin:0 0 18px;padding-left:18px;font-size:15px;line-height:1.7;color:#3A3733;">
              ${docs.map((d) => `<li>${escapeHtml(d.file_name)}</li>`).join('')}
            </ul>`
        }
      }

      const mail = await sendEmail({
        to: before.client.email,
        subject: copy.subject(before.tax_year, statusLabel),
        html: emailLayout({
          title: copy.title(before.tax_year),
          intro: copy.intro[status],
          bodyHtml,
          ctaLabel: copy.cta,
          ctaUrl: `${siteUrl()}/year/${caseId}`,
          footerNote: copy.footer
        })
      })
      emailSent = mail.sent
      reason = mail.reason

      if (emailSent) {
        await admin.from('case_events').insert({
          case_id: caseId,
          event_type: 'email_sent',
          note: copy.subject(before.tax_year, statusLabel),
          actor_id: profile.id
        })
      }
    }

    return res.status(200).json({ case: updated, emailSent, reason })
  } catch (error) {
    console.error('[case-status]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
