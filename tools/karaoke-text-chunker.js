/**
 * karaoke-text-chunker.js
 * ========================
 * Troceo de guion para subtítulos karaoke — versión JavaScript independiente.
 *
 * No depende de ningún servicio de IA ni del DOM: toma un guion de texto
 * (con etiquetas "Nombre: texto" y, opcionalmente, marcas de tiempo
 * "(mm:ss)" o "(h:mm:ss)") y calcula:
 *
 *   1. la lista de palabras con su hablante,
 *   2. los bloques de subtítulo (se cortan por longitud o cambio de hablante),
 *   3. una estimación del tiempo de cada palabra, ya sea repartiendo una
 *      duración total de forma pareja, o interpolando entre marcas de tiempo
 *      reales detectadas en el texto.
 *
 * Funciona tanto en Node como en el navegador (sin imports externos).
 *
 * Uso típico:
 *
 *   import { parseScript, computeBlocks, interpolateFromAnchors } from './karaoke-text-chunker.js';
 *
 *   const { words, anchors } = parseScript(texto, new Set(['narrador', 'gu']));
 *   const blocks = computeBlocks(words, 70);
 *   const timestamps = interpolateFromAnchors(words, anchors, 42.0);
 */

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Normaliza un nombre de personaje a un identificador simple. */
export function slugify(name){
  return name.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');
}

/** Convierte 'mm:ss' o 'h:mm:ss' a segundos. */
export function parseTimeToken(token){
  const parts = token.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

const TAG_RE = /^\s*([^:\n]{1,30}):\s*(.*)$/;
const ANCHOR_RE = /\(\s*((?:\d+:)?\d{1,2}:\d{2})\s*\)/g;

// ---------------------------------------------------------------------------
// 1. Parseo del guion: palabras + hablante + marcas de tiempo detectadas
// ---------------------------------------------------------------------------

/**
 * Divide el guion en palabras, asignando el hablante actual a cada una,
 * y extrae cualquier marca de tiempo "(mm:ss)" como ancla.
 *
 * @param {string} text
 * @param {Set<string>|null} knownCharacters  ids (slugify) de personajes
 *   reconocidos. Si una línea empieza con "Nombre:" y ese nombre no está
 *   en el conjunto, se trata como texto normal (no cambia el hablante) —
 *   igual que en el editor. Si se pasa null, cualquier "Nombre:" se acepta.
 * @returns {{ words: {text:string, speaker:string}[], anchors: {wordIndex:number, time:number}[] }}
 */
export function parseScript(text, knownCharacters = null){
  const lines = text.split(/\n+/);
  const words = [];
  const anchors = [];
  let currentSpeaker = 'narrador';
  let pendingAnchorTime = null;

  const pushWords = (chunk) => {
    chunk.trim().split(/\s+/).filter(Boolean).forEach((w) => {
      if (pendingAnchorTime != null){
        anchors.push({ wordIndex: words.length, time: pendingAnchorTime });
        pendingAnchorTime = null;
      }
      words.push({ text: w, speaker: currentSpeaker });
    });
  };

  lines.forEach((line) => {
    if (!line.trim()) return;
    let content = line;
    const m = line.match(TAG_RE);
    if (m){
      const candidateId = slugify(m[1]);
      if (knownCharacters === null || knownCharacters.has(candidateId)){
        currentSpeaker = candidateId;
        content = m[2];
      }
    }
    let lastIndex = 0, match;
    ANCHOR_RE.lastIndex = 0;
    while ((match = ANCHOR_RE.exec(content)) !== null){
      pushWords(content.slice(lastIndex, match.index));
      pendingAnchorTime = parseTimeToken(match[1]);
      lastIndex = ANCHOR_RE.lastIndex;
    }
    pushWords(content.slice(lastIndex));
  });

  return { words, anchors };
}

// ---------------------------------------------------------------------------
// 2. Bloques de subtítulo (se cortan por longitud o cambio de hablante)
// ---------------------------------------------------------------------------

/**
 * @param {{text:string, speaker:string}[]} words
 * @param {number} limit  caracteres aproximados por bloque
 * @returns {{start:number, end:number}[]}  end es inclusive
 */
export function computeBlocks(words, limit = 70){
  const blocks = [];
  let start = 0, len = 0;
  for (let i = 0; i < words.length; i++){
    const wLen = words[i].text.length + 1;
    const speakerChanged = i > start && words[i].speaker !== words[i - 1].speaker;
    if ((len + wLen > limit || speakerChanged) && i > start){
      blocks.push({ start, end: i - 1 });
      start = i; len = 0;
    }
    len += wLen;
  }
  if (start <= words.length - 1) blocks.push({ start, end: words.length - 1 });
  return blocks;
}

// ---------------------------------------------------------------------------
// 3. Estimación de tiempos por palabra
// ---------------------------------------------------------------------------

/** Peso relativo de una palabra: más letras y puntuación = más tiempo. */
export function wordWeight(text){
  let weight = text.length + 1;
  if (/[.!?…]$/.test(text)) weight += 4;       // pausa larga
  else if (/[,;:]$/.test(text)) weight += 2;    // pausa corta
  return weight;
}

/** Reparte proporcionalmente el tiempo entre startTime y endTime para
 *  words[startIdx..endIdx], escribiendo en `out` (in-place). */
export function estimateSegment(words, startIdx, endIdx, startTime, endTime, out){
  if (startIdx > endIdx) return;
  const segment = words.slice(startIdx, endIdx + 1);
  const weights = segment.map((w) => wordWeight(w.text));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let cumulative = 0;
  segment.forEach((w, i) => {
    out[startIdx + i] = startTime + (cumulative / total) * (endTime - startTime);
    cumulative += weights[i];
  });
}

/**
 * Calcula el tiempo estimado de cada palabra usando las marcas de tiempo
 * detectadas como puntos de control exactos, interpolando el resto según
 * la longitud de las palabras.
 * @returns {(number|null)[]}
 */
export function interpolateFromAnchors(words, anchors, audioDuration = null){
  const out = new Array(words.length).fill(null);
  if (!anchors.length) return out;
  const sorted = [...anchors].sort((a, b) => a.wordIndex - b.wordIndex);

  // ritmo promedio (peso por segundo) entre anclas, para extrapolar extremos
  let paceWeight = 0, paceTime = 0;
  for (let i = 0; i < sorted.length - 1; i++){
    const a = sorted[i], b = sorted[i + 1];
    paceWeight += words.slice(a.wordIndex, b.wordIndex).reduce((s, w) => s + wordWeight(w.text), 0);
    paceTime += (b.time - a.time);
  }
  const pace = paceTime > 0 ? paceWeight / paceTime : null;

  const first = sorted[0];
  if (first.wordIndex > 0){
    const leadWeight = words.slice(0, first.wordIndex).reduce((s, w) => s + wordWeight(w.text), 0);
    const leadDuration = pace ? leadWeight / pace : first.time;
    estimateSegment(words, 0, first.wordIndex - 1, Math.max(0, first.time - leadDuration), first.time, out);
  }

  for (let i = 0; i < sorted.length - 1; i++){
    const a = sorted[i], b = sorted[i + 1];
    out[a.wordIndex] = a.time;
    estimateSegment(words, a.wordIndex + 1, b.wordIndex - 1, a.time, b.time, out);
    out[b.wordIndex] = b.time;
  }
  out[first.wordIndex] = first.time;

  const last = sorted[sorted.length - 1];
  if (last.wordIndex < words.length - 1){
    const tailWeight = words.slice(last.wordIndex + 1).reduce((s, w) => s + wordWeight(w.text), 0);
    let endTime;
    if (audioDuration) endTime = audioDuration;
    else if (pace) endTime = last.time + tailWeight / pace;
    else endTime = last.time + tailWeight * 0.08;
    estimateSegment(words, last.wordIndex + 1, words.length - 1, last.time, endTime, out);
  }
  return out;
}

/** Modo "automático" sin marcas: reparte toda la duración de forma pareja. */
export function estimateEvenly(words, duration){
  const out = new Array(words.length).fill(null);
  estimateSegment(words, 0, words.length - 1, 0, duration, out);
  return out;
}

// ---------------------------------------------------------------------------
// Ejemplo de uso (se ejecuta solo si corres este archivo directamente)
// ---------------------------------------------------------------------------

const isDirectRun = typeof process !== 'undefined' && process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun){
  const guion = `Narrador: (0:00) Compañero. Regresión infinita. Un cierto género lleva ese nombre.
Se llama, Regresión infinita, cuando el protagonista muere y regresa. (0:15) Naturalmente, el protagonista lo supera.`;

  const { words, anchors } = parseScript(guion, new Set(['narrador']));
  const blocks = computeBlocks(words, 70);
  const timestamps = interpolateFromAnchors(words, anchors, 20.0);

  console.log(`${words.length} palabras, ${blocks.length} bloques, ${anchors.length} anclas detectadas\n`);
  blocks.forEach((block) => {
    const text = words.slice(block.start, block.end + 1).map((w) => w.text).join(' ');
    const t0 = timestamps[block.start];
    console.log(`[${t0.toFixed(2)}s] ${text}`);
  });
}
