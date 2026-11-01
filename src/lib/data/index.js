import { supabaseApi } from './supabaseData'

// One import for the whole app: every call goes to our own /api functions.
export const api = supabaseApi
