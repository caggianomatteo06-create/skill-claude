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

# Servono solo alla modalità live (lezione_live.py). Se qualcosa non si
# installa, la trascrizione normale funziona lo stesso: non fermare il setup.
echo "Installo gli extra per la modalità live"
"$VENV/bin/pip" install --upgrade sounddevice mss anthropic --quiet || \
  echo "  alcuni extra non installati: trascrivi.py funziona comunque"

cat <<FINE

Pronto. Per trascrivere una lezione:

  $VENV/bin/python $CARTELLA/scripts/trascrivi.py "percorso/audio.m4a" \\
      --glossario "percorso/glossario.md"

Il primo avvio scarica anche il modello Whisper (circa 1,6 GB per large-v3-turbo),
poi resta nella cache e non viene più riscaricato.

Per seguire la lezione in diretta, con gli avvisi su cosa fotografare:

  $VENV/bin/python $CARTELLA/scripts/lezione_live.py --uscita "percorso/cartella-lezione"

Se il computer ha una GPU NVIDIA, installa anche le librerie CUDA per andare
molto più veloce:

  $VENV/bin/pip install nvidia-cublas-cu12 nvidia-cudnn-cu12

Se la modalità live dice che manca PortAudio, installalo dal sistema:
  Linux    sudo apt install libportaudio2
  macOS    brew install portaudio
  Windows  già incluso, non serve nulla

FINE
