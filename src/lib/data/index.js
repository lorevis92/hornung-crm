import { IS_DEMO } from '../config'
import { demoApi } from './demo'
import { supabaseApi } from './supabaseData'

// One import for the whole app; the implementation depends on whether the
// Supabase environment variables are present.
export const api = IS_DEMO ? demoApi : supabaseApi

export { resetDemo } from './demo'
