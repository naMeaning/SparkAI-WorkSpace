[CmdletBinding()]
param(
    [ValidateSet("1.3.14", "1.2.23")]
    [string]$BunVersion = "1.3.14",

    [switch]$RequireReleaseTools,

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
$goCandidates = @(
    (Join-Path $toolRoot "go-1.25.1-complete\go"),
    (Join-Path $toolRoot "go")
)
$goRoot = $goCandidates |
    Where-Object {
        (Test-Path -LiteralPath (Join-Path $_ "bin\go.exe")) -and
        (Test-Path -LiteralPath (Join-Path $_ "src\runtime")) -and
        (Test-Path -LiteralPath (Join-Path $_ "pkg\tool\windows_amd64\compile.exe"))
    } |
    Select-Object -First 1
if (-not $goRoot) { $goRoot = $goCandidates[0] }
$goBin = Join-Path $goRoot "bin"
$dotnetRoot = Join-Path $toolRoot "dotnet"
$ghRoot = Join-Path $toolRoot "gh-2.96.0"
$ghBin = Join-Path $ghRoot "bin"

$toolPaths = [ordered]@{
    Bun = (Join-Path $bunHome "bun.exe")
    Go = (Join-Path $goBin "go.exe")
    Dotnet = (Join-Path $dotnetRoot "dotnet.exe")
    GitHubCli = (Join-Path $ghBin "gh.exe")
}
$missingTools = @($toolPaths.GetEnumerator() | Where-Object { -not (Test-Path -LiteralPath $_.Value -PathType Leaf) })
if ($RequireReleaseTools -and $missingTools.Count -gt 0) {
    throw "Missing portable release tool(s): $($missingTools.Name -join ', '). Run scripts\bootstrap-local-toolchain.ps1 first."
}
if (-not $Quiet -and $missingTools.Count -gt 0) {
    Write-Warning "Optional portable tool(s) missing: $($missingTools.Name -join ', '). Release packaging/publishing remains unavailable until they are installed."
}

$nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop
$corepackCommand = Get-Command corepack -ErrorAction Stop

# Remove older entries managed by this script before putting the selected version first.
$managedPathEntries = @(
    (Join-Path $toolRoot "bun"),
    (Join-Path $toolRoot "bun-1.2.23"),
    $goBin,
    $dotnetRoot,
    $ghBin
)
$pathPrefix = @(
    if (Test-Path -LiteralPath $toolPaths.Bun -PathType Leaf) { $bunHome }
    if (Test-Path -LiteralPath $toolPaths.Go -PathType Leaf) { $goBin }
    if (Test-Path -LiteralPath $toolPaths.Dotnet -PathType Leaf) { $dotnetRoot }
    if (Test-Path -LiteralPath $toolPaths.GitHubCli -PathType Leaf) { $ghBin }
)
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
$env:NAIMAGE_WORKSPACE_ROOT = $workspaceRoot
$env:NAIMAGE_NODE_EXE = $nodeCommand.Source
$env:NAIMAGE_COREPACK_EXE = $corepackCommand.Source
$env:NAIMAGE_BUN_VERSION = $BunVersion
$env:NAIMAGE_BUN_EXE = if (Test-Path -LiteralPath $toolPaths.Bun -PathType Leaf) { $toolPaths.Bun } else { "" }
$env:NAIMAGE_GO_EXE = if (Test-Path -LiteralPath $toolPaths.Go -PathType Leaf) { $toolPaths.Go } else { "" }
$env:NAIMAGE_DOTNET_EXE = if (Test-Path -LiteralPath $toolPaths.Dotnet -PathType Leaf) { $toolPaths.Dotnet } else { "" }
$env:NAIMAGE_GH_EXE = if (Test-Path -LiteralPath $toolPaths.GitHubCli -PathType Leaf) { $toolPaths.GitHubCli } else { "" }
$env:NAIMAGE_RELEASE_TOOLS_READY = if ($missingTools.Count -eq 0) { "1" } else { "0" }

# Keep portable tool state and caches inside this workspace where practical.
$env:BUN_INSTALL_CACHE_DIR = Join-Path $toolRoot "bun-cache-$BunVersion"
$env:COREPACK_HOME = Join-Path $toolRoot "corepack"
$env:COREPACK_NPM_REGISTRY = "https://registry.npmjs.org"
$env:GOROOT = if (Test-Path -LiteralPath $toolPaths.Go -PathType Leaf) { $goRoot } else { "" }
$env:GOPATH = Join-Path $toolRoot "go-work"
$env:GOMODCACHE = Join-Path $toolRoot "go-mod-cache"
$env:GOCACHE = Join-Path $toolRoot "go-build-cache"
$env:GOTOOLCHAIN = "local"
$env:DOTNET_ROOT = if (Test-Path -LiteralPath $toolPaths.Dotnet -PathType Leaf) { $dotnetRoot } else { "" }
$env:DOTNET_ROOT_X64 = $env:DOTNET_ROOT
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
    Write-Host "GitHub CLI: 2.96.0 ($ghRoot)"
    Write-Host "Release tools ready: $env:NAIMAGE_RELEASE_TOOLS_READY"
    Write-Host "pnpm      : use 'corepack pnpm' (project pin: 10.12.1)"
}
