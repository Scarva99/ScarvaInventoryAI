#!/bin/bash
# Avvia l'inventario su macOS e apre la pagina nel browser. Doppio clic per lanciarlo.
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
if ! command -v node >/dev/null 2>&1; then
  echo "Node non e' installato. Scaricalo da https://nodejs.org e riprova."
  read -r -p "Premi Invio per chiudere."
  exit 1
fi
exec node server.mjs --open
