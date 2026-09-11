import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolveSupabaseConfig } from './supabaseConfig.mjs'

const PRODUCTION_URL_FOR_TEST = 'https://production-project.example.supabase.co'
const STAGING_URL = 'https://iijhdilfzndqlguefipn.supabase.co'
const TEST_PUBLISHABLE_KEY = 'test-publishable-key'

test('Production uses only the explicitly supplied deployment configuration', () => {
  assert.deepEqual(
    resolveSupabaseConfig({
      VITE_APP_ENV: 'production',
      VITE_SUPABASE_URL: PRODUCTION_URL_FOR_TEST,
      VITE_SUPABASE_PUBLISHABLE_KEY: TEST_PUBLISHABLE_KEY,
    }),
    {
      appEnv: 'production',
      publishableKey: TEST_PUBLISHABLE_KEY,
      url: PRODUCTION_URL_FOR_TEST,
    }
  )
})

test('Staging uses the explicitly supplied Staging project configuration', () => {
  assert.deepEqual(
    resolveSupabaseConfig({
      VITE_APP_ENV: 'staging',
      VITE_SUPABASE_URL: STAGING_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: TEST_PUBLISHABLE_KEY,
    }),
    {
      appEnv: 'staging',
      publishableKey: TEST_PUBLISHABLE_KEY,
      url: STAGING_URL,
    }
  )
})

test('missing configuration fails with a clear message', () => {
  assert.throws(
    () => resolveSupabaseConfig({ VITE_APP_ENV: 'staging' }),
    /missing VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.*no Production fallback/
  )
})

test('Preview cannot use an implicit Production fallback', () => {
  assert.throws(
    () => resolveSupabaseConfig({
      VITE_APP_ENV: 'preview',
      PRODUCTION_SUPABASE_URL: PRODUCTION_URL_FOR_TEST,
      PRODUCTION_SUPABASE_PUBLISHABLE_KEY: TEST_PUBLISHABLE_KEY,
    }),
    /missing VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.*no Production fallback/
  )
})

test('service-role credentials are rejected from browser configuration', () => {
  const serviceRoleFixture = ['service', 'role', 'test-only'].join('_')

  assert.throws(
    () => resolveSupabaseConfig({
      VITE_APP_ENV: 'staging',
      VITE_SUPABASE_URL: STAGING_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: serviceRoleFixture,
    }),
    /must never contain a service-role credential/
  )
})

test('Talent and Workspace share deployment config but retain separate storage keys', async () => {
  const [mainSource, source] = await Promise.all([
    readFile(new URL('./main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./supabase.js', import.meta.url), 'utf8'),
  ])

  assert.equal((source.match(/createClient\(supabaseUrl, supabaseKey/g) || []).length, 3)
  assert.match(source, /WORKSPACE_AUTH_STORAGE_KEY = 'visaflow-workspace-auth'/)
  assert.match(source, /storageKey: 'visaflow-talent-auth'/)
  assert.match(source, /createAIInterviewPortalClient\(accessToken\)/)
  assert.match(source, /'x-ai-interview-token': token/)
  assert.match(mainSource, /Application configuration error/)
  assert.match(mainSource, /getViteSupabaseConfig\(\)/)
  assert.match(mainSource, /await import\('\.\/App\.jsx'\)/)
  assert.doesNotMatch(source, /https:\/\/[a-z0-9-]+\.supabase\.co/)
  assert.doesNotMatch(source, /sb_publishable_[A-Za-z0-9_-]{20,}/)
})
