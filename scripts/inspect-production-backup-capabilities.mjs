import assert from "node:assert/strict";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const expectedRef = "zeocbftriydodzfgixjv";
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.equal(projectRef, expectedRef, "Production project identity mismatch");

async function api(path, { optional = false } = {}) {
  const response = await fetch(`https://api.supabase.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (optional && !response.ok) return { available: false, status: response.status };
  assert.ok(response.ok, `Management API ${path} failed with HTTP ${response.status}`);
  return response.json();
}

const [project, organizations, backups] = await Promise.all([
  api(`/projects/${projectRef}`),
  api("/organizations"),
  api(`/projects/${projectRef}/database/backups`),
]);
assert.equal(project.id || project.ref, expectedRef, "Management API returned another project");

const organizationId = project.organization_id || project.organization_slug || project.organization?.id;
const organization = organizations.find((item) =>
  item.id === organizationId || item.slug === organizationId);
assert.ok(organization, "Production organization could not be resolved");
const organizationDetails = await api(`/organizations/${organization.slug}`);
const schedule = await api(`/projects/${projectRef}/database/backups/schedule`, { optional: true });

const completed = (Array.isArray(backups.backups) ? backups.backups : [])
  .filter((backup) => String(backup.status).toUpperCase() === "COMPLETED");
const completedTimes = completed
  .map((backup) => backup.inserted_at || backup.completed_at || backup.created_at)
  .filter(Boolean)
  .sort();
const latestCompletedAt = completedTimes.at(-1) || null;
const latestPhysicalUnix = Number(backups.physical_backup_data?.latest_physical_backup_date_unix || 0);
const latestPhysicalAt = latestPhysicalUnix > 0
  ? new Date(latestPhysicalUnix * 1_000).toISOString()
  : null;
const now = Date.now();
const recentCompleted = latestCompletedAt
  ? now - Date.parse(latestCompletedAt) < 48 * 60 * 60 * 1_000
  : false;
const recentPhysical = latestPhysicalAt
  ? now - Date.parse(latestPhysicalAt) < 48 * 60 * 60 * 1_000
  : false;

console.log(JSON.stringify({
  project_ref: projectRef,
  project_status: project.status || null,
  organization_plan: organizationDetails.plan || null,
  pitr_enabled: backups.pitr_enabled === true,
  walg_enabled: backups.walg_enabled === true,
  completed_backup_count: completed.length,
  latest_completed_at: latestCompletedAt,
  latest_physical_at: latestPhysicalAt,
  managed_backup_under_48h: backups.pitr_enabled === true || recentCompleted || recentPhysical,
  schedule_available: schedule.available !== false,
  scheduled_for: schedule.available === false ? null : schedule.schedule_for || null,
  schedule_http_status: schedule.available === false ? schedule.status : 200,
}));
