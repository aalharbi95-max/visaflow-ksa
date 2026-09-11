function value(environment, name) {
  return String(environment?.[name] ?? '').trim()
}

export function hasHousingSupabaseConfig(environment = {}) {
  return Boolean(
    value(environment, 'VITE_HOUSING_SUPABASE_URL')
    && value(environment, 'VITE_HOUSING_SUPABASE_PUBLISHABLE_KEY')
  )
}

export function resolveHousingSupabaseConfig(environment = {}) {
  const url = value(environment, 'VITE_HOUSING_SUPABASE_URL')
  const publishableKey = value(environment, 'VITE_HOUSING_SUPABASE_PUBLISHABLE_KEY')
  if (!url || !publishableKey) {
    throw new Error('Housing Supabase configuration is incomplete.')
  }

  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('VITE_HOUSING_SUPABASE_URL must be a valid absolute URL.')
  }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new Error('Housing Supabase URL must use HTTP or HTTPS.')
  }
  if (/service[_-]?role/i.test(publishableKey)) {
    throw new Error('A service-role credential must never be used in the Housing browser application.')
  }

  return Object.freeze({ url: parsedUrl.origin, publishableKey })
}

export function getViteHousingSupabaseConfig() {
  return resolveHousingSupabaseConfig(import.meta.env)
}

export function hasViteHousingSupabaseConfig() {
  return hasHousingSupabaseConfig(import.meta.env)
}
