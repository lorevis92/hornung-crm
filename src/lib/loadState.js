// Loading a page's data, with exactly one rule: it always ENDS. Whatever the
// loader does — a missing table, a network error, a bug — the state moves
// from 'loading' to either 'ready' or 'error', never stays on the spinner.
// Pure (no React), so the rule is testable on its own; src/lib/useLoad.js is
// the hook every page uses on top of it.

// onState receives { status: 'loading' | 'ready' | 'error', error }.
export async function runLoad(loader, onState) {
  onState({ status: 'loading', error: null })
  try {
    await loader()
    onState({ status: 'ready', error: null })
  } catch (error) {
    console.error('[load]', error)
    onState({ status: 'error', error: error || new Error('UNKNOWN_ERROR') })
  }
}

// The technical detail shown to staff under the plain-language message:
// what the database (or the server) actually said, e.g.
// 'relation "public.entity_merge_decisions" does not exist (42P01)'.
// Supabase errors carry message/code/details/hint; a plain Error only a
// message — whichever parts exist are joined, nothing is invented.
export function describeLoadError(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  const message = error.message || String(error)
  const code = error.code ? ` (${error.code})` : ''
  const extras = [error.details, error.hint].filter((part) => part && part !== message)
  return [`${message}${code}`, ...extras].join(' — ')
}
