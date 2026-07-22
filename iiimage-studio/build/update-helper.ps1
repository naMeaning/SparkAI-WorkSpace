param(
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$ExpectedSha256,
  [Parameter(Mandatory = $true)][string]$AppExe,
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$HealthFile,
  [string]$ReadyFile = "",
  [Parameter(Mandatory = $true)][string]$LogFile,
  [int]$ParentExitTimeoutSeconds = 90,
  [int]$HealthTimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"

function Write-UpdateLog([string]$Message) {
  $directory = Split-Path -Parent $LogFile
  if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  Add-Content -LiteralPath $LogFile -Value "[$([DateTime]::UtcNow.ToString('o'))] $Message" -Encoding UTF8
}

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Wait-ForExit([int]$ProcessId, [int]$Seconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Move-WithRetry([string]$From, [string]$To) {
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    try {
      Move-Item -LiteralPath $From -Destination $To -Force
      return
    } catch {
      if ($attempt -eq 30) { throw }
      Start-Sleep -Milliseconds 300
    }
  }
}

function Replace-WithBackup([string]$From, [string]$To, [string]$Backup) {
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    try {
      # Source, target and backup live in the same resources directory. The
      # Windows replace primitive swaps the ASAR and creates its rollback copy
      # as one filesystem operation, avoiding a boot-breaking gap where
      # resources\app.asar does not exist.
      [System.IO.File]::Replace($From, $To, $Backup, $true)
      return
    } catch {
      if ($attempt -eq 30) { throw }
      Start-Sleep -Milliseconds 300
    }
  }
}

function Restore-Backup([string]$Backup, [string]$Target) {
  if (-not (Test-Path -LiteralPath $Backup -PathType Leaf)) { return }
  if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) {
    Move-WithRetry -From $Backup -To $Target
    return
  }
  $failedTarget = "$Target.iiimage-failed"
  Remove-Item -LiteralPath $failedTarget -Force -ErrorAction SilentlyContinue
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    try {
      [System.IO.File]::Replace($Backup, $Target, $failedTarget, $true)
      Remove-Item -LiteralPath $failedTarget -Force -ErrorAction SilentlyContinue
      return
    } catch {
      if ($attempt -eq 30) { throw }
      Start-Sleep -Milliseconds 300
    }
  }
}

$backup = "$Target.iiimage-backup"
$staging = "$Target.iiimage-new"
$launched = $null

try {
  Write-UpdateLog "restart update begin parent=$ParentPid"
  if ($ReadyFile) {
    $readyDirectory = Split-Path -Parent $ReadyFile
    if ($readyDirectory) { New-Item -ItemType Directory -Path $readyDirectory -Force | Out-Null }
    Set-Content -LiteralPath $ReadyFile -Value "ready" -Encoding ASCII
  }
  if (-not (Wait-ForExit -ProcessId $ParentPid -Seconds $ParentExitTimeoutSeconds)) {
    throw "iiimage Studio did not exit before the update timeout."
  }
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Downloaded update is missing." }
  $sourceHash = Get-Sha256 -Path $Source
  if ($sourceHash -ne $ExpectedSha256.ToLowerInvariant()) { throw "Downloaded update checksum mismatch." }

  Remove-Item -LiteralPath $staging -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $Source -Destination $staging -Force
  $stagingHash = Get-Sha256 -Path $staging
  if ($stagingHash -ne $ExpectedSha256.ToLowerInvariant()) { throw "Staged update checksum mismatch." }

  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { throw "Installed application resource is missing." }
  Replace-WithBackup -From $staging -To $Target -Backup $backup
  $installedHash = Get-Sha256 -Path $Target
  if ($installedHash -ne $ExpectedSha256.ToLowerInvariant()) { throw "Installed update checksum mismatch." }

  Remove-Item -LiteralPath $HealthFile -Force -ErrorAction SilentlyContinue
  $launched = Start-Process -FilePath $AppExe -ArgumentList @("--updated", "--iiimage-update-token=$Token") -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds($HealthTimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $HealthFile -PathType Leaf) {
      Write-UpdateLog "restart update healthy pid=$($launched.Id)"
      $successCleanup = @($backup, $Source, $HealthFile)
      if ($ReadyFile) { $successCleanup += $ReadyFile }
      Remove-Item -LiteralPath $successCleanup -Force -ErrorAction SilentlyContinue
      exit 0
    }
    if ($launched.HasExited) { break }
    Start-Sleep -Milliseconds 500
    $launched.Refresh()
  }
  throw "Updated application did not report healthy startup."
} catch {
  Write-UpdateLog "restart update failed: $($_.Exception.Message)"
  if ($launched -and -not $launched.HasExited) {
    Stop-Process -Id $launched.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path -LiteralPath $backup -PathType Leaf) {
    Restore-Backup -Backup $backup -Target $Target
  }
  $failureCleanup = @($staging, "$Target.iiimage-failed", $HealthFile)
  if ($ReadyFile) { $failureCleanup += $ReadyFile }
  Remove-Item -LiteralPath $failureCleanup -Force -ErrorAction SilentlyContinue
  try { Start-Process -FilePath $AppExe -ArgumentList @("--update-rollback") | Out-Null } catch {}
  exit 1
}
