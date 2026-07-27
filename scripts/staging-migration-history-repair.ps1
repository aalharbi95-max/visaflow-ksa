[CmdletBinding()]
param(
    [ValidateSet('Preflight', 'Repair')]
    [string]$Mode = 'Preflight'
)

$ErrorActionPreference = 'Stop'

$stagingRef = 'iijhdilfzndqlguefipn'
$productionRef = 'zeocbftriydodzfgixjv'
$poolerHost = 'aws-0-eu-central-1.pooler.supabase.com'
$poolerUser = "postgres.$stagingRef"
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$migrationNamePattern = '^(?<version>[0-9]{14})_.*\.sql$'

$approvedVersions = @(
    '20260718000100',
    '20260719000100',
    '20260719000200',
    '20260719000300',
    '20260719000400'
)

$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = Split-Path -Parent $scriptDirectory
$migrationsDirectory = Join-Path $repositoryRoot 'supabase\migrations'
$attemptMarker = Join-Path $repositoryRoot 'staging-migration-history-repair.attempted'

function Format-VersionList {
    param([string[]]$Versions)

    if ($null -eq $Versions -or $Versions.Count -eq 0) {
        return '[]'
    }

    return '[' + ($Versions -join ', ') + ']'
}

function Invoke-PsqlScalar {
    param([Parameter(Mandatory)][string]$Query)

    $nativePreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(
            & $psql "$env:STAGING_DB_URL" `
                --no-psqlrc `
                --set=ON_ERROR_STOP=on `
                --tuples-only `
                --no-align `
                --quiet `
                --command="$Query" `
                2>&1 |
                ForEach-Object { $_.ToString() }
        )
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $nativePreference
    }

    if ($exitCode -ne 0) {
        throw "Read-only migration history query failed with exit code $exitCode."
    }

    return @(
        $output |
            ForEach-Object { $_.Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
}

function Invoke-SupabaseMigrationList {
    $nativePreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(
            npx --yes supabase@2.109.1 migration list `
                --db-url "$env:STAGING_DB_URL" `
                --output pretty `
                2>&1 |
                ForEach-Object { $_.ToString() }
        )
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $nativePreference
    }

    return @{
        Output = $output
        ExitCode = $exitCode
    }
}

function Invoke-ApprovedMigrationRepairOnce {
    $nativePreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(
            npx --yes supabase@2.109.1 migration repair `
                20260718000100 `
                20260719000100 `
                20260719000200 `
                20260719000300 `
                20260719000400 `
                --status applied `
                --db-url "$env:STAGING_DB_URL" `
                --output pretty `
                2>&1 |
                ForEach-Object { $_.ToString() }
        )
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $nativePreference
    }

    return @{
        Output = $output
        ExitCode = $exitCode
    }
}
if (-not (Test-Path -LiteralPath $migrationsDirectory -PathType Container)) {
    throw "Migrations directory was not found: $migrationsDirectory"
}
if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) {
    throw 'psql 17 was not found.'
}

$migrationFiles = @(
    Get-ChildItem -LiteralPath $migrationsDirectory -File -Filter '*.sql' |
        Sort-Object Name
)

$invalidFiles = @(
    $migrationFiles |
        Where-Object { $_.Name -cnotmatch $migrationNamePattern } |
        ForEach-Object { $_.Name }
)
if ($invalidFiles.Count -gt 0) {
    throw "SQL migration filenames do not match the required pattern: $($invalidFiles -join ', ')"
}

$localVersions = @(
    $migrationFiles |
        ForEach-Object {
            if ($_.Name -cmatch $migrationNamePattern) {
                $Matches.version
            }
        }
)
$duplicateVersions = @(
    $localVersions |
        Group-Object |
        Where-Object { $_.Count -gt 1 } |
        ForEach-Object { $_.Name }
)
$additionalVersions = @(
    $localVersions |
        Where-Object { $_ -cnotin $approvedVersions }
)
$missingVersions = @(
    $approvedVersions |
        Where-Object { $_ -cnotin $localVersions }
)
$localMatchesApproved = (
    $invalidFiles.Count -eq 0 -and
    $duplicateVersions.Count -eq 0 -and
    $additionalVersions.Count -eq 0 -and
    $missingVersions.Count -eq 0 -and
    (($localVersions -join ',') -ceq ($approvedVersions -join ','))
)

Write-Output "LocalVersions = $(Format-VersionList -Versions $localVersions)"
Write-Output "ApprovedVersions = $(Format-VersionList -Versions $approvedVersions)"
Write-Output "AdditionalVersions = $(Format-VersionList -Versions $additionalVersions)"
Write-Output "MissingVersions = $(Format-VersionList -Versions $missingVersions)"
Write-Output "DuplicateVersions = $(Format-VersionList -Versions $duplicateVersions)"

if (-not $localMatchesApproved) {
    throw 'Local migration versions do not exactly match the five approved historical versions.'
}

$securePassword = Read-Host 'Enter the VisaFlow Staging database password' -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = $null
$dbUriBuilder = $null

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
    $dbUriBuilder = [UriBuilder]::new()
    $dbUriBuilder.Scheme = 'postgresql'
    $dbUriBuilder.Host = $poolerHost
    $dbUriBuilder.Port = 5432
    $dbUriBuilder.UserName = $poolerUser
    $dbUriBuilder.Password = $plainPassword
    $dbUriBuilder.Path = 'postgres'
    $env:STAGING_DB_URL = $dbUriBuilder.Uri.AbsoluteUri
    $env:PGPASSWORD = $plainPassword
    $env:SUPABASE_TELEMETRY_DISABLED = '1'
    $env:DO_NOT_TRACK = '1'

    if ([string]::IsNullOrWhiteSpace($env:STAGING_DB_URL)) {
        throw 'STAGING_DB_URL is missing.'
    }
    if ($env:STAGING_DB_URL -notmatch $stagingRef) {
        throw 'Refusing to continue: connection is not confirmed as VisaFlow Staging.'
    }
    if ($env:STAGING_DB_URL -match $productionRef) {
        throw 'Refusing to continue: Production reference detected.'
    }

    $relationName = @(
        Invoke-PsqlScalar -Query "SELECT COALESCE(to_regclass('supabase_migrations.schema_migrations')::text, '');"
    )

    if ($relationName.Count -eq 0) {
        $migrationHistoryStatus = 'NOT_INITIALIZED'
        $remoteVersions = @()
    }
    else {
        $migrationHistoryStatus = 'INITIALIZED'
        $remoteVersions = @(
            Invoke-PsqlScalar -Query 'SELECT version::text FROM supabase_migrations.schema_migrations ORDER BY version::text;'
        )
    }

    $remoteIsEmpty = ($remoteVersions.Count -eq 0)
    $preflightPassed = $localMatchesApproved -and $remoteIsEmpty

    Write-Output "RemoteVersions = $(Format-VersionList -Versions $remoteVersions)"
    Write-Output "migration_history_status = $migrationHistoryStatus"
    Write-Output "LocalVersionsMatchApproved = $localMatchesApproved"
    Write-Output "RemoteVersionsEmpty = $remoteIsEmpty"
    Write-Output "Preflight = $(if ($preflightPassed) { 'PASS' } else { 'FAIL' })"
    Write-Output 'Proposed migration repair command (NOT EXECUTED):'
    Write-Output 'npx --yes supabase@2.109.1 migration repair 20260718000100 20260719000100 20260719000200 20260719000300 20260719000400 --status applied --db-url "$env:STAGING_DB_URL" --output pretty'

    if (-not $preflightPassed) {
        throw 'Preflight did not pass. Migration repair remains prohibited.'
    }

    if ($Mode -eq 'Preflight') {
        Write-Output 'Preflight-only mode complete. No migration repair executed.'
        return
    }

    if (Test-Path -LiteralPath $attemptMarker) {
        throw 'Refusing to continue: a migration history repair attempt was already recorded.'
    }

    Set-Content -LiteralPath $attemptMarker -Value (
        "UTC attempt recorded before migration repair: {0:o}" -f [DateTime]::UtcNow
    ) -Encoding ascii

    Write-Output 'Executing the approved migration history repair once...'
    $repair = Invoke-ApprovedMigrationRepairOnce
    $repair.Output | Write-Output
    if ($repair.ExitCode -ne 0) {
        throw "Migration repair failed with exit code $($repair.ExitCode). No retry is permitted."
    }

    Write-Output 'Migration repair command succeeded. Running migration list...'
    $migrationList = Invoke-SupabaseMigrationList
    $migrationList.Output | Write-Output
    if ($migrationList.ExitCode -ne 0) {
        throw "Post-repair migration list failed with exit code $($migrationList.ExitCode)."
    }
    if (-not ($migrationList.Output -match 'Connecting to remote database')) {
        throw 'Post-repair migration list did not confirm a remote database connection.'
    }

    $postRepairRelation = @(
        Invoke-PsqlScalar -Query "SELECT COALESCE(to_regclass('supabase_migrations.schema_migrations')::text, '');"
    )
    if ($postRepairRelation.Count -eq 0) {
        throw 'Migration history remained NOT_INITIALIZED after repair.'
    }

    $postRepairRemoteVersions = @(
        Invoke-PsqlScalar -Query 'SELECT version::text FROM supabase_migrations.schema_migrations ORDER BY version::text;'
    )
    $postRepairCount = $postRepairRemoteVersions.Count
    $postRepairMatches = (
        $postRepairCount -eq 5 -and
        (($postRepairRemoteVersions -join ',') -ceq ($approvedVersions -join ',')) -and
        (($localVersions -join ',') -ceq ($postRepairRemoteVersions -join ','))
    )

    Write-Output "PostRepairLocalVersions = $(Format-VersionList -Versions $localVersions)"
    Write-Output "PostRepairRemoteVersions = $(Format-VersionList -Versions $postRepairRemoteVersions)"
    Write-Output "PostRepairMigrationCount = $postRepairCount"
    Write-Output "PostRepairLocalRemoteMatch = $postRepairMatches"

    if (-not $postRepairMatches) {
        throw 'Post-repair verification failed: Local and Remote are not exactly the five approved versions.'
    }

    Write-Output 'SUCCESS: Five historical migrations recorded and verified on VisaFlow Staging.'
}
finally {
    $env:STAGING_DB_URL = $null
    $env:PGPASSWORD = $null
    $env:SUPABASE_TELEMETRY_DISABLED = $null
    $env:DO_NOT_TRACK = $null
    $plainPassword = $null
    $dbUriBuilder = $null
    if ($passwordPtr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
    }
}
