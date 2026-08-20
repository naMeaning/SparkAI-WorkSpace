[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupArchive,

    [Parameter(Mandatory = $true)]
    [string]$NewBinary,

    [Parameter(Mandatory = $true)]
    [string]$OldBinary,

    [ValidateRange(10, 300)]
    [int]$StartupTimeoutSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally {
        $listener.Stop()
    }
}

function Stop-RehearsalProcess {
    param([System.Diagnostics.Process]$Process)

    if ($null -eq $Process) {
        return
    }
    try {
        $Process.Refresh()
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
            [void]$Process.WaitForExit(5000)
        }
    }
    catch {
        # Cleanup is best-effort here; the outer finally runs this for both binaries.
    }
}

function Start-RehearsalProcess {
    param(
        [string]$Binary,
        [string]$WorkingDirectory,
        [string]$DatabasePath,
        [string]$StorageDirectory,
        [int]$Port,
        [string]$Secret,
        [string]$StdoutPath,
        [string]$StderrPath
    )

    $environment = @{
        PORT                                  = [string]$Port
        SQLITE_PATH                           = $DatabasePath
        SESSION_SECRET                        = $Secret
        CRYPTO_SECRET                         = $Secret
        GIN_MODE                              = 'release'
        TRUSTED_PROXIES                       = 'none'
        NODE_TYPE                             = 'master'
        UPDATE_TASK                           = 'false'
        MEMORY_CACHE_ENABLED                  = 'false'
        BATCH_UPDATE_ENABLED                  = 'false'
        ENABLE_PPROF                          = 'false'
        SQL_DSN                               = ''
        LOG_SQL_DSN                           = ''
        REDIS_CONN_STRING                     = ''
        CHANNEL_UPDATE_FREQUENCY              = ''
        FRONTEND_BASE_URL                     = "http://127.0.0.1:$Port"
        MANAGED_IMAGE_IDEMPOTENCY_STORAGE_DIR = $StorageDirectory
    }

    return Start-Process `
        -FilePath $Binary `
        -WorkingDirectory $WorkingDirectory `
        -Environment $environment `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutPath `
        -RedirectStandardError $StderrPath `
        -PassThru
}

function Wait-NewApiHealthy {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$Port,
        [int]$TimeoutSeconds
    )

    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $uri = "http://127.0.0.1:$Port/api/status"
    while ($timer.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "New API exited before health check (exit code $($Process.ExitCode))."
        }
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 2
            if ($response.success -eq $true -and $null -ne $response.data -and -not [string]::IsNullOrWhiteSpace([string]$response.data.version)) {
                return [ordered]@{
                    version    = [string]$response.data.version
                    startup_ms = [int][Math]::Round($timer.Elapsed.TotalMilliseconds)
                }
            }
        }
        catch {
            # Startup races are expected until the listener and migrations are ready.
        }
        Start-Sleep -Milliseconds 250
    }
    throw "New API did not become healthy within $TimeoutSeconds seconds."
}

function Invoke-SqliteQuickCheck {
    param([string]$DatabasePath)

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($null -eq $python) {
        throw 'Python 3 is required for the isolated SQLite quick_check.'
    }
    $program = @'
import sqlite3, sys
connection = sqlite3.connect(sys.argv[1], timeout=30)
try:
    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchall()
    rows = connection.execute("PRAGMA quick_check").fetchall()
    if rows != [("ok",)]:
        raise SystemExit(2)
    print("ok")
finally:
    connection.close()
'@
    $output = & $python.Source -c $program $DatabasePath 2>$null
    if ($LASTEXITCODE -ne 0 -or (($output | Select-Object -Last 1) -ne 'ok')) {
        throw 'SQLite quick_check failed.'
    }
    return 'ok'
}

function Copy-DirectoryContents {
    param(
        [string]$Source,
        [string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        Copy-Item -LiteralPath $item.FullName -Destination $Destination -Recurse -Force
    }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$diagnosticsRoot = Join-Path $repoRoot '.diagnostics\new-api-sqlite-compat'
$runId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 10))
$runRoot = Join-Path $diagnosticsRoot $runId

$archivePath = (Resolve-Path -LiteralPath $BackupArchive).Path
$newBinaryPath = (Resolve-Path -LiteralPath $NewBinary).Path
$oldBinaryPath = (Resolve-Path -LiteralPath $OldBinary).Path

$newProcess = $null
$oldProcess = $null
$stage = 'initialize'
$result = [ordered]@{
    schema_version    = 1
    success           = $false
    run_id            = $runId
    archive           = [ordered]@{
        name   = [IO.Path]::GetFileName($archivePath)
        bytes  = (Get-Item -LiteralPath $archivePath).Length
        sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    new_binary        = [ordered]@{
        name   = [IO.Path]::GetFileName($newBinaryPath)
        bytes  = (Get-Item -LiteralPath $newBinaryPath).Length
        sha256 = (Get-FileHash -LiteralPath $newBinaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
        healthy = $false
    }
    old_binary        = [ordered]@{
        name   = [IO.Path]::GetFileName($oldBinaryPath)
        bytes  = (Get-Item -LiteralPath $oldBinaryPath).Length
        sha256 = (Get-FileHash -LiteralPath $oldBinaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
        healthy = $false
    }
    source_quick_check   = $null
    migrated_quick_check = $null
    old_quick_check      = $null
    workspace_removed    = $false
    failure_stage        = $null
    error                = $null
}

try {
    $stage = 'prepare_workspace'
    New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
    $sourceDirectory = Join-Path $runRoot 'source'
    $newDirectory = Join-Path $runRoot 'new'
    $newStateDirectory = Join-Path $newDirectory 'state'
    $oldDirectory = Join-Path $runRoot 'old'
    $oldStateDirectory = Join-Path $oldDirectory 'state'
    foreach ($directory in @($sourceDirectory, $newStateDirectory, $oldStateDirectory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $stage = 'validate_archive'
    $listing = @(& tar -tzf $archivePath 2>$null)
    if ($LASTEXITCODE -ne 0 -or $listing.Count -eq 0) {
        throw 'Backup archive could not be listed.'
    }
    $normalizedEntries = @($listing | ForEach-Object { ([string]$_).Replace('\', '/').Trim() } | Where-Object { $_ -ne '' })
    if (@($normalizedEntries | Where-Object { $_ -eq 'one-api.db' }).Count -ne 1) {
        throw 'Backup archive must contain exactly one one-api.db.'
    }
    foreach ($entry in $normalizedEntries) {
        $unsafe = $entry.StartsWith('/') -or $entry -match '^[A-Za-z]:' -or $entry.Split('/') -contains '..' -or $entry.Contains(':')
        $allowed = $entry -match '^(one-api\.db|backup-metadata\.txt|managed-image-idempotency/?|managed-image-idempotency/.+)$'
        if ($unsafe -or -not $allowed) {
            throw 'Backup archive contains an unsafe or unexpected entry.'
        }
    }

    $stage = 'extract_archive'
    & tar -xzf $archivePath -C $sourceDirectory
    if ($LASTEXITCODE -ne 0) {
        throw 'Backup archive extraction failed.'
    }
    $sourceDatabase = Join-Path $sourceDirectory 'one-api.db'
    if (-not (Test-Path -LiteralPath $sourceDatabase -PathType Leaf)) {
        throw 'Extracted SQLite database is missing.'
    }
    $reparsePoint = Get-ChildItem -LiteralPath $sourceDirectory -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1
    if ($null -ne $reparsePoint) {
        throw 'Backup archive extracted a reparse point.'
    }
    $result.source_quick_check = Invoke-SqliteQuickCheck -DatabasePath $sourceDatabase

    $stage = 'prepare_new_state'
    Copy-Item -LiteralPath $sourceDatabase -Destination (Join-Path $newStateDirectory 'one-api.db') -Force
    $sourceManaged = Join-Path $sourceDirectory 'managed-image-idempotency'
    if (Test-Path -LiteralPath $sourceManaged -PathType Container) {
        Copy-Item -LiteralPath $sourceManaged -Destination $newStateDirectory -Recurse -Force
    }
    else {
        New-Item -ItemType Directory -Path (Join-Path $newStateDirectory 'managed-image-idempotency') -Force | Out-Null
    }

    $stage = 'start_new_binary'
    $newPort = Get-FreeTcpPort
    $newSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $newProcess = Start-RehearsalProcess `
        -Binary $newBinaryPath `
        -WorkingDirectory $newDirectory `
        -DatabasePath (Join-Path $newStateDirectory 'one-api.db') `
        -StorageDirectory (Join-Path $newStateDirectory 'managed-image-idempotency') `
        -Port $newPort `
        -Secret $newSecret `
        -StdoutPath (Join-Path $newDirectory 'stdout.log') `
        -StderrPath (Join-Path $newDirectory 'stderr.log')
    $newHealth = Wait-NewApiHealthy -Process $newProcess -Port $newPort -TimeoutSeconds $StartupTimeoutSeconds
    $result.new_binary.healthy = $true
    $result.new_binary.version = $newHealth.version
    $result.new_binary.startup_ms = $newHealth.startup_ms
    Stop-RehearsalProcess -Process $newProcess
    $newProcess = $null

    $stage = 'check_migrated_database'
    $result.migrated_quick_check = Invoke-SqliteQuickCheck -DatabasePath (Join-Path $newStateDirectory 'one-api.db')

    $stage = 'prepare_old_state'
    Copy-DirectoryContents -Source $newStateDirectory -Destination $oldStateDirectory

    $stage = 'start_old_binary'
    $oldPort = Get-FreeTcpPort
    $oldSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $oldProcess = Start-RehearsalProcess `
        -Binary $oldBinaryPath `
        -WorkingDirectory $oldDirectory `
        -DatabasePath (Join-Path $oldStateDirectory 'one-api.db') `
        -StorageDirectory (Join-Path $oldStateDirectory 'managed-image-idempotency') `
        -Port $oldPort `
        -Secret $oldSecret `
        -StdoutPath (Join-Path $oldDirectory 'stdout.log') `
        -StderrPath (Join-Path $oldDirectory 'stderr.log')
    $oldHealth = Wait-NewApiHealthy -Process $oldProcess -Port $oldPort -TimeoutSeconds $StartupTimeoutSeconds
    $result.old_binary.healthy = $true
    $result.old_binary.version = $oldHealth.version
    $result.old_binary.startup_ms = $oldHealth.startup_ms
    Stop-RehearsalProcess -Process $oldProcess
    $oldProcess = $null

    $stage = 'check_old_database'
    $result.old_quick_check = Invoke-SqliteQuickCheck -DatabasePath (Join-Path $oldStateDirectory 'one-api.db')
    $result.success = $true
}
catch {
    $result.failure_stage = $stage
    $safeMessage = [string]$_.Exception.Message
    foreach ($path in @($runRoot, $archivePath, $newBinaryPath, $oldBinaryPath)) {
        if (-not [string]::IsNullOrWhiteSpace($path)) {
            $safeMessage = $safeMessage.Replace($path, [IO.Path]::GetFileName($path))
        }
    }
    $result.error = (($safeMessage -replace '[\r\n]+', ' ').Trim()).Substring(0, [Math]::Min(400, (($safeMessage -replace '[\r\n]+', ' ').Trim()).Length))
}
finally {
    Stop-RehearsalProcess -Process $newProcess
    Stop-RehearsalProcess -Process $oldProcess
    if (Test-Path -LiteralPath $runRoot) {
        Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    $result.workspace_removed = -not (Test-Path -LiteralPath $runRoot)
}

$result | ConvertTo-Json -Depth 6 -Compress
if (-not $result.success) {
    exit 1
}
