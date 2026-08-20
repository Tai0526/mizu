import { hasSupabase } from '../supabase'
import { createCloudStore } from './cloud'
import { createLocalStore } from './local'
import type { Store } from './types'

/**
 * One store for the whole app, chosen once at startup.
 *
 * With Supabase keys present the app is a shared, multi-device service. Without
 * them it is a single-browser sketchpad that behaves identically otherwise —
 * which is what makes it possible to try the idea before committing to a
 * backend.
 */
export const store: Store = hasSupabase ? createCloudStore() : createLocalStore()

export const isCloud = store.mode === 'cloud'

export type { Store } from './types'
