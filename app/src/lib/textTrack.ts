import type { CaptionOptions } from './caption';

/**
 * Trilha de TEXTO da timeline (estilo CapCut).
 *
 * Cada bloco tem seu próprio texto/estilo e só aparece entre `start` e `end`
 * (em segundos, sempre alinhados a quadros). A prévia e o arquivo exportado
 * usam EXATAMENTE a mesma regra (`activeTexts`), então o que você vê é o que sai.
 *
 * Este módulo é puro (sem DOM): dá pra testar sozinho.
 */

/** Quadros por segundo do projeto — o mesmo do export da montagem (`fps` = 30). */
export const PROJECT_FPS = 30;

/** Um bloco de texto nunca fica menor que isso (em quadros). */
export const MIN_TEXT_FRAMES = 3;

/** Duração padrão de um bloco novo, em segundos. */
export const DEFAULT_TEXT_SECONDS = 2;

export interface TextClip {
  id: string;
  /** Primeiro instante em que o texto aparece (s). */
  start: number;
  /** Instante em que ele some (s) — o quadro `end` já NÃO mostra o texto. */
  end: number;
  /** Conteúdo e aparência (mesmas opções da antiga legenda). */
  style: CaptionOptions;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Alinha um tempo ao quadro mais próximo. */
export function snapToFrame(t: number, fps: number = PROJECT_FPS): number {
  return Math.round(t * fps) / fps;
}

/** Índice do quadro que está no ar no tempo `t` (0 = primeiro). */
export function frameIndex(t: number, fps: number = PROJECT_FPS): number {
  return Math.max(0, Math.floor(t * fps + 1e-6));
}

/** Último quadro de uma timeline com `total` segundos (nunca negativo). */
export function lastFrameIndex(total: number, fps: number = PROJECT_FPS): number {
  return Math.max(0, Math.ceil(total * fps - 1e-6) - 1);
}

/** Anda `n` quadros a partir de `t` (n pode ser negativo), sem sair da timeline. */
export function stepTime(
  t: number,
  n: number,
  total: number,
  fps: number = PROJECT_FPS,
): number {
  const next = clamp(frameIndex(t, fps) + n, 0, lastFrameIndex(total, fps));
  return next / fps;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** Tempo no formato `MM:SS:QQ` (minutos : segundos : quadros), como nos editores de vídeo. */
export function formatTimecode(t: number, fps: number = PROJECT_FPS): string {
  const total = frameIndex(Number.isFinite(t) ? t : 0, fps);
  const frames = total % fps;
  const secs = Math.floor(total / fps);
  return `${two(Math.floor(secs / 60))}:${two(secs % 60)}:${two(frames)}`;
}

/** Texto está no ar no tempo `t`? (início inclusivo, fim exclusivo) */
export function isTextActive(c: TextClip, t: number): boolean {
  return t >= c.start - 1e-9 && t < c.end - 1e-9;
}

/** Blocos visíveis no tempo `t`, na ordem da lista (o último desenha por cima). */
export function activeTexts(
  texts: readonly TextClip[] | undefined,
  t: number,
): TextClip[] {
  if (!texts || texts.length === 0) return [];
  return texts.filter((c) => isTextActive(c, t));
}

/**
 * Ajusta início/fim de um bloco respeitando: dentro de [0, total], duração
 * mínima, alinhado a quadros. Mexer no início empurra o fim só se precisar
 * (e vice-versa).
 */
export function withRange(
  c: TextClip,
  range: { start?: number; end?: number },
  total: number,
  fps: number = PROJECT_FPS,
): TextClip {
  const min = MIN_TEXT_FRAMES / fps;
  const limit = Math.max(total, min);
  let start = c.start;
  let end = c.end;

  if (range.start !== undefined) {
    start = clamp(snapToFrame(range.start, fps), 0, limit - min);
    end = Math.max(end, start + min);
  }
  if (range.end !== undefined) {
    end = clamp(snapToFrame(range.end, fps), min, limit);
    start = Math.min(start, end - min);
  }
  end = Math.min(end, limit);
  start = Math.max(0, Math.min(start, end - min));
  return { ...c, start: snapToFrame(start, fps), end: snapToFrame(end, fps) };
}

/** Desloca o bloco inteiro em `dt` segundos, mantendo a duração. */
export function moveText(
  c: TextClip,
  dt: number,
  total: number,
  fps: number = PROJECT_FPS,
): TextClip {
  const dur = c.end - c.start;
  const limit = Math.max(total, dur);
  const start = clamp(snapToFrame(c.start + dt, fps), 0, limit - dur);
  return { ...c, start, end: snapToFrame(start + dur, fps) };
}

let counter = 0;
const newId = (): string =>
  `txt-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

/** Cria um bloco novo a partir do tempo `at` (o cursor da timeline). */
export function newTextClip(
  at: number,
  total: number,
  style: CaptionOptions,
  fps: number = PROJECT_FPS,
): TextClip {
  const min = MIN_TEXT_FRAMES / fps;
  const limit = Math.max(total, min);
  const dur = Math.min(DEFAULT_TEXT_SECONDS, limit);
  const start = snapToFrame(clamp(at, 0, limit - dur), fps);
  return {
    id: newId(),
    start,
    end: Math.min(snapToFrame(limit, fps), snapToFrame(start + dur, fps)),
    style,
  };
}

/** Duplica um bloco logo depois dele (ou onde couber). */
export function duplicateText(
  c: TextClip,
  total: number,
  fps: number = PROJECT_FPS,
): TextClip {
  const dur = c.end - c.start;
  const limit = Math.max(total, dur);
  const start = c.end + dur <= limit + 1e-9 ? c.end : Math.max(0, limit - dur);
  return {
    ...c,
    id: newId(),
    start: snapToFrame(start, fps),
    end: snapToFrame(start + dur, fps),
    style: { ...c.style },
  };
}
