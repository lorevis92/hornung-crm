// The Claude models a specialist can pick for each AI-backed feature (Tax
// settings' "AI" tab) — shared between that page and anything that needs to
// validate a choice against the same list. Kept as a plain array (not an
// enum in the database) so adding a new model is a code change here, not a
// migration.
export const AI_MODELS = [
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    note: 'Most capable — slower and more expensive. Best for complex or unusual cases.'
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    note: 'Balanced quality, speed and cost — the default for both extraction and the assistant.'
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    note: 'Fastest and cheapest — best for high volume or simple, well-structured documents.'
  },
  {
    id: 'claude-fable-5-1',
    label: 'Claude Fable 5.1',
    note: 'Specialized model — verify it fits this use before switching to it.'
  }
]

export const DEFAULT_MODEL = 'claude-sonnet-5'

export function aiModelLabel(modelId) {
  return AI_MODELS.find((m) => m.id === modelId)?.label || modelId
}

// The exact precedence every AI-backed endpoint uses: a specialist's saved
// choice (ai_model_settings, see migration 20260101000044) wins if present,
// otherwise the env var, otherwise the hardcoded default — so changing the
// model in the database never requires a redeploy, and a fresh install with
// no row set behaves exactly as before this feature existed.
export function resolveModel({ dbValue, envValue, fallback = DEFAULT_MODEL } = {}) {
  return dbValue || envValue || fallback
}
