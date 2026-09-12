# skill-claude

Skill personali per Claude.

| Cartella | A cosa serve |
|---|---|
| `sbobina-lezioni/` | Registrare ed elaborare le lezioni del triennio in Textile & Fashion Design allo IAAD di Torino: trascrizione, assistente in aula, biblioteca nel browser, piano di scadenze e medie. |
| `volantini-linea.skill` | Volantini promozionali mensili di Linea S.r.l. |

I file `.skill` sono i pacchetti pronti da caricare in Claude. Si rigenerano dalle cartelle con
`./build.sh`.

## Cominciare con sbobina-lezioni

Due dei quattro programmi girano con il solo Python, senza installare nulla:

```bash
cd sbobina-lezioni
python3 scripts/piano.py init          # crea il piano di scadenze, esami e materiali
python3 scripts/piano.py agenda        # cosa arriva e da quando lavorarci
python3 scripts/biblioteca.py Lezioni  # apre tutto il materiale nel browser
```

Solo la trascrizione richiede un'installazione, perché scarica il modello Whisper:

```bash
bash scripts/setup.sh
.venv/bin/python scripts/trascrivi.py "percorso/audio.m4a" --glossario "percorso/glossario.md"
```

Il resto è spiegato in `sbobina-lezioni/SKILL.md` e nei documenti dentro
`sbobina-lezioni/references/`.

**Prima settimana di prova:** `PROVE.md` dice cosa provare e cosa serve riportare indietro per
migliorare il sistema.
