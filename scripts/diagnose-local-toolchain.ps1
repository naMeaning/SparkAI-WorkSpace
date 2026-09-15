[CmdletBinding()]
param(
    [ValidateSet("1.3.14", "1.2.23")]
    [string]$BunVersion = "1.3.14",

    [switch]$ToolsOnly
)

$ErrorActionPreference = "Continue"
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$activationScript = Join-Path $PSScriptRoot "activate-local-toolchain.ps1"

try {
    & $activationScript -BunVersion $BunVersion -Quiet
} catch {
    Write-Error $_
    exit 1
}

$hardFailure = $false

function Read-CommandOutput {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    $output = & $Command 2>&1
    $exitCode = $LASTEXITCODE
    return [PSCustomObject]@{
        ExitCode = $exitCode
        Text = (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
    }
}

function Test-ExactVersion {
    param(
        [string]$Label,
        [scriptblock]$Command,
        [string]$Expected
    )

    $result = Read-CommandOutput -Command $Command
    $ok = $result.ExitCode -eq 0 -and $result.Text -eq $Expected
    $status = if ($ok) { "PASS" } else { "FAIL" }
    Write-Host ("[{0}] {1}: {2} (expected {3})" -f $status, $Label, $result.Text, $Expected)
    return $ok
}

function Invoke-ProjectCheck {
    param(
        [string]$Label,
        [string]$WorkingDirectory,
        [string[]]$Arguments
    )

    Write-Host ""
    Write-Host "--- $Label ---"
    Push-Location -LiteralPath $WorkingDirectory
    try {
        $commandOutput = & corepack pnpm @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    foreach ($line in $commandOutput) {
        Write-Host $line
    }

    if ($exitCode -eq 0) {
        Write-Host "[PASS] $Label"
        return $true
    }

    Write-Host "[FAIL] $Label (exit $exitCode)"
    return $false
}

Write-Host "Local toolchain diagnostics"
Write-Host "Workspace: $workspaceRoot"
Write-Host "Selected Bun: $BunVersion"
Write-Host ""

if (-not (Test-ExactVersion -Label "Node" -Command { node --version } -Expected "v24.15.0")) {
    $hardFailure = $true
}
if (-not (Test-ExactVersion -Label "Corepack pnpm" -Command { corepack pnpm --version } -Expected "10.12.1")) {
    $hardFailure = $true
}
if (-not (Test-ExactVersion -Label "Bun" -Command { bun --version } -Expected $BunVersion)) {
    $hardFailure = $true
}
if (-not (Test-ExactVersion -Label "Go" -Command { go version } -Expected "go version go1.25.1 windows/amd64")) {
    $hardFailure = $true
}
if (-not (Test-ExactVersion -Label ".NET SDK" -Command { dotnet --version } -Expected "9.0.316")) {
    $hardFailure = $true
}

$longPathsEnabled = $null
try {
    $longPathsEnabled = (Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -ErrorAction Stop).LongPathsEnabled
    Write-Host ("[{0}] Windows LongPathsEnabled: {1}" -f $(if ($longPathsEnabled -eq 1) { "PASS" } else { "WARN" }), $longPathsEnabled)
} catch {
    Write-Host "[WARN] Windows LongPathsEnabled could not be read."
}

$studioRoot = Join-Path $workspaceRoot "sparkai_workspace"
$extensionRoot = Join-Path $workspaceRoot "sparkai-extension"
$webRoot = Join-Path $extensionRoot "services\ai-gateway\new-api\web"
$webRootModules = Join-Path $webRoot "node_modules"
$webDefaultModules = Join-Path $webRoot "default\node_modules"
$webDependenciesReady = (Test-Path -LiteralPath $webRootModules -PathType Container) -and (Test-Path -LiteralPath $webDefaultModules -PathType Container)

if (-not $ToolsOnly) {
    if (-not (Invoke-ProjectCheck -Label "sparkai_workspace pnpm/typecheck" -WorkingDirectory $studioRoot -Arguments @("run", "typecheck"))) {
        $hardFailure = $true
    }
    if (-not (Invoke-ProjectCheck -Label "sparkai-extension verify:workspace" -WorkingDirectory $extensionRoot -Arguments @("run", "verify:workspace"))) {
        $hardFailure = $true
    }
    if (-not (Invoke-ProjectCheck -Label "sparkai-extension check" -WorkingDirectory $extensionRoot -Arguments @("run", "check"))) {
        $hardFailure = $true
    }
}

Write-Host ""
Write-Host "--- New API Web dependency status ---"
if ($webDependenciesReady) {
    Write-Host "[WARN] node_modules directories are present, but this diagnostic does not claim that the Web build passed."
} else {
    Write-Host "[BLOCKED] New API Web dependencies are NOT installed."
    Write-Host "          Activate the workspace toolchain, then run 'bun install --frozen-lockfile'"
    Write-Host "          from sparkai-extension/services/ai-gateway/new-api/web."
    if ($longPathsEnabled -eq 0) {
        Write-Host "          Windows LongPathsEnabled=0 may contribute to deep-path installation failures."
    }
    Write-Host "          If installation fails on paths, use a short physical checkout path or WSL/Linux."
}

if ($hardFailure) {
    Write-Host ""
    Write-Host "Diagnostics result: FAILED (tool or local project check failed)."
    exit 1
}

if (-not $webDependenciesReady) {
    Write-Host ""
    Write-Host "Diagnostics result: PARTIAL (toolchain and checked projects passed; New API Web remains blocked)."
    exit 2
}

Write-Host ""
Write-Host "Diagnostics result: PASS (Web dependency directories present; Web build was not executed)."
exit 0
