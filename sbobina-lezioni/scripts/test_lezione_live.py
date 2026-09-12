"""Verifica lezione_live.py senza microfono, senza modello Whisper e senza rete.

Eseguilo dopo aver toccato le espressioni del rilevatore:
    .venv/bin/python scripts/test_lezione_live.py
"""

import importlib.util, json, shutil, sys, types
from pathlib import Path

import numpy as np

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI))
spec = importlib.util.spec_from_file_location("lv", QUI / "lezione_live.py")
lv = importlib.util.module_from_spec(spec)
sys.modules["lv"] = lv  # le dataclass risolvono le annotazioni via sys.modules
spec.loader.exec_module(lv)

# ---------- 1. Rilevatore ----------
r = lv.Rilevatore()
casi = [
    ("Come vedete qui la linea si allarga", "visivo"),
    ("Guardate questo drappeggio", "visivo"),
    ("Questo qui è il dettaglio che ci interessa", "visivo"),
    ("Toccate la mano del tessuto", "visivo"),
    ("Per la prossima volta portate tre tavole in formato A3", "consegna"),
    ("La revisione è entro venerdì", "consegna"),
    ("Dovete consegnare il figurino stampato", "consegna"),
    ("Guardatevi la collezione autunno inverno 1997", "riferimento"),
    ("Andate a vedere l'archivio di Vionnet", "riferimento"),
    ("Come abbiamo visto la scorsa volta sulle slide", "riferimento"),
    ("Ci siamo? Domande?", "domanda"),
]
for testo, atteso in casi:
    r2 = lv.Rilevatore()
    categorie = {e.categoria for e in r2.esamina(10.0, testo)}
    assert atteso in categorie, f"{testo!r} -> {categorie}, atteso {atteso}"
print(f"rilevatore: {len(casi)} frasi riconosciute")

neutre = ["Allora ragazzi, oggi continuiamo il programma.",
          "Il colore nasce dalla luce riflessa dalla superficie.",
          "La moda del dopoguerra cambia insieme alla società."]
for testo in neutre:
    assert not lv.Rilevatore().esamina(10.0, testo), f"falso positivo su {testo!r}"
print(f"rilevatore: {len(neutre)} frasi neutre ignorate")

r3 = lv.Rilevatore(silenzio=45.0)
assert len(r3.esamina(10.0, "guardate questo capo")) == 1
assert len(r3.esamina(20.0, "guardate questo capo")) == 0, "avviso ripetuto troppo presto"
assert len(r3.esamina(70.0, "guardate questo capo")) == 1, "avviso mai più riemesso"
print("rilevatore: limite anti-raffica OK")

assert [e.categoria for e in lv.Rilevatore().esamina(5.0, "parola", confidenza=-2.0)] == ["confidenza"]
assert not lv.Rilevatore().esamina(5.0, "parola", confidenza=-0.2)
print("rilevatore: confidenza bassa segnalata OK")

# ---------- 2. TrascrittoreFinestra ----------
class Seg:
    def __init__(self, start, end, text, lp=-0.3):
        self.start, self.end, self.text, self.avg_logprob = start, end, text, lp

class ModelloFinto:
    def __init__(self, risposte): self.risposte, self.viste = risposte, []
    def transcribe(self, audio, **kw):
        self.viste.append(len(audio) / lv.FREQUENZA)
        return iter(self.risposte.pop(0)), None

def blocchi(secondi):
    n = int(secondi * lv.FREQUENZA)
    return [np.zeros(lv.BLOCCO_CAMPIONI, dtype="float32")
            for _ in range(n // lv.BLOCCO_CAMPIONI)]

# finestra 1: l'ultimo segmento tocca il bordo -> va riportato avanti
m = ModelloFinto([
    [Seg(1.0, 5.0, "prima frase"), Seg(6.0, 12.0, "seconda frase"),
     Seg(22.0, 24.8, "frase tagl")],
    [Seg(0.5, 3.0, "frase tagliata intera"), Seg(4.0, 10.0, "terza frase")],
])
t = lv.TrascrittoreFinestra(m, finestra=25.0)
usciti = []
for b in blocchi(25.0):
    usciti += t.aggiungi(b)
assert [x[1] for x in usciti] == ["prima frase", "seconda frase"], usciti
assert abs(usciti[0][0] - 1.0) < 0.01
for b in blocchi(25.0):
    usciti += t.aggiungi(b)
testi = [x[1] for x in usciti]
assert testi == ["prima frase", "seconda frase",
                 "frase tagliata intera", "terza frase"], testi
# la frase riportata riparte da 22.0s (inizio del segmento tagliato) + 0.5s
assert abs(usciti[2][0] - 22.5) < 0.05, usciti[2][0]
assert abs(usciti[3][0] - 26.0) < 0.05, usciti[3][0]
# la seconda finestra riparte dai 3s riportati e si riempie di nuovo a 25s:
# il riporto sposta il contenuto, non allunga la finestra
assert abs(m.viste[1] - 25.0) < 0.05, m.viste
assert [x[0] for x in usciti] == sorted(x[0] for x in usciti), "timeline non monotona"
print(f"trascrittore: riporto fra finestre OK (finestre da {[round(v,1) for v in m.viste]}s)")

# segmento lungo quanto la finestra: NON deve essere riportato all'infinito
m2 = ModelloFinto([[Seg(0.2, 24.9, "monologo lunghissimo")]] + [[Seg(0.2, 24.9, "x")]] * 5)
t2 = lv.TrascrittoreFinestra(m2, finestra=25.0, riporto_massimo=8.0)
u2 = []
for b in blocchi(25.0):
    u2 += t2.aggiungi(b)
assert [x[1] for x in u2] == ["monologo lunghissimo"], u2
assert t2._campioni == 0, "buffer non svuotato: crescerebbe all'infinito"
print("trascrittore: monologo lungo emesso senza gonfiare il buffer")

m3 = ModelloFinto([[]])
t3 = lv.TrascrittoreFinestra(m3, finestra=25.0)
u3 = []
for b in blocchi(25.0):
    u3 += t3.aggiungi(b)
assert u3 == [] and t3._campioni == 0 and abs(t3._offset - 25.0) < 0.1
print("trascrittore: finestra di solo silenzio gestita")

# ---------- 3. SorgenteFile su un WAV vero ----------
import wave
CAMPIONE = QUI.parent / ".prova-audio.wav"
with wave.open(str(CAMPIONE), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(lv.FREQUENZA)
    n = int(8.8 * lv.FREQUENZA)
    onda = (np.sin(np.arange(n) * 2 * np.pi * 220 / lv.FREQUENZA) * 8000).astype(np.int16)
    w.writeframes(onda.tobytes())

s = lv.SorgenteFile(CAMPIONE, tempo_reale=False)
tot = sum(len(b) for b in s.blocchi())
assert abs(tot / lv.FREQUENZA - 8.8) < 0.3, tot / lv.FREQUENZA
print(f"sorgente file: {tot/lv.FREQUENZA:.1f}s di audio reale letti")

# ---------- 4. Sessione ----------
dest = QUI.parent / ".prova-sessione"
shutil.rmtree(dest, ignore_errors=True)
sess = lv.Sessione(dest)
sess.annota_parlato(65.0, "oggi parliamo di taglio in sbieco")
sess.annota_evento(lv.Evento(72.0, "visivo", "guardate questo drappeggio"))
sess.annota_evento(lv.Evento(80.0, "confidenza", "brr frr"))
assert "[00:01:05] oggi parliamo di taglio in sbieco" in (dest / "trascrizione-live.md").read_text()
avv = (dest / "avvisi.md").read_text()
assert "**[00:01:12]** 📸" in avv and "**[00:01:20]** ⚠️" in avv, avv
assert sess.riepilogo() == "1 confidenza, 1 visivo", sess.riepilogo()
print("sessione: file di trascrizione e avvisi scritti")

# ---------- 5. AgenteClaude con client finto ----------
visto = {}
class MessaggiFinti:
    def create(self, **kw):
        visto.update(kw)
        risposta = types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text", text=json.dumps({
                "da_fotografare": ["il capo mostrato al minuto 3, con il drappeggio in vita"],
                "riferimenti_citati": ["Madeleine Vionnet, sbieco"],
                "consegne_e_scadenze": ["tre tavole A3 per la revisione di venerdì"],
                "termini_da_verificare": ["moulage"],
                "domande_da_fare": ["Il moulage va fatto sul manichino o sulla persona?"],
            }))])
        return risposta
class ClientFinto:
    def __init__(self, **kw):
        self.messages = MessaggiFinti()
        self.beta = types.SimpleNamespace(messages=MessaggiFinti())
sys.modules["anthropic"] = types.SimpleNamespace(Anthropic=ClientFinto)

ag = lv.AgenteClaude("claude-opus-5", 999, dest / "domande.md")
ag._analizza([(120.0, "guardate questo drappeggio"), (180.0, "lo sbieco di Vionnet")])
assert visto["model"] == "claude-opus-5"
assert visto["betas"] == ["server-side-fallback-2026-07-01"] and visto["fallbacks"] == "default"
assert visto["output_config"]["effort"] == "low"
assert visto["output_config"]["format"]["schema"]["additionalProperties"] is False
assert "[00:02:00] guardate questo drappeggio" in visto["messages"][0]["content"]
testo = (dest / "domande.md").read_text()
assert "Minuti 00:02:00 – 00:03:00" in testo and "Vionnet" in testo, testo
assert ag.avvisi.qsize() == 5, ag.avvisi.qsize()
print("agente: parametri API e file domande.md corretti")

visto.clear()
lv.AgenteClaude("claude-haiku-4-5", 999, dest / "d2.md")._analizza([(1.0, "ciao")])
assert "betas" not in visto and "fallbacks" not in visto, "fallbacks passati a un modello che non li supporta"
print("agente: nessun parametro beta sui modelli che non lo prevedono")

class ClientRotto(ClientFinto):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.beta.messages.create = lambda **kw: (_ for _ in ()).throw(RuntimeError("rete giù"))
sys.modules["anthropic"] = types.SimpleNamespace(Anthropic=ClientRotto)
ag2 = lv.AgenteClaude("claude-opus-5", 999, dest / "d3.md")
ag2._analizza([(1.0, "ciao")])
assert "rete giù" in ag2.avvisi.get_nowait(), "un errore di rete deve avvisare, non fermare la lezione"
print("agente: errore di rete non interrompe la sessione")

# ---------- 6. esegui() end-to-end ----------
shutil.rmtree(dest, ignore_errors=True)
sess = lv.Sessione(dest)
m4 = ModelloFinto([[Seg(1.0, 4.0, "guardate questo drappeggio"),
                    Seg(5.0, 9.0, "per la prossima volta portate tre tavole")]])
lv.esegui(lv.SorgenteFile(CAMPIONE, tempo_reale=False),
          lv.TrascrittoreFinestra(m4, finestra=25.0), sess, lv.Rilevatore(), None)
assert [e.categoria for e in sess.eventi] == ["visivo", "consegna"], sess.eventi
assert "guardate questo drappeggio" in (dest / "trascrizione-live.md").read_text()
print("esegui(): ciclo completo audio -> trascrizione -> avvisi OK")

print("\nTUTTI I TEST DI lezione_live.py PASSATI")

shutil.rmtree(dest, ignore_errors=True)
CAMPIONE.unlink(missing_ok=True)
