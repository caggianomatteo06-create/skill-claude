# Registrare: cosa serve davvero e cosa si perde

Guida da usare quando l'utente chiede con cosa registrare o teme di perdersi dei pezzi.

## Quello che si perde non è l'audio

È la domanda giusta posta sulla cosa sbagliata. In un'aula normale il telefono sul banco prende la
voce del docente in modo più che sufficiente: Whisper regge rumore di fondo, colpi di tosse e
banchi che cigolano. Quello che l'audio non conserva è tutto il resto:

- **Le immagini proiettate.** Collezioni, sfilate, archivi. Il docente dice "guardate questa
  silhouette" e nella trascrizione resta "guardate questa silhouette", che non vale niente.
- **I capi e i campioni.** Un tessuto che gira per l'aula si commenta a gesti: "sentite la mano",
  "vedete come cade". Senza una foto, sparisce.
- **I nomi.** Designer, maison, collezioni e stagioni escono storpiati dalla trascrizione, e un
  nome sbagliato è peggio di un nome mancante perché non ci si accorge dell'errore.
- **Le consegne dette a voce.** "Per la prossima volta tre tavole A3" non è scritto da nessuna
  parte, e chi non l'ha sentito bene lo scopre alla revisione.
- **Le domande dal fondo dell'aula.** Spesso inudibili; la risposta del docente resta monca.

Nessun microfono migliore risolve questi problemi. Si risolvono catturando anche il canale visivo,
ed è esattamente il motivo per cui esiste `scripts/lezione_live.py`: avvisa nel momento in cui sta
succedendo, così si fotografa mentre l'immagine è ancora proiettata e il campione è ancora in giro.

## Scala delle soluzioni, dal minimo al massimo

**1. Telefono sul banco.** Gratis, sufficiente nella grande maggioranza dei casi. Microfono verso
il docente, non coperto dalla mano né dentro lo zaino. Primi banchi se l'aula è grande.

**2. Telefono più foto.** Il salto di qualità più grande, e costa zero. Una foto a ogni immagine
proiettata, a ogni campione che passa, a ogni tavola commentata. Rinominandole `hh-mm-ss` compaiono
nella galleria della biblioteca e diventano cliccabili sull'audio.

**3. Microfono lavalier con clip.** Venti o trenta euro, jack o USB-C. Appoggiato sul bordo del
banco davanti, non sul tavolo sotto il portatile. Serve davvero solo in aule molto grandi, molto
riverberanti, o con un docente che parla piano o si muove continuamente.

**4. Portatile con `lezione_live.py`.** Registrazione, trascrizione in diretta e avvisi su cosa
fotografare e su cosa è appena stato dato come consegna. Consuma batteria, quindi meglio con
alimentatore per le lezioni lunghe. In laboratorio, dove ci si muove e ci si sporca le mani, il
telefono con il bip è più pratico del portatile.

**5. Slide proiettate, con il portatile aperto.** Se le stesse slide sono anche sul proprio
schermo, `--schermo` le salva nel momento esatto in cui il docente le commenta, e il problema
principale sparisce da solo. Vale anche per le lezioni a distanza.

## Hardware, con i numeri

Prima dei modelli, il fatto che decide tutto: **conta la distanza dalla sorgente più di qualunque
microfono**. Il livello della voce cala con il quadrato della distanza, mentre il riverbero
dell'aula resta costante. Dimezzare la distanza vale più di duecento euro di attrezzatura.
Spostarsi dalla nona alla terza fila è l'upgrade più economico che esista.

Detto questo, quando il telefono non basta davvero:

| Categoria | Esempi | Prezzo | Quando serve |
|---|---|---|---|
| Lavalier con filo | Boya BY-M1, Rode SmartLav+ | 20–70 € | Aula grande: si appoggia sul bordo del banco davanti |
| Lavalier wireless | Hollyland Lark M2, DJI Mic Mini, DJI Mic 2 | 140–300 € | Solo se il docente accetta di indossare il trasmettitore |
| Registratore dedicato | Zoom H1essential, Tascam DR-05XP, Sony ICD-PX370 | 60–150 € | Aule molto riverberanti, o per non impegnare il telefono |
| Registratore con AI | Plaud Note e simili | 150–200 € | Trascrive e riassume da sé, ma richiude il dato dentro il suo servizio |

Cosa cambia davvero con un registratore dedicato: microfoni migliori dei capsuli di un telefono,
preamplificatori più silenziosi, dinamica più larga, autonomia da una giornata intera, e nessuna
notifica o telefonata che interrompe la registrazione. È un guadagno reale ma **incrementale**:
migliora il rapporto segnale-rumore, non riporta indietro la lavagna.

Il wireless è la soluzione tecnicamente migliore e praticamente più difficile: chiede di
consegnare un trasmettitore al docente a ogni lezione. Vale la pena solo con un docente
disponibile e un corso lungo.

**Ordine in cui spendere, dal più redditizio:** sedersi davanti (gratis), fotografare la lavagna
(gratis), lavalier con filo, registratore dedicato, wireless. Chi salta i primi due e compra il
quinto ha speso male i suoi soldi.

## Errori pratici che costano una lezione intera

- Batteria scarica a metà lezione. Due ore di registrazione consumano parecchio.
- Spazio esaurito sul telefono. Un'ora occupa dai 30 ai 60 MB.
- Telefono in modalità silenziosa che sospende l'app di registrazione: verificare una volta, con
  una prova da dieci minuti, prima di fidarsi.
- Aver registrato con un'app che tiene il file dentro di sé e non lo esporta. Controllare prima
  che il file audio si possa copiare sul computer.

**La prova a freddo**: registrare dieci minuti della prima lezione, portarli a casa, farli passare
per la pipeline completa. Si scopre in un pomeriggio quello che altrimenti si scoprirebbe a fine
semestre.

## Una regola sul consenso

Chiedere al docente prima di registrare, e guardare il regolamento d'ateneo. Con la modalità live
vale anche una cosa in più: l'agente riceve la trascrizione della lezione, quindi anche eventuali
interventi degli altri studenti. Tenere i file per sé e non diffonderli.
