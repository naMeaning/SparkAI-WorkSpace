param([Parameter(Mandatory = $true)][string]$PayloadBase64)

$ErrorActionPreference = "Stop"

try {
  $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($PayloadBase64))
  $payload = $payloadJson | ConvertFrom-Json
  $encodedPayload = $PayloadBase64
  $helperCommand = @"
`$ErrorActionPreference = 'Stop'
try {
  `$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('$encodedPayload'))
  `$payload = `$payloadJson | ConvertFrom-Json
  & ([string]`$payload.HelperPath) ``
    -ParentPid ([int]`$payload.ParentPid) ``
    -Source ([string]`$payload.Source) ``
    -Target ([string]`$payload.Target) ``
    -ExpectedSha256 ([string]`$payload.ExpectedSha256) ``
    -AppExe ([string]`$payload.AppExe) ``
    -Token ([string]`$payload.Token) ``
    -HealthFile ([string]`$payload.HealthFile) ``
    -ReadyFile ([string]`$payload.ReadyFile) ``
    -LogFile ([string]`$payload.LogFile)
  exit `$LASTEXITCODE
} catch {
  Add-Content -LiteralPath ([string]`$payload.BootstrapLogFile) -Value "[`$([DateTime]::UtcNow.ToString('o'))] helper bootstrap failed: `$(`$_.Exception.Message)" -Encoding UTF8
  exit 1
}
"@
  $encodedCommand = [System.Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($helperCommand))
  $helper = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", $encodedCommand
  ) -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath ([string]$payload.HelperPidFile) -Value ([string]$helper.Id) -Encoding ASCII
  exit 0
} catch {
  try {
    $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($PayloadBase64))
    $payload = $payloadJson | ConvertFrom-Json
    Add-Content -LiteralPath ([string]$payload.BootstrapLogFile) -Value "[$([DateTime]::UtcNow.ToString('o'))] launcher failed: $($_.Exception.Message)" -Encoding UTF8
  } catch {}
  exit 1
}
