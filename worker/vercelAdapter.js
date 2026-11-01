// Runs a handler written in the Vercel/Node style — handler(req, res) — as a
// Workers fetch handler: Request in, Response out.
//
// The endpoints in api/ keep that signature on purpose: the tests drive the
// real handlers with tiny req/res stand-ins (test/helpers/fakeSupabase.js),
// and one adapter here is the whole difference between the two runtimes.
// Only what the handlers use is implemented:
//   req: method, url, headers (lower-case names), query, body (parsed JSON,
//        else the raw text — as Vercel did)
//   res: status(), json(), setHeader(), getHeader(), writeHead(), end()

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024

export async function toNodeRequest(request, params = {}) {
  const url = new URL(request.url)
  const headers = {}
  for (const [name, value] of request.headers) headers[name.toLowerCase()] = value
  const query = { ...Object.fromEntries(url.searchParams), ...params }

  let body
  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    const declared = Number(headers['content-length'])
    if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) {
      const error = new Error('Request body too large.')
      error.status = 413
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
    const text = await request.text()
    if (text.length > MAX_JSON_BODY_BYTES) {
      const error = new Error('Request body too large.')
      error.status = 413
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
    if (/application\/json/i.test(headers['content-type'] || '')) {
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        body = text
      }
    } else {
      body = text
    }
  }
  return { method, url: url.pathname + url.search, headers, query, body }
}

export function createNodeResponse() {
  const state = { status: 200, headers: new Headers(), body: null, done: false }
  const res = {
    get statusCode() {
      return state.status
    },
    set statusCode(code) {
      state.status = code
    },
    status(code) {
      state.status = code
      return res
    },
    json(payload) {
      if (!state.headers.has('content-type')) state.headers.set('content-type', 'application/json; charset=utf-8')
      state.body = JSON.stringify(payload)
      state.done = true
      return res
    },
    setHeader(name, value) {
      state.headers.delete(name)
      for (const v of Array.isArray(value) ? value : [value]) state.headers.append(name, String(v))
      return res
    },
    getHeader(name) {
      if (name.toLowerCase() === 'set-cookie') {
        const cookies = state.headers.getSetCookie()
        return cookies.length ? cookies : undefined
      }
      return state.headers.get(name) ?? undefined
    },
    writeHead(code, headers = {}) {
      state.status = code
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
      return res
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) state.body = chunk
      state.done = true
      return res
    }
  }
  return {
    res,
    toResponse() {
      // Null-body statuses must not carry a body.
      const body = [101, 204, 205, 304].includes(state.status) ? null : state.body
      return new Response(body, { status: state.status, headers: state.headers })
    }
  }
}

export async function runNodeHandler(handler, request, params) {
  let req
  try {
    req = await toNodeRequest(request, params)
  } catch (error) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status || 400 })
  }
  const { res, toResponse } = createNodeResponse()
  await handler(req, res)
  return toResponse()
}
