-- ===========================================================================
-- 44 — AI model choice, editable by the consultant, no redeploy needed
-- ---------------------------------------------------------------------------
-- Both AI-backed features (document extraction, api/extract-document.js;
-- the case assistant, api/case-assistant.js) previously picked their model
-- only from an env var (ANTHROPIC_EXTRACTION_MODEL / ANTHROPIC_ASSISTANT_MODEL),
-- which needs a redeploy to change. This table lets a specialist choose a
-- model from the Tax settings "AI" tab instead — the endpoints check this
-- table FIRST and fall back to the env var (then a hardcoded default) only
-- when no row is set, so nothing breaks for an install that never touches
-- this screen.
--
-- Deliberately its own table, not a row in app_settings (20260101000011) —
-- that table is service-role only (it holds a real secret, the extraction
-- webhook secret) and must never gain a staff-readable/writable RLS policy;
-- mixing a secret store with a normal, specialist-editable setting in one
-- table would risk loosening that by accident later.
-- ===========================================================================

create table if not exists public.ai_model_settings (
  key         text primary key check (key in ('extraction_model', 'assistant_model')),
  model       text,                -- null = "no override", the endpoint falls back to its env var / default
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.app_profiles(id) on delete set null
);

drop trigger if exists ai_model_settings_touch on public.ai_model_settings;
create trigger ai_model_settings_touch before update on public.ai_model_settings
  for each row execute function public.touch_updated_at();

alter table public.ai_model_settings enable row level security;

drop policy if exists "ai model settings: staff all" on public.ai_model_settings;
create policy "ai model settings: staff all" on public.ai_model_settings for all to authenticated
  using (public.is_hornung_staff()) with check (public.is_hornung_staff());
