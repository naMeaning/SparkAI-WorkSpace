[CmdletBinding()]
param(
    [ValidateSet("1.3.14", "1.2.23")]
    [string]$BunVersion = "1.3.14",

    [switch]$ToolsOnly,

    [switch]$RequireReleaseTools
)

$ErrorActionPreference = "Continue"
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$activationScript = Join-Path $PSScriptRoot "activate-local-toolchain.ps1"

try {
    & $activationScript -BunVersion $BunVersion -RequireReleaseTools:$RequireReleaseTools -Quiet
} catch {
    Write-Error $_
    exit 1
}

$hardFailure = $false
$studioRoot = Join-Path $workspaceRoot "sparkai_workspace"
$extensionRoot = Join-Path $workspaceRoot "sparkai-extension"

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

function Test-MinimumVersion {
    param(
        [string]$Label,
        [scriptblock]$Command,
        [version]$Minimum
    )

    $result = Read-CommandOutput -Command $Command
    $raw = $result.Text.Trim() -replace "^v", ""
    $parsed = $null
    $ok = [version]::TryParse($raw, [ref]$parsed) -and $result.ExitCode -eq 0 -and $parsed -ge $Minimum
    $status = if ($ok) { "PASS" } else { "FAIL" }
    Write-Host ("[{0}] {1}: {2} (minimum {3})" -f $status, $Label, $result.Text, $Minimum)
    return $ok
}

function Test-OptionalExactVersion {
    param(
        [string]$Label,
        [string]$CommandName,
        [scriptblock]$Command,
        [string]$Expected
    )

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        Write-Host ("[WARN] {0}: missing (install with scripts\bootstrap-local-toolchain.ps1)" -f $Label)
        return $false
    }
    return Test-ExactVersion -Label $Label -Command $Command -Expected $Expected
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

if (-not (Test-MinimumVersion -Label "Node" -Command { node --version } -Minimum ([version]"24.0.0"))) {
    $hardFailure = $true
}
$pnpmVersion = {
    Push-Location -LiteralPath $studioRoot
    try { corepack pnpm --version } finally { Pop-Location }
}
if (-not (Test-ExactVersion -Label "Corepack pnpm (project pin)" -Command $pnpmVersion -Expected "10.12.1")) {
    $hardFailure = $true
}
$bunOk = Test-OptionalExactVersion -Label "Bun" -CommandName "bun" -Command { bun --version } -Expected $BunVersion
$goOk = Test-OptionalExactVersion -Label "Go" -CommandName "go" -Command { go version } -Expected "go version go1.25.1 windows/amd64"
$dotnetOk = Test-OptionalExactVersion -Label ".NET SDK" -CommandName "dotnet" -Command { dotnet --version } -Expected "9.0.316"
$ghOk = $false
if (Get-Command gh -ErrorAction SilentlyContinue) {
    $ghResult = Read-CommandOutput -Command { gh --version }
    $ghOk = $ghResult.ExitCode -eq 0 -and $ghResult.Text -match "gh version 2\.96\.0"
    Write-Host ("[{0}] GitHub CLI: {1} (expected 2.96.0)" -f $(if ($ghOk) { "PASS" } else { "FAIL" }), ($ghResult.Text -split "`r?`n")[0])
} else {
    Write-Host "[WARN] GitHub CLI: missing (release push is unavailable until it is installed)."
}
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCommand -and $pythonCommand.Source -notmatch "WindowsApps") {
    $pythonResult = Read-CommandOutput -Command { python --version }
    Write-Host ("[{0}] Python: {1}" -f $(if ($pythonResult.ExitCode -eq 0) { "PASS" } else { "WARN" }), $pythonResult.Text)
} else {
    Write-Host "[WARN] Python: no real interpreter found (WindowsApps aliases do not count; set NAIMAGE_SCIENTIFIC_PYTHON or install Python for the scientific runner)."
}
$rscriptCommand = Get-Command Rscript -ErrorAction SilentlyContinue
if ($rscriptCommand) {
    $rResult = Read-CommandOutput -Command { Rscript --version }
    Write-Host ("[{0}] Rscript: {1}" -f $(if ($rResult.ExitCode -eq 0) { "PASS" } else { "WARN" }), $rResult.Text)
} else {
    Write-Host "[INFO] Rscript: not installed (optional; required only for scientific plans selecting the R backend)."
}
if ($RequireReleaseTools -and (-not $bunOk -or -not $goOk -or -not $dotnetOk -or -not $ghOk)) {
    $hardFailure = $true
}

$longPathsEnabled = $null
try {
    $longPathsEnabled = (Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -ErrorAction Stop).LongPathsEnabled
    Write-Host ("[{0}] Windows LongPathsEnabled: {1}" -f $(if ($longPathsEnabled -eq 1) { "PASS" } else { "WARN" }), $longPathsEnabled)
} catch {
    Write-Host "[WARN] Windows LongPathsEnabled could not be read."
}

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
    Write-Host "[INFO] Legacy New API Web dependency directories are present; this diagnostic does not claim that the Web build passed."
} else {
    Write-Host "[INFO] Legacy New API Web dependencies are not installed; this is not required by the active SparkAI Extension service."
    Write-Host "       Only audit the historical Web tree when explicitly needed."
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

Write-Host ""
Write-Host "Diagnostics result: PASS (active projects and required checks passed; optional release/legacy tools are reported above)."
exit 0
