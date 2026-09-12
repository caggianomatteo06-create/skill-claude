# Registrare: cosa serve davvero e cosa si perde

Guida da usare quando l'utente chiede con cosa registrare o teme di perdersi dei pezzi.

## Quello che si perde non è l'audio

È la domanda giusta posta sulla cosa sbagliata. In un'aula normale il telefono sul banco prende la
voce del docente in modo più che sufficiente: Whisper regge rumore di fondo, colpi di tosse e
banchi che cigolano. Quello che l'audio non conserva è tutto il resto:

- **La lavagna e le slide.** Il docente scrive una formula e dice "questo qui è il termine che ci
  interessa". Nella trascrizione resta "questo qui", e non significa niente.
- **I gesti.** "Da qui a qui l'integrale cresce" indicando un grafico.
- **La matematica letta a voce.** "a con n che tende a infinito" è ambiguo persino per una persona.
- **Le domande dal fondo dell'aula.** Spesso inudibili; la risposta del docente resta monca.

Nessun microfono migliore risolve questi quattro problemi. Si risolvono catturando anche il canale
visivo, ed è esattamente il motivo per cui esiste `scripts/lezione_live.py`: avvisa nel momento in
cui sta succedendo, così si fotografa la lavagna mentre è ancora scritta.

## Scala delle soluzioni, dal minimo al massimo

**1. Telefono sul banco.** Gratis, sufficiente nella grande maggioranza dei casi. Microfono verso
il docente, non coperto dalla mano né dentro lo zaino. Primi banchi se l'aula è grande.

**2. Telefono più foto della lavagna.** Il salto di qualità più grande, e costa zero. Ogni volta
che il docente scrive qualcosa, una foto. Il nome del file contiene già l'ora, quindi si allinea
da sé con i timestamp della trascrizione.

**3. Microfono lavalier con clip.** Venti o trenta euro, jack o USB-C. Appoggiato sul bordo del
banco davanti, non sul tavolo sotto il portatile. Serve davvero solo in aule molto grandi, molto
riverberanti, o con un docente che parla piano o si muove continuamente.

**4. Portatile con `lezione_live.py`.** Registrazione, trascrizione in diretta e avvisi su cosa
fotografare. Consuma batteria, quindi meglio con alimentatore per lezioni lunghe.

**5. Lezione online.** Qui non si perde niente: audio pulito dalla sorgente e `--schermo` che
salva l'inquadratura delle slide nel momento esatto in cui il docente le indica. È la
configurazione in cui tutto questo rende al massimo.

Il registratore digitale dedicato non entra in questa scala: costa più del lavalier e, per una
lezione trascritta automaticamente, non aggiunge nulla che conti.

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
