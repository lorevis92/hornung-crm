// The token of an invite / reset link (/set-password?token=..., see
// setPasswordLink in api/_auth.js). Links sent before the token moved to the
// query string carry it in the fragment (#token=...): still accepted, an
// invite stays valid for 7 days.
export function readLinkToken(location) {
  try {
    const fromQuery = new URLSearchParams(location.search || '').get('token')
    if (fromQuery) return fromQuery
    return new URLSearchParams((location.hash || '').replace(/^#/, '')).get('token') || ''
  } catch {
    return ''
  }
}

// The same address without the token (query parameter or fragment), for
// history.replaceState: the token leaves the address bar, the history and
// any later Referer as soon as it has been read.
export function addressWithoutToken(location) {
  const params = new URLSearchParams(location.search || '')
  params.delete('token')
  const query = params.toString()
  return location.pathname + (query ? `?${query}` : '')
}
