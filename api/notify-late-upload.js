// POST /api/notify-late-upload
//   { caseId, fileName }
//
// Called by the client app right after a successful client_upload (see
// api.uploadDocument + CasePage.jsx) when the case status is already
// 'review' or 'finished'. The RLS policy on case_documents intentionally
// lets clients upload regardless of status (see 20260101000003_hornung_rls.sql,
// "documents: client upload") — this endpoint is the other half of that
// decision: instead of blocking the upload, it alerts staff by e-mail so a
// document doesn't quietly land on a case nobody is actively working on
// anymore.
import { APP_ID, emailLayout, httpError, readBody, requireUser, sendEmail, siteUrl } from './_lib.js'

const LATE_STATUSES = ['review', 'finished']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' })

  try {
    const { user, admin } = await requireUser(req)
    const { caseId, fileName } = readBody(req)
    if (!caseId || !fileName) {
      throw httpError(400, 'MISSING_FIELDS', 'caseId and fileName are required.')
    }

    const { data: caseRow, error: caseError } = await admin
      .from('tax_cases')
      .select('id, tax_year, status, client:clients(profile_id, first_name, last_name, email)')
      .eq('id', caseId)
      .maybeSingle()
    if (caseError) throw httpError(400, 'LOOKUP_FAILED', caseError.message)
    if (!caseRow) throw httpError(404, 'CASE_NOT_FOUND', 'Tax case not found.')

    // Never trust the caller-supplied caseId alone — confirm the caller's
    // own profile is actually the client this case belongs to.
    const { data: profile } = await admin
      .from('app_profiles')
      .select('id')
      .eq('user_id', user.id)
      .eq('app_id', APP_ID)
      .maybeSingle()
    if (!profile || caseRow.client?.profile_id !== profile.id) {
      throw httpError(403, 'FORBIDDEN', 'You do not have access to this case.')
    }

    if (!LATE_STATUSES.includes(caseRow.status)) {
      return res.status(200).json({ notified: false })
    }

    const ownerEmail = process.env.OWNER_EMAIL
    if (!ownerEmail) {
      console.warn('[notify-late-upload] OWNER_EMAIL is not configured — skipping notification.')
      return res.status(200).json({ notified: false })
    }

    const clientName =
      [caseRow.client?.first_name, caseRow.client?.last_name].filter(Boolean).join(' ').trim() ||
      caseRow.client?.email ||
      'A client'
    const statusLabel = caseRow.status === 'finished' ? 'finished' : 'final review'

    const mail = await sendEmail({
      to: ownerEmail,
      subject: `New document on a ${statusLabel} case — ${clientName}`,
      html: emailLayout({
        title: 'New document on a closed case',
        intro: `${clientName} just uploaded "${fileName}" to their ${caseRow.tax_year} tax case, which is already marked "${statusLabel}". You may want to check whether this changes anything.`,
        ctaLabel: 'Open the case',
        ctaUrl: `${siteUrl()}/year/${caseId}`,
        footerNote: 'Internal notification — Hornung Consulting staff only.'
      })
    })

    return res.status(200).json({ notified: mail.sent })
  } catch (error) {
    console.error('[notify-late-upload]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
