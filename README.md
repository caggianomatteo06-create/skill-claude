# skill-claude

Skill per Claude usati in **Linea S.r.l.** (distribuzione alimentare, Asti), impacchettati come file `.skill` pronti da installare.

Al momento il repository ne contiene uno.

## Cosa c'è dentro

| File | Skill | A cosa serve |
| --- | --- | --- |
| `volantini-linea.skill` | `volantini-linea` | Crea in Canva i volantini promozionali mensili di Linea, riproducendo lo stile storico dell'azienda. |

## Lo skill `volantini-linea`

Si attiva quando si chiede di fare, aggiornare o rifare un volantino, le offerte del mese o la versione sfogliabile online — anche senza nominare Canva.

Non inventa un layout nuovo: replica i pattern ricavati da quattro volantini reali dell'archivio aziendale. In particolare fissa

- **l'intestazione** — striscia teal `LA LINEA SRL, SEMPRE IN MOVIMENTO PER VOI`, titolo bubble `VOLANTINO [MESE] [ANNO]`, logo in alto a destra;
- **la scheda prodotto** — nome in maiuscolo, `COD. Lxxx`, foto ritagliata, listino barrato accanto al promozionale in grande, badge sconto;
- **le sezioni per fornitore** — `SPECIALE RASPINI`, `SPECIALE CASEIFICIO QUAGLIA`… più la pagina dedicata `SPECIALE BAR!` per la clientela HoReCa;
- **il footer legale**, che va riportato parola per parola e non si tocca mai.

Il numero di pagine non è fisso: dipende da quanti articoli sono in promozione quel mese.

Tre regole che lo skill tratta come non negoziabili:

1. **Ogni volantino è un design Canva nuovo.** Si copia il volantino precedente per ereditarne stile e formato, poi si modifica solo la copia — mai una transazione di editing su un `design_id` che esisteva già.
2. **I prezzi promozionali non si inventano.** Descrizione, unità di misura e listino si recuperano dall'anagrafica Excel a partire dal codice articolo; il promozionale e lo sconto, se non li dà l'utente, si chiedono. Quello che l'utente scrive in chat vince sempre sul file.
3. **Niente salvataggi automatici.** Il `finalize: "commit"` arriva solo dopo l'approvazione esplicita, perché è irreversibile.

### Cosa serve perché funzioni

- Il **connettore Canva** attivo, con accesso alla cartella immagini `FAHRfo5yBqc` (progetto "sito"), dove le foto prodotto sono nominate per codice articolo — `L911.jpg`, `R027.png`…
- Il file **Excel di anagrafica articoli** (codice → descrizione, unità di misura, listino), letto tramite lo skill `xlsx`.

## Installare uno skill

**Claude Code** — scompatta il pacchetto fra gli skill personali (o in `.claude/skills/` per limitarlo a un progetto):

```bash
unzip volantini-linea.skill -d ~/.claude/skills/
```

L'archivio contiene già la cartella dello skill, quindi si ottiene `~/.claude/skills/volantini-linea/SKILL.md`.

**Claude sul web e nelle app** — carica il file `.skill` dalle impostazioni degli skill.

## Modificare uno skill

I file `.skill` sono archivi zip: si scompattano, si modifica il `SKILL.md` e si ricompattano.

```bash
unzip volantini-linea.skill -d /tmp/skill && $EDITOR /tmp/skill/volantini-linea/SKILL.md
cd /tmp/skill && zip -r volantini-linea.skill volantini-linea
```

Il nuovo archivio va rimesso nella radice del repository al posto del vecchio. La cartella dev'essere al primo livello dello zip: senza di quella lo skill non viene riconosciuto.

## Struttura del pacchetto

```
volantini-linea.skill        archivio zip
└── volantini-linea/
    └── SKILL.md             front matter (name, description) + istruzioni
```

Il campo `description` del front matter è ciò che Claude legge per decidere se attivare lo skill: va tenuto esplicito sui casi d'uso, altrimenti lo skill non parte quando servirebbe.
