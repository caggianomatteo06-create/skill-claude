# Alternative già pronte (senza scrivere codice)

Panoramica per rispondere quando l'utente chiede "non esiste qualcosa di già fatto?". Prezzi e
funzioni verificati a settembre 2026: vanno ricontrollati prima di darli per certi, cambiano spesso.

## Il criterio per scegliere

La domanda non è quale strumento trascrive meglio: sotto la superficie usano quasi tutti lo stesso
motore (Whisper o derivati) e in italiano si equivalgono. La domanda è **dove finisce il testo**.

- Se il testo resta dentro la piattaforma, si elabora solo come decide lei, e il giorno che cambia
  prezzo o chiude, tre anni di lezioni se ne vanno con lei.
- Se il testo è un file sul disco, si rielabora all'infinito e con qualsiasi strumento.

Per questo lo skill usa la trascrizione locale: il file resta dell'utente. Le piattaforme qui sotto
hanno comunque senso in due casi, la mancanza di un computer capace e il bisogno di trascrizione
dal vivo durante la lezione.

## Tutto-in-uno (trascrizione + materiali di studio)

**NotebookLM** (Google) — la più sensata da provare per prima, ed è gratuita. Si caricano audio,
PDF delle slide e appunti nello stesso quaderno, e produce riassunti, mappa mentale interattiva,
guida allo studio, quiz, flashcard e un "audio overview" in forma di podcast a due voci. Supporta
l'italiano. Funziona bene proprio perché incrocia audio della lezione e slide del docente. Limiti:
tetto al numero di fonti per quaderno nel piano gratuito, e il materiale resta dentro Google.

**Algor Education** — italiano, costruito per studenti, converte l'audio in mappe concettuali,
riassunti e flashcard. Più orientato alla mappa concettuale vera e propria rispetto a NotebookLM.
Modello freemium.

**Otter.ai, Notta, Fireflies** — nati per le riunioni aziendali. Trascrizione dal vivo e riassunti
automatici, ma il taglio è "action item e decisioni prese", non "concetti spiegati". Otter in
particolare rende molto meno in italiano che in inglese.

## Solo trascrizione (poi si elabora dove si vuole)

Sono la via di mezzo onesta: restituiscono un file di testo scaricabile, che è quello che serve.

**Registratore del telefono con trascrizione integrata**: su iPhone i Memo Vocali trascrivono in
italiano, su Pixel il Registratore fa lo stesso, su Samsung c'è la funzione equivalente. Gratis, già
installato, e su lezioni con audio pulito il risultato è più che sufficiente. È il modo più rapido
per iniziare oggi stesso senza installare nulla.

**Transkriptor, TurboScribe, Happy Scribe**: caricamento del file e download del testo, a consumo o
ad abbonamento, con diarizzazione (chi parla) che i registratori del telefono non hanno.

## Via API, per chi automatizza

Se il computer non regge Whisper in locale, la stessa pipeline dello skill può chiamare un servizio
esterno cambiando solo lo stadio 2. Costo indicativo per un'ora di audio, a settembre 2026:

| Servizio | Costo / ora |
|---|---|
| AssemblyAI (batch) | circa 0,12–0,21 $ |
| Deepgram (batch) | circa 0,26 $ |
| OpenAI Whisper API | circa 0,36 $ |
| Whisper in locale | 0 $ |

Un semestre serio sono circa 300 ore di lezione: fra i 35 e i 110 dollari all'anno contro zero, in
cambio di non far girare niente sul proprio computer. I servizi a pagamento aggiungono però la
diarizzazione e vanno molto più veloci di una CPU.

## Quando lo strumento a valle non capisce

Domanda che arriva presto: e se NotebookLM (o qualunque altro) non capisce un passaggio?

Quasi sempre non è lui a non capire. NotebookLM è **ancorato alle fonti**: ogni affermazione che
produce è legata a un passaggio preciso del materiale che gli hai dato, e se la risposta non è
nelle fonti dice che non la trova invece di inventarla. Il che significa che capisce benissimo
quello che gli arriva. Se gli è arrivata una trascrizione storpiata dell'audio, cita fedelmente
una frase storpiata, con la stessa sicurezza di una giusta.

**Il controllo che hai dall'interno**: le citazioni. Clicca su una frase del riassunto e guarda il
passaggio della fonte da cui viene. Se quel passaggio è incomprensibile, hai trovato il problema.
È l'unico segnale disponibile, e va usato su tutto ciò che si intende studiare davvero.

**Il segnale che non hai**: nessun avviso di bassa confidenza. Non esiste un "questo pezzo di
audio non l'ho capito", e un "non è nelle fonti" non distingue fra *il docente non l'ha detto* e
*l'ho trascritto male*.

**Rimedi restando dentro la piattaforma:**

- Aggiungere fonti invece di insistere sull'audio: il PDF delle slide del docente, il capitolo del
  libro, gli appunti presi a mano. In un corso di moda è la mossa che conta di più, perché le slide
  contengono i nomi scritti giusti, che l'audio non può dare.
- Chiederglielo esplicitamente: *"quali passaggi delle fonti sono incoerenti o sembrano trascritti
  male?"*. Legge il testo, quindi sa rispondere.
- Quello che non si può fare: correggere la trascrizione, o dargli un glossario che sistemi
  "le beg" in "Lebesgue". Il testo è dentro la piattaforma e non si tocca.

**Il rimedio vero è non dargli l'audio.** Dagli la trascrizione prodotta in locale:

1. il glossario di corso corregge termini tecnici e nomi di designer *prima* che entrino nel testo;
2. il file è dell'utente, quindi una sostituzione sistema tutte le occorrenze di un errore insieme;
3. `avvisi.md` della modalità live indica già quali passaggi hanno confidenza bassa: si correggono
   quelli, non si rileggono due ore di trascrizione;
4. il testo pesa molto meno dell'audio e sta comodamente nei limiti di fonti del piano gratuito.

La regola generale da trasmettere: ogni strumento a valle vale quanto il testo che riceve.
La fatica va spesa una volta sola sulla trascrizione, non ripetuta a ogni elaborazione.

## Cosa consigliare, in pratica

1. **Per iniziare stasera, senza installare niente**: registratore del telefono, poi il file audio
   caricato su NotebookLM.
2. **Per fare la cosa per bene e tenersi il dato**: la pipeline dello skill, con Whisper in locale.
3. **Le due cose non si escludono**: la trascrizione prodotta in locale si può comunque caricare su
   NotebookLM come fonte testuale, che pesa molto meno dell'audio e si incrocia con le slide.

## Fonti

- [Le 5 migliori app per registrare le lezioni per studenti](https://www.happyscribe.com/blog/5-best-lecture-recorder-apps-for-students)
- [Sbobinare file audio: le migliori app con AI](https://www.algoreducation.com/it/blog/sbobinare-file-audio)
- [NotebookLM 2026 Guide: Features, Tools & Best Practices](https://www.geeky-gadgets.com/notebooklm-complete-guide-2026/)
- [How to Use NotebookLM for Studying: Full 2026 Guide](https://ainativestudent.com/blog/how-to-use-notebooklm-for-studying-2026/)
- [Best Speech-to-Text APIs in 2026](https://deepgram.com/learn/best-speech-to-text-apis-2026)
- [Speech-to-Text APIs in 2026: Benchmarks, Pricing, and a Developer's Decision Guide](https://futureagi.com/blog/speech-to-text-apis-in-2026-benchmarks-pricing-developer-s-decision-guide/)
- [How Accurate Is Whisper? 2026 WER Data by Language & Condition](https://vexascribe.com/how-accurate-is-whisper)
- [Whisper Large-v3 vs Turbo (2026): Speed, WER & Cost Compared](https://vexascribe.com/whisper-large-v3-vs-turbo)
