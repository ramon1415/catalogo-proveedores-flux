[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$PgBin = 'C:\Users\Public\codex-pg16\pgsql\bin',

  [Parameter(Mandatory = $false)]
  [string]$HostName = '127.0.0.1',

  [Parameter(Mandatory = $false)]
  [int]$Port = 55436,

  [Parameter(Mandatory = $false)]
  [string]$Database = 'flux_shadow_036_037',

  [Parameter(Mandatory = $false)]
  [string]$DatabaseUser = 'postgres'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Database -notmatch '^[a-z][a-z0-9_]{0,62}$') {
  throw "Unsafe shadow database name: $Database"
}

$psql = Join-Path $PgBin 'psql.exe'
$dropdb = Join-Path $PgBin 'dropdb.exe'
$createdb = Join-Path $PgBin 'createdb.exe'
$requiredTools = @($psql, $dropdb, $createdb)

foreach ($tool in $requiredTools) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
    throw "PostgreSQL tool not found: $tool"
  }
}

$repoRoot = (
  Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')
).Path
$migrationsDir = Join-Path $repoRoot 'supabase\migrations'
$prelude = Join-Path $PSScriptRoot '000_supabase_prelude.sql'
$seed = Join-Path $PSScriptRoot '035_seed_extraordinary_7_1_1.sql'
$postcheck036 = Join-Path $PSScriptRoot '036_postcheck.sql'
$postcheck037 = Join-Path $PSScriptRoot '037_postcheck_and_negative.sql'
$fixture038 = Join-Path $PSScriptRoot '038_fixture_and_old_failure.sql'
$contracts038 = Join-Path $PSScriptRoot '038_mixed_close_contracts.sql'
$pregrant039 = Join-Path $PSScriptRoot (
  '039_pregrant_storage_policy_contracts.sql'
)
$postgrant039 = Join-Path $PSScriptRoot (
  '039_postgrant_storage_policy_contracts.sql'
)
$oldFailure040 = Join-Path $PSScriptRoot (
  '040_old_failure_reproduction.sql'
)
$contracts040 = Join-Path $PSScriptRoot (
  '040_consumption_material_guards_contracts.sql'
)
$concurrencyFixture040 = Join-Path $PSScriptRoot (
  '040_concurrency_fixture.sql'
)
$concurrencyAssert040 = Join-Path $PSScriptRoot (
  '040_concurrency_assert.sql'
)
$devPrecheck039 = Join-Path $repoRoot (
  'scripts\qa\extraordinary-039-dev-precheck-readonly.sql'
)
$devPrecheck040 = Join-Path $repoRoot (
  'scripts\qa\extraordinary-040-dev-precheck-readonly.sql'
)
$devPostcheck040 = Join-Path $repoRoot (
  'scripts\qa\extraordinary-040-dev-postcheck-readonly.sql'
)
$precheck036 = Join-Path $repoRoot (
  'scripts\qa\legacy-extraordinary-direct-lineage-precheck.sql'
)
$migration036 = Join-Path $migrationsDir (
  '036_quarantine_legacy_extraordinary_authorizations.sql'
)
$migration037 = Join-Path $migrationsDir (
  '037_secure_extraordinary_external_authorization.sql'
)
$migration038 = Join-Path $migrationsDir (
  '038_materialize_only_released_batch_items.sql'
)
$migration039 = Join-Path $migrationsDir (
  '039_enable_extraordinary_evidence_storage_policy_helper.sql'
)
$migration040 = Join-Path $migrationsDir (
  '040_fix_extraordinary_consumption_and_material_invalidation.sql'
)
$expectedMigration037Sha256 = (
  '266542d2b587c46f99a64eabe3b362f7cb039249b7efda1479572bffbded7c87'
)
$migration037TransportCopy = Join-Path (
  [System.IO.Path]::GetTempPath()
) (
  'flux-shadow-037-crlf-{0}.sql' -f [guid]::NewGuid().ToString('N')
)

$allMigrations = @(
  Get-ChildItem -LiteralPath $migrationsDir -File -Filter '*.sql' |
    Sort-Object Name
)
$migration036Index = [array]::FindIndex(
  [System.IO.FileInfo[]]$allMigrations,
  [Predicate[System.IO.FileInfo]] {
    param($migration)
    $migration.Name -eq (
      '036_quarantine_legacy_extraordinary_authorizations.sql'
    )
  }
)

if ($migration036Index -lt 1) {
  throw 'Could not derive the exact pre-036 migration sequence'
}

$baseMigrations = @($allMigrations[0..($migration036Index - 1)])

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  Write-Output "RUN $Label"
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = @(
    & $psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -h $HostName `
      -p $Port `
      -U $DatabaseUser `
      -d $Database `
      -f $Path 2>&1
  )
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  $output | ForEach-Object { Write-Output $_ }

  if ($exitCode -ne 0) {
    throw "$Label failed with exit code $exitCode"
  }

  if (($output | Out-String) -match '(?i)identifier will be truncated') {
    throw "$Label emitted an identifier truncation warning"
  }
}

function Invoke-PsqlCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Sql,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  Write-Output "RUN $Label"
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = @(
    & $psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -h $HostName `
      -p $Port `
      -U $DatabaseUser `
      -d $Database `
      --command $Sql 2>&1
  )
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  $output | ForEach-Object { Write-Output $_ }

  if ($exitCode -ne 0) {
    throw "$Label failed with exit code $exitCode"
  }
}

function Invoke-040Concurrency {
  $insertTemplate = @'
begin;
set local lock_timeout = '15s';
insert into public.payment_layout_lines(
  id,
  layout_id,
  payment_request_id,
  company_id,
  proveedor_id,
  company_bank_account_id,
  source_account_number,
  company_name,
  destination_type,
  destination_value,
  beneficiary_name,
  amount,
  payment_reference,
  payment_concept,
  request_number,
  status
) values (
  '{0}'::uuid,
  '{1}'::uuid,
  '42100000-0000-4000-8000-000000000001'::uuid,
  '02000000-0000-4000-8000-000000000001'::uuid,
  '42000000-0000-4000-8000-000000000001'::uuid,
  '42900000-0000-4000-8000-000000000001'::uuid,
  '424000000000000001',
  'Shadow QA Company',
  'cuenta',
  '424000000000000001',
  'Shadow 040 Concurrent',
  4201,
  '42001',
  'Shadow 040 concurrent request',
  'SHADOW-040-CONCURRENT',
  'included'
);
select pg_sleep(0.5);
commit;
'@
  $commands = @(
    ($insertTemplate -f
      '42300000-0000-4000-8000-000000000001',
      '42200000-0000-4000-8000-000000000001'),
    ($insertTemplate -f
      '42300000-0000-4000-8000-000000000002',
      '42200000-0000-4000-8000-000000000002')
  )

  Write-Output 'RUN migration 040 true two-session concurrency'
  $jobs = @(
    foreach ($sql in $commands) {
      Start-Job -ScriptBlock {
        param(
          [string]$PsqlPath,
          [string]$ServerHost,
          [int]$ServerPort,
          [string]$UserName,
          [string]$DatabaseName,
          [string]$CommandText
        )
        $result = @(
          & $PsqlPath `
            -X `
            -v ON_ERROR_STOP=1 `
            -h $ServerHost `
            -p $ServerPort `
            -U $UserName `
            -d $DatabaseName `
            --command $CommandText 2>&1
        )
        [pscustomobject]@{
          ExitCode = $LASTEXITCODE
          Output = ($result | Out-String)
        }
      } -ArgumentList @(
        $psql,
        $HostName,
        $Port,
        $DatabaseUser,
        $Database,
        $sql
      )
    }
  )

  try {
    $jobs | Wait-Job -Timeout 30 | Out-Null
    if ($jobs.State -contains 'Running') {
      throw 'migration 040 concurrency sessions did not finish'
    }
    $results = @($jobs | Receive-Job)
    $results | ForEach-Object {
      Write-Output $_.Output
    }
    $winnerCount = @(
      $results | Where-Object { $_.ExitCode -eq 0 }
    ).Count
    $failureCount = @(
      $results | Where-Object { $_.ExitCode -ne 0 }
    ).Count
    if ($winnerCount -ne 1 -or $failureCount -ne 1) {
      throw 'migration 040 concurrency did not produce exactly one winner'
    }
  }
  finally {
    $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
  }
}

$migration037Hash = (
  Get-FileHash -LiteralPath $migration037 -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($migration037Hash -ne $expectedMigration037Sha256) {
  throw "Migration 037 source hash drifted: $migration037Hash"
}

$migration037Source = [System.IO.File]::ReadAllText($migration037)
if ($migration037Source.Contains("`r")) {
  throw 'Migration 037 source must remain LF-only'
}
$migration037Transported = $migration037Source.Replace("`n", "`r`n")
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText(
  $migration037TransportCopy,
  $migration037Transported,
  $utf8NoBom
)

try {
  Write-Output "REBUILD $Database"
  & $dropdb `
    --if-exists `
    -h $HostName `
    -p $Port `
    -U $DatabaseUser `
    $Database
  if ($LASTEXITCODE -ne 0) {
    throw "Could not drop disposable shadow database $Database"
  }

  & $createdb `
    -h $HostName `
    -p $Port `
    -U $DatabaseUser `
    $Database
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create disposable shadow database $Database"
  }

  Invoke-PsqlFile -Path $prelude -Label 'Supabase prelude'
  Invoke-PsqlCommand `
    -Sql (
      'alter default privileges for role postgres in schema public ' +
      'grant execute on functions to service_role;'
    ) `
    -Label 'Supabase function default privileges'

  foreach ($migration in $baseMigrations) {
    Invoke-PsqlFile -Path $migration.FullName -Label $migration.Name
  }

  Invoke-PsqlFile -Path $seed -Label 'synthetic 7/1/1 seed'
  Invoke-PsqlFile -Path $precheck036 -Label 'migration 036 read-only precheck'
  Invoke-PsqlFile -Path $migration036 -Label 'migration 036 exact file'
  Invoke-PsqlFile -Path $postcheck036 -Label 'migration 036 postcheck'
  Invoke-PsqlFile `
    -Path $migration037TransportCopy `
    -Label 'migration 037 audited CRLF transport copy'
  Invoke-PsqlFile -Path $fixture038 -Label 'migration 038 old-failure reproduction'
  Invoke-PsqlFile -Path $migration038 -Label 'migration 038 exact file'
  Invoke-PsqlFile -Path $contracts038 -Label 'migration 038 mixed-close contracts'
  Invoke-PsqlFile -Path $devPrecheck039 -Label 'migration 039 read-only precheck'
  Invoke-PsqlFile -Path $pregrant039 -Label 'migration 039 pregrant denial'
  Invoke-PsqlFile -Path $migration039 -Label 'migration 039 exact file'
  Invoke-PsqlFile `
    -Path $postgrant039 `
    -Label 'migration 039 Storage policy contracts'
  Invoke-PsqlFile `
    -Path $devPrecheck040 `
    -Label 'migration 040 read-only precheck'
  Invoke-PsqlFile `
    -Path $oldFailure040 `
    -Label 'migration 040 old consumer failure reproduction'
  Invoke-PsqlFile -Path $migration040 -Label 'migration 040 exact file'
  Invoke-PsqlFile `
    -Path $devPostcheck040 `
    -Label 'migration 040 read-only postcheck'
  Invoke-PsqlFile `
    -Path $contracts040 `
    -Label 'migration 040 atomic consumption and material contracts'
  Invoke-PsqlFile `
    -Path $concurrencyFixture040 `
    -Label 'migration 040 concurrency fixture'
  Invoke-040Concurrency
  Invoke-PsqlFile `
    -Path $concurrencyAssert040 `
    -Label 'migration 040 concurrency assertion'
  Invoke-PsqlFile `
    -Path $postcheck037 `
    -Label 'migration 037 postcheck and regressions'
}
finally {
  if (Test-Path -LiteralPath $migration037TransportCopy -PathType Leaf) {
    Remove-Item -LiteralPath $migration037TransportCopy -Force
  }
}

Write-Output 'SHADOW_036_037_038_SEQUENCE_PASS'
Write-Output 'SHADOW_039_LIVE_BODY_CONTRACT_PASS'
Write-Output 'SHADOW_040_STATIC_MIGRATION_PASS'
