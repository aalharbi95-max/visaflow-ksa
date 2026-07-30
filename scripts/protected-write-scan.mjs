import { readFile } from 'node:fs/promises'

const protectedTables = [
  'visa_authorizations',
  'authorization_events',
  'notification_events',
  'users',
  'agencies',
  'company_agency_access',
  'agency_company_user_access',
  'agency_provisioning_requests',
  'agency_provisioning_events',
]
// Vite's live entry imports App.jsx and the focused workflow module. Historical
// backup folders under src are intentionally not part of the application graph.
const productionFiles = [
  'src/App.jsx',
  'src/authorizationWorkflow.mjs',
  'src/agencyInvitation.mjs',
]
const findings = []

for (const file of productionFiles) {
  const source = await readFile(file, 'utf8')
  for (const table of protectedTables) {
    const pattern = new RegExp(
      String.raw`\.from\(\s*["']${table}["']\s*\)[\s\S]{0,200}?\.(?:insert|update|upsert|delete)\s*\(`,
      'g'
    )
    if (pattern.test(source)) findings.push(`${file}: direct ${table} mutation`)
    }
}

if (findings.length) {
  console.error(findings.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Protected-write scan passed (${protectedTables.length} tables, ${productionFiles.length} production files).`)
}
