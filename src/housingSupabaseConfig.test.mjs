import test from 'node:test'
import assert from 'node:assert/strict'
import { hasHousingSupabaseConfig, resolveHousingSupabaseConfig } from './housingSupabaseConfig.mjs'

test('housing database configuration is independent from VisaFlow variables', () => {
  const environment = {
    VITE_SUPABASE_URL: 'https://main.example.com',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'main-key',
  }
  assert.equal(hasHousingSupabaseConfig(environment), false)
  assert.throws(() => resolveHousingSupabaseConfig(environment), /incomplete/i)
})

test('resolves a dedicated housing project configuration', () => {
  const config = resolveHousingSupabaseConfig({
    VITE_HOUSING_SUPABASE_URL: 'https://housing.example.com/path',
    VITE_HOUSING_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  })
  assert.deepEqual(config, {
    url: 'https://housing.example.com',
    publishableKey: 'publishable-key',
  })
})

test('rejects service-role credentials', () => {
  assert.throws(() => resolveHousingSupabaseConfig({
    VITE_HOUSING_SUPABASE_URL: 'https://housing.example.com',
    VITE_HOUSING_SUPABASE_PUBLISHABLE_KEY: 'service_role_secret',
  }), /service-role/i)
})
