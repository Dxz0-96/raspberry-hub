# Builds the hub and publishes it on the Raspberry Pi.
#
#   .\deploy.ps1                                       website only
#   .\deploy.ps1 -Pi user@address -Key C:\path\to\key
#   .\deploy.ps1 -Update                               website + everything in pi/, then runs hub-install.sh on
#                                                      the Raspberry Pi (asks for the sudo password there). Use it
#                                                      after pulling a new version: it also upgrades older installs.
#
# Your values go in .env, next to this script (ignored by git): copy .env.example to .env and edit it. It holds
# plain KEY=value lines and is only read, never run:
#   PI_HOST=pi@192.168.1.10        Raspberry Pi to deploy to (SSH user@host)
#   PI_SSH_KEY=~/.ssh/id_ed25519   SSH key to use (~ is your user folder)
#   HUB_URL=https://raspberry/     address of the hub, printed at the end
#   MAP_COUNTRY=FR                 the country of the map on a new installation (ISO 3166 code; empty: it asks)
#
# Which value wins: -Pi and -Key on the command line, then .env, then deploy.local.ps1 (the older way: a script
# setting $DefaultPi and $DefaultKey, still read), then the defaults below.
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

# Every setting .env may hold, with its default.
$Settings = [ordered]@{
    PI_HOST    = "pi@raspberry"
    PI_SSH_KEY = "~/.ssh/id_ed25519"
    HUB_URL    = "https://raspberry/"
    # answers hub-install.sh would ask on a new installation (re-runs for upgrades never ask)
    MAP_COUNTRY = ""
}

function Read-DotEnv([string]$Path, $Known) {
    # KEY=value lines. Blank lines and lines starting with # are skipped, "export " in front is allowed, a value
    # may be in single or double quotes, and an unquoted value ends at " #". Nothing is run or expanded.
    # Returns the known settings that have a value; anything else gets a warning, so a typo does not go unnoticed.
    $Values = @{}
    $Number = 0
    foreach ($Line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $Number++
        $Text = $Line.Trim()
        if ($Text -eq "" -or $Text.StartsWith("#")) { continue }
        if ($Text -notmatch '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            Write-Warning ".env, line ${Number}: not a KEY=value line, ignored."
            continue
        }
        $Name = $Matches[1]
        $Value = $Matches[2]
        if (-not $Known.Contains($Name)) {
            Write-Warning ".env, line ${Number}: unknown setting $Name, ignored (known: $($Known.Keys -join ', '))."
            continue
        }
        if ($Value -match '^"(.*?)"\s*(#.*)?$' -or $Value -match "^'(.*?)'\s*(#.*)?$") {
            $Value = $Matches[1]
        }
        else {
            $Value = ($Value -replace '(^|\s+)#.*$', '').Trim()
        }
        if ($Value) { $Values[$Name] = $Value }
    }
    return $Values
}

# deploy.local.ps1, the older way: a script setting $DefaultPi and $DefaultKey ($PiPredefinito and
# $ChiavePredefinita in raspberry-hub 1.x). Set to nothing first, so a variable of the same name in the
# terminal does not count.
$DefaultPi = $DefaultKey = $PiPredefinito = $ChiavePredefinita = $null
$LocalSettings = Join-Path $Root "deploy.local.ps1"
if (Test-Path -LiteralPath $LocalSettings) {
    . $LocalSettings
    foreach ($Value in $DefaultPi, $PiPredefinito) { if ($Value) { $Settings.PI_HOST = $Value } }
    foreach ($Value in $DefaultKey, $ChiavePredefinita) { if ($Value) { $Settings.PI_SSH_KEY = $Value } }
}

$EnvFile = Join-Path $Root ".env"
if (Test-Path -LiteralPath $EnvFile) {
    $FromFile = Read-DotEnv $EnvFile $Settings
    foreach ($Name in $FromFile.Keys) { $Settings[$Name] = $FromFile[$Name] }
}

if (-not $Pi) { $Pi = $Settings.PI_HOST }
if (-not $Key) { $Key = $Settings.PI_SSH_KEY }
if ($Key -match '^~([\\/]|$)') { $Key = $HOME + $Key.Substring(1) }
$HubUrl = $Settings.HUB_URL

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
    # only values of the expected shape go into the remote command line
    $Answers = ""
    if ($Settings.MAP_COUNTRY) {
        if ($Settings.MAP_COUNTRY -notmatch '^[A-Za-z]{2}$') { throw "MAP_COUNTRY in .env is not an ISO 3166 code (for example IT, FR)." }
        $Answers += "MAP_COUNTRY=$($Settings.MAP_COUNTRY) "
    }
    ssh -t -i $Key $Pi "sudo ${Answers}bash ~/pi-setup/hub/hub-install.sh"
    Assert-Success "hub-install.sh"
    Write-Host "== Done: reload $HubUrl (devices that were logged in have to log in again after an upgrade from 1.x)"
    return
}

scp -q -i $Key (Join-Path $Root "pi\site.tar.gz") "${Pi}:pi-setup/hub/site.tar.gz"
Assert-Success "Copying the archive"
ssh -i $Key $Pi "find /srv/hub/site -mindepth 1 -delete; tar -xzf ~/pi-setup/hub/site.tar.gz -C /srv/hub/site; test -f /srv/hub/site/index.html"
Assert-Success "Installing the website"
Write-Host "== Done: reload $HubUrl"
