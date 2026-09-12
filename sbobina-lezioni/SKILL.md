---
name: sbobina-lezioni
description: >
  Trasforma le registrazioni delle lezioni universitarie in materiale di studio: trascrizione
  completa con timestamp, riassunti strutturati, mappe concettuali, flashcard per Anki, quiz di
  autoverifica e glossario dei termini. Usa SEMPRE questo skill quando l'utente chiede di
  "sbobinare" una lezione, trascrivere un audio o un video di lezione, ricavare appunti, riassunti,
  schemi, mappe o flashcard da una registrazione, organizzare il materiale di un corso o di un
  esame, oppure chiede come registrare le lezioni, con che attrezzatura, o come seguirle in diretta
  con un assistente. Copre la scelta di cosa usare per registrare, la modalità live che durante la
  lezione avvisa quando il docente indica la lavagna o segnala un argomento d'esame, la trascrizione
  in locale con Whisper senza mandare l'audio a terzi, la correzione della terminologia tecnica
  tramite glossario di corso, e la produzione dei materiali di studio a partire dal testo.
---

# Sbobinare ed elaborare le lezioni universitarie

Pipeline in tre stadi, più una modalità in diretta opzionale. Ogni stadio produce un **file di
testo che resta all'utente**, così il dato è sempre riutilizzabile e non resta chiuso dentro una
piattaforma.

```
registrazione audio  →  trascrizione (.md + .srt)  →  materiali di studio (.md, .csv)
     telefono              scripts/trascrivi.py           riassunto, mappa, flashcard, quiz
        │
        └─ opzionale, durante la lezione: scripts/lezione_live.py
           avvisa in diretta su ciò che dal solo audio andrebbe perso
```

Il valore sta nello **stadio 3**: la trascrizione grezza di una lezione da due ore è lunga
15.000–20.000 parole e nessuno la rilegge. Quello che si studia è ciò che viene dopo.

## Struttura cartelle consigliata

Proporla all'utente la prima volta e poi rispettarla:

```
Lezioni/
  <Corso>/
    glossario.md                     # termini, nomi, sigle del corso (vedi sotto)
    2026-09-12-titolo-lezione/
      audio.m4a                      # registrazione originale, non cancellarla
      trascrizione.md                # output stadio 2
      trascrizione.srt
      riassunto.md                   # output stadio 3
      mappa.md
      flashcard.csv
      quiz.md
      avvisi.md                      # solo se si è usata la modalità live
      domande.md
      schermate/
```

Il nome cartella `AAAA-MM-GG-titolo` tiene le lezioni in ordine cronologico da sole.

## Stadio 1 — Registrazione

Il telefono sul banco basta quasi sempre. **Quello che si perde non è la qualità audio: è la
lavagna, le slide e i gesti.** Il docente scrive una formula e dice "questo qui": nella
trascrizione resta "questo qui", che non significa niente.

Scala delle soluzioni, errori pratici che costano una lezione intera e la prova da fare prima di
fidarsi: `references/registrazione.md`. Leggerlo prima di consigliare attrezzatura.

**Nota da dare all'utente la prima volta, senza farne un caso:** registrare una lezione per uso
personale di studio è normale, ma il permesso del docente va chiesto e il regolamento d'ateneo va
rispettato. Registrazioni e trascrizioni non vanno diffuse: la lezione è opera del docente e in
aula ci sono le voci di altre persone.

## Stadio 1b — Modalità live (opzionale)

`scripts/lezione_live.py` sta acceso durante la lezione: registra, trascrive a finestre di 25
secondi e **avvisa nel momento in cui sta succedendo qualcosa che l'audio da solo non conserva**,
quando c'è ancora tempo per fotografare la lavagna o alzare la mano.

```bash
# in aula, con un bip quando conviene fotografare la lavagna
.venv/bin/python scripts/lezione_live.py --uscita "Lezioni/Analisi/2026-09-12-serie" --suono

# lezione online: cattura da sé lo schermo quando il docente indica le slide
.venv/bin/python scripts/lezione_live.py --uscita "..." --schermo

# prova a freddo su una registrazione già fatta, senza microfono
.venv/bin/python scripts/lezione_live.py --uscita prova --sorgente vecchia-lezione.m4a --veloce
```

### Cosa rileva, e come

**Rilevatore locale**, sempre attivo, gratuito, offline, istantaneo. Cerca nel parlato quattro
famiglie di segnali e un quinto indizio che non viene dalle parole:

| | Segnale | Perché conta |
|---|---|---|
| 📸 | "guardate qui", "questa formula", "come vedete" | Sta parlando di qualcosa che si vede e basta: **fotografalo adesso** |
| ⭐ | "all'esame lo chiedo sempre", "mi raccomando" | Vale più del contenuto stesso |
| 📖 | "come abbiamo visto la scorsa volta", "sul libro" | Materiale esterno da recuperare |
| ❓ | "ci siamo?", "domande?" | La finestra per chiedere si apre adesso |
| ⚠️ | confidenza bassa del modello (`avg_logprob`) | Whisper sta tirando a indovinare: audio da riascoltare |

L'ultima riga è quella che l'utente non si aspetta: il modello dichiara quanto è sicuro di ogni
segmento, e un crollo di confidenza segnala l'audio degradato **senza bisogno di rileggere nulla**.

Gli avvisi finiscono in `avvisi.md` con timestamp, frase che li ha fatti scattare e, con
`--schermo`, la schermata catturata in quell'istante.

**Agente Claude**, opzionale, con `--agente`. Ogni cinque minuti rilegge quello che è stato detto
e scrive in `domande.md`: cosa è stato citato ma non si ricostruisce dall'audio, quali termini
sono stati usati senza mai definirli, quali domande precise fare al docente adesso, quali
passaggi sono da riascoltare. Richiede `ANTHROPIC_API_KEY`. Costo indicativo per una lezione da
due ore, con `claude-opus-5`: circa mezzo dollaro; con `--modello-agente claude-haiku-4-5` circa
un decimo di dollaro, con analisi più superficiali.

Quando l'utente attiva l'agente, dirgli che le richieste usano la protezione automatica contro
i rifiuti del modello (`fallbacks`), attiva per impostazione predefinita.

### Due avvertenze da dare sempre

1. **La diretta usa il modello Whisper piccolo**, perché deve stare al passo con il parlato. La
   sua trascrizione serve a far scattare gli avvisi, non a studiarci. Finita la lezione, **va
   comunque ripassato `trascrivi.py` sull'audio** con il modello grande: è quella la trascrizione
   buona. La modalità live salva l'audio integrale in `audio.wav` apposta.
2. **Non si guarda il terminale durante la lezione.** Il valore è nel bip (`--suono`), nella
   cattura automatica dello schermo (`--schermo`) e nei file da rileggere dopo. Dirlo chiaramente,
   altrimenti l'utente si aspetta di doverlo sorvegliare.

Chi modifica le espressioni del rilevatore in `lezione_live.py` deve poi eseguire
`.venv/bin/python scripts/test_lezione_live.py`: gira senza microfono, senza modello e senza rete.

## Stadio 2 — Trascrizione

Usare `scripts/trascrivi.py`. Gira **in locale** con faster-whisper: nessun file esce dal computer,
nessun costo per ora di audio, nessun limite mensile.

Prima volta:

```bash
bash scripts/setup.sh          # crea .venv e installa faster-whisper
```

Poi, per ogni lezione:

```bash
.venv/bin/python scripts/trascrivi.py "Lezioni/Analisi/2026-09-12-serie-numeriche/audio.m4a" \
    --glossario "Lezioni/Analisi/glossario.md"
```

Produce accanto all'audio: `trascrizione.md` (blocchi con timestamp), `trascrizione.srt`
(sottotitoli, per riascoltare un passaggio) e `trascrizione.txt` (testo continuo).

**Scelta del modello** — `--modello`, default `large-v3-turbo`:

| Situazione | Modello | Tempo indicativo per 1h di audio |
|---|---|---|
| PC con GPU NVIDIA | `large-v3-turbo` | pochi minuti |
| Solo CPU, si ha tempo | `large-v3-turbo` | da 20 min a oltre un'ora |
| Solo CPU, serve in fretta | `small` | qualche minuto, più errori sui termini tecnici |

Se il computer dell'utente non regge, o se vuole i nomi di chi parla (diarizzazione), l'alternativa
è un servizio a pagamento: vedi `references/strumenti-pronti.md`.

### Il glossario di corso: la cosa che cambia di più il risultato

Whisper sbaglia sistematicamente i termini tecnici, i nomi propri e le sigle: "Lebesgue" diventa
"le beg", "STM32" diventa "esse ti emme 32". Si risolve con un file `glossario.md` per corso, che
lo script passa al modello come contesto iniziale.

Alla prima lezione di un corso, crearlo insieme all'utente con i termini che già conosce dal
programma. Dopo ogni trascrizione, **proporre di aggiungere i termini nuovi** che sono comparsi:
il glossario migliora da solo lezione dopo lezione. Formato: una voce per riga, niente altro.

```markdown
# Glossario — Analisi Matematica II
integrale di Lebesgue
teorema di Fubini-Tonelli
successione di Cauchy
prof. Rossi
```

Vanno tenute le 50–80 voci più utili: il modello legge solo l'inizio del glossario, quindi mettere
per prime le più frequenti e le più sbagliate.

## Stadio 3 — Elaborazione (il lavoro vero)

Leggere la trascrizione e produrre i materiali richiesti. Se l'utente non specifica cosa vuole,
proporre riassunto + mappa e chiedere se servono anche flashcard e quiz.

I formati esatti degli output stanno in `references/formati-output.md`: leggerlo prima di scrivere
il primo file.

### Regole che valgono per tutti gli output

1. **Solo ciò che il docente ha detto.** Non integrare con conoscenza generale sull'argomento senza
   dirlo. Se serve un'integrazione perché il passaggio è incomprensibile, marcarla:
   `> [integrazione, non detto a lezione]`.
2. **Timestamp come riferimento.** Ogni sezione del riassunto porta il timestamp da cui viene
   `[00:14:30]`. Serve per riascoltare il punto quando il testo non basta, ed è la differenza tra
   un riassunto utile e uno di cui non ci si fida.
3. **Segnalare l'incerto.** Audio saltato, formula letta a voce, riferimento a una slide che non si
   vede: marcarlo `⚠️ [audio poco chiaro, verificare]` invece di indovinare. Le formule dettate a
   voce sono il caso più frequente: trascriverle in LaTeX e marcarle come da verificare.
4. **Distinguere il peso.** Quando il docente dice "questo all'esame lo chiedo sempre", "questo
   saltatelo", "questo è solo per curiosità", quell'informazione vale più del contenuto stesso:
   raccoglierla in una sezione `## Segnalato dal docente`.
5. **Niente riempitivi.** La trascrizione è parlato: ripetizioni, "allora", "ok ragazzi", aneddoti,
   pause per le domande. Vanno via tutti, tranne le domande degli studenti che hanno avuto una
   risposta di contenuto (quelle diventano una voce del riassunto).

### Lavorare su più lezioni insieme

Quando l'utente chiede un riassunto del corso o prepara un esame, leggere i `riassunto.md` di tutte
le lezioni della cartella corso (non le trascrizioni grezze, sono troppo lunghe) e produrre un
`riassunto-corso.md` con la progressione degli argomenti e i collegamenti tra lezioni. Molte
domande d'esame stanno esattamente lì, nei punti in cui il docente riprende un argomento vecchio.

## Se l'utente non vuole installare niente

Esiste la via senza codice: registrazione dal telefono e caricamento su una piattaforma che fa
trascrizione ed elaborazione insieme. Confronto, limiti e quando conviene:
`references/strumenti-pronti.md`. Il costo è che il materiale resta dentro la piattaforma e si
elabora solo come decide lei.
