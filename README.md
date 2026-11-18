# Hub di casa su `https://raspberry`

Una pagina da cui aprire i servizi del Raspberry (Pi-hole, Wikipedia offline, mappe offline dell'Italia,
monitor di rete e quelli che aggiungi tu), accenderli e spegnerli, e vedere come sta l'hardware.

Provato su Raspberry Pi 3 Model B, Debian 13 a 64 bit, Pi-hole v6 (novembre 2026). Nessun Docker: sul Pi girano
solo servizi di sistema. La rete predefinita di Docker (172.17.x.x) entra in conflitto con i router che
inoltrano il DNS da quegli indirizzi.

### Requisiti

- Raspberry Pi con Debian (o Raspberry Pi OS) a 64 bit e Pi-hole v6 già installato.
- Il pacchetto `pi-setup` del Raspberry, **non incluso in questa repo**: crea la "CA di casa" e il certificato
  (`pihole-cert.sh`), l'aggiornamento mensile (`monthly-update.sh`), i backup e il monitor di rete (`/netmon/`).
  `hub-install.sh` si aspetta di stare in `~/pi-setup/hub` e salta i passi che lo richiedono se non lo trova.
- Sul PC: Node.js 20 o più recente e PowerShell per `deploy.ps1`.

## Come è fatto

```
https://raspberry  ->  Caddy (porte 80 e 443, certificato della "CA di casa")
   /             sito dell'hub (Next.js compilato in statico)      /srv/hub/site
   /mappe/       mappa (MapLibre) che legge /tiles/italia.pmtiles  /srv/hub/maps
   /cerca        ricerca degli indirizzi   hub-search.py  127.0.0.1:8082   /srv/hub/search/indirizzi.db
   /controllo/   stato, interruttori, monitor hardware   hub-control.py  127.0.0.1:8083
   /wiki/        Wikipedia offline   kiwix-serve  127.0.0.1:8081   /srv/hub/zim
   /admin /api /netmon   Pi-hole (il suo web ascolta solo su 127.0.0.1:8080)
   /servizi.json /icone/   elenco dei servizi e loro immagini      /srv/hub/config, /srv/hub/icone
```

| Cartella | Contenuto |
|---|---|
| `hub/` | L'interfaccia: Next.js + React, compilata in un sito statico. Sul Pi non gira Node. |
| `pi/` | Tutto ciò che va sul Raspberry: Caddyfile, servizi systemd, script. Sul Pi sta in `~/pi-setup/hub`. |
| `deploy.ps1` | Ricompila l'hub e lo ripubblica sul Raspberry. |

## Uso di tutti i giorni

| Cosa | Come |
|---|---|
| Aprire l'hub | `https://raspberry/` (la prima volta su ogni dispositivo va importata la CA: vedi sotto) |
| Accendere o spegnere Wikipedia, mappe, blocco pubblicità | Interruttore accanto al servizio; chiede utente e password |
| Aggiungere un collegamento (NAS, router, stampante) | "Aggiungi servizio" nell'hub, con nome, indirizzo e immagine |
| Aggiungere un servizio che gira sul Pi | Sul Pi: `sudo hub-servizio aggiungi` (pubblica sotto `https://raspberry/<percorso>/` e può dargli l'interruttore) |
| Cambiare utente e password dell'hub | Sul Pi: `sudo hub-control-setpass`. Solo la password: dall'hub, menu dell'utente, "Cambia password" |
| Aggiornare subito Wikipedia, mappe, indirizzi | Sul Pi: `sudo hub-update.sh` (oppure `wiki`, `mappe`, `indirizzi`) |
| Controllare che tutto sia in piedi | Sul Pi: `sudo hub-verifica.sh` |
| Cambiare variante di Wikipedia o zona delle mappe | `/etc/hub.conf`, poi `sudo hub-update.sh` |

Wikipedia e mappe partono **spente**: si accendono dall'hub quando servono, e lo stato scelto resta anche dopo
un riavvio. Con il blocco pubblicità in pausa, il monitor di rete lo segnala come guasto su Telegram dopo due minuti.

## Credenziali

| Cosa | Credenziali | Dove si cambiano |
|---|---|---|
| Interruttori e "Aggiungi servizio" | Utente (`admin` se non lo cambi) e password scelti da te | `sudo hub-control-setpass` |
| Dashboard di Pi-hole | La password di Pi-hole | `sudo pihole setpassword` |
| Stato dei servizi, monitor hardware, Wikipedia, mappe | Nessuna | |

La password dell'hub sta in `/etc/hub-control/credenziali.json` solo come impronta scrypt. Dopo 5 tentativi
sbagliati l'accesso si blocca per 5 minuti. Una volta entrati si resta dentro finché non si preme "Esci",
anche dopo un riavvio del Raspberry: il cookie dura 400 giorni e si rinnova da solo una volta al giorno
mentre si usa l'hub. Sul Raspberry restano solo le impronte delle sessioni (`/var/lib/hub-control/sessioni.json`);
cambiare la password, dall'hub o con `sudo hub-control-setpass`, fa uscire tutti gli altri dispositivi.

## Certificato HTTPS

Il certificato è emesso dalla "CA di casa" creata da `pihole-cert.sh` (pacchetto `pi-setup`), valida solo per
`raspberry`, `pi.hole` e l'indirizzo IP del Raspberry. Va importata una volta su ogni dispositivo:

1. Scarica `http://raspberry/ca.crt`.
2. Windows: doppio clic, Installa certificato, Computer locale, "Autorità di certificazione radice attendibili".
3. Riavvia il browser.

Il rinnovo è automatico: `pihole-cert.sh` rinnova il certificato, `hub-cert-sync.path` lo passa a Caddy.

## Cosa succede da solo

| Quando | Cosa |
|---|---|
| All'avvio | Partono Caddy, il servizio di controllo e, se accesi, Wikipedia e la ricerca degli indirizzi |
| Ogni 5 secondi | Il servizio di controllo campiona l'hardware (storico di 24 ore in memoria, nulla su disco) |
| Domenica 04:30 | Controllo del certificato (pacchetto `pi-setup`) |
| Il 1° del mese, 03:00 | Dopo sistema e Pi-hole: nuova edizione di Wikipedia se è uscita, mappe e indice degli indirizzi rifatti, poi riavvio |

Wikipedia offline non ha aggiornamenti differenziali: ogni edizione è un file nuovo (circa 30 GB), scaricato
solo quando esce. Mappe (4,7 GB) e indirizzi vengono rifatti se hanno più di 20 giorni.

## Modificare l'interfaccia

```
cd hub
npm install
npm run assets          # caratteri e icone della mappa, una volta
npm run build
npm run mock            # finto Raspberry su http://localhost:8790 (accesso di prova: admin / prova1234)
```

Per provare mappa e ricerca con i dati veri del Raspberry: apri un tunnel con
`ssh -N -L 8443:127.0.0.1:443 utente@indirizzo-del-raspberry`, metti il certificato della CA di casa in
`ca-di-casa.crt` nella cartella principale (escluso da git), poi lancia `node dev/mock-pi.mjs` e apri
`http://localhost:8791/mappe/`. Le mappe devono essere accese. Nel tunnel il primo caricamento è più lento
che in casa: collegandosi direttamente al Raspberry ogni pezzo di mappa arriva in 50-150 ms.

La pagina delle mappe tiene la posizione nell'indirizzo (`/mappe/#posizione=zoom/lat/lon`): ricaricando
non si perde, e un indirizzo così si può salvare tra i preferiti.

Poi, per pubblicare: `.\deploy.ps1`. Utente, indirizzo del Raspberry e chiave SSH si passano con
`-Pi utente@indirizzo -Chiave percorso`, oppure si scrivono una volta in `deploy.local.ps1` (escluso da git):

```powershell
$PiPredefinito = "pi@192.168.1.10"
$ChiavePredefinita = "$env:USERPROFILE\.ssh\id_ed25519"
```

## Test

Test end-to-end con Playwright su mappe e Wikipedia, sul computer e su un telefono simulato. Girano sul sito
compilato servito dal finto Raspberry, con una piccola mappa del centro di Roma (`hub/tests/fixtures/roma.pmtiles`,
dati OpenStreetMap) e una Wikipedia finta (`hub/dev/finta-wikipedia.mjs`): non serve il Raspberry.

```
cd hub
npx playwright install chromium     # una volta
npm run test:tutto                  # compila e lancia i test (npm test se il sito è già compilato)
```

L'elenco dei servizi non è nel codice: sta sul Pi in `/srv/hub/config/servizi.json`.

## Se qualcosa non va

| Sintomo | Controllo |
|---|---|
| L'hub non si apre | Sul Pi: `systemctl status caddy`; `sudo hub-verifica.sh` |
| Avviso del browser sul certificato | Importa `http://raspberry/ca.crt` sul dispositivo |
| "Servizio spento o non risponde" | Accendilo dall'hub; se era acceso, `systemctl status kiwix-hub hub-search` |
| Lo stato dei servizi non arriva | `systemctl status hub-control` |
| La ricerca degli indirizzi non risponde | L'indice c'è? `ls -la /srv/hub/search`; rifarlo: `sudo hub-update.sh indirizzi` |
| A volte `raspberry` non risponde | Il router ha due indirizzi per quel nome: togli dal router il vecchio dispositivo chiamato `raspberry` |

### Tornare indietro

```
cd ~/pi-setup/hub
sudo bash hub-install.sh disattiva      # Pi-hole di nuovo sulle porte 80/443, Caddy fermo
sudo systemctl disable --now kiwix-hub hub-search hub-control hub-cert-sync.path
sudo cp /usr/local/sbin/monthly-update.sh.bak /usr/local/sbin/monthly-update.sh
sudo rm -rf /srv/hub                    # solo se vuoi liberare anche lo spazio dei contenuti
```

## Dati e licenze

Codice: licenza MIT, vedi `LICENSE`.

Mappe e indirizzi: © OpenStreetMap, licenza ODbL, tramite Protomaps e il dump Photon/Nominatim di GraphHopper.
Wikipedia offline: Kiwix. Caratteri: IBM Plex (SIL Open Font License) e Noto Sans per le etichette della mappa.
