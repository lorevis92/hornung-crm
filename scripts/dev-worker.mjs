// npm run dev:worker — the whole app locally, in workerd (the Workers
// runtime), with nothing on Cloudflare or Neon:
//   * Postgres: scripts/local-neon.mjs (PGlite + every migration), reached
//     through the real Neon driver;
//   * R2, the extraction queue, Cloudflare Images (reduced local version)
//     and the cron trigger: emulated by `wrangler dev` (state in .wrangler/);
//   * the front-end from dist/ (run `npm run build` first; for hot reload
//     run `npm run dev` too — vite proxies /api to this Worker).
// ANTHROPIC_API_KEY / RESEND_API_KEY: in .dev.vars (git-ignored), optional.
//
//   node scripts/dev-worker.mjs [--fresh] [--port 8787]
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { startLocalNeon } from './local-neon.mjs'

export const LOCAL_DATABASE_URL = 'postgresql://local:local@local-neon.localhost/hornung'

export async function startDevWorker({ port = 8787, fresh = false, neonPort = 4444, quiet = false, extraArgs = [] } = {}) {
  const log = quiet ? () => {} : console.log
  if (!existsSync('dist/index.html')) log('[dev-worker] dist/ is missing: run `npm run build` first for the pages (the API works anyway).')
  const neon = await startLocalNeon({ port: neonPort, fresh, log })
  const vars = {
    DATABASE_URL: LOCAL_DATABASE_URL,
    NEON_FETCH_ENDPOINT: neon.url,
    // A fresh one per run unless .dev.vars sets it (wrangler gives --var precedence).
    FILES_SIGNING_SECRET: process.env.FILES_SIGNING_SECRET || randomBytes(32).toString('hex'),
    PUBLIC_SITE_URL: `http://127.0.0.1:${port}`
  }
  const args = ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--test-scheduled', ...extraArgs]
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`)
  const child = spawn('npx', args, { shell: process.platform === 'win32', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  let output = ''
  child.stdout?.on('data', (d) => (output += d))
  child.stderr?.on('data', (d) => (output += d))
  const stop = async () => {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true })
    else child.kill()
    await neon.close()
  }
  return { child, neon, stop, output: () => output, url: `http://127.0.0.1:${port}` }
}

if (process.argv[1]?.endsWith('dev-worker.mjs')) {
  const portArg = process.argv.indexOf('--port')
  const { stop } = await startDevWorker({
    port: portArg > 0 ? Number(process.argv[portArg + 1]) : 8787,
    fresh: process.argv.includes('--fresh')
  })
  process.on('SIGINT', async () => {
    await stop()
    process.exit(0)
  })
}
