param([string]$HelperPath = "")

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$helper = if ($HelperPath) { (Resolve-Path $HelperPath).Path } else { Join-Path $projectRoot "build\update-helper.ps1" }
$launcher = Join-Path $projectRoot "build\update-launcher.ps1"
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("naimage-update-helper-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $root -Force | Out-Null

function Get-TestSha256([string]$Path) {
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

function Invoke-HelperCase([string]$Name, [bool]$Healthy) {
  $directory = Join-Path $root $Name
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $source = Join-Path $directory "new.asar"
  $target = Join-Path $directory "app.asar"
  $health = Join-Path $directory "health.ok"
  $log = Join-Path $directory "update.log"
  $app = Join-Path $directory "probe.cmd"
  Set-Content -LiteralPath $source -Value "new-release" -NoNewline -Encoding ASCII
  Set-Content -LiteralPath $target -Value "old-release" -NoNewline -Encoding ASCII
  if ($Healthy) {
    Set-Content -LiteralPath $app -Value "@echo off`r`n> `"$health`" echo healthy`r`nping -n 3 127.0.0.1 >nul`r`n" -Encoding ASCII
  } else {
    Set-Content -LiteralPath $app -Value "@echo off`r`nexit /b 1`r`n" -Encoding ASCII
  }
  $expected = Get-TestSha256 -Path $source
  & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper `
    -ParentPid 999999 -Source $source -Target $target -ExpectedSha256 $expected -AppExe $app `
    -Token ("a" * 48) -HealthFile $health -LogFile $log -ParentExitTimeoutSeconds 2 -HealthTimeoutSeconds 8
  $exitCode = $LASTEXITCODE
  if ($Healthy) {
    if ($exitCode -ne 0) {
      $logText = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Raw } else { "update log missing" }
      throw "healthy update helper case failed with exit code $exitCode`n$logText"
    }
    if ((Get-Content -LiteralPath $target -Raw) -ne "new-release") { throw "healthy update did not install the new app.asar" }
    if (Test-Path -LiteralPath "$target.naimage-backup") { throw "healthy update left a backup behind" }
  } else {
    if ($exitCode -eq 0) { throw "rollback update helper case unexpectedly succeeded" }
    if ((Get-Content -LiteralPath $target -Raw) -ne "old-release") { throw "failed update did not restore the old app.asar" }
  }
}

function Invoke-LauncherCase() {
  $directory = Join-Path $root "launcher"
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $source = Join-Path $directory "new.asar"
  $target = Join-Path $directory "app.asar"
  $health = Join-Path $directory "health.ok"
  $ready = Join-Path $directory "ready.ok"
  $pidFile = Join-Path $directory "helper.pid"
  $log = Join-Path $directory "update.log"
  $bootstrap = Join-Path $directory "bootstrap.log"
  $app = Join-Path $directory "probe.cmd"
  Set-Content -LiteralPath $source -Value "new-release" -NoNewline -Encoding ASCII
  Set-Content -LiteralPath $target -Value "old-release" -NoNewline -Encoding ASCII
  Set-Content -LiteralPath $app -Value "@echo off`r`n> `"$health`" echo healthy`r`nping -n 3 127.0.0.1 >nul`r`n" -Encoding ASCII
  $payload = [ordered]@{
    HelperPath = $helper
    ParentPid = 999999
    Source = $source
    Target = $target
    ExpectedSha256 = Get-TestSha256 -Path $source
    AppExe = $app
    Token = "b" * 48
    HealthFile = $health
    ReadyFile = $ready
    LogFile = $log
    HelperPidFile = $pidFile
    BootstrapLogFile = $bootstrap
  }
  $payloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Compress)))
  & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $launcher -PayloadBase64 $payloadBase64
  if ($LASTEXITCODE -ne 0) { throw "update launcher exited with code $LASTEXITCODE" }
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $deadline) {
    $healthyLog = (Test-Path -LiteralPath $log) -and ((Get-Content -LiteralPath $log -Raw) -match "restart update healthy")
    if ($healthyLog -and (Get-Content -LiteralPath $target -Raw) -eq "new-release" -and -not (Test-Path -LiteralPath "$target.naimage-backup")) { break }
    Start-Sleep -Milliseconds 100
  }
  if ((Get-Content -LiteralPath $target -Raw) -ne "new-release") {
    $bootstrapText = if (Test-Path -LiteralPath $bootstrap) { Get-Content -LiteralPath $bootstrap -Raw } else { "" }
    throw "launcher did not complete the update: $bootstrapText"
  }
  if (Test-Path -LiteralPath "$target.naimage-backup") { throw "launcher update left a backup behind" }
}

function Invoke-ChecksumMismatchCase() {
  $directory = Join-Path $root "checksum-mismatch"
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $source = Join-Path $directory "new.asar"
  $target = Join-Path $directory "app.asar"
  $health = Join-Path $directory "health.ok"
  $log = Join-Path $directory "update.log"
  $app = Join-Path $directory "probe.cmd"
  Set-Content -LiteralPath $source -Value "evil-release" -NoNewline -Encoding ASCII
  Set-Content -LiteralPath $target -Value "old-release" -NoNewline -Encoding ASCII
  Set-Content -LiteralPath $app -Value "@echo off`r`nexit /b 0`r`n" -Encoding ASCII
  & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper `
    -ParentPid 999999 -Source $source -Target $target -ExpectedSha256 ("0" * 64) -AppExe $app `
    -Token ("c" * 48) -HealthFile $health -LogFile $log -ParentExitTimeoutSeconds 2 -HealthTimeoutSeconds 4
  if ($LASTEXITCODE -eq 0) { throw "checksum mismatch case unexpectedly succeeded" }
  if ((Get-Content -LiteralPath $target -Raw) -ne "old-release") { throw "checksum mismatch modified the installed app.asar" }
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "checksum mismatch removed the diagnostic source artifact" }
  if (Test-Path -LiteralPath "$target.naimage-backup") { throw "checksum mismatch left a rollback backup" }
}

try {
  Invoke-HelperCase -Name "healthy" -Healthy $true
  Invoke-HelperCase -Name "rollback" -Healthy $false
  Invoke-LauncherCase
  Invoke-ChecksumMismatchCase
  [pscustomobject]@{ ok = $true; healthy = $true; rollback = $true; launcher = $true; checksumMismatchRejected = $true; atomicReplace = $true } | ConvertTo-Json
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
