import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zeocbftriydodzfgixjv.supabase.co'
const supabaseKey = 'sb_publishable_b5oQYxCWh6pwJsf8zDvDFA_HEcuoHCj'

function isTalentAuthUrl(url) {
  return url.searchParams.get('auth_flow') === 'candidate'
}

function isImplicitAuthCallback(params) {
  return Boolean(params.access_token || params.error_description)
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Preserve normal company callbacks while excluding explicitly marked candidate links.
    detectSessionInUrl: (url, params) => !isTalentAuthUrl(url) && isImplicitAuthCallback(params),
  },
})

// Keep candidate authentication independent from the company workspace session.
export const talentSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: 'visaflow-talent-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: (url, params) => isTalentAuthUrl(url) && isImplicitAuthCallback(params),
  },
})

let talentRecoveryUserId = null

export function establishTalentRecoveryProof(event, session) {
  const isCandidateRecovery = event === 'PASSWORD_RECOVERY'
    && Boolean(session?.user?.id)
    && session.user.user_metadata?.account_type === 'candidate'

  talentRecoveryUserId = isCandidateRecovery ? session.user.id : null
  return isCandidateRecovery
}

talentSupabase.auth.onAuthStateChange((event, session) => {
  const isCandidate = session?.user?.user_metadata?.account_type === 'candidate'

  if (event === 'PASSWORD_RECOVERY') {
    establishTalentRecoveryProof(event, session)
  }

  if (session && !isCandidate && ['INITIAL_SESSION', 'SIGNED_IN', 'PASSWORD_RECOVERY'].includes(event)) {
    talentRecoveryUserId = null
    setTimeout(() => {
      talentSupabase.auth.signOut({ scope: 'local' })
    }, 0)
  }
})

export function hasTalentRecoveryProof(userId) {
  return Boolean(userId && talentRecoveryUserId === userId)
}

export function clearTalentRecoveryProof() {
  talentRecoveryUserId = null
}
