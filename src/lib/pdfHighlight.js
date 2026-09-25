// Approximate text search across a PDF page's text-content items, used to
// point the specialist at roughly where an AI-extracted value came from.
// Doesn't need a perfect character-for-character match — a partial match on
// a normalized quote is good enough to highlight the right area of the page.
function normalize(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Returns the indexes (into itemStrings) of the text items that overlap the
// best match found for `quote`, or an empty array if nothing matched at all.
export function findQuoteItemIndexes(itemStrings, quote) {
  const normQuote = normalize(quote)
  if (!normQuote) return []

  const offsets = []
  let concat = ''
  itemStrings.forEach((str, idx) => {
    const normStr = normalize(str)
    if (concat) concat += ' '
    const start = concat.length
    concat += normStr
    offsets.push({ idx, start, end: concat.length })
  })

  const candidates = [normQuote, normQuote.slice(0, 60), normQuote.slice(0, 30), normQuote.slice(0, 15)]
  const tried = new Set()
  for (const candidate of candidates) {
    if (candidate.length < 6 || tried.has(candidate)) continue
    tried.add(candidate)
    const at = concat.indexOf(candidate)
    if (at === -1) continue
    const matchEnd = at + candidate.length
    const matched = offsets.filter((o) => o.end > at && o.start < matchEnd).map((o) => o.idx)
    if (matched.length) return matched
  }
  return []
}
