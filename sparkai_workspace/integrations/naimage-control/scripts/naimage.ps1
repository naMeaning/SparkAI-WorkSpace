[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = "status",

  [string]$ArgsJson = "{}",

  [string]$SkillPath = "",

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

function Resolve-NaimageErrorPayload([System.Management.Automation.ErrorRecord]$record) {
  $message = [string]$record.Exception.Message
  $body = [string]$record.ErrorDetails.Message
  if (-not $body) {
    try {
      $response = $record.Exception.Response
      if ($null -ne $response) {
        $stream = $response.GetResponseStream()
        if ($null -ne $stream) {
          $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8)
          try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
        }
      }
    } catch {
      # Keep the original transport message when the response body is unavailable.
    }
  }
  if ($body) {
    try {
      $payload = $body | ConvertFrom-Json
      if ($payload.error) { return $payload }
    } catch {
      # The endpoint may have returned a non-JSON proxy or transport error.
    }
  }
  return [pscustomobject]@{ ok = $false; error = $message }
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
    if ($SkillPath) {
      if ($Command -ne "canvas.import-skill") {
        throw "SkillPath is only valid with canvas.import-skill."
      }
      $resolvedSkillPath = (Resolve-Path -LiteralPath $SkillPath -ErrorAction Stop).Path
      $skillBytes = [System.IO.File]::ReadAllBytes($resolvedSkillPath)
      if ($skillBytes.Length -eq 0) { throw "SKILL.md is empty." }
      if ($skillBytes.Length -gt 262144) { throw "SKILL.md exceeds the 262144 byte import limit." }
      $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
      $skillMarkdown = $utf8.GetString($skillBytes)
      $argsObject | Add-Member -NotePropertyName markdown -NotePropertyValue $skillMarkdown -Force
      $argsObject | Add-Member -NotePropertyName sourceName -NotePropertyValue ([System.IO.Path]::GetFileName($resolvedSkillPath)) -Force
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
  Resolve-NaimageErrorPayload $_ | ConvertTo-Json -Depth 30 -Compress
  exit 1
}
