[CmdletBinding()]
param(
    [ValidateSet("1.3.14", "1.2.23")]
    [string]$BunVersion = "1.3.14",

    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$toolRoot = Join-Path $workspaceRoot ".tools"
$bunHome = if ($BunVersion -eq "1.2.23") {
    Join-Path $toolRoot "bun-1.2.23"
} else {
    Join-Path $toolRoot "bun"
}
$goRoot = Join-Path $toolRoot "go"
$goBin = Join-Path $goRoot "bin"
$dotnetRoot = Join-Path $toolRoot "dotnet"

$requiredExecutables = @(
    (Join-Path $bunHome "bun.exe"),
    (Join-Path $goBin "go.exe"),
    (Join-Path $dotnetRoot "dotnet.exe")
)

foreach ($executable in $requiredExecutables) {
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "Missing portable tool: $executable"
    }
}

$nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop
$corepackCommand = Get-Command corepack -ErrorAction Stop

# Remove older entries managed by this script before putting the selected version first.
$managedPathEntries = @(
    (Join-Path $toolRoot "bun"),
    (Join-Path $toolRoot "bun-1.2.23"),
    $goBin,
    $dotnetRoot
)
$pathPrefix = @($bunHome, $goBin, $dotnetRoot)
$existingPathEntries = @($env:PATH -split [IO.Path]::PathSeparator | Where-Object { $_ })
$newPathEntries = New-Object System.Collections.Generic.List[string]
$seenPathEntries = @{}

foreach ($entry in @($pathPrefix + $existingPathEntries)) {
    $normalizedEntry = $entry.Trim().TrimEnd("\", "/")
    if (-not $normalizedEntry) {
        continue
    }

    $isManagedButNotSelected = $false
    if (-not ($pathPrefix -contains $normalizedEntry)) {
        foreach ($managedEntry in $managedPathEntries) {
            if ($normalizedEntry.Equals($managedEntry.TrimEnd("\", "/"), [StringComparison]::OrdinalIgnoreCase)) {
                $isManagedButNotSelected = $true
                break
            }
        }
    }
    if ($isManagedButNotSelected) {
        continue
    }

    $key = $normalizedEntry.ToLowerInvariant()
    if (-not $seenPathEntries.ContainsKey($key)) {
        $seenPathEntries[$key] = $true
        $newPathEntries.Add($normalizedEntry)
    }
}

$env:PATH = [string]::Join([IO.Path]::PathSeparator, $newPathEntries)

# Workspace markers and pinned tool selection.
$env:IIIMAGE_WORKSPACE_ROOT = $workspaceRoot
$env:IIIMAGE_NODE_EXE = $nodeCommand.Source
$env:IIIMAGE_COREPACK_EXE = $corepackCommand.Source
$env:IIIMAGE_BUN_VERSION = $BunVersion
$env:IIIMAGE_BUN_EXE = Join-Path $bunHome "bun.exe"

# Keep portable tool state and caches inside this workspace where practical.
$env:BUN_INSTALL_CACHE_DIR = Join-Path $toolRoot "bun-cache-$BunVersion"
$env:GOROOT = $goRoot
$env:GOPATH = Join-Path $toolRoot "go-work"
$env:GOMODCACHE = Join-Path $toolRoot "go-mod-cache"
$env:GOCACHE = Join-Path $toolRoot "go-build-cache"
$env:GOTOOLCHAIN = "local"
$env:DOTNET_ROOT = $dotnetRoot
$env:DOTNET_ROOT_X64 = $dotnetRoot
$env:DOTNET_CLI_HOME = Join-Path $toolRoot "dotnet-cli-home"
$env:NUGET_PACKAGES = Join-Path $toolRoot "nuget-packages"
$env:DOTNET_MULTILEVEL_LOOKUP = "0"
$env:DOTNET_NOLOGO = "1"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1"
$env:COREPACK_ENABLE_PROJECT_SPEC = "1"
$env:COREPACK_ENABLE_STRICT = "1"
$env:COREPACK_DEFAULT_TO_LATEST = "0"

if (-not $Quiet) {
    Write-Host "Local toolchain activated for this PowerShell process only."
    Write-Host "Workspace : $workspaceRoot"
    Write-Host "Bun       : $BunVersion ($bunHome)"
    Write-Host "Go        : $goRoot"
    Write-Host ".NET      : $dotnetRoot"
    Write-Host "pnpm      : use 'corepack pnpm' (project pin: 10.12.1)"
}
