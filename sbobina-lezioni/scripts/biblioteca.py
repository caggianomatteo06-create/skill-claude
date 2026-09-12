#!/usr/bin/env python3
"""Interfaccia locale su tutto il materiale delle lezioni.

Legge la cartella Lezioni/ così com'è e la serve come sito nel browser: corsi,
lezioni, audio, trascrizione, riassunti, mappe, avvisi, flashcard e ricerca su
tutto. I timestamp sono cliccabili e fanno saltare l'audio in quel punto, che è
il motivo per cui vale la pena avere un'interfaccia invece di aprire i file a
mano.

Gira solo su questo computer, non espone niente in rete e non copia nulla:
legge i file dove sono.

    python biblioteca.py Lezioni/
    python biblioteca.py Lezioni/ --porta 8080
"""

from __future__ import annotations

import argparse
import csv
import html
import mimetypes
import re
import socketserver
import sys
import threading
import urllib.parse
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler
from pathlib import Path

TIMESTAMP = re.compile(r"\[(\d{1,2}):([0-5]\d):([0-5]\d)\]")
ESTENSIONI_AUDIO = (".wav", ".m4a", ".mp3", ".ogg", ".opus", ".flac", ".mp4", ".webm")

MATERIALI = [
    ("riassunto", "riassunto.md", "Riassunto"),
    ("trascrizione", "trascrizione.md", "Trascrizione"),
    ("live", "trascrizione-live.md", "Diretta"),
    ("mappa", "mappa.md", "Mappa"),
    ("avvisi", "avvisi.md", "Avvisi"),
    ("domande", "domande.md", "Domande"),
    ("quiz", "quiz.md", "Quiz"),
    ("flashcard", "flashcard.csv", "Flashcard"),
]


@dataclass
class Lezione:
    cartella: Path
    corso: str

    @property
    def nome(self) -> str:
        return self.cartella.name

    @property
    def titolo(self) -> str:
        # "2026-09-12-serie-numeriche" -> "serie numeriche"
        resto = re.sub(r"^\d{4}-\d{2}-\d{2}-?", "", self.nome)
        return resto.replace("-", " ").strip() or self.nome

    @property
    def data(self) -> str:
        trovata = re.match(r"^(\d{4}-\d{2}-\d{2})", self.nome)
        return trovata.group(1) if trovata else ""

    @property
    def audio(self) -> Path | None:
        for file in sorted(self.cartella.iterdir()):
            if file.suffix.lower() in ESTENSIONI_AUDIO:
                return file
        return None

    @property
    def presenti(self) -> dict[str, Path]:
        return {
            chiave: self.cartella / nome
            for chiave, nome, _ in MATERIALI
            if (self.cartella / nome).is_file()
        }

    @property
    def mancanti(self) -> list[str]:
        presenti = self.presenti
        # La diretta è alternativa alla trascrizione, non un materiale in più.
        attesi = {"riassunto": "riassunto", "mappa": "mappa", "flashcard": "flashcard"}
        manca = [e for c, e in attesi.items() if c not in presenti]
        if "trascrizione" not in presenti and "live" not in presenti:
            manca.insert(0, "trascrizione")
        return manca


@dataclass
class Corso:
    cartella: Path
    lezioni: list[Lezione] = field(default_factory=list)

    @property
    def nome(self) -> str:
        return self.cartella.name


def leggi_biblioteca(radice: Path) -> list[Corso]:
    corsi = []
    for cartella_corso in sorted(p for p in radice.iterdir() if p.is_dir()):
        corso = Corso(cartella_corso)
        for cartella_lezione in sorted(p for p in cartella_corso.iterdir() if p.is_dir()):
            lezione = Lezione(cartella_lezione, corso.nome)
            if lezione.presenti or lezione.audio:
                corso.lezioni.append(lezione)
        corso.lezioni.reverse()  # la lezione più recente per prima
        if corso.lezioni:
            corsi.append(corso)
    return corsi


# ---------------------------------------------------------------------------
# Markdown -> HTML (sottoinsieme sufficiente ai file prodotti dallo skill)
# ---------------------------------------------------------------------------

def esc(testo: str) -> str:
    return html.escape(testo, quote=True)


def secondi(ore: str, minuti: str, sec: str) -> int:
    return int(ore) * 3600 + int(minuti) * 60 + int(sec)


def collega_timestamp(testo: str, con_audio: bool) -> str:
    if not con_audio:
        return testo

    def sostituisci(trovato):
        t = secondi(*trovato.groups())
        return f'<a class="t" href="#" data-t="{t}">{trovato.group(0)}</a>'

    return TIMESTAMP.sub(sostituisci, testo)


def inline(testo: str, con_audio: bool, base: str = "") -> str:
    testo = esc(testo)
    testo = re.sub(r"`([^`]+)`", r"<code>\1</code>", testo)
    testo = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)",
                   lambda m: f'<img src="{base}{esc(m.group(2))}" alt="{m.group(1)}">', testo)
    testo = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', testo)
    testo = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", testo)
    testo = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", testo)
    return collega_timestamp(testo, con_audio)


def markdown(testo: str, con_audio: bool = False, base: str = "") -> str:
    righe = testo.splitlines()
    fuori: list[str] = []
    lista: list[int] = []          # livelli di rientro aperti
    paragrafo: list[str] = []      # righe consecutive da unire in un solo <p>
    in_codice = False
    in_tabella = False

    def chiudi_paragrafo() -> None:
        if paragrafo:
            unito = " ".join(paragrafo)
            fuori.append(f"<p>{inline(unito, con_audio, base)}</p>")
            paragrafo.clear()

    def chiudi_liste(fino: int = 0) -> None:
        while len(lista) > fino:
            fuori.append("</ul>")
            lista.pop()

    def chiudi_tabella() -> None:
        nonlocal in_tabella
        if in_tabella:
            fuori.append("</tbody></table></div>")
            in_tabella = False

    for riga in righe:
        if riga.strip().startswith("```"):
            chiudi_paragrafo(); chiudi_liste(); chiudi_tabella()
            fuori.append("</pre>" if in_codice else "<pre>")
            in_codice = not in_codice
            continue
        if in_codice:
            fuori.append(esc(riga))
            continue

        nudo = riga.strip()

        if not nudo:
            chiudi_paragrafo(); chiudi_liste(); chiudi_tabella()
            continue

        if re.match(r"^\|.*\|$", nudo):
            celle = [c.strip() for c in nudo.strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in celle if c):
                continue  # riga separatrice
            if not in_tabella:
                chiudi_paragrafo(); chiudi_liste()
                fuori.append('<div class="scorri"><table><tbody>')
                in_tabella = True
            celle_html = "".join(f"<td>{inline(c, con_audio, base)}</td>" for c in celle)
            fuori.append(f"<tr>{celle_html}</tr>")
            continue
        chiudi_tabella()

        intestazione = re.match(r"^(#{1,6})\s+(.*)$", nudo)
        if intestazione:
            chiudi_paragrafo(); chiudi_liste()
            livello = min(len(intestazione.group(1)) + 1, 6)
            fuori.append(f"<h{livello}>{inline(intestazione.group(2), con_audio, base)}</h{livello}>")
            continue

        if nudo.startswith(">"):
            chiudi_paragrafo(); chiudi_liste()
            fuori.append(f"<blockquote>{inline(nudo.lstrip('> '), con_audio, base)}</blockquote>")
            continue

        if re.fullmatch(r"-{3,}", nudo):
            chiudi_paragrafo(); chiudi_liste()
            fuori.append("<hr>")
            continue

        punto = re.match(r"^(\s*)(?:[-*+]|\d+\.)\s+(.*)$", riga)
        if punto:
            chiudi_paragrafo()
            rientro = len(punto.group(1)) // 2
            while len(lista) > rientro + 1:
                fuori.append("</ul>"); lista.pop()
            while len(lista) < rientro + 1:
                fuori.append("<ul>"); lista.append(rientro)
            fuori.append(f"<li>{inline(punto.group(2), con_audio, base)}</li>")
            continue

        chiudi_liste()
        paragrafo.append(nudo)

    chiudi_paragrafo(); chiudi_liste(); chiudi_tabella()
    if in_codice:
        fuori.append("</pre>")
    return "\n".join(fuori)


def flashcard_html(percorso: Path) -> str:
    righe = []
    with percorso.open(encoding="utf-8", newline="") as f:
        for numero, campi in enumerate(csv.reader(f)):
            if not campi or not campi[0].strip():
                continue
            fronte = esc(campi[0])
            retro = esc(campi[1]) if len(campi) > 1 else ""
            tag = esc(campi[2]) if len(campi) > 2 else ""
            righe.append(
                f'<div class="carta"><div class="fronte">{fronte}'
                f'{f"<span class=tag>{tag}</span>" if tag else ""}</div>'
                f'<button class="mostra" data-n="{numero}">mostra</button>'
                f'<div class="retro" hidden>{retro}</div></div>'
            )
    if not righe:
        return "<p>Nessuna flashcard nel file.</p>"
    return f'<p class="nota">{len(righe)} carte. Il file si importa in Anki così com\'è.</p>' + "".join(righe)


# ---------------------------------------------------------------------------
# Pagine
# ---------------------------------------------------------------------------

STILE = """
:root { color-scheme: light dark;
  --sfondo:#fbfaf8; --carta:#fff; --testo:#1b1b1a; --tenue:#6b6a66;
  --bordo:#e3e0d9; --tinta:#8a5a2b; --evidenza:#f3efe7; }
@media (prefers-color-scheme: dark) { :root {
  --sfondo:#16161a; --carta:#1e1e23; --testo:#e9e7e2; --tenue:#9b988f;
  --bordo:#32323a; --tinta:#d8a26a; --evidenza:#26262d; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--sfondo); color:var(--testo); font:16px/1.6 system-ui,sans-serif; }
a { color:var(--tinta); }
.guscio { max-width:900px; margin:0 auto; padding:24px 16px 64px; }
header.alto { border-bottom:1px solid var(--bordo); background:var(--carta); }
header.alto .guscio { padding:16px; display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
header.alto strong { font-size:17px; }
form.cerca { margin-left:auto; display:flex; gap:8px; }
input[type=search] { padding:8px 12px; border:1px solid var(--bordo); border-radius:8px;
  background:var(--sfondo); color:var(--testo); min-width:180px; }
h1 { font-size:26px; margin:24px 0 4px; }
h2 { font-size:20px; margin:28px 0 8px; }
h3 { font-size:17px; margin:20px 0 6px; }
.tenue { color:var(--tenue); font-size:14px; }
.corso { margin:32px 0; }
.lezione { display:block; padding:14px 16px; border:1px solid var(--bordo); border-radius:10px;
  background:var(--carta); margin-bottom:10px; text-decoration:none; color:inherit; }
.lezione:hover { border-color:var(--tinta); }
.lezione b { display:block; margin-bottom:4px; }
.pastiglia { display:inline-block; font-size:12px; padding:2px 8px; border-radius:999px;
  background:var(--evidenza); color:var(--tenue); margin:2px 4px 2px 0; }
.pastiglia.manca { background:transparent; border:1px dashed var(--bordo); }
audio { width:100%; margin:8px 0 0; }
.barra { position:sticky; top:0; z-index:5; background:var(--carta);
  border-bottom:1px solid var(--bordo); padding:10px 16px; margin:0 -16px 16px; }
nav.schede { display:flex; gap:4px; flex-wrap:wrap; margin:16px 0; }
nav.schede button { padding:7px 13px; border:1px solid var(--bordo); border-radius:999px;
  background:var(--carta); color:var(--testo); cursor:pointer; font-size:14px; }
nav.schede button[aria-selected=true] { background:var(--tinta); border-color:var(--tinta); color:#fff; }
section.scheda { background:var(--carta); border:1px solid var(--bordo);
  border-radius:12px; padding:4px 20px 20px; }
section.scheda img { max-width:100%; border-radius:8px; border:1px solid var(--bordo); }
a.t { font-variant-numeric:tabular-nums; text-decoration:none; font-size:13px;
  background:var(--evidenza); padding:1px 6px; border-radius:5px; white-space:nowrap; }
a.t:hover { background:var(--tinta); color:#fff; }
blockquote { margin:8px 0; padding:6px 14px; border-left:3px solid var(--bordo); color:var(--tenue); }
pre { background:var(--evidenza); padding:12px; border-radius:8px; overflow-x:auto; font-size:13px; }
code { background:var(--evidenza); padding:1px 5px; border-radius:4px; font-size:13px; }
.scorri { overflow-x:auto; }
table { border-collapse:collapse; width:100%; font-size:14px; }
td { border:1px solid var(--bordo); padding:7px 10px; vertical-align:top; }
.carta { border:1px solid var(--bordo); border-radius:10px; padding:12px 14px; margin:10px 0; }
.carta .fronte { font-weight:600; }
.carta .retro { margin-top:8px; color:var(--tenue); }
.carta .tag { font-size:12px; color:var(--tenue); font-weight:400; margin-left:8px; }
.mostra { margin-top:8px; font-size:13px; padding:4px 10px; cursor:pointer;
  border:1px solid var(--bordo); border-radius:6px; background:var(--sfondo); color:var(--testo); }
.esito { border-bottom:1px solid var(--bordo); padding:14px 0; }
.esito mark { background:var(--tinta); color:#fff; border-radius:3px; padding:0 2px; }
.vuoto { border:1px dashed var(--bordo); border-radius:12px; padding:28px; color:var(--tenue); }
@media (max-width:520px) { form.cerca { margin-left:0; width:100%; }
  input[type=search] { flex:1; min-width:0; } }
"""

SCRIPT = """
const audio = document.querySelector('audio');
document.addEventListener('click', (e) => {
  const salto = e.target.closest('a.t');
  if (salto && audio) {
    e.preventDefault();
    audio.currentTime = Number(salto.dataset.t);
    audio.play().catch(() => {});
    return;
  }
  const scheda = e.target.closest('nav.schede button');
  if (scheda) {
    document.querySelectorAll('nav.schede button').forEach(b =>
      b.setAttribute('aria-selected', String(b === scheda)));
    document.querySelectorAll('section.scheda').forEach(s =>
      s.hidden = s.dataset.scheda !== scheda.dataset.scheda);
    return;
  }
  const mostra = e.target.closest('.mostra');
  if (mostra) {
    const retro = mostra.nextElementSibling;
    retro.hidden = !retro.hidden;
    mostra.textContent = retro.hidden ? 'mostra' : 'nascondi';
  }
});
const partenza = new URLSearchParams(location.search).get('t');
if (partenza && audio) { audio.currentTime = Number(partenza); }
"""


def pagina(titolo: str, corpo: str) -> bytes:
    return f"""<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(titolo)}</title><style>{STILE}</style></head><body>
<header class="alto"><div class="guscio">
<strong><a href="/" style="text-decoration:none;color:inherit">Biblioteca lezioni</a></strong>
<form class="cerca" action="/cerca"><input type="search" name="q" placeholder="cerca in tutte le lezioni"
 aria-label="cerca"><button class="mostra" type="submit">cerca</button></form>
</div></header>
<div class="guscio">{corpo}</div>
<script>{SCRIPT}</script></body></html>""".encode("utf-8")


def pagina_indice(corsi: list[Corso]) -> bytes:
    if not corsi:
        return pagina("Biblioteca lezioni", """<h1>Ancora niente</h1>
<div class="vuoto"><p>Nessuna lezione trovata in questa cartella.</p>
<p>La struttura attesa è <code>Corso/AAAA-MM-GG-titolo/</code> con dentro l'audio
e i file prodotti dagli altri script.</p></div>""")

    pezzi = [f"<h1>{sum(len(c.lezioni) for c in corsi)} lezioni in {len(corsi)} corsi</h1>"]
    for corso in corsi:
        pezzi.append(f'<div class="corso"><h2>{esc(corso.nome)}</h2>')
        for lezione in corso.lezioni:
            presenti = lezione.presenti
            etichette = [e for c, _, e in MATERIALI if c in presenti]
            if lezione.audio:
                etichette.insert(0, "audio")
            pastiglie = "".join(f'<span class="pastiglia">{esc(e)}</span>' for e in etichette)
            pastiglie += "".join(
                f'<span class="pastiglia manca">manca {esc(m)}</span>' for m in lezione.mancanti)
            collegamento = f"/lezione/{urllib.parse.quote(corso.nome)}/{urllib.parse.quote(lezione.nome)}"
            pezzi.append(
                f'<a class="lezione" href="{collegamento}"><b>{esc(lezione.titolo)}</b>'
                f'<span class="tenue">{esc(lezione.data)}</span><br>{pastiglie}</a>')
        pezzi.append("</div>")
    return pagina("Biblioteca lezioni", "".join(pezzi))


def pagina_lezione(lezione: Lezione) -> bytes:
    base = f"/media/{urllib.parse.quote(lezione.corso)}/{urllib.parse.quote(lezione.nome)}/"
    presenti = lezione.presenti
    audio = lezione.audio

    testa = [f"<h1>{esc(lezione.titolo)}</h1>",
             f'<p class="tenue">{esc(lezione.corso)} · {esc(lezione.data)}</p>']
    if audio:
        testa.append(f'<div class="barra"><audio controls preload="metadata" '
                     f'src="{base}{urllib.parse.quote(audio.name)}"></audio></div>')

    schede, sezioni = [], []
    for chiave, nome, etichetta in MATERIALI:
        percorso = presenti.get(chiave)
        if not percorso:
            continue
        primo = not schede
        if chiave == "flashcard":
            contenuto = flashcard_html(percorso)
        else:
            contenuto = markdown(percorso.read_text(encoding="utf-8"),
                                 con_audio=audio is not None, base=base)
        schede.append(f'<button data-scheda="{chiave}" aria-selected="{str(primo).lower()}">'
                      f'{esc(etichetta)}</button>')
        sezioni.append(f'<section class="scheda" data-scheda="{chiave}"'
                       f'{"" if primo else " hidden"}>{contenuto}</section>')

    if not schede:
        corpo = "".join(testa) + ('<div class="vuoto"><p>Per questa lezione c\'è solo l\'audio.</p>'
                                  '<p>Il passo successivo è <code>trascrivi.py</code>.</p></div>')
        return pagina(lezione.titolo, corpo)

    mancanti = lezione.mancanti
    coda = ""
    if mancanti:
        coda = ('<p class="tenue" style="margin-top:20px">Da produrre ancora: '
                + ", ".join(esc(m) for m in mancanti) + ".</p>")
    corpo = "".join(testa) + f'<nav class="schede">{"".join(schede)}</nav>' + "".join(sezioni) + coda
    return pagina(lezione.titolo, corpo)


def pagina_ricerca(corsi: list[Corso], query: str) -> bytes:
    if not query.strip():
        return pagina("Ricerca", "<h1>Ricerca</h1><p>Scrivi qualcosa nella casella in alto.</p>")

    ago = query.strip().lower()
    esiti = []
    for corso in corsi:
        for lezione in corso.lezioni:
            for chiave, percorso in lezione.presenti.items():
                if percorso.suffix == ".csv":
                    continue
                try:
                    righe = percorso.read_text(encoding="utf-8").splitlines()
                except OSError:
                    continue
                ultimo_tempo = ""
                for riga in righe:
                    trovato = TIMESTAMP.search(riga)
                    if trovato:
                        ultimo_tempo = str(secondi(*trovato.groups()))
                    if ago not in riga.lower():
                        continue
                    esiti.append((corso.nome, lezione, chiave, riga.strip(), ultimo_tempo))
                    if len(esiti) >= 200:
                        break

    if not esiti:
        return pagina("Ricerca", f"<h1>Nessun risultato per “{esc(query)}”</h1>")

    pezzi = [f"<h1>{len(esiti)} risultati per “{esc(query)}”</h1>"]
    for nome_corso, lezione, chiave, riga, tempo in esiti:
        indirizzo = (f"/lezione/{urllib.parse.quote(nome_corso)}/{urllib.parse.quote(lezione.nome)}"
                     + (f"?t={tempo}" if tempo else ""))
        evidenziata = re.sub(f"({re.escape(query.strip())})", r"<mark>\1</mark>",
                             esc(riga), flags=re.IGNORECASE)
        pezzi.append(f'<div class="esito"><a href="{indirizzo}">{esc(lezione.titolo)}</a> '
                     f'<span class="tenue">{esc(nome_corso)} · {esc(chiave)}</span>'
                     f'<div>{evidenziata}</div></div>')
    return pagina(f"Ricerca: {query}", "".join(pezzi))


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

class Gestore(BaseHTTPRequestHandler):
    radice: Path = Path(".")
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):  # una lezione non ha bisogno di un access log
        pass

    def do_GET(self):
        indirizzo = urllib.parse.urlparse(self.path)
        parti = [urllib.parse.unquote(p) for p in indirizzo.path.strip("/").split("/") if p]
        try:
            if not parti:
                return self._html(pagina_indice(leggi_biblioteca(self.radice)))
            if parti[0] == "cerca":
                query = urllib.parse.parse_qs(indirizzo.query).get("q", [""])[0]
                return self._html(pagina_ricerca(leggi_biblioteca(self.radice), query))
            if parti[0] == "lezione" and len(parti) == 3:
                cartella = self._dentro_radice(self.radice / parti[1] / parti[2])
                if not cartella or not cartella.is_dir():
                    return self._errore(404, "Lezione non trovata")
                return self._html(pagina_lezione(Lezione(cartella, parti[1])))
            if parti[0] == "media" and len(parti) == 4:
                file = self._dentro_radice(self.radice / parti[1] / parti[2] / parti[3])
                if not file or not file.is_file():
                    return self._errore(404, "File non trovato")
                return self._file(file)
            return self._errore(404, "Pagina non trovata")
        except BrokenPipeError:
            pass  # il browser ha cambiato pagina mentre servivamo l'audio

    def _dentro_radice(self, percorso: Path) -> Path | None:
        """Nessun percorso fuori dalla cartella servita, qualunque cosa chieda il browser."""
        try:
            risolto = percorso.resolve()
            risolto.relative_to(self.radice.resolve())
            return risolto
        except (ValueError, OSError):
            return None

    def _html(self, corpo: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _errore(self, codice: int, messaggio: str) -> None:
        corpo = pagina(messaggio, f"<h1>{esc(messaggio)}</h1><p><a href='/'>Torna all'indice</a></p>")
        self.send_response(codice)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _file(self, percorso: Path) -> None:
        """Serve il file con supporto Range: senza, l'audio non si può spostare."""
        dimensione = percorso.stat().st_size
        tipo = mimetypes.guess_type(percorso.name)[0] or "application/octet-stream"
        intervallo = self.headers.get("Range", "")
        inizio, lunghezza, codice = 0, dimensione, 200

        trovato = re.match(r"bytes=(\d*)-(\d*)$", intervallo.strip())
        if trovato and dimensione:
            testa, coda = trovato.groups()
            if testa:
                inizio = int(testa)
                fine = min(int(coda), dimensione - 1) if coda else dimensione - 1
            else:  # "bytes=-N": gli ultimi N byte
                ultimi = int(coda or 0)
                inizio = max(dimensione - ultimi, 0)
                fine = dimensione - 1 if ultimi else -1
            # Un intervallo che comincia oltre la fine del file non è servibile:
            # va rifiutato, non accorciato all'ultimo byte.
            if inizio >= dimensione or fine < inizio:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{dimensione}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            lunghezza, codice = fine - inizio + 1, 206

        self.send_response(codice)
        if codice == 206:
            self.send_header("Content-Range", f"bytes {inizio}-{inizio + lunghezza - 1}/{dimensione}")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(lunghezza))
        self.end_headers()
        with percorso.open("rb") as f:
            f.seek(inizio)
            restante = lunghezza
            while restante > 0:
                pezzo = f.read(min(65536, restante))
                if not pezzo:
                    break
                self.wfile.write(pezzo)
                restante -= len(pezzo)


class Servitore(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apre nel browser tutto il materiale delle lezioni.")
    parser.add_argument("radice", type=Path, nargs="?", default=Path("Lezioni"),
                        help="cartella con i corsi (default: Lezioni)")
    parser.add_argument("--porta", type=int, default=8000)
    parser.add_argument("--non-aprire", action="store_true",
                        help="non aprire il browser da solo")
    args = parser.parse_args()

    if not args.radice.is_dir():
        print(f"errore: cartella non trovata: {args.radice}", file=sys.stderr)
        return 1

    Gestore.radice = args.radice
    corsi = leggi_biblioteca(args.radice)
    lezioni = sum(len(c.lezioni) for c in corsi)
    indirizzo = f"http://127.0.0.1:{args.porta}"

    # 127.0.0.1 e non 0.0.0.0: le lezioni restano su questo computer.
    with Servitore(("127.0.0.1", args.porta), Gestore) as servitore:
        print(f"  {lezioni} lezioni in {len(corsi)} corsi da {args.radice}")
        print(f"  {indirizzo}  (Ctrl+C per chiudere)")
        if not args.non_aprire:
            threading.Timer(0.5, lambda: webbrowser.open(indirizzo)).start()
        try:
            servitore.serve_forever()
        except KeyboardInterrupt:
            print("\n  chiuso.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
