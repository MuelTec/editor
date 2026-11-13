/**
 * BATIDAS DA MÚSICA (Etapa 12).
 *
 * Tudo local: decodifica o arquivo pela Web Audio, rola um FFT próprio e
 * detecta os onsets (batidas) por "spectral flux" com limiar adaptativo.
 * Daí dá pra:
 *  - desenhar a forma de onda na timeline da música;
 *  - marcar as batidas pra usuário ver;
 *  - encaixar os CORTES da montagem nas batidas (`snapCutsToBeats`).
 *
 * Sem dependências, sem rede — o arquivo nunca sai do aparelho.
 */

import { buildTimeline } from './montage';

export interface MusicAnalysis {
  /** Duração em segundos. */
  duration: number;
  /** Forma de onda: N valores 0..1 (max abs por bucket) pra desenhar a barra. */
  peaks: Float32Array;
  /** Tempos das batidas em segundos (dentro do arquivo). */
  beats: number[];
  /** BPM estimado (0 quando não deu pra estimar). */
  bpm: number;
}

// ------------------------------------------------------------------ FFT

/** FFT radix-2 in-place (reais + imaginários). `n` precisa ser potência de 2. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// ------------------------------------------------------------------ análise

const FRAME = 1024; // 23ms @44,1kHz
const HOP = 512; // 11,6ms — resolução boa o bastante pra encaixar cortes

/** Amostra mono (média dos canais) do AudioBuffer. */
function toMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const out = new Float32Array(n);
  const channels = buffer.numberOfChannels;
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  if (channels > 1) {
    const k = 1 / channels;
    for (let i = 0; i < n; i++) out[i] *= k;
  }
  return out;
}

/** Forma de onda: `buckets` valores 0..1 (máximo absoluto de cada fatia). */
function computePeaks(mono: Float32Array, buckets = 480): Float32Array {
  const peaks = new Float32Array(buckets);
  const size = Math.max(1, Math.floor(mono.length / buckets));
  for (let b = 0; b < buckets; b++) {
    const from = b * size;
    const to = Math.min(mono.length, from + size);
    let max = 0;
    for (let i = from; i < to; i++) {
      const v = mono[i] < 0 ? -mono[i] : mono[i];
      if (v > max) max = v;
    }
    peaks[b] = max;
  }
  // normaliza pelo maior pico
  let top = 0;
  for (let i = 0; i < buckets; i++) if (peaks[i] > top) top = peaks[i];
  if (top > 0) for (let i = 0; i < buckets; i++) peaks[i] /= top;
  return peaks;
}

/**
 * Spectral flux com limiar adaptativo:
 *  1. janela de 1024 amostras com passo 512 → FFT → magnitude;
 *  2. flux = soma do que SUBIU em relação ao quadro anterior (só positivo);
 *  3. pico onde o flux passa de `média local + desvio local` (janela ~1,2s)
 *     e está num máximo local, com no mínimo 180ms de uma batida anterior.
 */
function detectBeats(mono: Float32Array, sampleRate: number): number[] {
  const frames = Math.max(2, Math.floor((mono.length - FRAME) / HOP) + 1);
  const flux = new Float32Array(frames);
  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    // hann
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  }

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const prev = new Float32Array(FRAME / 2);
  let maxFlux = 0;

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = (mono[off + i] ?? 0) * window[i];
      im[i] = 0;
    }
    fft(re, im);

    let sum = 0;
    for (let k = 1; k < FRAME / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const d = mag - prev[k];
      if (d > 0) sum += d;
      prev[k] = mag;
    }
    flux[f] = sum;
    if (sum > maxFlux) maxFlux = sum;
  }

  if (maxFlux <= 0) return [];

  // Média/desvio locais (janela de ±10 quadros ≈ 1,2s)
  const W = 10;
  const beats: number[] = [];
  let lastBeat = -Infinity;
  const MIN_GAP = 0.18; // segundos

  for (let f = 1; f < frames - 1; f++) {
    const from = Math.max(0, f - W);
    const to = Math.min(frames, f + W + 1);
    let mean = 0;
    for (let i = from; i < to; i++) mean += flux[i];
    mean /= to - from;
    let variance = 0;
    for (let i = from; i < to; i++) {
      const d = flux[i] - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / (to - from));

    const v = flux[f];
    const limite = mean + std * 1.1;
    // exige também uma fração relevante do pico geral (evita ruído em silêncio)
    const minimo = maxFlux * 0.18;
    if (v < limite || v < minimo) continue;
    // máximo local em ±2 quadros
    if (v < flux[f - 1] || v < flux[f + 1]) continue;

    const t = (f * HOP + FRAME / 2) / sampleRate;
    if (t - lastBeat < MIN_GAP) continue;
    lastBeat = t;
    beats.push(t);
  }

  return beats;
}

/** Estima BPM a partir do intervalo mediano entre batidas (dobra/reduz pra 70–180). */
function estimateBpm(beats: number[]): number {
  if (beats.length < 4) return 0;
  const diffs: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const d = beats[i] - beats[i - 1];
    if (d > 0.15 && d < 2) diffs.push(d);
  }
  if (diffs.length < 3) return 0;
  diffs.sort((a, b) => a - b);
  const med = diffs[Math.floor(diffs.length / 2)];
  let bpm = 60 / med;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

/**
 * Analisa o arquivo de música: decodifica, mede a onda e acha as batidas.
 * Retorna `null` se o navegador não conseguir decodificar.
 */
export async function analyzeMusic(file: File): Promise<MusicAnalysis | null> {
  try {
    const bytes = await file.arrayBuffer();
    // OfflineAudioContext decodifica sem gesto do usuário (mesmo truque do mix).
    const probe = new OfflineAudioContext(2, 1, 44100);
    const buffer = await probe.decodeAudioData(bytes);
    if (!buffer || buffer.duration <= 0) return null;

    const mono = toMono(buffer);
    const peaks = computePeaks(mono);
    const beats = detectBeats(mono, buffer.sampleRate);
    return {
      duration: buffer.duration,
      peaks,
      beats,
      bpm: estimateBpm(beats),
    };
  } catch {
    return null;
  }
}

/**
 * Batidas convertidas pro TEMPO DA MONTAGEM.
 *
 * A música começa em `offset` (seconds dentro do arquivo) e dá loop; cada
 * batida em `b` reaparece a cada volta: `t = b - offset + k*duração`.
 */
export function beatsInTimeline(
  beats: number[],
  musicDuration: number,
  offset: number,
  total: number,
): number[] {
  if (beats.length === 0 || musicDuration <= 0 || total <= 0) return [];
  const out: number[] = [];
  for (const b of beats) {
    let t = b - offset;
    while (t < -1e-6) t += musicDuration;
    for (; t <= total + 1e-6; t += musicDuration) {
      if (t >= 0 && t <= total) out.push(t);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Ajusta os TRIMS dos clipes pra que os cortes da montagem caiam nas batidas.
 *
 * Caminha de cima pra baixo: para cada corte (início do clipe i), acha a
 * batida mais próxima dentro de `maxSnap` segundos e estica/encolhe o clipe
 * ANTERIOR pra o corte parar em cima dela. A timeline é recalculada a cada
 * passo, então os cortes seguintes acompanham o deslocamento.
 *
 * Limites de segurança: clipe nunca fica menor que `minClip` nem maior que
 * o trecho disponível no arquivo, e nenhum corte anda mais que `maxSnap`.
 */
export function snapCutsToBeats(
  clips: { trimStart: number; trimEnd: number; duration: number }[],
  beats: number[],
  musicDuration: number,
  offset: number,
  transitionDuration: number,
  total: number,
  options?: { maxSnap?: number; minClip?: number },
): { trimStart: number; trimEnd: number; duration: number }[] | null {
  if (clips.length < 2 || beats.length === 0 || total <= 0) return null;
  const maxSnap = options?.maxSnap ?? 1.5;
  const minClip = options?.minClip ?? 0.5;

  const targets = beatsInTimeline(beats, musicDuration, offset, total);
  if (targets.length === 0) return null;

  const next = clips.map((c) => ({ ...c }));
  const durations = () => next.map((c) => Math.max(0.1, c.trimEnd - c.trimStart));

  let moved = 0;
  // Recalcula a timeline a cada ajuste (o corte i depende dos anteriores).
  for (let pass = 0; pass < 2; pass++) {
    const { clips: timelineClips } = buildTimeline(durations(), transitionDuration);
    for (let i = 1; i < next.length; i++) {
      const cut = timelineClips[i].start;
      // batida mais próxima deste corte
      let best = -1;
      let bestDist = Infinity;
      for (const t of targets) {
        const d = Math.abs(t - cut);
        if (d < bestDist) {
          bestDist = d;
          best = t;
        }
      }
      if (best < 0 || bestDist > maxSnap || bestDist < 0.02) continue;

      const delta = best - cut; // quanto o clipe anterior precisa crescer
      const prev = next[i - 1];
      // Piso: mínimo do clipe. Teto: o fim do arquivo.
      const wanted = prev.trimEnd + delta;
      const newEnd = Math.min(
        Math.max(wanted, prev.trimStart + minClip),
        Math.max(prev.trimStart + minClip, prev.duration),
      );
      const realDelta = newEnd - prev.trimEnd;
      if (Math.abs(realDelta) < 0.02) continue;
      prev.trimEnd = newEnd;
      moved++;
    }
  }

  return moved > 0 ? next : null;
}
