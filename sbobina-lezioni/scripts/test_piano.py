"""Verifica piano.py. La parte che conta è la matematica delle medie: un
'ti serve 24' sbagliato fa studiare meno del necessario.

    python scripts/test_piano.py
"""

import importlib.util, io, json, shutil, sys
from contextlib import redirect_stdout, redirect_stderr
from datetime import date
from pathlib import Path

QUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("piano", QUI / "piano.py")
pn = importlib.util.module_from_spec(spec); sys.modules["piano"] = pn; spec.loader.exec_module(pn)

BANCO = QUI.parent / ".prova-piano"
shutil.rmtree(BANCO, ignore_errors=True); BANCO.mkdir(parents=True)
OGGI = date(2026, 9, 12)


def esegui(*argomenti, atteso=0):
    uscita = io.StringIO()
    with redirect_stdout(uscita), redirect_stderr(uscita):
        codice = pn.main(list(argomenti))
    assert codice == atteso, f"{argomenti} -> codice {codice}\n{uscita.getvalue()}"
    return uscita.getvalue()


def scrivi(nome, dati):
    percorso = BANCO / nome
    percorso.write_text(json.dumps(dati, ensure_ascii=False), encoding="utf-8")
    return percorso


# ---------- 1. medie ----------
piano = {
    "impostazioni": {"valore_lode": 30, "cfa_totali": 180, "obiettivo_media": 27},
    "corsi": {
        "storia": {"nome": "Storia della moda", "cfa": 6, "valutazione": "voto"},
        "disegno": {"nome": "Disegno e colore", "cfa": 10, "valutazione": "voto"},
        "lab": {"nome": "Laboratorio", "cfa": 4, "valutazione": "idoneita"},
        "textile": {"nome": "Textile Design 1", "cfa": 8, "valutazione": "voto"},
    },
    "impegni": [], "materiali": {},
    "voti": [
        {"corso": "storia", "voto": 30, "lode": True, "data": "2026-02-10"},
        {"corso": "disegno", "voto": 24, "lode": False, "data": "2026-02-20"},
        {"corso": "lab", "voto": None, "lode": False, "data": "2026-03-01"},
    ],
}
p = scrivi("medie.json", piano)
m = pn.calcola_medie(pn.carica(p))
atteso = (30 * 6 + 24 * 10) / 16
assert abs(m.media_ponderata - atteso) < 1e-9, (m.media_ponderata, atteso)
assert abs(m.media_aritmetica - 27.0) < 1e-9, m.media_aritmetica
assert m.cfa_con_voto == 16, "l'idoneità non deve entrare nella media"
assert m.cfa_fatti == 20, "l'idoneità deve contare fra i CFA acquisiti"
assert m.cfa_restanti == 8, m.cfa_restanti
assert abs(m.in_centodecimi - atteso * 110 / 30) < 1e-9
assert abs(m.massima_raggiungibile - (30 * 6 + 24 * 10 + 30 * 8) / 24) < 1e-9
print(f"medie: ponderata {m.media_ponderata:.2f}, aritmetica {m.media_aritmetica:.2f}, "
      f"idoneità esclusa dalla media ma contata nei CFA")

# la lode vale quanto dice l'impostazione, non sempre 30
piano_lode = json.loads(json.dumps(piano))
piano_lode["impostazioni"]["valore_lode"] = 31
m31 = pn.calcola_medie(pn.carica(scrivi("lode.json", piano_lode)))
assert abs(m31.media_ponderata - (31 * 6 + 24 * 10) / 16) < 1e-9
print("medie: valore della lode configurabile")

# ---------- 2. voto necessario, verificato al contrario ----------
dati = pn.carica(p)
for obiettivo in (25.0, 26.5, 27.0, 28.0):
    esito = pn.voto_necessario(dati, obiettivo, 8)
    v = esito["richiesto"]
    ricalcolata = (m.media_ponderata * m.cfa_con_voto + v * 8) / (m.cfa_con_voto + 8)
    assert abs(ricalcolata - obiettivo) < 1e-9, (obiettivo, v, ricalcolata)
print("voto necessario: ricalcolando la media col voto richiesto si ottiene l'obiettivo esatto")

assert pn.voto_necessario(dati, 29.0, 8)["possibile"] is False, "29 non è raggiungibile qui"
assert pn.voto_necessario(dati, 25.0, 8)["possibile"] is True
assert pn.voto_necessario(dati, 20.0, 8)["gia_raggiunto"] is True
vuoto = pn.carica(scrivi("vuoto.json", {"corsi": {"x": {"nome": "X", "cfa": 6}}}))
assert abs(pn.voto_necessario(vuoto, 27.0, 6)["richiesto"] - 27.0) < 1e-9, \
    "senza voti precedenti serve esattamente l'obiettivo"
try:
    pn.voto_necessario(dati, 27.0, 0); raise AssertionError("zero CFA accettati")
except pn.ErrorePiano:
    pass
print("voto necessario: irraggiungibile, già raggiunto, piano vuoto e zero CFA gestiti")

uscita = esegui("--piano", str(p), "serve", "--obiettivo", "27", "--corso", "textile")
assert "Textile Design 1 (8 CFA)" in uscita, uscita
assert "Serve almeno 28.5" in uscita and "cioè 29" in uscita, uscita
uscita = esegui("--piano", str(p), "serve", "--obiettivo", "29")
assert "Non è raggiungibile" in uscita, uscita
uscita = esegui("--piano", str(p), "media", "--obiettivo", "26")
assert "media ponderata" in uscita and "proiezione in centodecimi" in uscita
assert "26.25" in uscita and "27.00" in uscita, uscita  # ponderata e aritmetica
assert "96.2" in uscita, uscita  # 26,25 riportata in centodecimi
print("comandi serve e media: output coerente con i calcoli")

# ---------- 3. agenda e tempistiche ----------
piano2 = {
    "corsi": {"textile": {"nome": "Textile Design 1", "cfa": 8,
                          "orario": [{"giorno": "sabato", "dalle": "09:00",
                                      "alle": "13:00", "aula": "A2"}]}},
    "impegni": [
        {"id": "vecchia", "corso": "textile", "tipo": "consegna", "titolo": "Tavole di ricerca",
         "quando": "2026-09-05", "giorni_lavoro": 3, "materiali": [], "stato": "aperto"},
        {"id": "campioni", "corso": "textile", "tipo": "revisione", "titolo": "Tre campioni",
         "quando": "2026-09-19", "giorni_lavoro": 8, "materiali": ["crepe", "filo"],
         "stato": "aperto"},
        {"id": "esame", "corso": "textile", "tipo": "esame", "titolo": "Esame Textile",
         "quando": "2026-11-30", "giorni_lavoro": 20, "materiali": [], "stato": "aperto"},
        {"id": "chiusa", "corso": "textile", "tipo": "consegna", "titolo": "Già fatta",
         "quando": "2026-09-14", "giorni_lavoro": 1, "materiali": [], "stato": "fatto"},
    ],
    "materiali": {
        "crepe": {"nome": "Crêpe de chine 1 m", "giorni_approvvigionamento": 7,
                  "costo": 22, "stato": "da comprare"},
        "filo": {"nome": "Filo di seta", "giorni_approvvigionamento": 2,
                 "costo": 4, "stato": "disponibile"},
    },
    "voti": [],
}
p2 = scrivi("agenda.json", piano2)
uscita = esegui("--piano", str(p2), "--oggi", "2026-09-12", "agenda")
assert "SCADUTO" in uscita and "7g fa" in uscita
assert "INIZIA ORA" in uscita, "una revisione fra 7 giorni con 8 di lavoro è già in ritardo"
assert "Già fatta" not in uscita, "gli impegni chiusi non vanno in agenda"
assert "Esame Textile" not in uscita, "oltre l'orizzonte di 30 giorni"
assert "1 da procurare" in uscita, "il filo è disponibile, il crêpe no"
uscita = esegui("--piano", str(p2), "--oggi", "2026-09-12", "agenda", "--giorni", "90")
assert "Esame Textile" in uscita and "dal 2026-11-10" in uscita
print("agenda: scaduti, inizio lavoro, impegni chiusi, orizzonte e materiali mancanti")

# ---------- 4. materiali ----------
uscita = esegui("--piano", str(p2), "--oggi", "2026-09-12", "materiali")
# scadenza 19/09 meno 8 giorni di lavoro meno 7 di attesa = 04/09, già passato
assert "2026-09-04 IN RITARDO" in uscita, uscita
assert "Filo di seta" not in uscita, "un materiale disponibile non va nella lista"
assert "Spesa stimata: 22 €" in uscita, uscita
print("materiali: data d'ordine = scadenza - lavoro - attesa, ritardo segnalato")

# un materiale usato da due impegni segue la scadenza più vicina
piano3 = json.loads(json.dumps(piano2))
piano3["impegni"].append({"id": "presto", "corso": "textile", "tipo": "consegna",
                          "titolo": "Prova rapida", "quando": "2026-09-15",
                          "giorni_lavoro": 1, "materiali": ["crepe"], "stato": "aperto"})
uscita = esegui("--piano", str(scrivi("condiviso.json", piano3)),
                "--oggi", "2026-09-12", "materiali")
assert "Prova rapida" in uscita and uscita.count("Crêpe de chine") == 1
print("materiali: un materiale condiviso segue la scadenza più vicina")

# ---------- 5. oggi ----------
uscita = esegui("--piano", str(p2), "--oggi", "2026-09-14", "oggi")  # lunedì
assert "lunedì 2026-09-14" in uscita and "Nessuna lezione oggi" in uscita, uscita
uscita = esegui("--piano", str(p2), "--oggi", "2026-09-12", "oggi")  # sabato
assert "sabato" in uscita and "Textile Design 1" in uscita and "A2" in uscita, uscita
assert "Tre campioni" in uscita, "un impegno da iniziare subito va segnalato in oggi"
print("oggi: orario settimanale letto dal giorno della settimana")

# ---------- 6. scritture ----------
esegui("--piano", str(p2), "--oggi", "2026-09-12", "fatto", "campioni")
assert json.loads(p2.read_text())["impegni"][1]["stato"] == "fatto"
assert json.loads(p2.read_text())["impegni"][1]["chiuso_il"] == "2026-09-12"
esegui("--piano", str(p2), "fatto", "inesistente", atteso=1)

p4 = scrivi("voti.json", {"corsi": {"storia": {"nome": "Storia", "cfa": 6}}, "voti": []})
uscita = esegui("--piano", str(p4), "--oggi", "2026-09-12", "voto", "storia", "28")
assert "media ponderata: 28.00" in uscita
assert json.loads(p4.read_text())["voti"][0]["data"] == "2026-09-12"
assert "già registrato" in esegui("--piano", str(p4), "voto", "storia", "27", atteso=1)
assert "fuori scala" in esegui("--piano", str(p4), "voto", "storia", "35", atteso=1)
assert "sconosciuto" in esegui("--piano", str(p4), "voto", "nessuno", "28", atteso=1)
print("scritture: chiusura impegni, registrazione voti, doppioni e voti fuori scala rifiutati")

# ---------- 7. controlla ----------
rotto = scrivi("rotto.json", {
    "corsi": {"a": {"nome": "A", "cfa": 6, "orario": [{"giorno": "lunedi"}]}},
    "impegni": [
        {"id": "x", "corso": "fantasma", "tipo": "sbagliato", "quando": "2026-01-01",
         "materiali": ["mai-visto"], "stato": "aperto", "titolo": "T"},
        {"id": "x", "corso": "a", "tipo": "consegna", "quando": "2027-01-01",
         "materiali": [], "stato": "aperto", "titolo": "U"},
    ],
    "materiali": {"m": {"nome": "M", "stato": "boh"}},
    "voti": [{"corso": "inesistente", "voto": 30}],
})
uscita = esegui("--piano", str(rotto), "--oggi", "2026-09-12", "controlla", atteso=1)
for pezzo in ["corso sconosciuto", "tipo 'sbagliato'", "materiale sconosciuto",
              "scaduto il 2026-01-01", "id ripetuto", "stato 'boh'",
              "voto su corso sconosciuto", "giorno 'lunedi'"]:
    assert pezzo in uscita, f"controlla non segnala: {pezzo}\n{uscita}"
print("controlla: otto tipi di incoerenza riconosciuti")

# ---------- 8. init ----------
nuovo = BANCO / "nuovo.json"
esegui("--piano", str(nuovo), "--oggi", "2026-09-12", "init")
assert nuovo.is_file()
esegui("--piano", str(nuovo), "--oggi", "2026-09-12", "init", atteso=1)  # non sovrascrive
esegui("--piano", str(nuovo), "--oggi", "2026-09-12", "controlla")
uscita = esegui("--piano", str(nuovo), "--oggi", "2026-09-12", "agenda")
assert "Tre campioni cuciti sullo sbieco" in uscita
print("init: crea un piano coerente e non sovrascrive")

# ---------- 9. errori del file ----------
(BANCO / "storto.json").write_text("{ non json", encoding="utf-8")
assert "non è JSON valido" in esegui("--piano", str(BANCO / "storto.json"), "agenda", atteso=1)
assert "piano non trovato" in esegui("--piano", str(BANCO / "assente.json"), "agenda", atteso=1)
male = scrivi("datastorta.json", {"impegni": [{"id": "y", "quando": "12/09/2026"}]})
assert "attesa AAAA-MM-GG" in esegui("--piano", str(male), "agenda", atteso=1)
print("errori: JSON rotto, file assente e data malformata spiegati senza traceback")

shutil.rmtree(BANCO, ignore_errors=True)
print("\nTUTTI I TEST DI piano.py PASSATI")
