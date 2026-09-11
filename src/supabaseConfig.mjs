const SUPPORTED_APP_ENVIRONMENTS = new Set([
  'development',
  'preview',
  'production',
  'staging',
  'test',
])

function readEnvironmentValue(environment, name) {
  return String(environment?.[name] ?? '').trim()
}

function configurationError(message) {
  return new Error(`VisaFlow Supabase configuration error: ${message}`)
}

export function resolveSupabaseConfig(environment = {}) {
  const appEnv = readEnvironmentValue(environment, 'VITE_APP_ENV').toLowerCase()
  const url = readEnvironmentValue(environment, 'VITE_SUPABASE_URL')
  const publishableKey = readEnvironmentValue(
    environment,
    'VITE_SUPABASE_PUBLISHABLE_KEY'
  )

  const missing = [
    ['VITE_APP_ENV', appEnv],
    ['VITE_SUPABASE_URL', url],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', publishableKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw configurationError(
      `missing ${missing.join(', ')}. Configure all required variables for this deployment; no Production fallback is available.`
    )
  }

  if (!SUPPORTED_APP_ENVIRONMENTS.has(appEnv)) {
    throw configurationError(
      `unsupported VITE_APP_ENV "${appEnv}".`
    )
  }

  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    throw configurationError('VITE_SUPABASE_URL must be a valid absolute URL.')
  }

  if (parsedUrl.protocol !== 'https:' && appEnv !== 'development' && appEnv !== 'test') {
    throw configurationError('VITE_SUPABASE_URL must use HTTPS outside local development.')
  }

  if (/service[_-]?role/i.test(publishableKey)) {
    throw configurationError(
      'VITE_SUPABASE_PUBLISHABLE_KEY must never contain a service-role credential.'
    )
  }

  return Object.freeze({
    appEnv,
    publishableKey,
    url: parsedUrl.origin,
  })
}

export function getViteSupabaseConfig() {
  return resolveSupabaseConfig(import.meta.env)
}
