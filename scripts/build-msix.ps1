param(
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ManifestSrc = Join-Path $RepoRoot "msix\AppxManifest.xml"
$IconsDir = Join-Path $RepoRoot "src-tauri\icons"
$ReleaseExe = Join-Path $RepoRoot "src-tauri\target\release\ferrowipe.exe"
$StagingDir = Join-Path $RepoRoot "src-tauri\target\msix-staging"
$OutputDir = Join-Path $RepoRoot "src-tauri\target\release\bundle\msix"

# Read version from package.json
$PkgJson = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
$Version = $PkgJson.version
$MsixVersion = "$Version.0"
$OutputMsix = Join-Path $OutputDir "Ferrowipe_${Version}_x64.msix"

# Locate latest Windows SDK makeappx.exe
$MakeAppx = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter "makeappx.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\makeappx\.exe$" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $MakeAppx) {
    throw "makeappx.exe not found. Please install the Windows 10/11 SDK."
}

Write-Host "Using makeappx: $MakeAppx" -ForegroundColor Cyan

# Build Tauri release binary if requested or missing
if ($Rebuild -or -not (Test-Path $ReleaseExe)) {
    Write-Host "Building Ferrowipe release binary..." -ForegroundColor Cyan
    Push-Location $RepoRoot
    try {
        npm run tauri build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run tauri build failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $ReleaseExe)) {
    throw "Release binary not found at $ReleaseExe"
}

# Prepare clean staging folder
if (Test-Path $StagingDir) {
    Remove-Item $StagingDir -Recurse -Force
}
$AssetsDir = Join-Path $StagingDir "Assets"
New-Item -ItemType Directory -Path $AssetsDir -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

# Copy manifest (only replace standalone Identity Version="..." attribute, never MinVersion/MaxVersionTested)
$ManifestContent = Get-Content $ManifestSrc -Raw
$ManifestContent = $ManifestContent -creplace '(\s)Version="[^"]+"', "`$1Version=`"$MsixVersion`""
[System.IO.File]::WriteAllText((Join-Path $StagingDir "AppxManifest.xml"), $ManifestContent, (New-Object System.Text.UTF8Encoding($false)))

# Copy binary
Copy-Item $ReleaseExe (Join-Path $StagingDir "ferrowipe.exe") -Force

# Copy required Store visual assets
$RequiredIcons = @(
    "StoreLogo.png",
    "Square44x44Logo.png",
    "Square71x71Logo.png",
    "Square150x150Logo.png",
    "Square310x310Logo.png"
)

foreach ($icon in $RequiredIcons) {
    $src = Join-Path $IconsDir $icon
    if (-not (Test-Path $src)) {
        throw "Required Store icon missing: $src"
    }
    Copy-Item $src (Join-Path $AssetsDir $icon) -Force
}

# Generate crisp 310x150 Wide Tile from Ferrowipe_banner.png
Add-Type -AssemblyName System.Drawing
$WideBmp = New-Object System.Drawing.Bitmap(310, 150)
$Gfx = [System.Drawing.Graphics]::FromImage($WideBmp)
$Gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$Gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$Gfx.Clear([System.Drawing.Color]::Black)
$BannerPath = Join-Path $RepoRoot "Ferrowipe_banner.png"
$BannerImg = [System.Drawing.Image]::FromFile($BannerPath)
$TargetW = 286
$TargetH = [int][Math]::Round($BannerImg.Height * ($TargetW / [double]$BannerImg.Width))
$X = [int]((310 - $TargetW) / 2)
$Y = [int]((150 - $TargetH) / 2)
$Gfx.DrawImage($BannerImg, $X, $Y, $TargetW, $TargetH)
$BannerImg.Dispose()
$Gfx.Dispose()
$WideBmp.Save((Join-Path $AssetsDir "Wide310x150Logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$WideBmp.Dispose()

# Pack unsigned MSIX ready for Microsoft Store Partner Center upload
if (Test-Path $OutputMsix) {
    Remove-Item $OutputMsix -Force
}

Write-Host "Packing $OutputMsix ..." -ForegroundColor Cyan
& $MakeAppx pack /d $StagingDir /p $OutputMsix /o /v
if ($LASTEXITCODE -ne 0) {
    throw "makeappx pack failed with exit code $LASTEXITCODE"
}

$SizeMB = [Math]::Round((Get-Item $OutputMsix).Length / 1MB, 2)
Write-Host ""
Write-Host "SUCCESS! Microsoft Store MSIX package created:" -ForegroundColor Green
Write-Host "  Path: $OutputMsix" -ForegroundColor Green
Write-Host "  Size: $SizeMB MB" -ForegroundColor Green
Write-Host ""
Write-Host "Upload this unsigned .msix directly to Microsoft Partner Center (Microsoft signs it automatically)." -ForegroundColor Yellow
