import { createClient } from '@supabase/supabase-js'
import { getViteSupabaseConfig } from './supabaseConfig.mjs'
import {
  clearWorkspaceRecoveryLocalState,
  getWorkspaceRecoveryUrlState,
} from './workspaceRecovery.mjs'

const {
  url: supabaseUrl,
  publishableKey: supabaseKey,
} = getViteSupabaseConfig()
export const WORKSPACE_AUTH_STORAGE_KEY = 'visaflow-workspace-auth'

function isTalentAuthUrl(url) {
  return url.searchParams.get('auth_flow') === 'candidate'
}

const browserAuthUrl = typeof window === 'undefined' ? null : new URL(window.location.href)
const workspaceRecoveryRequested = Boolean(
  browserAuthUrl && getWorkspaceRecoveryUrlState(browserAuthUrl).requested
)

if (workspaceRecoveryRequested) {
  clearWorkspaceRecoveryLocalState({
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    workspaceAuthStorageKey: WORKSPACE_AUTH_STORAGE_KEY,
  })
}

const workspaceDetectsAuthCallback = Boolean(
  browserAuthUrl && !isTalentAuthUrl(browserAuthUrl)
)
const talentDetectsAuthCallback = Boolean(
  browserAuthUrl && isTalentAuthUrl(browserAuthUrl)
)

export const workspaceSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: WORKSPACE_AUTH_STORAGE_KEY,
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Exactly one client may consume the callback; candidate links stay isolated.
    detectSessionInUrl: workspaceDetectsAuthCallback,
  },
})
export const supabase = workspaceSupabase

// Keep candidate authentication independent from the company workspace session.
export const talentSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: 'visaflow-talent-auth',
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: talentDetectsAuthCallback,
  },
})

let talentRecoveryUserId = null
let workspaceRecoveryUserId = null

function isWorkspaceUser(user) {
  const accountType = String(user?.user_metadata?.account_type || '').toLowerCase()
  return Boolean(user?.id) && accountType !== 'candidate'
}

export function establishWorkspaceRecoveryProof(event, session) {
  const valid = event === 'PASSWORD_RECOVERY'
    && workspaceRecoveryRequested
    && isWorkspaceUser(session?.user)
  workspaceRecoveryUserId = valid ? session.user.id : null
  return valid
}

export function hasWorkspaceRecoveryProof(userId) {
  return Boolean(userId && workspaceRecoveryUserId === userId)
}

export function clearWorkspaceRecoveryProof() {
  workspaceRecoveryUserId = null
}

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

workspaceSupabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    establishWorkspaceRecoveryProof(event, session)
  } else if (event === 'SIGNED_OUT') {
    clearWorkspaceRecoveryProof()
  }
})

export function hasTalentRecoveryProof(userId) {
  return Boolean(userId && talentRecoveryUserId === userId)
}

export function clearTalentRecoveryProof() {
  talentRecoveryUserId = null
}
