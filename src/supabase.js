import { createClient } from '@supabase/supabase-js'
import {
  clearWorkspaceRecoveryLocalState,
  getWorkspaceRecoveryUrlState,
} from './workspaceRecovery.mjs'

const defaultSupabaseUrl = 'https://zeocbftriydodzfgixjv.supabase.co'
const defaultSupabaseKey = 'sb_publishable_b5oQYxCWh6pwJsf8zDvDFA_HEcuoHCj'
const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || defaultSupabaseUrl).trim()
const supabaseKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || defaultSupabaseKey).trim()
const expectedProjectRef = String(import.meta.env.VITE_SUPABASE_EXPECTED_PROJECT_REF || '').trim()
const activeProjectRef = new URL(supabaseUrl).hostname.split('.')[0]

if (expectedProjectRef && activeProjectRef !== expectedProjectRef) {
  throw new Error('Configured Supabase project does not match the expected test project.')
}
export const WORKSPACE_AUTH_STORAGE_KEY = 'visaflow-workspace-auth'
export const TALENT_AUTH_STORAGE_KEY = 'visaflow-talent-auth'
export const INTERVIEW_AUTH_STORAGE_KEY = 'visaflow-interview-auth'

function isTalentAuthUrl(url) {
  return url.searchParams.get('auth_flow') === 'candidate'
}

function isInterviewAuthUrl(url) {
  return url.searchParams.get('auth_flow') === 'interview'
}

const browserAuthUrl = typeof window === 'undefined' ? null : new URL(window.location.href)
const workspaceRecoveryRequested = Boolean(
  browserAuthUrl && getWorkspaceRecoveryUrlState(browserAuthUrl).requested
)

if (workspaceRecoveryRequested) {
  // Remove only Workspace identity/session state before Supabase consumes the
  // recovery callback. Talent and public interview sessions remain isolated.
  clearWorkspaceRecoveryLocalState({
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    workspaceAuthStorageKey: WORKSPACE_AUTH_STORAGE_KEY,
  })
}

const workspaceDetectsAuthCallback = Boolean(
  browserAuthUrl && !isTalentAuthUrl(browserAuthUrl) && !isInterviewAuthUrl(browserAuthUrl)
)
const talentDetectsAuthCallback = Boolean(browserAuthUrl && isTalentAuthUrl(browserAuthUrl))

export const workspaceSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: WORKSPACE_AUTH_STORAGE_KEY,
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Supabase expects a boolean here. Exactly one persistent client is allowed
    // to consume an Auth callback, selected by the explicit auth_flow marker.
    detectSessionInUrl: workspaceDetectsAuthCallback,
  },
})
export const supabase = workspaceSupabase

// Keep candidate authentication independent from the company workspace session.
export const talentSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: TALENT_AUTH_STORAGE_KEY,
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: talentDetectsAuthCallback,
  },
})

// Public interviews use an isolated anonymous Auth session. It is deliberately
// tab-scoped so it cannot replace or inherit Workspace/Talent identity.
export const interviewSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: INTERVIEW_AUTH_STORAGE_KEY,
    storage: typeof window === 'undefined' ? undefined : window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

let talentRecoveryUserId = null
let workspaceRecoveryUserId = null

function isWorkspaceAuthUser(user) {
  const accountType = String(user?.user_metadata?.account_type || '').trim().toLowerCase()
  return Boolean(user?.id) && !['candidate', 'interview_portal'].includes(accountType)
}

export function establishWorkspaceRecoveryProof(event, session) {
  const isWorkspaceRecovery = event === 'PASSWORD_RECOVERY'
    && isWorkspaceAuthUser(session?.user)
    && workspaceRecoveryRequested

  workspaceRecoveryUserId = isWorkspaceRecovery ? session.user.id : null
  return isWorkspaceRecovery
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
