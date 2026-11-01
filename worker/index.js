// The Cloudflare Worker: the whole app in one deployment.
//
//   fetch      /api/files/<token>  -> api/files.js (signed R2 up/downloads)
//              /api/auth/<action>  -> api/auth/[action].js
//              /api/data/<op>      -> api/data/[op].js
//              /api/<name>         -> api/<name>.js
//              anything else       -> the built front-end (Workers Static
//                                     Assets, dist/, single-page fallback —
//                                     see wrangler.toml [assets])
//   scheduled  the monthly Cron Trigger -> open the new tax year
//   queue      EXTRACTION_QUEUE         -> one document extraction
//
// The api/ handlers keep their (req, res) signature; worker/vercelAdapter.js
// turns a Request into that and back. Secrets and vars reach them through
// process.env (nodejs_compat), bindings through api/_runtime.js.
import { setRuntime } from '../api/_runtime.js'
import { serviceClient } from '../api/_lib.js'
import { handleFileRequest } from '../api/files.js'
import { consumeExtractionBatch } from '../api/_extractionQueue.js'
import { openTaxYear } from '../api/open-tax-year.js'
import { runNodeHandler } from './vercelAdapter.js'
import authHandler from '../api/auth/[action].js'
import dataHandler from '../api/data/[op].js'
import caseAssistant from '../api/case-assistant.js'
import caseStatus from '../api/case-status.js'
import claimProfile from '../api/claim-profile.js'
import deleteClient from '../api/delete-client.js'
import extractDocumentNow from '../api/extract-document-now.js'
import inviteClient from '../api/invite-client.js'
import inviteStaff from '../api/invite-staff.js'
import notifyLateUpload from '../api/notify-late-upload.js'
import openTaxYearHandler from '../api/open-tax-year.js'
import register from '../api/register.js'
import reprocessClientYear from '../api/reprocess-client-year.js'
import resetPassword from '../api/reset-password.js'
import retryExtraction from '../api/retry-extraction.js'
import syncChildSuggestions from '../api/sync-child-suggestions.js'
import syncPersonalDetails from '../api/sync-personal-details.js'
import syncPropertySuggestion from '../api/sync-property-suggestion.js'

export const ENDPOINTS = {
  'case-assistant': caseAssistant,
  'case-status': caseStatus,
  'claim-profile': claimProfile,
  'delete-client': deleteClient,
  'extract-document-now': extractDocumentNow,
  'invite-client': inviteClient,
  'invite-staff': inviteStaff,
  'notify-late-upload': notifyLateUpload,
  'open-tax-year': openTaxYearHandler,
  register,
  'reprocess-client-year': reprocessClientYear,
  'reset-password': resetPassword,
  'retry-extraction': retryExtraction,
  'sync-child-suggestions': syncChildSuggestions,
  'sync-personal-details': syncPersonalDetails,
  'sync-property-suggestion': syncPropertySuggestion
}

// What vercel.json's "headers" set on every response.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
}

function withSecurityHeaders(response) {
  const out = new Response(response.body, response)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(name)) out.headers.set(name, value)
  }
  return out
}

const notFound = () => Response.json({ error: 'NOT_FOUND', code: 'NOT_FOUND' }, { status: 404 })

export async function routeApi(request, url) {
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(2) // after "/api"
  const [head, arg, ...rest] = parts
  if (head === 'files' && arg && !rest.length) return handleFileRequest(request, decodeURIComponent(arg))
  if (head === 'auth' && arg && !rest.length) return runNodeHandler(authHandler, request, { action: arg })
  if (head === 'data' && arg && !rest.length) return runNodeHandler(dataHandler, request, { op: arg })
  if (head && !arg && Object.prototype.hasOwnProperty.call(ENDPOINTS, head)) {
    return runNodeHandler(ENDPOINTS[head], request)
  }
  return notFound()
}

export default {
  async fetch(request, env, ctx) {
    setRuntime({ env, ctx })
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return withSecurityHeaders(await routeApi(request, url))
      } catch (error) {
        console.error('[worker]', error)
        return withSecurityHeaders(
          Response.json({ error: error.message || 'UNEXPECTED_ERROR', code: error.code }, { status: error.status || 500 })
        )
      }
    }
    // Static assets normally never reach the Worker (wrangler.toml
    // run_worker_first only claims /api/*); this is the fallback.
    if (env.ASSETS) return withSecurityHeaders(await env.ASSETS.fetch(request))
    return notFound()
  },

  async scheduled(controller, env, ctx) {
    setRuntime({ env, ctx })
    const result = await openTaxYear(serviceClient())
    console.log('[cron] open-tax-year', JSON.stringify(result))
  },

  async queue(batch, env, ctx) {
    setRuntime({ env, ctx })
    await consumeExtractionBatch(batch, { serviceClient })
  }
}
