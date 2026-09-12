#!/usr/bin/env python3
"""Trascrive la registrazione di una lezione in Markdown, SRT e testo puro.

Gira in locale con faster-whisper: l'audio non lascia il computer e non si paga
nulla a ora trascritta. Accetta qualsiasi formato audio o video leggibile da
ffmpeg (m4a, mp3, wav, ogg, mp4, mkv...).

Esempio:
    python trascrivi.py lezione.m4a --glossario glossario.md
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

# Lunghezza di un blocco nel Markdown. Cinque minuti danno un file navigabile
# senza spezzare i ragionamenti del docente a metà.
SECONDI_PER_BLOCCO = 300

# Whisper legge come contesto iniziale al massimo circa 220 token: oltre, taglia.
MAX_CARATTERI_GLOSSARIO = 850


def hhmmss(secondi: float) -> str:
    t = int(secondi)
    return f"{t // 3600:02d}:{(t % 3600) // 60:02d}:{t % 60:02d}"


def timestamp_srt(secondi: float) -> str:
    ms = int(round(secondi * 1000))
    ore, ms = divmod(ms, 3_600_000)
    minuti, ms = divmod(ms, 60_000)
    sec, ms = divmod(ms, 1000)
    return f"{ore:02d}:{minuti:02d}:{sec:02d},{ms:03d}"


def scegli_hardware(preferenza: str) -> tuple[str, str]:
    """Ritorna (device, compute_type). Su CPU int8 è l'unica scelta sensata."""
    if preferenza == "cpu":
        return "cpu", "int8"
    if preferenza == "cuda":
        return "cuda", "float16"
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def leggi_glossario(percorso: Path) -> str:
    """Costruisce il contesto iniziale da dare al modello.

    Le voci vanno passate come una frase in linguaggio naturale: Whisper è stato
    addestrato su testo continuo e un elenco puntato lo confonde. L'ordine conta,
    perché in caso di taglio sopravvivono le prime voci.
    """
    voci = []
    for riga in percorso.read_text(encoding="utf-8").splitlines():
        riga = riga.strip().lstrip("-*• ").strip()
        if not riga or riga.startswith("#"):
            continue
        voci.append(riga)

    if not voci:
        return ""

    contesto = "Lezione universitaria in italiano. Termini citati: " + ", ".join(voci) + "."
    if len(contesto) > MAX_CARATTERI_GLOSSARIO:
        contesto = contesto[:MAX_CARATTERI_GLOSSARIO].rsplit(",", 1)[0] + "."
        print(
            f"  glossario troppo lungo: uso le prime voci ({MAX_CARATTERI_GLOSSARIO} caratteri)",
            file=sys.stderr,
        )
    return contesto


def scrivi_markdown(percorso: Path, segmenti: list, titolo: str, durata: float) -> None:
    righe = [f"# Trascrizione — {titolo}", ""]
    righe.append(f"Durata: {hhmmss(durata)} · generata con Whisper, da rileggere prima di citarla.")
    righe.append("")

    blocco_corrente = -1
    for inizio, _fine, testo in segmenti:
        blocco = int(inizio // SECONDI_PER_BLOCCO)
        if blocco != blocco_corrente:
            blocco_corrente = blocco
            righe.append("")
            righe.append(f"## [{hhmmss(blocco * SECONDI_PER_BLOCCO)}]")
            righe.append("")
        righe.append(testo)

    percorso.write_text("\n".join(righe).strip() + "\n", encoding="utf-8")


def scrivi_srt(percorso: Path, segmenti: list) -> None:
    blocchi = []
    for n, (inizio, fine, testo) in enumerate(segmenti, start=1):
        blocchi.append(f"{n}\n{timestamp_srt(inizio)} --> {timestamp_srt(fine)}\n{testo}\n")
    percorso.write_text("\n".join(blocchi), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Trascrive una lezione in Markdown, SRT e testo puro.",
    )
    parser.add_argument("audio", type=Path, help="file audio o video della lezione")
    parser.add_argument(
        "--modello",
        default="large-v3-turbo",
        help="modello Whisper: large-v3-turbo (default), large-v3, medium, small",
    )
    parser.add_argument(
        "--lingua",
        default="it",
        help="lingua della lezione (default: it). 'auto' per farla riconoscere",
    )
    parser.add_argument(
        "--glossario",
        type=Path,
        help="file con i termini del corso, uno per riga: riduce gli errori sui tecnicismi",
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cpu", "cuda"],
        help="hardware da usare (default: auto)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="cartella di destinazione (default: quella dell'audio)",
    )
    args = parser.parse_args()

    if not args.audio.is_file():
        print(f"errore: file non trovato: {args.audio}", file=sys.stderr)
        return 1

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "errore: faster-whisper non installato. Esegui prima: bash scripts/setup.sh",
            file=sys.stderr,
        )
        return 1

    contesto = ""
    if args.glossario:
        if args.glossario.is_file():
            contesto = leggi_glossario(args.glossario)
            print(f"  glossario: {args.glossario}")
        else:
            print(f"  attenzione: glossario non trovato, proseguo senza: {args.glossario}",
                  file=sys.stderr)

    device, compute_type = scegli_hardware(args.device)
    print(f"  modello: {args.modello} su {device} ({compute_type})")
    print("  il primo avvio scarica il modello, può volerci qualche minuto.")

    modello = WhisperModel(args.modello, device=device, compute_type=compute_type)

    iteratore, info = modello.transcribe(
        str(args.audio),
        language=None if args.lingua == "auto" else args.lingua,
        initial_prompt=contesto or None,
        # Taglia i silenzi: in aula sono tanti (domande, pause, scrittura alla
        # lavagna) e senza filtro Whisper ci inventa testo sopra.
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 700},
        beam_size=5,
        condition_on_previous_text=False,  # evita che un errore si propaghi in cascata
    )

    durata = info.duration
    print(f"  durata audio: {hhmmss(durata)} · lingua: {info.language}")
    print("  trascrizione in corso...")

    segmenti: list[tuple[float, float, str]] = []
    avvio = time.monotonic()
    ultimo_avanzamento = 0.0

    for segmento in iteratore:
        testo = segmento.text.strip()
        if testo:
            segmenti.append((segmento.start, segmento.end, testo))
        if segmento.end - ultimo_avanzamento >= 60:
            ultimo_avanzamento = segmento.end
            trascorso = time.monotonic() - avvio
            quota = (segmento.end / durata * 100) if durata else 0
            print(f"    {hhmmss(segmento.end)} / {hhmmss(durata)}"
                  f"  ({quota:.0f}%, {trascorso / 60:.1f} min di elaborazione)")

    if not segmenti:
        print("errore: nessun parlato riconosciuto. Audio muto o troppo disturbato?",
              file=sys.stderr)
        return 1

    destinazione = args.output or args.audio.parent
    destinazione.mkdir(parents=True, exist_ok=True)
    titolo = args.audio.parent.name if args.audio.stem in {"audio", "registrazione"} else args.audio.stem

    md = destinazione / "trascrizione.md"
    srt = destinazione / "trascrizione.srt"
    txt = destinazione / "trascrizione.txt"

    scrivi_markdown(md, segmenti, titolo, durata)
    scrivi_srt(srt, segmenti)
    txt.write_text(" ".join(t for _, _, t in segmenti) + "\n", encoding="utf-8")

    parole = sum(len(t.split()) for _, _, t in segmenti)
    print(f"\n  fatto in {(time.monotonic() - avvio) / 60:.1f} min · {parole} parole")
    for percorso in (md, srt, txt):
        print(f"    {percorso}")
    print("\n  Passo successivo: chiedi a Claude riassunto, mappa o flashcard da trascrizione.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
