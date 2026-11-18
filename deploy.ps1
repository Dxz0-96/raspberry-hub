# Compila l'hub e lo pubblica sul Raspberry.
#
#   .\deploy.ps1                                         usa i valori di deploy.local.ps1 (se c'e')
#   .\deploy.ps1 -Pi utente@indirizzo -Chiave C:\percorso\chiave
#
# deploy.local.ps1 (escluso da git) contiene solo le due righe con i tuoi valori, per esempio:
#   $PiPredefinito = "pi@192.168.1.10"
#   $ChiavePredefinita = "$env:USERPROFILE\.ssh\id_ed25519"
#
# Non serve sudo: la cartella del sito sul Raspberry (/srv/hub/site) appartiene al tuo utente.
# Copia anche l'archivio in ~/pi-setup/hub/sito.tar.gz, cosi' il pacchetto di ricostruzione resta aggiornato.
param(
    [string]$Pi = "",
    [string]$Chiave = ""
)
$ErrorActionPreference = "Stop"

$Radice = $PSScriptRoot
$PiPredefinito = "pi@raspberry"
$ChiavePredefinita = "$env:USERPROFILE\.ssh\id_ed25519"
$Locale = Join-Path $Radice "deploy.local.ps1"
if (Test-Path $Locale) { . $Locale }
if (-not $Pi) { $Pi = $PiPredefinito }
if (-not $Chiave) { $Chiave = $ChiavePredefinita }

function Controlla([string]$Cosa) {
    if ($LASTEXITCODE -ne 0) { throw "$Cosa non riuscito (codice $LASTEXITCODE)." }
}

Push-Location (Join-Path $Radice "hub")
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "== Installo le dipendenze"
        npm install --no-audit --no-fund
        Controlla "npm install"
    }
    Write-Host "== Risorse della mappa (caratteri e icone)"
    npm run assets
    Controlla "Il download delle risorse della mappa"
    Write-Host "== Compilo il sito"
    npm run build
    Controlla "La compilazione"
    tar -czf (Join-Path $Radice "pi\sito.tar.gz") -C out .
    Controlla "La creazione dell'archivio"
}
finally {
    Pop-Location
}

Write-Host "== Copio sul Raspberry ($Pi)"
ssh -i $Chiave $Pi "mkdir -p ~/pi-setup/hub"
Controlla "La preparazione della cartella sul Raspberry"
scp -q -i $Chiave (Join-Path $Radice "pi\sito.tar.gz") "${Pi}:pi-setup/hub/sito.tar.gz"
Controlla "La copia dell'archivio"
ssh -i $Chiave $Pi "find /srv/hub/site -mindepth 1 -delete; tar -xzf ~/pi-setup/hub/sito.tar.gz -C /srv/hub/site; test -f /srv/hub/site/index.html"
Controlla "L'installazione del sito"
Write-Host "== Fatto: ricarica https://raspberry/"
