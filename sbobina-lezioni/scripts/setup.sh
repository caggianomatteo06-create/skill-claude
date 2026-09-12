#!/usr/bin/env bash
# Prepara l'ambiente per trascrivi.py. Da eseguire una volta sola.
set -euo pipefail

CARTELLA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$CARTELLA/.venv"

echo "Creo l'ambiente Python in $VENV"
python3 -m venv "$VENV"

echo "Installo faster-whisper (qualche minuto la prima volta)"
"$VENV/bin/pip" install --upgrade pip --quiet
"$VENV/bin/pip" install --upgrade faster-whisper --quiet

cat <<FINE

Pronto. Per trascrivere una lezione:

  $VENV/bin/python $CARTELLA/scripts/trascrivi.py "percorso/audio.m4a" \\
      --glossario "percorso/glossario.md"

Il primo avvio scarica anche il modello Whisper (circa 1,6 GB per large-v3-turbo),
poi resta nella cache e non viene più riscaricato.

Se il computer ha una GPU NVIDIA, installa anche le librerie CUDA per andare
molto più veloce:

  $VENV/bin/pip install nvidia-cublas-cu12 nvidia-cudnn-cu12

FINE
