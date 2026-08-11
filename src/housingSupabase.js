import { createClient } from '@supabase/supabase-js'
import { getViteHousingSupabaseConfig } from './housingSupabaseConfig.mjs'

let housingClient = null

export function getHousingSupabaseClient() {
  if (housingClient) return housingClient
  const { url, publishableKey } = getViteHousingSupabaseConfig()
  housingClient = createClient(url, publishableKey, {
    auth: {
      storageKey: 'housing-management-auth',
      storage: typeof window === 'undefined' ? undefined : window.localStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return housingClient
}
