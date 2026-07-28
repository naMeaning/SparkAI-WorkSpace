[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = "status",

  [string]$ArgsJson = "{}",

  [ValidateRange(5, 1800)]
  [int]$TimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"
$skillRoot = Split-Path -Parent $PSScriptRoot
$connectionPath = Join-Path $skillRoot ".naimage-connection.json"

function Read-Connection {
  if (-not (Test-Path -LiteralPath $connectionPath -PathType Leaf)) {
    throw "naimage connection metadata is missing. Reinstall this Skill from naimage Settings > Agent."
  }
  Get-Content -Raw -LiteralPath $connectionPath | ConvertFrom-Json
}

function Start-NaimageIfNeeded([object]$connection) {
  $endpointPath = [string]$connection.endpointPath
  if (Test-Path -LiteralPath $endpointPath -PathType Leaf) { return }
  $executablePath = [string]$connection.executablePath
  if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    $fallbacks = @(
      (Join-Path $env:LOCALAPPDATA "Programs\naimage\naimage.exe"),
      (Join-Path $env:LOCALAPPDATA "naimage\naimage.exe")
    )
    $executablePath = $fallbacks | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  }
  if (-not $executablePath) { throw "naimage executable was not found. Start naimage manually and retry." }
  Start-Process -FilePath $executablePath | Out-Null
}

function Wait-Endpoint([string]$endpointPath) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $endpointPath -PathType Leaf) {
      try {
        $endpoint = Get-Content -Raw -LiteralPath $endpointPath | ConvertFrom-Json
        if ($endpoint.port -and $endpoint.token) { return $endpoint }
      } catch {
        # The app may still be replacing the endpoint file.
      }
    }
    Start-Sleep -Milliseconds 250
  }
  throw "naimage automation endpoint did not become ready within 30 seconds."
}

try {
  $connection = Read-Connection
  Start-NaimageIfNeeded $connection
  $endpoint = Wait-Endpoint ([string]$connection.endpointPath)
  $headers = @{ Authorization = "Bearer $($endpoint.token)" }
  $baseUri = "http://127.0.0.1:$($endpoint.port)/v1"

  if ($Command -eq "status") {
    $result = Invoke-RestMethod -Method Get -Uri "$baseUri/status" -Headers $headers -TimeoutSec ([Math]::Min($TimeoutSeconds, 60))
  } else {
    try {
      $argsObject = $ArgsJson | ConvertFrom-Json
    } catch {
      throw "ArgsJson is not valid JSON: $($_.Exception.Message)"
    }
    $body = @{
      command = $Command
      args = $argsObject
      timeoutMs = $TimeoutSeconds * 1000
    } | ConvertTo-Json -Depth 30 -Compress
    $result = Invoke-RestMethod -Method Post -Uri "$baseUri/execute" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec $TimeoutSeconds
  }

  $result | ConvertTo-Json -Depth 30 -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
}
