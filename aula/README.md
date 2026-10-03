# Aula — lezioni, trascrizioni e appunti in un unico posto

Aula è una web app che gira **interamente nel browser**: non c'è niente da installare né un server da mantenere. Ci fai:

- 🎙 **Registrazione della lezione** dal PC o dal telefono, salvata a pezzi ogni 5 secondi: se il browser si chiude o la batteria muore, la registrazione viene recuperata alla riapertura.
- ⤒ **Caricamento audio/video** (mp3, m4a, wav, ogg, webm, anche l'mp4 delle registrazioni Teams).
- 📝 **Trascrizione** in quattro modi diversi (vedi sotto), con i tempi: clicchi una frase e l'audio riparte da lì.
- ✏️ **Appunti in Markdown** collegati al minuto esatto: `Alt+T` inserisce `[[12:34]]`, che poi diventa un pulsante per riascoltare quel punto. ⭐ segna i momenti importanti mentre registri.
- 📎 **Foto, file, slide e link**: foto della lavagna scattate col telefono, PDF del professore, link a video e pagine web. Si possono incollare (`Ctrl+V`) o trascinare, e inserire negli appunti.
- ✨ **Claude**: riassunto, appunti strutturati, domande d'esame, flashcard, concetti difficili, oppure domande libere sulla lezione. Funziona anche senza chiave API, usando il tuo account claude.ai.
- 🔎 **Ricerca** su tutto: titoli, appunti, trascrizioni, allegati, risposte di Claude.
- ☁️ **Sincronizzazione tra PC** tramite una cartella (OneDrive, Google Drive, Dropbox, chiavetta USB) e **backup ZIP**.
- 🕘 **Cronologia degli appunti**: le versioni precedenti vengono conservate, anche quando una sincronizzazione le sostituisce.

---

## Perché prima la trascrizione non funzionava

Claude (sia su claude.ai che via API) **non accetta file audio**: per questo il caricamento falliva. La soluzione è dividere il lavoro in due:

1. **Prima la trascrizione**, fatta da un motore di riconoscimento vocale (Whisper o il browser).
2. **Poi Claude**, che lavora sul testo: riassunti, appunti, domande d'esame.

Aula fa entrambe le cose nello stesso posto.

## Come aprirla

### Online (consigliato)
L'app viene pubblicata su GitHub Pages a ogni push sul branch `main`:

**https://caggianomatteo06-create.github.io/skill-claude/**

La prima volta va attivato GitHub Pages: nel repository vai in **Settings → Pages → Build and deployment → Source: GitHub Actions**. Il workflow `.github/workflows/pages.yml` fa il resto.

### Installala come app
Da Chrome/Edge: icona "Installa" nella barra degli indirizzi. Dal telefono: menu → "Aggiungi a schermata Home". Così si apre come un'app vera, funziona anche offline e il browser protegge meglio i dati dalla pulizia automatica.

> Non aprire `index.html` facendo doppio clic sul file: alcune funzioni (microfono, Whisper) richiedono un indirizzo `https://`.

## Una lezione tipica

1. Apri il corso → **● Registra lezione**.
2. Durante la lezione scrivi appunti. `Alt+T` inserisce il minuto, ⭐ marca un passaggio importante. Fotografa lavagna/slide dal telefono con 📷: le foto vengono collegate al minuto della registrazione.
3. **■ Stop**: la registrazione viene salvata (circa 15 MB per un'ora e mezza).
4. Se la trascrizione live era attiva, ce l'hai già. Altrimenti apri **📝 Trascrizione → 🎙 Trascrivi audio**.
5. **✨ Claude → Appunti strutturati**: Claude integra i tuoi appunti con quello che ha detto il professore. Poi **↳ Aggiungi agli appunti** o **💾 Salva nella lezione**.

## Trascrizione: quale scegliere

| Modo | Costo | Velocità | Qualità in italiano | Note |
|---|---|---|---|---|
| **Dal vivo** (mentre registri) | gratis | in tempo reale | discreta | Chrome/Edge, serve internet. Si attiva dalle Impostazioni. |
| **Nel browser** (Whisper Small) | gratis | 15-40 min per 1 h di audio su un portatile, molto meno con una GPU | buona | Privata: l'audio non lascia il PC. La prima volta scarica il modello (~250 MB), poi funziona offline. |
| **Cloud** (Groq, Whisper Large v3 Turbo) | gratis con limiti giornalieri | < 1 min per 1 h | ottima | Serve una chiave gratuita da [console.groq.com](https://console.groq.com) → API Keys. Va bene anche OpenAI. |
| **Importa** | — | subito | quella della fonte | File `.vtt`/`.srt` di Teams/Zoom/YouTube, oppure testo incollato con o senza `[mm:ss]`. |

Consiglio pratico: **trascrizione live durante la lezione** per avere subito qualcosa, poi a casa **Cloud** (o Whisper nel browser) per la versione buona, che sostituisce quella live.

## Claude

- **Senza chiave API**: ogni pulsante copia negli appunti del PC il materiale della lezione (appunti, trascrizione, link) con le istruzioni, e apre claude.ai. Tu incolli (`Ctrl+V`) e invii. Usa il tuo abbonamento Claude.
- **Con chiave API** ([console.anthropic.com](https://console.anthropic.com), si paga a consumo): le risposte arrivano direttamente nell'app, in streaming, e Claude vede anche **foto della lavagna e PDF** della lezione. Modello predefinito: Claude Opus 5.5, si può scegliere Sonnet 5.5 o Haiku 4.5 per spendere meno.
- I minuti citati da Claude (`[12:30]`) sono cliccabili e fanno ripartire l'audio da lì.

## Il PC dell'università

Aula non ha un server: i dati stanno nel browser del dispositivo in cui la usi. Per ritrovarli su un altro PC ci sono tre strade, dalla più comoda alla più universale.

### 1. Cartella sincronizzata (consigliata)
**Impostazioni → ☁️ Sincronizzazione → 📁 Scegli cartella.** Scegli una cartella dentro un servizio che hai su entrambi i PC:

- **OneDrive**: quasi tutte le università danno Microsoft 365 con OneDrive. Sul PC dell'università di solito è già presente in Esplora file.
- **Google Drive per desktop**, **Dropbox**, oppure una **chiavetta USB** (in questo caso la "sincronizzazione" la fai tu portandola con te).

Aula ci scrive:
```
Aula/
├── aula-data.json        ← tutti i dati (corsi, lezioni, appunti, trascrizioni)
├── media/                ← audio, foto, file
└── Appunti/<Corso>/      ← ogni lezione anche in Markdown, leggibile senza Aula
```
Sull'altro PC apri Aula e collega **la stessa cartella**. Da lì la sincronizzazione è automatica (pochi secondi dopo ogni modifica e ogni volta che torni sulla scheda). Quando riapri il browser, Chrome può chiederti di cliccare **🔓 Riconnetti** (in basso a sinistra) per ridare il permesso sulla cartella: scegli "Consenti a ogni visita" e non te lo chiederà più. Se modifichi la stessa lezione su due PC vince la modifica più recente, e l'altra versione degli appunti resta nella **🕘 Cronologia**.

Gli audio vengono letti dalla cartella solo quando servono: su un PC con poco spazio non copi tutto in locale.

Serve **Chrome o Edge** (Firefox e Safari non permettono a un sito di usare una cartella del PC).

### 2. Backup ZIP (funziona ovunque)
**Impostazioni → 📦 Esporta tutto** crea un unico file `.zip`. Sull'altro PC: **⤓ Importa backup**. L'importazione unisce i dati e non sovrascrive niente di più recente. Il file si può passare con Drive/OneDrive dal sito web, via email, con una chiavetta...

Dal menu **⋯** di una lezione puoi esportare **solo quella lezione**. È il modo più comodo per passare al PC una lezione registrata col telefono.

### 3. Telefono come registratore
Apri Aula sul telefono (installala come app), registra la lezione e scatta le foto. Poi:
- **⋯ → Esporta questa lezione** e importala sul PC, oppure
- registra con l'app registratore del telefono e carica il file in Aula sul PC.

### Su un PC condiviso o pubblico
- In **Impostazioni → 🔐 PC condiviso** togli la spunta a "Ricorda le chiavi API": le chiavi restano solo finché la scheda è aperta.
- Quando hai finito: **🧹 Cancella tutti i miei dati da questo browser**. Se c'è una cartella collegata, Aula prima sincronizza e poi cancella.
- Se il PC si azzera da solo a ogni riavvio (succede in molte aule informatiche), usa la cartella su OneDrive o il backup ZIP: quello che resta solo nel browser andrebbe perso.

## Scorciatoie

| Tasti | Azione |
|---|---|
| `Alt+T` | inserisci il minuto attuale negli appunti |
| `Alt+M` | ⭐ segna un momento importante |
| `Alt+K` | play / pausa |
| `Alt+J` / `Alt+L` | indietro / avanti di 10 secondi |
| `Ctrl+K` | cerca ovunque |
| `Ctrl+S` | salva e sincronizza subito |
| `Ctrl+V` | incolla una foto o un link nella lezione |

## Privacy

- Tutto resta nel browser e nella cartella che scegli tu. Non ci sono account né server di Aula.
- Whisper nel browser: l'audio non esce dal PC.
- Trascrizione dal vivo: l'audio passa dal servizio di riconoscimento vocale del browser (Google per Chrome, Microsoft per Edge).
- Trascrizione cloud e Claude con chiave: il materiale viene inviato a Groq/OpenAI e ad Anthropic. Le chiavi sono salvate solo nel tuo browser.

## Limiti noti

- Sync con cartella: solo Chrome/Edge su computer. Altrove si usa il backup ZIP.
- Trascrizione dal vivo: solo Chrome/Edge (e Safari recente), serve internet.
- Su iPhone la registrazione si interrompe se blocchi lo schermo: Aula tiene lo schermo acceso mentre registri, ma non chiudere l'app.
- Lo spazio nel browser è ampio (di solito decine di GB) ma non infinito: dalle Impostazioni vedi quanto stai usando.

## Per sviluppatori

App statica senza build, in JavaScript moderno (moduli ES):

```
aula/
├── index.html, css/app.css, manifest.webmanifest, sw.js, icon.svg
├── js/app.js             interfaccia, routing, editor, player, registrazione, Claude
├── js/db.js              IndexedDB (corsi, lezioni, allegati, blob, spezzoni di registrazione)
├── js/recorder.js        MediaRecorder + salvataggio incrementale + recupero
├── js/transcribe.js      decodifica audio, Whisper locale, cloud, Web Speech, import VTT/SRT
├── js/whisper-worker.js  transformers.js in un Web Worker (WebGPU se c'è, altrimenti WASM)
├── js/sync.js            cartella (File System Access API), merge, ZIP, export Markdown
├── js/ai.js              Claude (SDK Anthropic dal browser) e "Copia per claude.ai"
└── vendor/               marked, DOMPurify, fflate (inclusi per funzionare offline)
```

Per provarla in locale: `cd aula && python3 -m http.server 8000` e apri http://localhost:8000.
