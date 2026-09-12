#!/usr/bin/env python3
"""Assistente che segue la lezione mentre la registri.

Registra, trascrive a finestre di pochi secondi e avvisa in tempo reale quando
sta succedendo qualcosa che dal solo audio andrebbe perso: il docente indica la
lavagna, cita una slide, segnala un argomento d'esame, o l'audio si degrada.

Tre livelli, attivabili in modo indipendente:

1. rilevatore locale, sempre attivo, gratuito e offline;
2. cattura automatica dello schermo quando serve, per le lezioni online;
3. agente Claude che ogni pochi minuti rilegge quello che è stato detto e
   prepara le domande da fare al docente. Opzionale, richiede una chiave API.

Esempi:
    python lezione_live.py --uscita "Lezioni/Analisi/2026-09-12-serie"
    python lezione_live.py --uscita out --schermo --agente
    python lezione_live.py --uscita out --sorgente prova.wav --veloce
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import sys
import threading
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

FREQUENZA = 16000          # Whisper lavora a 16 kHz: inutile registrare più fine
BLOCCO_CAMPIONI = 4000     # 0,25 s per blocco in arrivo dal microfono
FINESTRA_SECONDI = 25.0    # quanto audio accumulare prima di trascriverlo
CODA_SECONDI = 1.0         # se l'ultimo segmento finisce qui dentro, è tagliato a metà
RIPORTO_MASSIMO = 8.0      # oltre questa lunghezza il segmento si emette comunque
SILENZIO_TRA_AVVISI = 45.0 # per categoria: sotto questa soglia l'avviso si ripete a vuoto
SOGLIA_CONFIDENZA = -0.9   # avg_logprob sotto il quale Whisper sta tirando a indovinare

# ---------------------------------------------------------------------------
# Rilevatore locale
# ---------------------------------------------------------------------------

# Ogni categoria: emoji, spiegazione, e le espressioni che la fanno scattare.
# Sono volutamente generose: un avviso di troppo costa un'occhiata, un avviso
# mancato costa un pezzo di lezione.
CATEGORIE = {
    "visivo": {
        "emoji": "📸",
        "azione": "il docente sta indicando qualcosa: fotografa la lavagna o lo schermo",
        "espressioni": [
            r"\bquest[oaie]\s+(?:qui|qua)\b",
            r"\b(?:qui|qua)\s+(?:vedete|vedi|abbiamo|ho scritto|scrivo|c'è)\b",
            r"\bcome\s+(?:vedete|potete vedere|si vede|vedi)\b",
            r"\b(?:guardate|osservate|notate)\b",
            r"\bquest[ao]\s+(?:formula|grafico|slide|figura|tabella|schema|disegno|immagine|curva|matrice|equazione|espressione|funzione)\b",
            r"\b(?:in|nella)\s+figura\b",
            r"\b(?:sulla|alla)\s+lavagna\b",
            r"\bquel(?:lo|la)?\s+(?:lì|là)\b",
            r"\b(?:qui|qua)\s+(?:sopra|sotto)\b",
            r"\b(?:a|sulla)\s+(?:sinistra|destra)\b",
            r"\bvi\s+(?:faccio|mostro)\s+vedere\b",
        ],
    },
    "esame": {
        "emoji": "⭐",
        "azione": "segnalato per l'esame",
        "espressioni": [
            r"\ball'?\s*esame\b",
            r"\bin sede d'?esame\b",
            r"\b(?:lo|la|questo|questa)\s+chiedo\s+sempre\b",
            r"\bvi\s+chiederò\b",
            r"\bdomanda\s+(?:classica|tipica|d'?esame|ricorrente)\b",
            r"\b(?:è|e')\s+(?:fondamentale|importantissimo|essenziale)\b",
            r"\bmi\s+raccomando\b",
            r"\bricordate(?:vi)?\b",
            r"\bdovete\s+saper(?:lo|la|e)\b",
        ],
    },
    "esterno": {
        "emoji": "📖",
        "azione": "rimando a slide, libro o lezione precedente: recupera il materiale",
        "espressioni": [
            r"\bcome\s+(?:abbiamo|avevamo)\s+(?:visto|detto)\b",
            r"\bla\s+(?:scorsa|volta scorsa)\b",
            r"\bsul\s+libro\b",
            r"\bnel\s+capitolo\b",
            r"\bcapitolo\s+\w+",
            r"\besercizi(?:o)?\s+\w+",
            r"\bsulle\s+slide\b",
            r"\bvi\s+ho\s+(?:caricato|messo)\b",
            r"\bdispens[ae]\b",
        ],
    },
    "domanda": {
        "emoji": "❓",
        "azione": "il docente apre alle domande: è il momento di chiedere",
        "espressioni": [
            r"\b(?:ci siamo|tutto chiaro|è chiaro|e' chiaro)\b",
            r"\bdomande\b",
            r"\bchiedete\s+pure\b",
            r"\bdubbi\b",
        ],
    },
}

CATEGORIE_COMPILATE = {
    nome: [re.compile(e, re.IGNORECASE) for e in dati["espressioni"]]
    for nome, dati in CATEGORIE.items()
}


@dataclass
class Evento:
    istante: float
    categoria: str
    testo: str

    @property
    def emoji(self) -> str:
        return CATEGORIE[self.categoria]["emoji"] if self.categoria in CATEGORIE else "⚠️"

    @property
    def azione(self) -> str:
        if self.categoria == "confidenza":
            return "audio poco chiaro: la trascrizione qui non è affidabile"
        return CATEGORIE[self.categoria]["azione"]


class Rilevatore:
    """Trova nel parlato i segnali che l'audio da solo non basta a conservare."""

    def __init__(self, silenzio: float = SILENZIO_TRA_AVVISI,
                 soglia_confidenza: float = SOGLIA_CONFIDENZA):
        self.silenzio = silenzio
        self.soglia_confidenza = soglia_confidenza
        self._ultimo: dict[str, float] = {}

    def esamina(self, istante: float, testo: str, confidenza: float | None = None) -> list[Evento]:
        trovati: list[Evento] = []

        for nome, espressioni in CATEGORIE_COMPILATE.items():
            if any(e.search(testo) for e in espressioni):
                trovati.append(Evento(istante, nome, testo))

        if confidenza is not None and confidenza < self.soglia_confidenza:
            trovati.append(Evento(istante, "confidenza", testo))

        # Una categoria che scatta a raffica smette di essere un'informazione.
        emessi = []
        for evento in trovati:
            precedente = self._ultimo.get(evento.categoria)
            if precedente is not None and istante - precedente < self.silenzio:
                continue
            self._ultimo[evento.categoria] = istante
            emessi.append(evento)
        return emessi


# ---------------------------------------------------------------------------
# Sorgenti audio
# ---------------------------------------------------------------------------

class SorgenteMicrofono:
    """Microfono in diretta, con copia integrale su disco mentre si registra."""

    def __init__(self, archivio: Path, dispositivo=None):
        self.archivio = archivio
        self.dispositivo = dispositivo
        self._coda: queue.Queue = queue.Queue()
        self._stop = threading.Event()

    def blocchi(self):
        try:
            import numpy as np
            import sounddevice as sd
        except (ImportError, OSError) as errore:
            raise RuntimeError(
                "microfono non disponibile: serve sounddevice con PortAudio "
                f"({errore}). Su Linux: apt install libportaudio2. "
                "Per provare senza microfono usa --sorgente file.wav"
            ) from errore

        def richiamo(dati, _frame, _tempo, stato):
            if stato:
                print(f"  (audio: {stato})", file=sys.stderr)
            self._coda.put(dati[:, 0].copy())

        scrittore = wave.open(str(self.archivio), "wb")
        scrittore.setnchannels(1)
        scrittore.setsampwidth(2)
        scrittore.setframerate(FREQUENZA)

        flusso = sd.InputStream(
            samplerate=FREQUENZA, channels=1, dtype="float32",
            blocksize=BLOCCO_CAMPIONI, callback=richiamo, device=self.dispositivo,
        )
        try:
            with flusso:
                while not self._stop.is_set():
                    try:
                        blocco = self._coda.get(timeout=0.5)
                    except queue.Empty:
                        continue
                    scrittore.writeframes((blocco * 32767).astype(np.int16).tobytes())
                    yield blocco
        finally:
            scrittore.close()

    def ferma(self) -> None:
        self._stop.set()


class SorgenteFile:
    """Rilegge un file già registrato. Serve per provare tutto prima della lezione."""

    def __init__(self, percorso: Path, tempo_reale: bool = True):
        self.percorso = percorso
        self.tempo_reale = tempo_reale
        self._stop = threading.Event()

    def blocchi(self):
        import numpy as np
        from faster_whisper.audio import decode_audio

        audio = decode_audio(str(self.percorso), sampling_rate=FREQUENZA)
        durata_blocco = BLOCCO_CAMPIONI / FREQUENZA
        for inizio in range(0, len(audio), BLOCCO_CAMPIONI):
            if self._stop.is_set():
                return
            if self.tempo_reale:
                time.sleep(durata_blocco)
            yield np.asarray(audio[inizio:inizio + BLOCCO_CAMPIONI], dtype="float32")

    def ferma(self) -> None:
        self._stop.set()


# ---------------------------------------------------------------------------
# Trascrizione a finestre
# ---------------------------------------------------------------------------

class TrascrittoreFinestra:
    """Trascrive l'audio a blocchi, senza spezzare le frasi fra una finestra e l'altra.

    L'ultimo segmento di ogni finestra, se finisce a ridosso del bordo, è quasi
    sempre una frase tagliata: il suo audio viene riportato nella finestra
    successiva invece di essere emesso subito.
    """

    def __init__(self, modello, finestra: float = FINESTRA_SECONDI,
                 coda: float = CODA_SECONDI, contesto: str = "",
                 riporto_massimo: float = RIPORTO_MASSIMO):
        self.modello = modello
        self.finestra_campioni = int(finestra * FREQUENZA)
        self.coda = coda
        self.riporto_massimo = riporto_massimo
        self.contesto = contesto
        self._buffer = []
        self._campioni = 0
        self._offset = 0.0

    def aggiungi(self, blocco):
        self._buffer.append(blocco)
        self._campioni += len(blocco)
        if self._campioni >= self.finestra_campioni:
            return self._svuota(finale=False)
        return []

    def chiudi(self):
        return self._svuota(finale=True) if self._campioni else []

    def _svuota(self, finale: bool):
        import numpy as np

        audio = np.concatenate(self._buffer)
        durata = len(audio) / FREQUENZA
        segmenti, _ = self.modello.transcribe(
            audio, language="it", initial_prompt=self.contesto or None,
            vad_filter=True, beam_size=1, condition_on_previous_text=False,
        )
        segmenti = [s for s in segmenti if s.text.strip()]

        riporto_da = None
        if segmenti and not finale and durata - segmenti[-1].end < self.coda:
            # Un segmento lungo quanto la finestra non è una frase tagliata: se lo
            # riportassimo indietro, ogni blocco successivo lo farebbe ritrascrivere
            # daccapo e il buffer non si svuoterebbe più.
            if durata - segmenti[-1].start <= self.riporto_massimo:
                riporto_da = segmenti[-1].start
                segmenti = segmenti[:-1]

        emessi = [
            (self._offset + s.start, s.text.strip(), getattr(s, "avg_logprob", None))
            for s in segmenti
        ]

        if riporto_da is None:
            self._buffer, self._campioni = [], 0
            self._offset += durata
        else:
            taglio = int(riporto_da * FREQUENZA)
            resto = audio[taglio:]
            self._buffer, self._campioni = [resto], len(resto)
            self._offset += taglio / FREQUENZA
        return emessi


# ---------------------------------------------------------------------------
# Agente Claude
# ---------------------------------------------------------------------------

SISTEMA_AGENTE = """\
Segui in diretta una lezione universitaria italiana. Ricevi la trascrizione \
automatica degli ultimi minuti: è imperfetta, i termini tecnici possono essere \
storpiati e le formule lette a voce sono spesso incomprensibili.

Il tuo compito non è riassumere. È accorgerti di cosa si sta perdendo chi ha \
solo l'audio, mentre c'è ancora tempo per rimediare: lo studente è in aula e \
può fotografare la lavagna o alzare la mano.

Rispondi solo su ciò che è realmente nel testo. Se non c'è niente da segnalare, \
restituisci liste vuote: è una risposta corretta e utile."""

SCHEMA_AGENTE = {
    "type": "object",
    "properties": {
        "da_catturare": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Cose citate che dal solo audio non si ricostruiscono: formule scritte, grafici, passaggi indicati a gesti. Una riga ciascuna, con la parola del docente che lo fa capire.",
        },
        "termini_non_definiti": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Termini tecnici usati come noti ma mai definiti in questo estratto.",
        },
        "domande_da_fare": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Domande precise da rivolgere al docente adesso, non generiche.",
        },
        "punti_deboli": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Passaggi in cui la trascrizione è incoerente o palesemente corrotta, da riascoltare.",
        },
    },
    "required": ["da_catturare", "termini_non_definiti", "domande_da_fare", "punti_deboli"],
    "additionalProperties": False,
}

ETICHETTE_AGENTE = {
    "da_catturare": "📸 da catturare",
    "termini_non_definiti": "📖 termini mai definiti",
    "domande_da_fare": "❓ da chiedere al docente",
    "punti_deboli": "⚠️ da riascoltare",
}


class AgenteClaude:
    """Ogni N minuti rilegge il parlato recente e prepara le domande da fare."""

    def __init__(self, modello: str, intervallo: float, destinazione: Path):
        import anthropic

        self.client = anthropic.Anthropic()
        self.modello = modello
        self.intervallo = intervallo
        self.destinazione = destinazione
        self._coda: queue.Queue = queue.Queue()
        self._stop = threading.Event()
        self._filo = threading.Thread(target=self._gira, daemon=True)
        self.avvisi: queue.Queue = queue.Queue()

    def avvia(self) -> None:
        self._filo.start()

    def aggiungi(self, istante: float, testo: str) -> None:
        self._coda.put((istante, testo))

    def ferma(self) -> None:
        self._stop.set()
        self._filo.join(timeout=30)

    def _gira(self) -> None:
        scadenza = time.monotonic() + self.intervallo
        accumulo: list[tuple[float, str]] = []
        while not self._stop.is_set():
            try:
                accumulo.append(self._coda.get(timeout=1.0))
            except queue.Empty:
                pass
            if time.monotonic() >= scadenza:
                if accumulo:
                    self._analizza(accumulo)
                    accumulo = []
                scadenza = time.monotonic() + self.intervallo
        if accumulo:
            self._analizza(accumulo)

    def _analizza(self, pezzi: list[tuple[float, str]]) -> None:
        testo = "\n".join(f"[{formatta(i)}] {t}" for i, t in pezzi)
        try:
            risultato = self._chiedi(testo)
        except Exception as errore:  # una lezione non si interrompe per un errore di rete
            self.avvisi.put(f"agente non raggiungibile: {errore}")
            return
        if risultato is None:
            return

        righe = [f"\n## Minuti {formatta(pezzi[0][0])} – {formatta(pezzi[-1][0])}\n"]
        utile = False
        for chiave, etichetta in ETICHETTE_AGENTE.items():
            voci = risultato.get(chiave) or []
            if not voci:
                continue
            utile = True
            righe.append(f"**{etichetta}**")
            righe.extend(f"- {v}" for v in voci)
            righe.append("")
            for v in voci[:2]:
                self.avvisi.put(f"{etichetta}: {v}")
        if utile:
            with self.destinazione.open("a", encoding="utf-8") as f:
                f.write("\n".join(righe) + "\n")

    def _chiedi(self, testo: str) -> dict | None:
        parametri = dict(
            model=self.modello,
            max_tokens=2000,
            system=SISTEMA_AGENTE,
            messages=[{"role": "user", "content": testo}],
            # effort basso: qui conta rispondere prima che la lezione vada avanti.
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": SCHEMA_AGENTE},
            },
        )
        if self.modello.startswith(("claude-opus-5", "claude-fable")):
            risposta = self.client.beta.messages.create(
                betas=["server-side-fallback-2026-07-01"], fallbacks="default", **parametri
            )
        else:
            risposta = self.client.messages.create(**parametri)

        if risposta.stop_reason == "refusal":
            self.avvisi.put("l'agente ha rifiutato di analizzare questo estratto")
            return None
        blocco = next((b for b in risposta.content if b.type == "text"), None)
        return json.loads(blocco.text) if blocco else None


# ---------------------------------------------------------------------------
# Sessione
# ---------------------------------------------------------------------------

def formatta(secondi: float) -> str:
    t = int(secondi)
    return f"{t // 3600:02d}:{(t % 3600) // 60:02d}:{t % 60:02d}"


@dataclass
class Sessione:
    destinazione: Path
    schermo: bool = False
    suono: bool = False
    eventi: list[Evento] = field(default_factory=list)

    def __post_init__(self):
        self.destinazione.mkdir(parents=True, exist_ok=True)
        self.trascrizione = self.destinazione / "trascrizione-live.md"
        self.avvisi = self.destinazione / "avvisi.md"
        self.domande = self.destinazione / "domande.md"
        self.schermate = self.destinazione / "schermate"
        self.trascrizione.write_text("# Trascrizione in diretta\n\n", encoding="utf-8")
        self.avvisi.write_text("# Avvisi durante la lezione\n\n", encoding="utf-8")
        self._cattura = None
        if self.schermo:
            self.schermate.mkdir(exist_ok=True)
            self._cattura = self._prepara_schermo()

    def _prepara_schermo(self):
        try:
            import mss
            import mss.tools
        except ImportError:
            print("  schermo disattivato: manca mss (pip install mss)", file=sys.stderr)
            return None

        def scatta(istante: float) -> Path | None:
            percorso = self.schermate / f"{formatta(istante).replace(':', '-')}.png"
            try:
                with mss.mss() as presa:
                    immagine = presa.grab(presa.monitors[0])
                mss.tools.to_png(immagine.rgb, immagine.size, output=str(percorso))
                return percorso
            except Exception as errore:
                print(f"  schermata non riuscita: {errore}", file=sys.stderr)
                return None

        return scatta

    def annota_parlato(self, istante: float, testo: str) -> None:
        with self.trascrizione.open("a", encoding="utf-8") as f:
            f.write(f"[{formatta(istante)}] {testo}\n\n")

    def annota_evento(self, evento: Evento) -> None:
        self.eventi.append(evento)
        scatto = None
        if evento.categoria == "visivo" and self._cattura:
            scatto = self._cattura(evento.istante)

        riga = f"- **[{formatta(evento.istante)}]** {evento.emoji} {evento.azione}\n"
        riga += f"  > {evento.testo}\n"
        if scatto:
            riga += f"  ![schermata]({scatto.relative_to(self.destinazione)})\n"
        with self.avvisi.open("a", encoding="utf-8") as f:
            f.write(riga)

        campanello = "\a" if (self.suono and evento.categoria == "visivo") else ""
        print(f"{campanello}  {evento.emoji} [{formatta(evento.istante)}] {evento.azione}")
        if scatto:
            print(f"     schermata salvata: {scatto.name}")

    def riepilogo(self) -> str:
        if not self.eventi:
            return "nessun avviso"
        conteggi: dict[str, int] = {}
        for evento in self.eventi:
            conteggi[evento.categoria] = conteggi.get(evento.categoria, 0) + 1
        return ", ".join(f"{n} {c}" for c, n in sorted(conteggi.items()))


def esegui(sorgente, trascrittore, sessione: Sessione, rilevatore: Rilevatore,
           agente: AgenteClaude | None) -> None:
    """Ciclo principale: audio dentro, parlato e avvisi fuori."""

    def consegna(risultati):
        for istante, testo, confidenza in risultati:
            sessione.annota_parlato(istante, testo)
            print(f"  [{formatta(istante)}] {testo}")
            for evento in rilevatore.esamina(istante, testo, confidenza):
                sessione.annota_evento(evento)
            if agente:
                agente.aggiungi(istante, testo)
        if agente:
            while True:
                try:
                    print(f"  🤖 {agente.avvisi.get_nowait()}")
                except queue.Empty:
                    break

    try:
        for blocco in sorgente.blocchi():
            consegna(trascrittore.aggiungi(blocco))
    except KeyboardInterrupt:
        print("\n  interrotto, chiudo i file...")
    finally:
        sorgente.ferma()
        consegna(trascrittore.chiudi())


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Registra la lezione e avvisa in diretta su ciò che l'audio non conserva.",
    )
    parser.add_argument("--uscita", type=Path, required=True,
                        help="cartella della lezione")
    parser.add_argument("--sorgente", type=Path,
                        help="file audio da riprodurre invece del microfono, per fare una prova")
    parser.add_argument("--veloce", action="store_true",
                        help="con --sorgente, elabora il file alla massima velocità")
    parser.add_argument("--modello", default="small",
                        help="modello Whisper per la diretta (default: small, il più veloce utile)")
    parser.add_argument("--glossario", type=Path,
                        help="termini del corso, uno per riga")
    parser.add_argument("--dispositivo", help="microfono da usare (nome o indice)")
    parser.add_argument("--schermo", action="store_true",
                        help="cattura lo schermo quando il docente indica qualcosa (lezioni online)")
    parser.add_argument("--suono", action="store_true",
                        help="emetti un bip quando è il momento di fotografare la lavagna")
    parser.add_argument("--agente", action="store_true",
                        help="attiva l'analisi periodica con Claude (richiede ANTHROPIC_API_KEY)")
    parser.add_argument("--modello-agente", default="claude-opus-5",
                        help="modello Claude per l'agente (default: claude-opus-5)")
    parser.add_argument("--ogni", type=float, default=300.0,
                        help="secondi fra un'analisi dell'agente e la successiva (default: 300)")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("errore: manca faster-whisper. Esegui prima: bash scripts/setup.sh",
              file=sys.stderr)
        return 1

    sys.path.insert(0, str(Path(__file__).parent))
    from trascrivi import leggi_glossario, scegli_hardware

    contesto = ""
    if args.glossario and args.glossario.is_file():
        contesto = leggi_glossario(args.glossario)

    sessione = Sessione(args.uscita, schermo=args.schermo, suono=args.suono)

    if args.sorgente:
        if not args.sorgente.is_file():
            print(f"errore: file non trovato: {args.sorgente}", file=sys.stderr)
            return 1
        sorgente = SorgenteFile(args.sorgente, tempo_reale=not args.veloce)
        print(f"  prova su file: {args.sorgente}")
    else:
        sorgente = SorgenteMicrofono(args.uscita / "audio.wav", dispositivo=args.dispositivo)
        print(f"  registro da microfono in {args.uscita / 'audio.wav'}")

    device, compute = scegli_hardware("auto")
    print(f"  modello {args.modello} su {device} ({compute})")
    modello = WhisperModel(args.modello, device=device, compute_type=compute)

    agente = None
    if args.agente:
        if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
            print("  agente non attivato: manca ANTHROPIC_API_KEY", file=sys.stderr)
        else:
            try:
                agente = AgenteClaude(args.modello_agente, args.ogni, sessione.domande)
                agente.avvia()
                print(f"  agente {args.modello_agente} attivo, analisi ogni {int(args.ogni)}s")
            except ImportError:
                print("  agente non attivato: manca il pacchetto anthropic", file=sys.stderr)

    print("\n  in ascolto. Ctrl+C per chiudere.\n")
    try:
        esegui(sorgente, TrascrittoreFinestra(modello, contesto=contesto),
               sessione, Rilevatore(), agente)
    except RuntimeError as errore:
        print(f"errore: {errore}", file=sys.stderr)
        return 1
    finally:
        if agente:
            agente.ferma()

    print(f"\n  chiuso. Avvisi: {sessione.riepilogo()}")
    print(f"    {sessione.trascrizione}")
    print(f"    {sessione.avvisi}")
    if agente:
        print(f"    {sessione.domande}")
    print("\n  Per il materiale di studio definitivo, ritrascrivi l'audio con")
    print("  trascrivi.py e il modello grande: la diretta usa il modello veloce.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
