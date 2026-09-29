// Tax Summary shows its source-document viewer as a same-page state, not a
// separate route — but that state is driven by a URL query param
// (?view=source), not bare useState, specifically so the BROWSER's own
// back button (not just an in-app "back" click) returns to the Tax Summary
// list instead of skipping straight past it to whatever page was open
// before Tax Summary (the bug this exists to fix — see TaxSummary.jsx's
// viewSource/backToList). A pure function so the "never show a broken
// viewer" rule has one definition, checkable without rendering the page.
//
// searchParamsView: the raw `view` query-string value (or null/undefined).
// hasSourceField: whether a source field is actually loaded to show — false
//   right after a hard refresh (or a shared link) lands on a stale/direct
//   ?view=source URL with no field data behind it, which must fall back to
//   the list rather than rendering a viewer with nothing to show.
export function resolveTaxSummaryView(searchParamsView, hasSourceField) {
  return searchParamsView === 'source' && hasSourceField ? 'source' : 'list'
}
