# Formati degli output di studio

Template per lo stadio 3, tarati su un corso di progetto in Textile & Fashion Design. Rispettare
la struttura: serve a rendere confrontabili le lezioni e a permettere il quadro d'insieme a fine
semestre.

La differenza rispetto a un corso teorico: qui il contenuto è in gran parte **visivo e operativo**.
Quello che conta ritrovare fra tre mesi non è la definizione, è *quale immagine ha mostrato*,
*quale tessuto ha fatto girare per l'aula* e *cosa bisogna consegnare venerdì*.

---

## `riassunto.md`

Il file principale. Lunghezza indicativa: un decimo della trascrizione.

```markdown
# <Corso> — <Titolo della lezione>
<data> · durata <hh:mm> · [trascrizione](trascrizione.md) · [riferimenti](riferimenti.md)

## In due righe
<Cosa si è fatto oggi e perché, in due frasi. Deve bastare a chi rilegge fra tre mesi.>

## Contenuti

### <Primo argomento> [00:04:15]
<Spiegazione in prosa, ripulita dal parlato.>

- **In pratica**: <la parte operativa, come si fa>
- **Mostrato in aula**: <cosa si vedeva mentre lo diceva> → `schermate/00-04-20.png`

### <Secondo argomento> [00:22:40]
...

## Materiali e tecniche citati
| Cosa | Detto a proposito di | Minuto |
|---|---|---|
| crêpe de chine | caduta sullo sbieco | [00:31:10] |

## Consegne e revisioni
- **[01:12:05]** Per <data>: <cosa portare>, <formato>, <supporto>.
- ⚠️ Se il docente non ha detto scadenze, lasciare vuoto. Non dedurle.

## Domande in aula
- **D** [00:55:00]: <domanda>
  **R**: <risposta del docente>

## Da chiarire
- ⚠️ [00:38:20] Audio poco chiaro: <cosa manca>
- Il docente ha citato "<termine>" senza definirlo.
- Riferimento nominato ma non identificato con certezza: <come suonava nella trascrizione>
```

Regole sul contenuto:

- **"Mostrato in aula" è la riga più importante.** Se in quel punto esiste una schermata o una foto,
  citarne il percorso: è l'unico modo per ricollegare parola e immagine mesi dopo.
- **Consegne e revisioni** vale più del resto del file messo insieme. Riportarle testuali.
- **Da chiarire** non è un difetto: è la lista delle cose da chiedere alla prossima revisione.
- Non trasformare una lezione di progetto in una lezione teorica: se il docente ha passato mezz'ora
  a commentare immagini, il riassunto deve dire *quali* e *cosa ha detto di ciascuna*, non
  ricostruire una teoria che non ha esposto.

---

## `riferimenti.md`

L'indice dei nomi. In un corso di moda è il file che si riapre più spesso, perché i riferimenti
tornano da una lezione all'altra e nessuno se li ricorda tutti.

```markdown
# Riferimenti — <Titolo della lezione>

| Chi o cosa | Minuto | Detto a proposito di | Dove ritrovarlo |
|---|---|---|---|
| Madeleine Vionnet | [00:12:30] | invenzione del taglio in sbieco | `schermate/00-12-35.png` |
| Comme des Garçons, Body Meets Dress 1997 | [00:41:00] | volume che deforma il corpo | da cercare |
| mostra al Palazzo Madama | [01:05:00] | visita consigliata entro dicembre | — |
```

Regole:

- **Scrivere il nome come lo si cercherebbe**, non come l'ha trascritto Whisper. "comme de garson"
  va corretto in "Comme des Garçons".
- Se il nome non è identificabile con certezza, riportarlo com'era e marcarlo `⚠️ da verificare`.
  Mai inventare il designer che "probabilmente intendeva".
- Collezione e stagione quando ci sono: `Primavera Estate 1997` vale molto più del solo nome.
- Aggiungere ogni nome nuovo anche al `glossario.md` del corso: da lì in poi Whisper lo trascrive
  giusto.

---

## `scadenze.md`

Un solo file per corso, non per lezione. Si aggiorna, non si riscrive.

```markdown
# Consegne — <Corso>

## Prossime
- [ ] **<data>** — <cosa>, <formato>, <come consegnare>. Detto il <data lezione> [01:12:05].

## Fatte
- [x] **<data>** — <cosa>.

## Note del docente sulle revisioni
- <criteri di valutazione, se li ha esposti>
```

Ogni voce porta il timestamp della lezione in cui è stata annunciata, così si può riascoltare
com'era stata formulata quando il dubbio nasce la sera prima.

---

## `mappa.md`

Elenco puntato annidato, compatibile con [markmap](https://markmap.js.org) e leggibile così com'è.
Utile soprattutto nei corsi di storia, semiotica e brand identity, dove le relazioni contano più
delle singole nozioni.

```markdown
# Mappa — <Titolo della lezione>

## <Macro-argomento>
### <Concetto o corrente>
- <carattere distintivo>
- <carattere distintivo>
#### <Autore o maison>
- collegamento: reagisce a <altro concetto> perché ...
```

Massimo quattro livelli. Le **relazioni** vanno scritte esplicitamente (deriva da, reagisce a,
anticipa, cita): senza, la mappa è solo un indice rientrato.

---

## `flashcard.csv`

Solo per i corsi in cui si viene interrogati su nozioni: storia della moda, semiotica del design,
teoria del colore, merceologia tessile. Per i corsi di progetto non servono, e farle è tempo perso.

CSV con virgolette, tre colonne, senza intestazione: `fronte,retro,tag`.

```csv
"Chi introduce il taglio in sbieco, e quando?","Madeleine Vionnet, negli anni Venti.","storia lez03"
"Che effetto ha lo sbieco sul tessuto?","Lo rende elastico nel senso del taglio e ne cambia la caduta.","storia lez03"
```

Come importarle: in Anki, `File → Importa`, separatore virgola, terza colonna su Tag.

Regole: una nozione per carta, il fronte è una domanda, niente carte su ciò che si ricorda
comunque. Da una lezione ne escono 15–25 buone, non 60.

---

## `glossario.md`

Uno per corso, in cima alla cartella del corso. Cresce a ogni lezione ed è la leva che riduce di
più gli errori di trascrizione. Punto di partenza: `glossario-base.md`.

Dopo ogni elaborazione, **proporre le voci nuove** comparse: termini tecnici, nomi di designer,
maison, collezioni, software. Le più frequenti vanno in cima, perché Whisper legge solo l'inizio.

---

## `quadro-corso.md`

Si costruisce dai `riassunto.md` e dai `riferimenti.md`, mai dalle trascrizioni grezze.

```markdown
# <Corso> — quadro d'insieme
Aggiornato al <data> · <n> lezioni

## Dove sta andando il corso
<Il filo del semestre in un paragrafo: da dove è partito, dove sta arrivando.>

## Riferimenti ricorrenti
| Chi o cosa | Lezioni | Perché torna |
|---|---|---|

## Tutte le consegne
<Unione dei file scadenze, in ordine di data.>

## Buchi
- Lezione del <data> non registrata.
- ⚠️ <riferimenti rimasti non identificati, raccolti da tutte le lezioni>
```

I riferimenti che tornano in più lezioni sono quelli su cui il docente sta costruendo il corso:
è lì che si concentra ciò che conta.
