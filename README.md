# Inventario AI

Pagina locale con tutto ciò che riguarda l'AI e lo sviluppo sul computer su cui gira. Ogni computer vede solo se stesso.

## Installazione su un altro computer

Serve [Node](https://nodejs.org) 22 o più recente. Funziona su Windows e macOS, senza altre dipendenze.

```
git clone https://github.com/Scarva99/ScarvaInventoryAI.git
```

- **Windows:** doppio clic su `Avvia Inventario.vbs`.
- **macOS:** doppio clic su `Avvia Inventario.command`. La prima volta macOS chiede il permesso di leggere Documenti, Scrivania e Download: senza, quelle cartelle restano fuori dall'inventario. Per un controllo completo aggiungi Terminale in Impostazioni di Sistema, Privacy e sicurezza, Accesso completo al disco.

La pagina mostra subito gli ultimi dati, rifà la scansione e segnala cosa è cambiato. Il server si spegne da solo circa un minuto e mezzo dopo che chiudi la pagina.

Per portare su un computer una versione nuova del programma: `git pull` nella cartella.

## Cosa modificare a mano

Solo `dichiarato.json`, per ciò che il computer non può rilevare (abbonamenti diversi da Claude, modelli inclusi). Viene creato alla prima scansione a partire da `dichiarato.esempio.json` e non va su GitHub.

## Riconoscimento dei modelli

I nomi noti stanno in `scanner/models.mjs`, nell'elenco `RULES`. Un modello che non corrisponde a nessuna regola compare comunque, col nome del file.

## Sicurezza

Il programma legge soltanto. Ascolta solo su 127.0.0.1 e non apre i file delle credenziali (`.credentials.json`, `auth.json`, `oauth_creds.json`, `.env`). Di MCP e connettori salva solo i nomi. La cartella `data`, con l'inventario del computer, non va su GitHub.

## Limiti della scansione

Salta sempre le cartelle `node_modules` e `.git` e quelle protette dal sistema. Il numero di quelle saltate è nella sezione Hardware.

- **Windows:** legge tutti i dischi fissi, tranne `C:\Windows`.
- **macOS:** legge la cartella utente, `/Applications`, `/Library/Application Support`, `/opt`, `/usr/local` e i dischi esterni collegati. Salta le cartelle cloud in `~/Library/CloudStorage`.
