# Builds the hub and publishes it on the Raspberry Pi.
#
#   .\deploy.ps1                                       website only; uses the values in deploy.local.ps1 (if present)
#   .\deploy.ps1 -Pi user@address -Key C:\path\to\key
#   .\deploy.ps1 -Update                               website + everything in pi/, then runs hub-install.sh on
#                                                      the Raspberry Pi (asks for the sudo password there). Use it
#                                                      after pulling a new version: it also upgrades older installs.
#
# deploy.local.ps1 (ignored by git) holds only the two lines with your values, for example:
#   $DefaultPi = "pi@192.168.1.10"
#   $DefaultKey = "$env:USERPROFILE\.ssh\id_ed25519"
#
# No sudo needed: the website folder on the Raspberry Pi (/srv/hub/site) belongs to your user.
# It also copies the archive to ~/pi-setup/hub/site.tar.gz, so the rebuild package stays up to date.
param(
    [string]$Pi = "",
    [string]$Key = "",
    [switch]$Update
)
$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$DefaultPi = "pi@raspberry"
$DefaultKey = "$env:USERPROFILE\.ssh\id_ed25519"
$LocalSettings = Join-Path $Root "deploy.local.ps1"
if (Test-Path $LocalSettings) { . $LocalSettings }
# names used by deploy.local.ps1 files written for raspberry-hub 1.x
if (Get-Variable -Name PiPredefinito -ErrorAction SilentlyContinue) { $DefaultPi = $PiPredefinito }
if (Get-Variable -Name ChiavePredefinita -ErrorAction SilentlyContinue) { $DefaultKey = $ChiavePredefinita }
if (-not $Pi) { $Pi = $DefaultPi }
if (-not $Key) { $Key = $DefaultKey }

function Assert-Success([string]$What) {
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

Push-Location (Join-Path $Root "hub")
try {
    # npm keeps a copy of the lockfile it installed in node_modules: when package-lock.json is newer (a new
    # version was pulled), the dependencies changed and are installed again, exactly as the lockfile says.
    $Installed = "node_modules\.package-lock.json"
    if (-not (Test-Path $Installed) -or (Get-Item "package-lock.json").LastWriteTime -gt (Get-Item $Installed).LastWriteTime) {
        Write-Host "== Installing dependencies"
        npm ci --no-audit --no-fund
        Assert-Success "npm ci"
    }
    Write-Host "== Map assets (fonts and icons)"
    npm run assets
    Assert-Success "Downloading the map assets"
    Write-Host "== Building the website"
    npm run build
    Assert-Success "The build"
    tar -czf (Join-Path $Root "pi\site.tar.gz") -C out .
    Assert-Success "Creating the archive"
}
finally {
    Pop-Location
}

Write-Host "== Copying to the Raspberry Pi ($Pi)"
ssh -i $Key $Pi "mkdir -p ~/pi-setup/hub"
Assert-Success "Preparing the folder on the Raspberry Pi"

if ($Update) {
    # scripts, services and configuration templates, with the website archive built above
    $Package = Join-Path ([System.IO.Path]::GetTempPath()) "raspberry-hub-pi.tar.gz"
    tar -czf $Package --exclude=tests --exclude=__pycache__ -C (Join-Path $Root "pi") .
    Assert-Success "Packing the pi folder"
    scp -q -i $Key $Package "${Pi}:pi-setup/hub-update.tar.gz"
    Assert-Success "Copying the pi folder"
    ssh -i $Key $Pi "tar -xzf ~/pi-setup/hub-update.tar.gz -C ~/pi-setup/hub && rm ~/pi-setup/hub-update.tar.gz"
    Assert-Success "Unpacking the pi folder"
    Remove-Item $Package
    Write-Host "== Installing on the Raspberry Pi (sudo asks for your password)"
    ssh -t -i $Key $Pi "sudo bash ~/pi-setup/hub/hub-install.sh"
    Assert-Success "hub-install.sh"
    Write-Host "== Done: reload https://raspberry/ (devices that were logged in have to log in again after an upgrade from 1.x)"
    return
}

scp -q -i $Key (Join-Path $Root "pi\site.tar.gz") "${Pi}:pi-setup/hub/site.tar.gz"
Assert-Success "Copying the archive"
ssh -i $Key $Pi "find /srv/hub/site -mindepth 1 -delete; tar -xzf ~/pi-setup/hub/site.tar.gz -C /srv/hub/site; test -f /srv/hub/site/index.html"
Assert-Success "Installing the website"
Write-Host "== Done: reload https://raspberry/"
