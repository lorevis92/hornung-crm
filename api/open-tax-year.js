// Automatically opens the current tax year for every active client that does
// not have one yet.
//   * monthly, by the Cloudflare Cron Trigger in wrangler.toml
//     ([triggers] crons, "0 6 1 * *" — what the Vercel cron in vercel.json
//     was), which calls openTaxYear() from worker/index.js's scheduled()
//     handler: no HTTP request, no secret involved;
//   * by hand: GET/POST /api/open-tax-year with "Authorization: Bearer
//     <CRON_SECRET>" (the handler below), as before.
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

/** Opens the current tax year where missing -> { taxYear, created, skipped }. */
export async function openTaxYear(admin) {
  const taxYear = currentTaxYear()
  const monthDay = process.env.AUTO_OPEN_MONTH_DAY || '01-01'

  if (!openingHasStarted(monthDay)) {
    console.log(`[open-tax-year] skipping — opening date ${monthDay} not reached yet for ${taxYear}`)
    return { taxYear, created: 0, skipped: 0 }
  }

  const { data: clients, error: clientsError } = await admin
    .from('clients')
    .select('id')
    .eq('app_id', APP_ID)
    .eq('status', 'active')
  if (clientsError) throw clientsError

  if (!clients?.length) {
    console.log(`[open-tax-year] tax year ${taxYear}: no active clients`)
    return { taxYear, created: 0, skipped: 0 }
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
  return { taxYear, created, skipped }
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

  try {
    return res.status(200).json(await openTaxYear(serviceClient()))
  } catch (error) {
    console.error('[open-tax-year]', error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
