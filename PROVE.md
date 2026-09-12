# Prima settimana di prova

Il sistema è tarato su **come immagino** che si svolgano le tue lezioni. Le frasi che il
rilevatore cerca, i termini nel glossario, la forma dei riassunti: sono ipotesi ragionevoli, non
dati. Per personalizzarlo davvero serve una cosa sola, che non richiede di programmare niente:
**usarlo su lezioni vere e riportare indietro cinque cose**.

Non serve che risolvi i problemi. Serve che li fotografi.

---

## Cosa provare, in ordine

Ogni passo funziona anche se non fai i successivi. Fermati dove arrivi.

### 1. Il piano, oggi stesso — 10 minuti, nessuna installazione

```bash
cd sbobina-lezioni
python3 scripts/piano.py init
```

Apri `piano.json` e sostituisci l'esempio con i tuoi corsi veri e le scadenze che hai già. Poi:

```bash
python3 scripts/piano.py agenda
python3 scripts/piano.py materiali
python3 scripts/piano.py controlla
```

- [ ] I corsi con nome, CFA, se danno voto o idoneità, e l'orario settimanale
- [ ] Almeno due scadenze vere, con la stima di quanti giorni serve lavorarci
- [ ] Almeno un materiale da comprare, con quanto ci mette ad arrivare

### 2. Una lezione registrata — la prova che conta di più

Registra una lezione col telefono, anche solo mezz'ora. Poi:

```bash
bash scripts/setup.sh
.venv/bin/python scripts/trascrivi.py "audio.m4a" --glossario "glossario.md"
```

- [ ] Segna quanto ci ha messo il tuo computer, e se si è scaldato o rallentato
- [ ] Leggi venti righe a caso della trascrizione e segna **cosa ha sbagliato**

### 3. La biblioteca

Metti la lezione in `Lezioni/<Corso>/<AAAA-MM-GG-titolo>/` e lancia:

```bash
python3 scripts/biblioteca.py Lezioni
```

- [ ] Aggiungi qualche foto in `foto/`, rinominandone almeno una `hh-mm-ss` per vedere il salto
      sull'audio
- [ ] Prova la ricerca con un nome citato a lezione

### 4. La modalità live, per ultima

Solo dopo che il resto funziona, e solo in una lezione in cui non ti crea ansia provarla.

```bash
.venv/bin/python scripts/lezione_live.py --uscita "cartella-lezione" --suono
```

- [ ] Guarda `avvisi.md` a fine lezione: quante volte ha suonato a vuoto, e quante volte
      **avrebbe dovuto suonare e non l'ha fatto**

---

## Le cinque cose da riportare indietro

Queste sono quelle che permettono di migliorare il sistema. Basta incollarmele in chat.

### 1. Il file `avvisi.md` di una lezione vera
È il più prezioso in assoluto. Mi dice come parlano davvero i tuoi docenti, e da lì correggo le
frasi che il rilevatore cerca. In questo momento cerca "guardate questo drappeggio" perché l'ho
immaginato io.

### 2. Venti righe di trascrizione grezza, con i termini sbagliati
Non correggerle. Mi servono **sbagliate**: da lì ricavo le voci da mettere in cima al glossario.

### 3. Che cosa ti aspettavi di trovare nel riassunto e non c'era
La domanda vera è: dopo aver letto il riassunto, cosa sei dovuto andare a cercare altrove?

### 4. Come funzionano davvero le consegne nei tuoi corsi
Il piano presuppone revisioni con una data e una lista di cose da portare. Se allo IAAD funziona
diversamente, il modello dei dati va cambiato prima di costruirci l'interfaccia sopra.

### 5. Per l'interfaccia: cosa hai aperto più volte
Mentre usi la biblioteca, segna quale scheda riapri di continuo e quale non guardi mai. E una
frase su cosa avresti voluto fare e non si poteva. Questo decide come sarà fatta la grafica, molto
meglio di qualsiasi ipotesi.

---

## Cosa puoi personalizzare da solo, senza programmare

Tre cose sono **dati, non codice**, e valgono più di metà della personalizzazione:

- **`glossario.md` di ogni corso.** Copia `references/glossario-base.md`, togli quello che non ti
  riguarda, aggiungi i termini e i nomi che sentì davvero. È la leva singola più efficace.
- **`piano.json`.** Corsi, orario, scadenze, materiali, tempi di consegna dei fornitori che usi.
- **Le stime di `giorni_lavoro`.** Dopo due o tre consegne saprai quanto ci metti davvero, e le
  correggi. Il sistema diventa utile esattamente quando queste stime diventano tue.

Per tutto il resto, riportami i cinque punti qui sopra e lo sistemo io.
