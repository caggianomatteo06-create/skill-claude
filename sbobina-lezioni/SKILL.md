---
name: sbobina-lezioni
description: >
  Registra ed elabora le lezioni del triennio in Textile & Fashion Design allo IAAD di Torino.
  Trasforma le registrazioni in materiale di studio: trascrizione con timestamp, riassunti,
  indice dei riferimenti citati (designer, maison, collezioni, mostre), consegne e scadenze delle
  revisioni, mappe, glossario tecnico e flashcard per i corsi teorici. Usa SEMPRE questo skill
  quando l'utente chiede di "sbobinare" una lezione, trascrivere un audio o un video di lezione,
  ricavare appunti, riassunti, schemi o mappe da una registrazione, ritrovare un riferimento o un
  nome citato a lezione, sapere cosa c'è da consegnare, organizzare il materiale di un corso o di
  un esame, oppure chiede come registrare le lezioni, con che attrezzatura, o come seguirle in
  diretta con un assistente. Copre registrazione, modalità live che avvisa quando il docente
  mostra qualcosa o annuncia una consegna, trascrizione locale con Whisper, glossario tecnico di
  moda e tessile, produzione dei materiali di studio e biblioteca consultabile nel browser.
---

# Lezioni IAAD — Textile & Fashion Design

Skill costruito per un preciso contesto: **triennio in Textile & Fashion Design allo IAAD di
Torino**, istituzione AFAM, Diploma Accademico di I Livello, 180 CFA, didattica in italiano.

Il corso alterna tre dimensioni: una **analitica** (materie umanistiche che leggono fenomeni e
tendenze), una **progettuale** (dall'idea al prodotto) e una **espressiva e grafica** (disegno,
rappresentazione del corpo, colore, software). Le prime chiedono uno studio da esame, le altre
si valutano su progetto e revisione. Lo skill serve entrambe, ma con output diversi.

## Cosa cambia rispetto a una lezione qualsiasi

Tre fatti da tenere presenti in ogni risposta, perché determinano tutto il resto:

1. **Il contenuto è in gran parte visivo.** Immagini di collezioni, capi appesi, campioni di
   tessuto che girano per l'aula, tavole alla parete. Una registrazione audio ne conserva quasi
   nulla: "guardate questo drappeggio" da solo non vale niente.
2. **Non si studia per un compito scritto, si consegna.** Revisioni, tavole, figurini, formati,
   scadenze. L'informazione più costosa da perdere è *cosa portare e per quando*.
3. **Il vocabolario manda in crisi la trascrizione automatica.** Termini francesi e inglesi
   (prêt-à-porter, pied-de-poule, crêpe de chine, colorway, tech pack) e nomi propri (Vionnet,
   Schiaparelli, Comme des Garçons, Margiela) escono storpiati sistematicamente.

Da qui discende ogni scelta dello skill. Non trattare queste lezioni come lezioni teoriche: niente
formule, niente "questo all'esame lo chiede sempre" nei corsi di progetto, niente flashcard dove
non si viene interrogati.

## La pipeline

```
registrazione audio  →  trascrizione (.md + .srt)  →  materiali di studio  →  biblioteca
     telefono              scripts/trascrivi.py        riassunto, riferimenti,   browser
        │                  + glossario del corso       consegne, mappa
        │
        └─ opzionale, durante la lezione: scripts/lezione_live.py
           avvisa quando fotografare e quando viene annunciata una consegna
```

Ogni stadio produce **file che restano all'utente**: il materiale non finisce chiuso dentro una
piattaforma e si rielabora all'infinito.

## Struttura cartelle

Proporla la prima volta e poi rispettarla:

```
Lezioni/
  <Corso>/                             # es. Disegno e colore, Semiotica del design
    glossario.md                       # termini e nomi del corso, cresce lezione dopo lezione
    scadenze.md                        # consegne e revisioni del corso, uno solo
    2026-09-12-titolo-lezione/
      audio.m4a                        # registrazione originale, non cancellarla
      trascrizione.md                  # stadio 2
      trascrizione.srt
      riassunto.md                     # stadio 3
      riferimenti.md
      mappa.md
      flashcard.csv                    # solo corsi teorici
      avvisi.md                        # se si è usata la modalità live
      domande.md
      schermate/                       # catturate in automatico
      foto/                            # scattate col telefono, rinominate hh-mm-ss
```

Il nome cartella `AAAA-MM-GG-titolo` tiene le lezioni in ordine da solo.

## Stadio 1 — Registrazione

Il telefono sul banco basta quasi sempre. **Quello che si perde non è la qualità audio: è il capo,
il campione, l'immagine sullo schermo.** Scala delle soluzioni, hardware con prezzi, errori che
costano una lezione intera: `references/registrazione.md`. Leggerlo prima di consigliare acquisti.

**Nota da dare la prima volta, senza farne un caso:** chiedere il permesso al docente e rispettare
il regolamento dell'istituto. Le registrazioni non vanno diffuse: la lezione è opera del docente e
in aula ci sono le voci di altre persone. Le immagini mostrate sono spesso protette da copyright:
vanno bene negli appunti personali, non in pubblicazioni.

## Stadio 1b — Modalità live (opzionale)

`scripts/lezione_live.py` sta acceso durante la lezione: registra, trascrive a finestre di 25
secondi e **avvisa mentre sta succedendo**, quando c'è ancora tempo per fotografare o alzare la
mano.

```bash
# in aula, con un bip quando conviene fotografare
.venv/bin/python scripts/lezione_live.py --uscita "Lezioni/Disegno e colore/2026-09-12-armonie" --suono

# lezione con slide proiettate su un portatile: cattura da sé lo schermo
.venv/bin/python scripts/lezione_live.py --uscita "..." --schermo

# prova a freddo su una registrazione già fatta, senza microfono
.venv/bin/python scripts/lezione_live.py --uscita prova --sorgente vecchia-lezione.m4a --veloce
```

### Cosa rileva

**Rilevatore locale**, sempre attivo, gratuito, offline, istantaneo:

| | Segnale | Perché conta |
|---|---|---|
| 📸 | "guardate questo drappeggio", "toccate la mano del tessuto", "come vedete" | Sta mostrando qualcosa: **fotografalo adesso** |
| 📌 | "per la prossima volta portate", "la revisione è entro", "in formato" | Consegna annunciata a voce, nessuno la scrive |
| 🔖 | "guardatevi la collezione", "l'archivio di", "la mostra al" | Nome o fonte da recuperare dopo |
| ❓ | "ci siamo?", "domande?" | La finestra per chiedere si apre adesso |
| ⚠️ | confidenza bassa del modello | Whisper sta tirando a indovinare: da riascoltare |

L'ultima riga non viene dalle parole: Whisper dichiara quanto è sicuro di ogni segmento, e un
crollo di confidenza segnala l'audio degradato senza bisogno di rileggere nulla. Sul vocabolario
di moda succede spesso, ed è un segnale utile.

Gli avvisi finiscono in `avvisi.md` con timestamp, frase che li ha fatti scattare e, con
`--schermo`, la schermata catturata in quell'istante.

**Agente Claude**, opzionale, con `--agente`. Ogni cinque minuti rilegge quanto è stato detto e
scrive in `domande.md`: cosa fotografare, quali riferimenti sono stati nominati, quali consegne
annunciate, quali termini verificare e quali domande fare al docente adesso. Richiede
`ANTHROPIC_API_KEY`. Costo indicativo per una lezione da due ore: circa mezzo dollaro con
`claude-opus-5`, circa un decimo con `--modello-agente claude-haiku-4-5` e analisi più
superficiali. Le richieste hanno attiva la protezione automatica contro i rifiuti (`fallbacks`).

### Due avvertenze da dare sempre

1. **La diretta usa il modello Whisper piccolo**, perché deve stare al passo con il parlato. Serve
   a far scattare gli avvisi, non a studiarci. Finita la lezione **va ripassato `trascrivi.py`**
   con il modello grande: la modalità live salva l'audio integrale apposta.
2. **Non si guarda il terminale durante la lezione.** Il valore è nel bip, nelle schermate
   automatiche e nei file da rileggere dopo.

Chi modifica le espressioni del rilevatore esegua poi
`.venv/bin/python scripts/test_lezione_live.py`: gira senza microfono, senza modello e senza rete.

## Stadio 2 — Trascrizione

```bash
bash scripts/setup.sh          # una volta sola

.venv/bin/python scripts/trascrivi.py "Lezioni/Disegno e colore/2026-09-12-armonie/audio.m4a" \
    --glossario "Lezioni/Disegno e colore/glossario.md"
```

Gira **in locale** con faster-whisper: nessun file esce dal computer, nessun costo a ora, nessun
limite mensile. Produce `trascrizione.md` (blocchi con timestamp), `trascrizione.srt` e
`trascrizione.txt`.

**Scelta del modello** — `--modello`, default `large-v3-turbo`. Con GPU pochi minuti per un'ora di
audio; su sola CPU da venti minuti a oltre un'ora; `small` è più veloce ma sui termini tecnici di
moda sbaglia molto di più, quindi va bene solo per la diretta.

### Il glossario: la leva che conta di più

È il punto in cui questo skill si ripaga. Senza glossario, "pied-de-poule" diventa "pié di pull" e
"Comme des Garçons" diventa "come de garson", in ogni lezione, per tre anni.

`references/glossario-base.md` è il punto di partenza già pronto: termini tessili, confezione,
modellistica, progetto, software e nomi ricorrenti. Alla prima lezione di un corso va **copiato
come `glossario.md` nella cartella del corso e sfoltito**: un glossario di 60 voci giuste rende
più di uno di 300 generiche.

Whisper legge solo i primi 850 caratteri circa, quindi l'ordine conta: in testa i forestierismi e
i nomi propri, che sono quelli che sbaglia. Il file intero viene invece usato nello stadio 3, dove
serve a correggere ciò che è passato comunque storpiato.

Dopo ogni trascrizione, **proporre di aggiungere le voci nuove** comparse. Il glossario migliora da
solo lezione dopo lezione ed è l'unica cosa che va curata a mano.

## Stadio 3 — Elaborazione

Leggere la trascrizione e produrre i materiali. Formati esatti in `references/formati-output.md`:
leggerlo prima di scrivere il primo file.

Cosa produrre, per tipo di corso:

| Tipo di corso | Output utili | Output inutili |
|---|---|---|
| Progetto (moda, tessile, laboratorio) | riassunto, riferimenti, scadenze | flashcard, quiz |
| Teorici (storia, semiotica, brand identity) | riassunto, mappa, flashcard, riferimenti | scadenze, se non ci sono consegne |
| Tecnici (disegno, colore, software) | riassunto, glossario, riferimenti | flashcard, salvo nomenclatura da sapere a memoria |

### Regole che valgono per tutti gli output

1. **Solo ciò che il docente ha detto.** Niente integrazioni con conoscenza generale sulla moda
   senza dichiararle: `> [integrazione, non detta a lezione]`.
2. **Timestamp come riferimento.** Ogni sezione porta il minuto da cui viene, `[00:14:30]`. È ciò
   che permette di riascoltare e, nella biblioteca, di saltarci con un clic.
3. **Legare parola e immagine.** Quando in quel punto esiste una schermata o una foto, citarne il
   percorso nel riassunto. È l'unico modo per ricollegarle mesi dopo.
4. **Mai inventare un nome.** Se il riferimento non è identificabile con certezza, riportarlo come
   suonava e marcarlo `⚠️ da verificare`. Un designer sbagliato in una tesina è peggio di un buco.
5. **Le consegne si riportano testuali**, con il minuto in cui sono state annunciate. Se non ne ha
   dette, lasciare vuoto: non dedurle.
6. **Niente riempitivi.** Via ripetizioni, "allora", aneddoti, pause. Restano le domande degli
   studenti che hanno avuto una risposta di contenuto.
7. **Correggere con il glossario.** Prima di scrivere, passare la trascrizione contro il
   `glossario.md` del corso e sistemare i termini storpiati.

### Lavorare su più lezioni

Per il quadro di un corso o la preparazione di un esame, leggere i `riassunto.md` e i
`riferimenti.md` di tutte le lezioni (non le trascrizioni grezze, troppo lunghe) e produrre
`quadro-corso.md`. I riferimenti che tornano in più lezioni sono quelli su cui il docente sta
costruendo il corso.

## Stadio 4 — La biblioteca

```bash
.venv/bin/python scripts/biblioteca.py Lezioni/
```

Apre tutto il materiale nel browser, su `127.0.0.1`: legge la cartella così com'è, non copia e non
converte niente, e non espone nulla in rete. Solo libreria standard di Python, nessuna dipendenza.

- **Indice** dei corsi con le pastiglie di cosa manca ancora: è la lista delle cose da fare.
- **Pagina lezione** con lettore audio e una scheda per materiale.
- **Galleria immagini** subito dopo il riassunto, perché in un corso di progetto le immagini sono
  il contenuto. Raccoglie `schermate/` e `foto/`, in ordine di lezione. Le foto rinominate
  `hh-mm-ss` diventano cliccabili sull'audio come le schermate.
- **Timestamp cliccabili ovunque**: da `[00:23:10]` si salta a quel punto della registrazione. Il
  server risponde alle richieste Range, quindi il salto è immediato anche su due ore di audio.
- **Ricerca** su tutti i corsi, con il risultato che porta al minuto giusto. È il modo pratico per
  rispondere a "chi era quel designer che aveva citato a ottobre".

Chi modifica rendering o rotte esegua poi `.venv/bin/python scripts/test_biblioteca.py`: monta un
corpus finto, avvia il server e fa richieste HTTP vere.

## Se l'utente non vuole installare niente

Esiste la via senza codice: registrazione dal telefono e caricamento su NotebookLM, che accetta
anche i PDF delle slide. Confronto, limiti, e cosa fare quando non capisce un passaggio:
`references/strumenti-pronti.md`.
