/**
 * Operações de edição sobre os clipes da montagem: dividir, cortar o início,
 * cortar o fim e achar qual clipe está sob o cursor.
 *
 * Módulo puro (sem DOM): dá pra testar sozinho.
 *
 * Vocabulário:
 *  - "tempo do arquivo": segundos dentro do vídeo de origem (`trimStart..trimEnd`).
 *  - Imagem: não tem arquivo de vídeo por trás — o clipe só "dura" `trimEnd −
 *    trimStart` segundos, e o tempo do arquivo é simplesmente o tempo desde o
 *    início da imagem na timeline.
 */

/** Cada pedaço, depois de dividir/cortar, precisa ter ao menos isso (s). */
export const MIN_PIECE = 0.3;

export interface EditableClip {
  id: string;
  kind?: 'video' | 'image';
  /** Duração total do arquivo (imagens: o máximo que dá pra esticar). */
  duration: number;
  trimStart: number;
  trimEnd: number;
  /** Transição do corte entre este clipe e o PRÓXIMO (ausente = padrão). */
  transition?: string;
  /** Duração dessa transição; 0 = corte seco (ausente = padrão). */
  transitionDuration?: number;
}

const isImage = (c: EditableClip): boolean => c.kind === 'image';

/** Quanto tempo o clipe toca na montagem. */
export function usedDuration(c: EditableClip): number {
  return Math.max(0, c.trimEnd - c.trimStart);
}

/**
 * Qual clipe está no ar em `t` (índice), ou -1 se a timeline estiver vazia.
 * Dentro de uma sobreposição de transição vale o clipe que ENTRA (é o que a
 * tela mostra por último). Depois do fim, o último; antes do início, o primeiro.
 */
export function locateClip(
  timeline: { clips: { start: number; end: number }[] },
  t: number,
): number {
  const { clips } = timeline;
  if (clips.length === 0) return -1;
  let found = -1;
  for (let i = 0; i < clips.length; i++) {
    if (t >= clips[i].start - 1e-9 && t < clips[i].end - 1e-9) found = i;
  }
  if (found >= 0) return found;
  if (t < clips[0].start) return 0;
  return clips.length - 1;
}

/** Tempo do ARQUIVO que corresponde a `t` na timeline, dado o início do clipe nela. */
export function fileTimeAt(c: EditableClip, clipStartOnTimeline: number, t: number): number {
  const local = Math.max(0, t - clipStartOnTimeline);
  return isImage(c) ? local : c.trimStart + local;
}

/**
 * Divide o clipe no tempo do arquivo `ft`, em duas partes. `null` se alguma
 * parte ficaria menor que `MIN_PIECE`.
 *
 * O corte entre as duas partes é CONTÍNUO (é o mesmo vídeo): vira corte seco
 * (`transitionDuration: 0`). O corte que vinha depois do clipe original
 * continua depois da segunda parte.
 */
export function splitClip<T extends EditableClip>(
  c: T,
  ft: number,
  newId: () => string,
): [T, T] | null {
  const used = usedDuration(c);
  const at = isImage(c) ? ft : ft - c.trimStart;
  if (!(at >= MIN_PIECE - 1e-9) || !(used - at >= MIN_PIECE - 1e-9)) return null;

  const first: T = isImage(c)
    ? { ...c, trimStart: 0, trimEnd: at, transition: undefined, transitionDuration: 0 }
    : { ...c, trimEnd: ft, transition: undefined, transitionDuration: 0 };
  const second: T = isImage(c)
    ? { ...c, id: newId(), trimStart: 0, trimEnd: used - at }
    : { ...c, id: newId(), trimStart: ft };
  return [first, second];
}

/** Corta tudo ANTES de `ft` (o clipe passa a começar aí). `null` se sobrar menos que `MIN_PIECE`. */
export function cutStart<T extends EditableClip>(c: T, ft: number): T | null {
  const used = usedDuration(c);
  const at = isImage(c) ? ft : ft - c.trimStart;
  if (!(at > 0) || !(used - at >= MIN_PIECE - 1e-9)) return null;
  return isImage(c)
    ? { ...c, trimStart: 0, trimEnd: used - at }
    : { ...c, trimStart: ft };
}

/** Corta tudo DEPOIS de `ft` (o clipe passa a terminar aí). `null` se sobrar menos que `MIN_PIECE`. */
export function cutEnd<T extends EditableClip>(c: T, ft: number): T | null {
  const used = usedDuration(c);
  const at = isImage(c) ? ft : ft - c.trimStart;
  if (!(at >= MIN_PIECE - 1e-9) || !(at < used)) return null;
  return isImage(c) ? { ...c, trimStart: 0, trimEnd: at } : { ...c, trimEnd: ft };
}

/** Troca o clipe `id` por `parts` (mantém a ordem dos demais). */
export function replaceClip<T extends EditableClip>(
  list: readonly T[],
  id: string,
  parts: readonly T[],
): T[] {
  return list.flatMap((c) => (c.id === id ? [...parts] : [c]));
}

/** Remove o clipe `id`. */
export function removeClipById<T extends EditableClip>(list: readonly T[], id: string): T[] {
  return list.filter((c) => c.id !== id);
}

/** Média das durações de transição dos cortes (os cálculos de batida usam um valor só). */
export function averageJunction(
  clips: readonly { transitionDuration?: number }[],
  fallback: number,
): number {
  if (clips.length < 2) return fallback;
  const list = clips.slice(0, -1).map((c) => c.transitionDuration ?? fallback);
  return list.reduce((a, b) => a + b, 0) / list.length;
}
