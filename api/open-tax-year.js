// GET/POST /api/open-tax-year
// Automatically opens the current tax year for every active client that does
// not have one yet. Triggered by the Vercel Cron Job defined in vercel.json
// (runs monthly so clients created after January are picked up too); can
// also be called manually with the same Authorization header.
import { APP_ID, serviceClient } from './_lib.js'

function currentTaxYear() {
  // Mirrors currentTaxYear() in src/lib/config.js: the declaration for
  // year N is filed during year N+1, so we open "last calendar year".
  return new Date().getUTCFullYear() - 1
}

function openingHasStarted(monthDay) {
  const match = /^(\d{2})-(\d{2})$/.exec(monthDay || '')
  const [, mm, dd] = match || [null, '01', '01']
  const now = new Date()
  const threshold = new Date(Date.UTC(now.getUTCFullYear(), Number(mm) - 1, Number(dd)))
  return now >= threshold
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return res
      .status(500)
      .json({ error: 'MISSING_CRON_SECRET', message: 'CRON_SECRET is not configured on the server.' })
  }

  const header = req.headers.authorization || ''
  if (header !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }

  const taxYear = currentTaxYear()
  const monthDay = process.env.AUTO_OPEN_MONTH_DAY || '01-01'

  if (!openingHasStarted(monthDay)) {
    console.log(`[open-tax-year] skipping — opening date ${monthDay} not reached yet for ${taxYear}`)
    return res.status(200).json({ taxYear, created: 0, skipped: 0 })
  }

  try {
    const admin = serviceClient()

    const { data: clients, error: clientsError } = await admin
      .from('clients')
      .select('id')
      .eq('app_id', APP_ID)
      .eq('status', 'active')
    if (clientsError) throw clientsError

    if (!clients?.length) {
      console.log(`[open-tax-year] tax year ${taxYear}: no active clients`)
      return res.status(200).json({ taxYear, created: 0, skipped: 0 })
    }

    const { data: existingCases, error: casesError } = await admin
      .from('tax_cases')
      .select('client_id')
      .eq('tax_year', taxYear)
      .in('client_id', clients.map((c) => c.id))
    if (casesError) throw casesError

    const alreadyOpen = new Set((existingCases || []).map((c) => c.client_id))
    const dueDate = `${taxYear + 1}-03-31`

    let created = 0
    let skipped = alreadyOpen.size

    for (const client of clients) {
      if (alreadyOpen.has(client.id)) continue

      const { data: caseRow, error: insertError } = await admin
        .from('tax_cases')
        .insert({ client_id: client.id, tax_year: taxYear, status: 'opened', due_date: dueDate })
        .select()
        .single()

      if (insertError) {
        // Idempotent: a concurrent run may have created it in the meantime.
        if (insertError.code === '23505') {
          skipped += 1
          continue
        }
        throw insertError
      }

      await admin.from('case_events').insert({
        case_id: caseRow.id,
        event_type: 'case_opened',
        note: 'Automatically opened by the scheduled task.'
      })
      created += 1
    }

    console.log(`[open-tax-year] tax year ${taxYear}: created ${created}, skipped ${skipped}`)
    return res.status(200).json({ taxYear, created, skipped })
  } catch (error) {
    console.error('[open-tax-year]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
