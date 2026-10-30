// The browser must never talk to the database (or storage) on its own: every
// read/write goes through our /api functions, which check the session and
// the access rules. This guards against a page quietly re-introducing a
// direct supabase-js query.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : /\.(jsx?|tsx?)$/.test(entry) ? [full] : []
  })
}

const files = walk('src')

describe('browser code', () => {
  it('never imports supabase-js', () => {
    const offenders = files.filter((f) => /from\s+['"]@supabase\//.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('never builds a query or storage call itself', () => {
    const offenders = files.filter((f) =>
      /\bsupabase\s*\.\s*(from|rpc|storage|auth)\b/.test(readFileSync(f, 'utf8'))
    )
    expect(offenders).toEqual([])
  })

  it('never reads a database key from the environment', () => {
    const offenders = files.filter((f) => /VITE_SUPABASE_ANON_KEY|SERVICE_ROLE/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
