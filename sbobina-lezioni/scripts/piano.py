#!/usr/bin/env python3
"""Il piano: scadenze, lezioni, esami, materiali, tempistiche e medie.

Tiene un solo file, `piano.json`, accanto alla cartella delle lezioni. È testo:
si legge, si modifica a mano e si mette in un backup come qualsiasi altro file.

Questo è il motore. Non disegna niente: stampa in terminale e risponde a
domande precise.

    python piano.py init                      crea un piano vuoto
    python piano.py agenda                    cosa arriva, e da quando lavorarci
    python piano.py oggi                      lezioni di oggi e impegni caldi
    python piano.py materiali                 cosa comprare, e entro quando ordinarlo
    python piano.py media                     media attuale e proiezione in centodecimi
    python piano.py serve --obiettivo 27      che voto serve negli esami che restano
    python piano.py fatto <id>                chiude un impegno
    python piano.py voto <corso> 28 [--lode]  registra un voto
    python piano.py controlla                 cerca incoerenze nel piano
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

GIORNI = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]
TIPI_IMPEGNO = ("revisione", "consegna", "esame", "altro")
STATI_MATERIALE = ("da comprare", "ordinato", "disponibile")

MODELLO = {
    "impostazioni": {
        "valore_lode": 30,
        "cfa_totali": 180,
        "obiettivo_media": 27,
    },
    "corsi": {},
    "impegni": [],
    "materiali": {},
    "voti": [],
}


# ---------------------------------------------------------------------------
# Lettura e scrittura
# ---------------------------------------------------------------------------

class ErrorePiano(Exception):
    """Problema nel file del piano, da mostrare all'utente senza traceback."""


def carica(percorso: Path) -> dict:
    if not percorso.is_file():
        raise ErrorePiano(f"piano non trovato: {percorso}. Crealo con: piano.py init")
    try:
        dati = json.loads(percorso.read_text(encoding="utf-8"))
    except json.JSONDecodeError as errore:
        raise ErrorePiano(f"{percorso} non è JSON valido: riga {errore.lineno}, {errore.msg}")
    for chiave, vuoto in MODELLO.items():
        dati.setdefault(chiave, json.loads(json.dumps(vuoto)))
    return dati


def salva(percorso: Path, dati: dict) -> None:
    percorso.write_text(json.dumps(dati, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def leggi_data(testo: str, dove: str) -> date:
    try:
        return datetime.strptime(testo, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise ErrorePiano(f"data non valida in {dove}: {testo!r}, attesa AAAA-MM-GG")


# ---------------------------------------------------------------------------
# Modello
# ---------------------------------------------------------------------------

@dataclass
class Impegno:
    id: str
    corso: str
    tipo: str
    titolo: str
    quando: date
    giorni_lavoro: int
    materiali: list[str]
    stato: str
    ora: str = ""
    note: str = ""

    @property
    def aperto(self) -> bool:
        return self.stato != "fatto"

    def giorni_a(self, oggi: date) -> int:
        return (self.quando - oggi).days

    @property
    def inizia_entro(self) -> date:
        return self.quando - timedelta(days=self.giorni_lavoro)

    def ordina_entro(self, giorni_approvvigionamento: int) -> date:
        """Ultimo giorno utile per ordinare un materiale e averlo prima di iniziare."""
        return self.inizia_entro - timedelta(days=giorni_approvvigionamento)


def leggi_impegni(dati: dict) -> list[Impegno]:
    impegni = []
    for grezzo in dati["impegni"]:
        identificativo = grezzo.get("id") or grezzo.get("titolo", "?")
        impegni.append(Impegno(
            id=identificativo,
            corso=grezzo.get("corso", ""),
            tipo=grezzo.get("tipo", "altro"),
            titolo=grezzo.get("titolo", ""),
            quando=leggi_data(grezzo.get("quando", ""), f"impegno {identificativo}"),
            giorni_lavoro=int(grezzo.get("giorni_lavoro", 0)),
            materiali=list(grezzo.get("materiali", [])),
            stato=grezzo.get("stato", "aperto"),
            ora=grezzo.get("ora", ""),
            note=grezzo.get("note", ""),
        ))
    impegni.sort(key=lambda i: i.quando)
    return impegni


def nome_corso(dati: dict, chiave: str) -> str:
    return dati["corsi"].get(chiave, {}).get("nome", chiave or "—")


# ---------------------------------------------------------------------------
# Medie
# ---------------------------------------------------------------------------

@dataclass
class Medie:
    cfa_fatti: int
    cfa_con_voto: int
    cfa_restanti: int
    media_ponderata: float | None
    media_aritmetica: float | None
    massima_raggiungibile: float | None

    @property
    def in_centodecimi(self) -> float | None:
        if self.media_ponderata is None:
            return None
        return self.media_ponderata * 110 / 30


def calcola_medie(dati: dict) -> Medie:
    """Media in trentesimi, ponderata sui CFA. Le idoneità non fanno media."""
    valore_lode = dati["impostazioni"].get("valore_lode", 30)
    corsi = dati["corsi"]

    somma_pesata = 0.0
    somma_cfa = 0
    voti_semplici = []
    cfa_fatti = 0
    corsi_con_voto = set()

    for voto in dati["voti"]:
        chiave = voto.get("corso", "")
        corso = corsi.get(chiave, {})
        cfa = int(corso.get("cfa", 0))
        cfa_fatti += cfa
        corsi_con_voto.add(chiave)
        if corso.get("valutazione") == "idoneita" or voto.get("voto") is None:
            continue
        valore = valore_lode if voto.get("lode") else float(voto["voto"])
        somma_pesata += valore * cfa
        somma_cfa += cfa
        voti_semplici.append(valore)

    cfa_restanti = sum(
        int(c.get("cfa", 0)) for chiave, c in corsi.items()
        if chiave not in corsi_con_voto and c.get("valutazione") != "idoneita"
    )

    ponderata = somma_pesata / somma_cfa if somma_cfa else None
    aritmetica = sum(voti_semplici) / len(voti_semplici) if voti_semplici else None
    massima = None
    if somma_cfa or cfa_restanti:
        massima = (somma_pesata + 30 * cfa_restanti) / (somma_cfa + cfa_restanti)

    return Medie(cfa_fatti, somma_cfa, cfa_restanti, ponderata, aritmetica, massima)


def voto_necessario(dati: dict, obiettivo: float, cfa_futuri: int) -> dict:
    """Che voto serve, su `cfa_futuri` crediti, per portare la ponderata a `obiettivo`.

    Da (S + v·c) / (C + c) ≥ M segue v ≥ (M·(C + c) − S) / c.
    """
    if cfa_futuri <= 0:
        raise ErrorePiano("servono dei CFA su cui calcolare: usa --cfa o registra i corsi mancanti")

    medie = calcola_medie(dati)
    somma = (medie.media_ponderata or 0) * medie.cfa_con_voto
    richiesto = (obiettivo * (medie.cfa_con_voto + cfa_futuri) - somma) / cfa_futuri

    return {
        "obiettivo": obiettivo,
        "cfa_futuri": cfa_futuri,
        "media_attuale": medie.media_ponderata,
        "richiesto": richiesto,
        "possibile": richiesto <= 30,
        "gia_raggiunto": richiesto <= 18,
        "massima_raggiungibile": medie.massima_raggiungibile,
    }


# ---------------------------------------------------------------------------
# Stampa
# ---------------------------------------------------------------------------

def tabella(intestazioni: list[str], righe: list[list[str]]) -> str:
    if not righe:
        return ""
    larghezze = [len(i) for i in intestazioni]
    for riga in righe:
        for n, cella in enumerate(riga):
            larghezze[n] = max(larghezze[n], len(cella))
    fuori = ["  ".join(i.ljust(larghezze[n]) for n, i in enumerate(intestazioni)).rstrip(),
             "  ".join("-" * l for l in larghezze)]
    for riga in righe:
        fuori.append("  ".join(c.ljust(larghezze[n]) for n, c in enumerate(riga)).rstrip())
    return "\n".join(fuori)


def quando_leggibile(giorni: int) -> str:
    if giorni < 0:
        return f"{-giorni}g fa"
    return {0: "oggi", 1: "domani"}.get(giorni, f"fra {giorni}g")


# ---------------------------------------------------------------------------
# Comandi
# ---------------------------------------------------------------------------

def comando_init(percorso: Path, _args, oggi: date) -> int:
    if percorso.exists():
        print(f"esiste già: {percorso}", file=sys.stderr)
        return 1
    modello = json.loads(json.dumps(MODELLO))
    modello["corsi"]["esempio-corso"] = {
        "nome": "Textile Design 1",
        "cfa": 8,
        "docente": "",
        "anno": 1,
        "semestre": 1,
        "valutazione": "voto",
        "cartella": "Textile Design",
        "orario": [{"giorno": "lunedì", "dalle": "09:00", "alle": "13:00", "aula": ""}],
    }
    modello["impegni"].append({
        "id": "esempio-revisione",
        "corso": "esempio-corso",
        "tipo": "revisione",
        "titolo": "Tre campioni cuciti sullo sbieco",
        "quando": (oggi + timedelta(days=14)).isoformat(),
        "ora": "14:00",
        "giorni_lavoro": 4,
        "materiali": ["esempio-tessuto"],
        "stato": "aperto",
        "note": "",
    })
    modello["materiali"]["esempio-tessuto"] = {
        "nome": "Crêpe de chine, 1 m",
        "dove": "",
        "giorni_approvvigionamento": 5,
        "costo": 18.0,
        "stato": "da comprare",
    }
    salva(percorso, modello)
    print(f"creato {percorso} con una voce di esempio per ogni sezione.")
    print("Modificalo a mano, o dillo a Claude: 'aggiungi al piano la revisione di venerdì'.")
    return 0


def comando_agenda(percorso: Path, args, oggi: date) -> int:
    dati = carica(percorso)
    impegni = [i for i in leggi_impegni(dati) if i.aperto]
    limite = oggi + timedelta(days=args.giorni)
    impegni = [i for i in impegni if i.quando <= limite]

    if not impegni:
        print(f"Niente in scadenza nei prossimi {args.giorni} giorni.")
        return 0

    righe = []
    for impegno in impegni:
        giorni = impegno.giorni_a(oggi)
        segnale = ""
        if giorni < 0:
            segnale = "SCADUTO"
        elif impegno.giorni_lavoro and impegno.inizia_entro <= oggi:
            segnale = "INIZIA ORA"
        elif impegno.giorni_lavoro:
            segnale = f"dal {impegno.inizia_entro.isoformat()}"

        mancanti = [
            dati["materiali"].get(m, {}).get("nome", m)
            for m in impegno.materiali
            if dati["materiali"].get(m, {}).get("stato") != "disponibile"
        ]
        righe.append([
            impegno.quando.isoformat(),
            quando_leggibile(giorni),
            impegno.tipo,
            nome_corso(dati, impegno.corso),
            impegno.titolo,
            segnale,
            f"{len(mancanti)} da procurare" if mancanti else "",
        ])

    print(tabella(["data", "quando", "tipo", "corso", "cosa", "lavoro", "materiali"], righe))
    scaduti = sum(1 for i in impegni if i.giorni_a(oggi) < 0)
    if scaduti:
        print(f"\n{scaduti} impegni scaduti e ancora aperti. Chiudili con: piano.py fatto <id>")
    return 0


def comando_oggi(percorso: Path, args, oggi: date) -> int:
    dati = carica(percorso)
    nome_giorno = GIORNI[oggi.weekday()]
    print(f"{nome_giorno} {oggi.isoformat()}\n")

    lezioni = []
    for chiave, corso in dati["corsi"].items():
        for slot in corso.get("orario", []):
            if slot.get("giorno", "").lower() == nome_giorno:
                lezioni.append([slot.get("dalle", ""), slot.get("alle", ""),
                                corso.get("nome", chiave), slot.get("aula", "")])
    lezioni.sort()
    if lezioni:
        print("Lezioni")
        print(tabella(["dalle", "alle", "corso", "aula"], lezioni))
    else:
        print("Nessuna lezione oggi.")

    caldi = [i for i in leggi_impegni(dati)
             if i.aperto and (i.quando <= oggi + timedelta(days=args.giorni)
                              or (i.giorni_lavoro and i.inizia_entro <= oggi))]
    if caldi:
        print("\nDa tenere d'occhio")
        print(tabella(["data", "quando", "cosa"],
                      [[i.quando.isoformat(), quando_leggibile(i.giorni_a(oggi)), i.titolo]
                       for i in caldi]))
    return 0


def comando_materiali(percorso: Path, args, oggi: date) -> int:
    dati = carica(percorso)
    limite = oggi + timedelta(days=args.giorni)

    # Un materiale serve per più impegni: conta la scadenza più vicina.
    servono: dict[str, Impegno] = {}
    for impegno in leggi_impegni(dati):
        if not impegno.aperto or impegno.quando > limite:
            continue
        for chiave in impegno.materiali:
            if chiave not in servono or impegno.quando < servono[chiave].quando:
                servono[chiave] = impegno

    righe, spesa, tardi = [], 0.0, 0
    for chiave, impegno in sorted(servono.items(), key=lambda v: v[1].quando):
        materiale = dati["materiali"].get(chiave, {})
        if materiale.get("stato") == "disponibile":
            continue
        attesa = int(materiale.get("giorni_approvvigionamento", 0))
        ordina = impegno.ordina_entro(attesa)
        ritardo = ordina < oggi
        tardi += ritardo
        spesa += float(materiale.get("costo") or 0)
        righe.append([
            materiale.get("nome", chiave),
            materiale.get("stato", "da comprare"),
            f"{attesa}g",
            ordina.isoformat() + (" IN RITARDO" if ritardo else ""),
            impegno.titolo,
            f"{float(materiale.get('costo') or 0):.0f} €" if materiale.get("costo") else "",
        ])

    if not righe:
        print(f"Niente da procurare per i prossimi {args.giorni} giorni.")
        return 0

    print(tabella(["materiale", "stato", "attesa", "ordina entro", "per", "costo"], righe))
    print(f"\nSpesa stimata: {spesa:.0f} €")
    if tardi:
        print(f"{tardi} materiali andavano già ordinati: la data tiene conto "
              f"dell'attesa e dei giorni di lavoro.")
    return 0


def comando_media(percorso: Path, args, _oggi: date) -> int:
    dati = carica(percorso)
    medie = calcola_medie(dati)

    if medie.media_ponderata is None:
        print("Nessun voto registrato. Aggiungine uno con: piano.py voto <corso> <voto>")
        return 0

    totali = dati["impostazioni"].get("cfa_totali", 180)
    print(tabella(["dato", "valore"], [
        ["media ponderata sui CFA", f"{medie.media_ponderata:.2f}"],
        ["media aritmetica", f"{medie.media_aritmetica:.2f}"],
        ["proiezione in centodecimi", f"{medie.in_centodecimi:.1f}"],
        ["CFA acquisiti", f"{medie.cfa_fatti} su {totali}"],
        ["CFA che fanno media", str(medie.cfa_con_voto)],
        ["CFA con voto ancora da dare", str(medie.cfa_restanti)],
        ["massima media ancora raggiungibile", f"{medie.massima_raggiungibile:.2f}"],
    ]))
    print("\nLa proiezione in centodecimi è la sola media riportata in scala: i punti per "
          "tesi, lodi e durata dipendono dal regolamento dell'istituto e non sono inclusi.")

    obiettivo = args.obiettivo or dati["impostazioni"].get("obiettivo_media")
    if obiettivo and medie.cfa_restanti:
        esito = voto_necessario(dati, float(obiettivo), medie.cfa_restanti)
        print(f"\nPer una media di {obiettivo:g} servono {esito['richiesto']:.1f} "
              f"di media sui {medie.cfa_restanti} CFA che restano.")
        if not esito["possibile"]:
            print(f"Non è più raggiungibile: il massimo possibile è "
                  f"{medie.massima_raggiungibile:.2f}.")
    return 0


def comando_serve(percorso: Path, args, _oggi: date) -> int:
    dati = carica(percorso)
    cfa = args.cfa
    etichetta = f"{cfa} CFA"

    if cfa is None and args.corso:
        corso = dati["corsi"].get(args.corso)
        if not corso:
            raise ErrorePiano(f"corso sconosciuto: {args.corso}")
        cfa = int(corso.get("cfa", 0))
        etichetta = f"{corso.get('nome', args.corso)} ({cfa} CFA)"
    elif cfa is None:
        cfa = calcola_medie(dati).cfa_restanti
        etichetta = f"tutti i {cfa} CFA che restano"

    esito = voto_necessario(dati, float(args.obiettivo), cfa)
    attuale = esito["media_attuale"]
    print(f"Media attuale: {attuale:.2f}" if attuale is not None else "Nessun voto ancora.")
    print(f"Obiettivo: {args.obiettivo:g}")
    print(f"Su: {etichetta}\n")

    if esito["gia_raggiunto"]:
        print(f"Basta passare: anche con 18 la media resta sopra {args.obiettivo:g}.")
    elif esito["possibile"]:
        print(f"Serve almeno {esito['richiesto']:.1f}, cioè {int(-(-esito['richiesto'] // 1))} "
              f"arrotondando per eccesso.")
    else:
        print(f"Non è raggiungibile: servirebbe {esito['richiesto']:.1f} e il massimo è 30.")
        print(f"La media più alta ancora possibile è {esito['massima_raggiungibile']:.2f}.")
    return 0


def comando_fatto(percorso: Path, args, oggi: date) -> int:
    dati = carica(percorso)
    for grezzo in dati["impegni"]:
        if grezzo.get("id") == args.id:
            grezzo["stato"] = "fatto"
            grezzo["chiuso_il"] = oggi.isoformat()
            salva(percorso, dati)
            print(f"chiuso: {grezzo.get('titolo', args.id)}")
            return 0
    raise ErrorePiano(f"impegno non trovato: {args.id}")


def comando_voto(percorso: Path, args, oggi: date) -> int:
    dati = carica(percorso)
    if args.corso not in dati["corsi"]:
        raise ErrorePiano(f"corso sconosciuto: {args.corso}")
    if not 18 <= args.voto <= 30:
        raise ErrorePiano(f"voto fuori scala: {args.voto}, atteso fra 18 e 30")

    for registrato in dati["voti"]:
        if registrato.get("corso") == args.corso:
            raise ErrorePiano(f"voto già registrato per {args.corso}: "
                              f"{registrato.get('voto')}. Correggilo nel file.")

    dati["voti"].append({"corso": args.corso, "voto": args.voto,
                         "lode": args.lode, "data": oggi.isoformat()})
    salva(percorso, dati)
    medie = calcola_medie(dati)
    print(f"registrato: {nome_corso(dati, args.corso)} {args.voto}"
          f"{' e lode' if args.lode else ''}")
    print(f"media ponderata: {medie.media_ponderata:.2f}")
    return 0


def comando_controlla(percorso: Path, _args, oggi: date) -> int:
    dati = carica(percorso)
    problemi = []

    for impegno in leggi_impegni(dati):
        if impegno.corso and impegno.corso not in dati["corsi"]:
            problemi.append(f"{impegno.id}: corso sconosciuto {impegno.corso!r}")
        if impegno.tipo not in TIPI_IMPEGNO:
            problemi.append(f"{impegno.id}: tipo {impegno.tipo!r} non fra {TIPI_IMPEGNO}")
        for chiave in impegno.materiali:
            if chiave not in dati["materiali"]:
                problemi.append(f"{impegno.id}: materiale sconosciuto {chiave!r}")
        if impegno.aperto and impegno.quando < oggi:
            problemi.append(f"{impegno.id}: scaduto il {impegno.quando} e ancora aperto")

    visti = set()
    for impegno in dati["impegni"]:
        identificativo = impegno.get("id")
        if identificativo in visti:
            problemi.append(f"id ripetuto: {identificativo!r}")
        visti.add(identificativo)

    for chiave, materiale in dati["materiali"].items():
        if materiale.get("stato") not in STATI_MATERIALE:
            problemi.append(f"materiale {chiave}: stato {materiale.get('stato')!r} "
                            f"non fra {STATI_MATERIALE}")

    for voto in dati["voti"]:
        if voto.get("corso") not in dati["corsi"]:
            problemi.append(f"voto su corso sconosciuto: {voto.get('corso')!r}")

    for chiave, corso in dati["corsi"].items():
        for slot in corso.get("orario", []):
            if slot.get("giorno", "").lower() not in GIORNI:
                problemi.append(f"corso {chiave}: giorno {slot.get('giorno')!r} non valido")

    if not problemi:
        print("Piano coerente.")
        return 0
    print(f"{len(problemi)} problemi:")
    for problema in problemi:
        print(f"  - {problema}")
    return 1


COMANDI = {
    "init": comando_init,
    "agenda": comando_agenda,
    "oggi": comando_oggi,
    "materiali": comando_materiali,
    "media": comando_media,
    "serve": comando_serve,
    "fatto": comando_fatto,
    "voto": comando_voto,
    "controlla": comando_controlla,
}


def costruisci_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scadenze, lezioni, esami, materiali, tempistiche e medie.")
    parser.add_argument("--piano", type=Path, default=Path("piano.json"),
                        help="file del piano (default: piano.json)")
    parser.add_argument("--oggi", help="data da usare come oggi, AAAA-MM-GG (per le prove)")
    sotto = parser.add_subparsers(dest="comando", required=True)

    sotto.add_parser("init", help="crea un piano vuoto con un esempio per sezione")

    for nome, aiuto, predefinito in [("agenda", "cosa arriva e da quando lavorarci", 30),
                                     ("materiali", "cosa comprare e entro quando", 30),
                                     ("oggi", "lezioni di oggi e impegni caldi", 3)]:
        p = sotto.add_parser(nome, help=aiuto)
        p.add_argument("--giorni", type=int, default=predefinito,
                       help=f"orizzonte in giorni (default: {predefinito})")

    p = sotto.add_parser("media", help="media attuale e proiezione")
    p.add_argument("--obiettivo", type=float, help="media a cui puntare")

    p = sotto.add_parser("serve", help="che voto serve per raggiungere una media")
    p.add_argument("--obiettivo", type=float, required=True)
    p.add_argument("--corso", help="calcola sul singolo esame di questo corso")
    p.add_argument("--cfa", type=int, help="CFA su cui calcolare, se non è un corso registrato")

    p = sotto.add_parser("fatto", help="chiude un impegno")
    p.add_argument("id")

    p = sotto.add_parser("voto", help="registra un voto")
    p.add_argument("corso")
    p.add_argument("voto", type=int)
    p.add_argument("--lode", action="store_true")

    sotto.add_parser("controlla", help="cerca incoerenze nel piano")
    return parser


def main(argomenti: list[str] | None = None) -> int:
    args = costruisci_parser().parse_args(argomenti)
    oggi = leggi_data(args.oggi, "--oggi") if args.oggi else date.today()
    try:
        return COMANDI[args.comando](args.piano, args, oggi)
    except ErrorePiano as errore:
        print(f"errore: {errore}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
