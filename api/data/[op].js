// POST /api/data/<op>   { ...named arguments }  ->  { data }
//
// The single door between the browser and the database (see
// api/_dataOps.js for every op and the rule it enforces). Every call:
//   1. must come from this site (Origin check) with a valid session cookie,
//   2. must belong to someone with a Hornung profile,
//   3. runs ONE whitelisted op, which re-checks access to the specific
//      client / case / document before touching it.
import { httpError, readBody, requireActor } from '../_lib.js'
import { ops } from '../_dataOps.js'

export default async function handler(req, res) {
  const op = req.query?.op
  try {
    if (req.method !== 'POST') throw httpError(405, 'METHOD_NOT_ALLOWED', 'METHOD_NOT_ALLOWED')
    if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(ops, op)) {
      throw httpError(404, 'UNKNOWN_OP', 'Unknown operation.')
    }
    const actor = await requireActor(req)
    if (!actor.profile) throw httpError(403, 'NO_PROFILE', 'This login has no access to the Hornung portal.')

    const body = readBody(req)
    const args = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
    const data = await ops[op](actor, args)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ data: data === undefined ? null : data })
  } catch (error) {
    if (!error.status || error.status >= 500) console.error(`[data/${op}]`, error)
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code })
  }
}
