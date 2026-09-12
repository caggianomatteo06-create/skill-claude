# Il piano — modello dei dati

Tutto sta in un solo file, `piano.json`, accanto alla cartella `Lezioni/`. È testo: si legge, si
modifica a mano e si mette in un backup come qualsiasi altro file.

**Chi lo scrive.** Quasi sempre Claude, su richiesta a voce dell'utente: *"il prof ha detto che per
venerdì servono tre campioni"*. Aggiungere la voce al file, non rispondere soltanto. Dopo ogni
modifica eseguire `piano.py controlla`.

Le date sono sempre `AAAA-MM-GG`. Le chiavi (`textile-1`, `rev-campioni`) sono identificatori
brevi, minuscoli, senza spazi né accenti: si scrivono a mano nei comandi.

## `impostazioni`

```json
{ "valore_lode": 30, "cfa_totali": 180, "obiettivo_media": 27 }
```

`valore_lode` è quanto vale la lode nel calcolo interno. Il valore predefinito è 30. Alcuni
regolamenti la contano di più: se l'utente lo sa, si cambia qui, altrimenti si lascia 30 e **non
si inventa**.

## `corsi`

```json
"textile-1": {
  "nome": "Textile Design 1",
  "cfa": 8,
  "docente": "",
  "anno": 1,
  "semestre": 1,
  "valutazione": "voto",
  "cartella": "Textile Design",
  "orario": [{ "giorno": "lunedì", "dalle": "09:00", "alle": "13:00", "aula": "A2" }]
}
```

- `valutazione` vale `"voto"` oppure `"idoneita"`. **Le idoneità contano per i CFA acquisiti ma
  non entrano nella media.** Sbagliare questo campo falsa tutti i calcoli: nel dubbio chiedere.
- `cartella` collega il corso alla sua cartella dentro `Lezioni/`.
- `orario` è la settimana tipo, una riga per slot. `giorno` in minuscolo e per esteso.

## `impegni`

Tutto ciò che ha una data: revisioni, consegne, esami.

```json
{
  "id": "rev-campioni",
  "corso": "textile-1",
  "tipo": "revisione",
  "titolo": "Tre campioni cuciti sullo sbieco",
  "quando": "2026-09-24",
  "ora": "14:00",
  "giorni_lavoro": 6,
  "materiali": ["crepe", "filo-seta"],
  "stato": "aperto",
  "note": "appesi almeno 24h prima"
}
```

- `tipo`: `revisione`, `consegna`, `esame`, `altro`.
- `giorni_lavoro` è **la stima di quanti giorni serve lavorarci**, e da qui esce la data entro cui
  cominciare. È il campo che trasforma un calendario in una pianificazione. Se l'utente non lo sa,
  proporre una stima e dirgli che è una stima; se la rifiuta, mettere 0 e l'impegno comparirà senza
  indicazione di inizio.
- `stato`: `aperto` oppure `fatto`. Si chiude con `piano.py fatto <id>`, che aggiunge `chiuso_il`.

## `materiali`

```json
"crepe": {
  "nome": "Crêpe de chine, 1,5 m",
  "dove": "fornitore online",
  "giorni_approvvigionamento": 7,
  "costo": 34,
  "stato": "da comprare"
}
```

- `giorni_approvvigionamento` è **quanto ci mette ad arrivare**: spedizione, tempi della copisteria,
  giorni di apertura del mercato tessuti. È la ragione per cui questa sezione esiste.
- `stato`: `da comprare`, `ordinato`, `disponibile`. Solo `disponibile` toglie il materiale dalla
  lista della spesa.
- La data limite per ordinare è `scadenza − giorni_lavoro − giorni_approvvigionamento`: il
  materiale deve esserci **prima di cominciare**, non il giorno della consegna.
- Un materiale usato da più impegni segue la scadenza più vicina.

## `voti`

```json
{ "corso": "storia", "voto": 30, "lode": true, "data": "2026-02-10" }
```

Per le idoneità: `"voto": null`. Un corso può comparire una volta sola; per correggere un voto si
modifica la riga esistente, e `piano.py voto` rifiuta i doppioni apposta.

## Come vengono calcolate le medie

- **Media ponderata**: `Σ(voto × CFA) / Σ(CFA)`, sulle sole prove con un voto numerico.
- **Media aritmetica**: senza pesi. Si riporta perché alcuni regolamenti la usano, ma quella che
  conta quasi sempre è la ponderata.
- **Proiezione in centodecimi**: `media × 110 / 30`. È soltanto la media riportata in scala. I
  punti per tesi, lodi e durata degli studi dipendono dal regolamento dell'istituto: **non vanno
  stimati né inventati**, e il comando lo dichiara ogni volta.
- **Voto necessario**: da `(S + v·c) / (C + c) ≥ M` segue `v ≥ (M·(C + c) − S) / c`, dove `S` è la
  somma pesata attuale, `C` i CFA che già fanno media, `c` i CFA futuri, `M` l'obiettivo. Se il
  risultato supera 30 l'obiettivo non è raggiungibile, e il comando dice qual è il massimo.

## Comandi

| Comando | A cosa risponde |
|---|---|
| `piano.py agenda` | Cosa arriva, cosa è scaduto, da quando lavorarci |
| `piano.py oggi` | Lezioni di oggi e impegni da far partire |
| `piano.py materiali` | Cosa comprare, entro quando ordinarlo, quanto si spende |
| `piano.py media` | Media attuale, CFA, proiezione, massimo ancora possibile |
| `piano.py serve --obiettivo 27` | Che voto serve negli esami che restano |
| `piano.py serve --obiettivo 27 --corso textile-1` | Che voto serve in quel singolo esame |
| `piano.py fatto <id>` | Chiude un impegno |
| `piano.py voto <corso> 28 --lode` | Registra un voto |
| `piano.py controlla` | Cerca incoerenze prima che facciano danni |

Tutti accettano `--piano <file>` e `--oggi AAAA-MM-GG`, quest'ultimo utile per rispondere a
domande del tipo "come sarà la situazione fra due settimane".
