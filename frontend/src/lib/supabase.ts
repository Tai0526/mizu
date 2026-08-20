import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/** True once a project is configured; the app runs browser-only until then. */
export const hasSupabase = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = hasSupabase
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured for this build.')
  return supabase
}
