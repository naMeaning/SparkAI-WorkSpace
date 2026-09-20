[CmdletBinding()]
param(
    [switch]$SkipBun,
    [switch]$SkipGo,
    [switch]$SkipDotnet,
    [switch]$SkipGh,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$toolRoot = Join-Path $workspaceRoot ".tools"
$downloadRoot = Join-Path $toolRoot "_downloads"
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null

function Assert-Hash {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expected,
        [string]$Algorithm = "SHA256"
    )

    $actual = (Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash.ToLowerInvariant()
    if ($actual -ne $Expected.ToLowerInvariant()) {
        throw "$Algorithm mismatch for $Path. Expected $Expected, got $actual."
    }
}

function Download-Verified {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Hash,
        [string]$HashAlgorithm = "SHA256"
    )

    $needsDownload = $true
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        try {
            Assert-Hash -Path $Path -Expected $Hash -Algorithm $HashAlgorithm
            $needsDownload = $false
        } catch {
            Remove-Item -LiteralPath $Path -Force
        }
    }
    if ($needsDownload) {
        Write-Host "Downloading $Url"
        $partial = "$Path.part"
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
        $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curl) {
            & $curl.Source -L --fail --retry 5 --retry-all-errors --connect-timeout 30 --max-time 1800 --output $partial $Url
            if ($LASTEXITCODE -ne 0) {
                throw "curl failed while downloading $Url (exit $LASTEXITCODE)."
            }
        } else {
            Invoke-WebRequest -Uri $Url -UseBasicParsing -OutFile $partial
        }
        Move-Item -LiteralPath $partial -Destination $Path -Force
    }
    Assert-Hash -Path $Path -Expected $Hash -Algorithm $HashAlgorithm
}

function Install-ZipTool {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Hash,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string]$ArchiveRelativeExecutable,
        [string]$HashAlgorithm = "SHA256",
        [switch]$StripTopDirectory
    )

    $targetExecutable = Join-Path $Destination $Executable
    if ((Test-Path -LiteralPath $targetExecutable -PathType Leaf) -and -not $Force) {
        Write-Host "Keeping existing $Id at $Destination"
        return
    }

    $archivePath = Join-Path $downloadRoot (Split-Path -Leaf $Url)
    Download-Verified -Url $Url -Path $archivePath -Hash $Hash -HashAlgorithm $HashAlgorithm
    $staging = Join-Path $toolRoot ("_staging-" + $Id + "-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    try {
        Expand-Archive -LiteralPath $archivePath -DestinationPath $staging -Force
        $sourceRoot = $staging
        if ($StripTopDirectory) {
            $children = @(Get-ChildItem -LiteralPath $staging -Force)
            if ($children.Count -ne 1 -or -not $children[0].PSIsContainer) {
                throw "$Id archive does not contain one top-level directory."
            }
            $sourceRoot = $children[0].FullName
        }
        $sourceExecutable = Join-Path $sourceRoot $ArchiveRelativeExecutable
        if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) {
            throw "$Id archive is missing $ArchiveRelativeExecutable."
        }
        if (Test-Path -LiteralPath $Destination) {
            if (-not $Force) {
                throw "$Destination already exists. Re-run with -Force only after checking that it is workspace-local."
            }
            Remove-Item -LiteralPath $Destination -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
        New-Item -ItemType Directory -Force -Path $Destination | Out-Null
        Get-ChildItem -LiteralPath $sourceRoot -Force | Copy-Item -Destination $Destination -Recurse -Force
        if (-not (Test-Path -LiteralPath $targetExecutable -PathType Leaf)) {
            throw "$Id installation did not produce $targetExecutable."
        }
        Write-Host "Installed $Id to $Destination"
    } finally {
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force
        }
    }
}

if (-not $SkipGo) {
    Install-ZipTool `
        -Id "go-1.25.1" `
        -Url "https://go.dev/dl/go1.25.1.windows-amd64.zip" `
        -Hash "4a974de310e7ee1d523d2fcedb114ba5fa75408c98eb3652023e55ccf3fa7cab" `
        -Destination (Join-Path $toolRoot "go-1.25.1-complete") `
        -Executable "go\bin\go.exe" `
        -ArchiveRelativeExecutable "go\bin\go.exe"
}

if (-not $SkipBun) {
    Install-ZipTool `
        -Id "bun-1.3.14" `
        -Url "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-windows-x64.zip" `
        -Hash "0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922" `
        -Destination (Join-Path $toolRoot "bun") `
        -Executable "bun.exe" `
        -ArchiveRelativeExecutable "bun.exe" `
        -StripTopDirectory
}

if (-not $SkipDotnet) {
    Install-ZipTool `
        -Id "dotnet-9.0.316" `
        -Url "https://builds.dotnet.microsoft.com/dotnet/Sdk/9.0.316/dotnet-sdk-9.0.316-win-x64.zip" `
        -Hash "871d655b07f05aa5844a27a0dc742ccb6ca1e6df11be1c1251d6e967505595f455fd1160165048e3348f8dd2412ca82d414d0402c8acab30f997e30897a9040f" `
        -HashAlgorithm "SHA512" `
        -Destination (Join-Path $toolRoot "dotnet") `
        -Executable "dotnet.exe" `
        -ArchiveRelativeExecutable "dotnet.exe"
}

if (-not $SkipGh) {
    Install-ZipTool `
        -Id "gh-2.96.0" `
        -Url "https://github.com/cli/cli/releases/download/v2.96.0/gh_2.96.0_windows_amd64.zip" `
        -Hash "c2d6acc935cd2f00e2144d7e036d5cd82e6b6bd5594e8c75aa75ef2a4ed6aac3" `
        -Destination (Join-Path $toolRoot "gh-2.96.0") `
        -Executable "bin\gh.exe" `
        -ArchiveRelativeExecutable "bin\gh.exe"
}

Write-Host ""
Write-Host "Portable toolchain bootstrap complete."
Write-Host "Next: .\scripts\activate-local-toolchain.ps1"
Write-Host "Then: .\scripts\diagnose-local-toolchain.ps1 -ToolsOnly"
