// Claude sulla lezione: riassunti, appunti strutturati, domande d'esame, chat.
// Due modalità:
//  - con chiave API Anthropic: risposta in streaming direttamente nell'app
//  - senza chiave: "Copia per Claude" mette tutto negli appunti e apre claude.ai
import { fmtTime } from './sync.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (migliore)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (più economico)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (il più economico)' },
];

export const ACTIONS = {
  riassunto: {
    title: 'Riassunto',
    prompt: 'Scrivi un riassunto chiaro della lezione: prima 3-5 righe con il succo, poi i punti principali in ordine. Indica tra parentesi quadre il minuto della trascrizione dove se ne parla (es. [12:30]).',
  },
  appunti: {
    title: 'Appunti strutturati',
    prompt: 'Trasforma trascrizione e appunti in appunti di studio completi e ordinati, con titoli, sottotitoli, definizioni in grassetto, formule ed esempi. Integra quello che ho scritto io con quello che ha detto il professore, senza perdere dettagli importanti. Segna con [mm:ss] i punti della registrazione.',
  },
  domande: {
    title: 'Domande d\'esame',
    prompt: 'Prepara 10 possibili domande d\'esame su questa lezione (mescola domande aperte e di ragionamento), ciascuna con una risposta modello sintetica.',
  },
  flashcard: {
    title: 'Flashcard',
    prompt: 'Crea 15-25 flashcard nel formato "**D:** domanda" a capo "**R:** risposta", sui concetti, definizioni e formule chiave.',
  },
  dubbi: {
    title: 'Concetti difficili',
    prompt: 'Individua i 3-6 concetti più difficili o spiegati in fretta nella lezione e rispiegali in modo semplice, con un esempio ciascuno. Se la trascrizione ha punti confusi o probabilmente trascritti male, segnalali.',
  },
};

const SYSTEM = `Sei l'assistente di studio di uno studente universitario italiano. Ricevi i materiali di una lezione: appunti dello studente, trascrizione automatica dell'audio (può contenere errori di riconoscimento: correggili con buon senso, soprattutto termini tecnici e nomi) ed eventuali foto della lavagna o delle slide. Rispondi sempre in italiano, in Markdown. Non inventare contenuti che non sono nei materiali; se aggiungi spiegazioni tue, dillo esplicitamente.`;

export function buildContext(lecture, course, items) {
  const parts = [`# Lezione: ${lecture.title || 'senza titolo'}`];
  if (course) parts.push(`Corso: ${course.name}${course.prof ? ' — prof. ' + course.prof : ''}`);
  if (lecture.date) parts.push(`Data: ${lecture.date}`);
  parts.push('', '## I miei appunti', lecture.notes?.trim() || '(nessuno)');
  const links = items.filter(i => i.kind === 'link');
  if (links.length) parts.push('', '## Link', ...links.map(i => `- ${i.name || ''} ${i.url}${i.caption ? ' — ' + i.caption : ''}`));
  const files = items.filter(i => i.kind !== 'link');
  if (files.length) parts.push('', '## Allegati', ...files.map(i => `- ${i.name}${i.caption ? ' — ' + i.caption : ''}`));
  if (lecture.transcript?.length) {
    parts.push('', '## Trascrizione');
    for (const s of lecture.transcript) {
      parts.push(s.start != null ? `[${(s.part ? `p${s.part + 1} ` : '') + fmtTime(s.start)}] ${s.text}` : s.text);
    }
  } else parts.push('', '## Trascrizione', '(non disponibile)');
  return parts.join('\n');
}

export function clipboardPrompt(action, context, question) {
  const task = action ? ACTIONS[action].prompt : question;
  return `${SYSTEM}\n\nCOMPITO: ${task}\n\n---\n\n${context}`;
}

// Riduce le foto (max 1568 px) prima di inviarle a Claude.
export async function imageBlock(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const b64 = await new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result.split(',')[1]);
    fr.readAsDataURL(out);
  });
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } };
}

let sdkP = null;

// history: [{role, content}] (chat precedente, solo testo). Ritorna il testo finale.
export async function ask({ apiKey, model, context, images = [], action, question, history = [], onText, signal }) {
  if (!apiKey) throw new Error('Inserisci la chiave API Anthropic nelle Impostazioni, oppure usa "Copia per Claude".');
  sdkP ||= import(SDK);
  const { default: Anthropic } = await sdkP;
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const task = action ? ACTIONS[action].prompt : question;
  const first = [
    ...images,
    { type: 'text', text: `${context}\n\n---\n\nCOMPITO: ${history.length ? 'rispondi alle domande che seguono sulla lezione.' : task}` },
  ];
  const messages = history.length
    ? [{ role: 'user', content: first }, ...history, { role: 'user', content: question }]
    : [{ role: 'user', content: first }];

  const params = {
    model,
    max_tokens: 64000,
    system: SYSTEM,
    messages,
  };
  if (model !== 'claude-haiku-4-5') {
    params.output_config = { effort: 'medium' };
    // se un filtro di sicurezza rifiuta per errore, il server riprova da solo con un altro modello
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  const stream = client.beta.messages.stream(params, { signal });
  let text = '';
  stream.on('text', d => { text += d; onText(text); });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    throw new Error('Claude ha rifiutato la richiesta' + (msg.stop_details?.explanation ? ': ' + msg.stop_details.explanation : '.'));
  }
  if (msg.stop_reason === 'max_tokens') text += '\n\n_(risposta troncata: troppo lunga)_';
  return text;
}
