# Gomitolo Milano Brera → Harrods Londra

Video 3D (30 s, 1920×1080, 30 fps): un gomitolo di lana rotola srotolandosi lungo
il percorso stradale reale (1.307 km) da Via Brera a Milano fino a Harrods,
Brompton Road, Londra. Vista dall'alto su immagini satellitari con rilievo
del terreno in 3D e 7 inquadrature con cambi di camera.

## Come funziona

- `prep_route.py`: percorso OSRM (Monte Bianco, Eurotunnel Calais–Folkestone)
  → polilinea Web-Mercator smussata (`data/route.json`).
- `timeline.js`: fisica e regia, condivisa tra browser e Node.
  - rotolamento senza strisciamento: a ogni sotto-passo il gomitolo ruota di
    `ds / R` attorno all'asse `up × v` (quaternioni integrati fotogramma per fotogramma);
  - srotolamento a volume costante: `R³ = R0³ · (1 − f·s/L)`, quindi il gomitolo si
    rimpicciolisce man mano che il filo si deposita;
  - partenza da fermo con accelerazione uniforme, frenata finale con decelerazione
    costante (attrito di rotolamento) davanti a Harrods;
  - contatto rigido col terreno: il centro poggia sul punto più alto sotto l'impronta.
  - Nelle inquadrature larghe il gomitolo viene ingrandito (scala "eroe") per restare
    visibile; il filo segue la stessa scala.
- `scene.js`: three.js — tessere satellitari Esri con LOD a quadtree, altimetria
  Terrarium (esagerata ×1,9 nelle viste larghe), gomitolo procedurale (24 bande × 7
  fili in tubi con texture a 3 capi e sheen da tessuto), filo ricostruito a ogni
  fotogramma, ombre, nebbia atmosferica, titoli e contachilometri.
- `server.py`: server statico con cache locale delle tessere.
- `render.mjs`: Chromium headless → ffmpeg (H.264).

## Render

```bash
npm install
python3 prep_route.py
python3 server.py 8765 &
node render.mjs out/seg_0.mp4 0 300 & node render.mjs out/seg_300.mp4 300 600 & node render.mjs out/seg_600.mp4 600 900
```

Poi si concatenano i segmenti con ffmpeg (`-f concat`).

Crediti: immagini © Esri, Maxar, Earthstar Geographics · altimetria AWS Terrain Tiles ·
percorso OSRM, © OpenStreetMap contributors.
