// Regression test for the model-resolution precedence used by both AI-backed
// endpoints (api/case-assistant.js, api/extract-document.js): a specialist's
// saved choice (ai_model_settings) beats the env var, which beats the
// hardcoded default.
import { describe, expect, it } from 'vitest'
import { resolveModel } from '../src/lib/aiModels.js'

describe('resolveModel', () => {
  it('uses the database value when present, regardless of the env var', () => {
    expect(resolveModel({ dbValue: 'claude-opus-5', envValue: 'claude-haiku-4-5-20251001' })).toBe('claude-opus-5')
  })

  it('falls back to the env var when there is no database value', () => {
    expect(resolveModel({ dbValue: null, envValue: 'claude-haiku-4-5-20251001' })).toBe('claude-haiku-4-5-20251001')
  })

  it('falls back to the hardcoded default when neither is set', () => {
    expect(resolveModel({ dbValue: null, envValue: undefined })).toBe('claude-sonnet-5')
  })

  it('treats an empty-string database value as "not set", not a literal model id', () => {
    expect(resolveModel({ dbValue: '', envValue: 'claude-haiku-4-5-20251001' })).toBe('claude-haiku-4-5-20251001')
  })
})
