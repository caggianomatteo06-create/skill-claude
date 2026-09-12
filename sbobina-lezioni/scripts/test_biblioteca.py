"""Verifica biblioteca.py facendo richieste HTTP vere al server."""
import importlib.util, shutil, sys, threading, wave
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np

QUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "bib", QUI / "biblioteca.py")
bib = importlib.util.module_from_spec(spec); sys.modules["bib"] = bib; spec.loader.exec_module(bib)

# ---------- corpus finto ----------
radice = QUI.parent / ".prova-lezioni"
shutil.rmtree(radice, ignore_errors=True)
lez = radice / "Analisi II" / "2026-09-12-serie-numeriche"
(lez / "schermate").mkdir(parents=True)
with wave.open(str(lez / "audio.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes((np.sin(np.arange(16000 * 4) * 0.05) * 8000).astype(np.int16).tobytes())
(lez / "trascrizione.md").write_text(
    "# Trascrizione\n\n## [00:00:00]\n\nBuongiorno a tutti.\n\n## [00:05:00]\n\n"
    "Il criterio del rapporto si applica cosi.\n", encoding="utf-8")
(lez / "riassunto.md").write_text(
    "# Serie numeriche\n\n## Concetti\n\n### Criterio del rapporto [00:05:00]\n\n"
    "Serve a **decidere** la convergenza.\n\n- primo punto\n  - punto annidato\n- `codice`\n\n"
    "| Formula | Uso |\n|---|---|\n| $a_n$ | termine |\n\n> nota del docente\n", encoding="utf-8")
(lez / "mappa.md").write_text("# Mappa\n\n## Convergenza\n- criterio del rapporto\n", encoding="utf-8")
(lez / "avvisi.md").write_text(
    "# Avvisi\n\n- **[00:05:12]** 📸 fotografa la lavagna\n  > guardate questa formula\n"
    "  ![schermata](schermate/00-05-12.png)\n", encoding="utf-8")
(lez / "flashcard.csv").write_text(
    '"Quando converge?","Se il rapporto tende a un limite < 1.","analisi2"\n'
    '"Criterio inconcludente?","Quando il limite vale 1.","analisi2"\n', encoding="utf-8")
(lez / "schermate" / "00-05-12.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 40)
vuota = radice / "Analisi II" / "2026-09-19-integrali"
vuota.mkdir(); (vuota / "audio.m4a").write_bytes(b"\0" * 100)

# ---------- lettura del corpus ----------
corsi = bib.leggi_biblioteca(radice)
assert [c.nome for c in corsi] == ["Analisi II"], corsi
assert [l.nome for l in corsi[0].lezioni] == ["2026-09-19-integrali", "2026-09-12-serie-numeriche"]
piena = corsi[0].lezioni[1]
assert piena.titolo == "serie numeriche" and piena.data == "2026-09-12"
assert piena.audio.name == "audio.wav"
assert set(piena.presenti) == {"trascrizione", "riassunto", "mappa", "avvisi", "flashcard"}
assert piena.mancanti == [], piena.mancanti
assert corsi[0].lezioni[0].mancanti == ["trascrizione", "riassunto", "mappa", "flashcard"]
print("lettura cartelle: corsi, lezioni, materiali presenti e mancanti OK")

# ---------- markdown ----------
reso = bib.markdown((lez / "riassunto.md").read_text(), con_audio=True)
assert "<h2>Serie numeriche</h2>" in reso and "<h4>Criterio del rapporto" in reso
assert "<strong>decidere</strong>" in reso and "<code>codice</code>" in reso
assert reso.count("<ul>") == 2 and reso.count("</ul>") == 2, reso
assert "<table>" in reso and "<blockquote>" in reso
assert 'data-t="300"' in reso, "timestamp non cliccabile"
senza = bib.markdown("testo [00:05:00] qui", con_audio=False)
assert "data-t" not in senza
assert "&lt;script&gt;" in bib.markdown("<script>alert(1)</script>"), "HTML non neutralizzato"
print("markdown: intestazioni, liste annidate, tabelle, timestamp e fuga HTML OK")

# ---------- server vero ----------
bib.Gestore.radice = radice
servitore = bib.Servitore(("127.0.0.1", 0), bib.Gestore)
porta = servitore.server_address[1]
threading.Thread(target=servitore.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{porta}"

def prendi(percorso, intestazioni=None):
    with urlopen(Request(base + percorso, headers=intestazioni or {})) as r:
        return r.status, r.headers, r.read()

stato, _, corpo = prendi("/")
testo = corpo.decode()
assert stato == 200 and "2 lezioni in 1 corsi" in testo
assert "serie numeriche" in testo and "manca trascrizione" in testo
print("indice: elenco corsi e stato dei materiali OK")

stato, _, corpo = prendi("/lezione/Analisi%20II/2026-09-12-serie-numeriche")
testo = corpo.decode()
assert stato == 200
assert testo.count('data-scheda="') == 10, testo.count('data-scheda="')  # 5 bottoni + 5 sezioni
assert "<audio controls" in testo and "audio.wav" in testo
assert "Quando converge?" in testo and "Se il rapporto tende" in testo
assert 'src="/media/Analisi%20II/2026-09-12-serie-numeriche/schermate/00-05-12.png"' in testo
print("pagina lezione: schede, player, flashcard e immagini degli avvisi OK")

stato, _, corpo = prendi("/lezione/Analisi%20II/2026-09-19-integrali")
assert stato == 200 and "solo l'audio" in corpo.decode()
print("lezione con solo audio: indicato il passo successivo")

stato, _, corpo = prendi("/cerca?q=rapporto")
testo = corpo.decode()
assert stato == 200 and "<mark>rapporto</mark>" in testo
assert "?t=300" in testo, "il risultato non porta al minuto giusto"
assert "Nessun risultato" not in testo
_, _, vuoto = prendi("/cerca?q=zzzinesistente")
assert "Nessun risultato" in vuoto.decode()
print("ricerca: evidenziazione e salto al timestamp OK")

# ---------- audio con Range ----------
percorso_audio = "/media/Analisi%20II/2026-09-12-serie-numeriche/audio.wav"
stato, testa, corpo = prendi(percorso_audio)
totale = len(corpo)
assert stato == 200 and testa["Accept-Ranges"] == "bytes" and testa["Content-Type"] == "audio/x-wav"
assert totale == (lez / "audio.wav").stat().st_size
stato, testa, parziale = prendi(percorso_audio, {"Range": "bytes=100-199"})
assert stato == 206 and len(parziale) == 100
assert testa["Content-Range"] == f"bytes 100-199/{totale}"
assert parziale == corpo[100:200]
stato, testa, coda = prendi(percorso_audio, {"Range": "bytes=-50"})
assert stato == 206 and coda == corpo[-50:], "richiesta degli ultimi byte sbagliata"
stato, testa, aperta = prendi(percorso_audio, {"Range": "bytes=500-"})
assert stato == 206 and aperta == corpo[500:]
try:
    prendi(percorso_audio, {"Range": f"bytes={totale + 10}-{totale + 20}"})
    raise AssertionError("range fuori scala accettato")
except HTTPError as e:
    assert e.code == 416
print("audio: Range completo, parziale, coda, aperto e fuori scala OK")

# ---------- sicurezza ----------
for cattivo in ["/media/Analisi%20II/2026-09-12-serie-numeriche/..%2f..%2f..%2fetc%2fpasswd",
                "/lezione/..%2f..%2fetc/passwd"]:
    try:
        stato, _, _ = prendi(cattivo)
        assert stato == 404, f"{cattivo} -> {stato}"
    except HTTPError as e:
        assert e.code == 404, f"{cattivo} -> {e.code}"
print("sicurezza: nessuna uscita dalla cartella servita")

servitore.shutdown()
shutil.rmtree(radice, ignore_errors=True)
print("\nTUTTI I TEST DI biblioteca.py PASSATI")
