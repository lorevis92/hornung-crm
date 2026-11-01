// What the Worker entry (worker/index.js) knows about the request it is
// serving and the module code below it can't receive as an argument
// without threading it through every handler: the bindings (R2 bucket,
// extraction queue, Cloudflare Images) and ctx.waitUntil.
//
// Plain configuration values (secrets, vars) are NOT here: with
// nodejs_compat they are in process.env, as they were on Vercel.
//
// Tests set their own stand-ins with setRuntime().
let current = { env: {}, ctx: null }

export function setRuntime({ env = {}, ctx = null } = {}) {
  current = { env, ctx }
}

export function runtimeBinding(name) {
  return current.env?.[name] ?? null
}

/** Keeps the isolate alive for `promise` after the response is sent
 * (Workers cap this at 30 s); outside a Worker it just runs. */
export function waitUntil(promise) {
  const guarded = Promise.resolve(promise).catch((error) => console.error('[waitUntil]', error))
  if (current.ctx?.waitUntil) current.ctx.waitUntil(guarded)
  return guarded
}
