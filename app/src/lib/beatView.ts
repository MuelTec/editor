/**
 * Quais batidas desenhar na linha do tempo, de um jeito LIMPO.
 *
 * Problemas do desenho antigo: toda batida virava uma linha de ponta a ponta
 * (centenas delas viravam uma cerca rosa), sem distinguir batida forte de fraca
 * e sem se adaptar ao zoom.
 *
 * Agora:
 *  - a densidade se adapta ao zoom: se as batidas ficariam coladas, mostra só
 *    1 a cada 2, 4, 8... (sempre as mesmas — não "pisca" ao rolar a janela);
 *  - toda 4ª batida é "forte" (o compasso): ganha destaque;
 *  - modo "só as fortes" e modo "escondidas".
 *
 * Módulo puro (sem DOM): dá pra testar sozinho.
 */

export type BeatViewMode = 'auto' | 'strong' | 'off';

export interface BeatMark {
  /** Tempo da batida na timeline (s). */
  t: number;
  /** Batida forte (início de compasso): desenhada com destaque. */
  strong: boolean;
}

/** Espaço mínimo entre duas marcações vizinhas (px). */
export const MIN_BEAT_GAP_PX = 18;

const MAX_STRIDE = 64;

/** Primeiro índice com `arr[i] >= x` (arr ordenado). */
function lowerBound(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Marcações a desenhar na janela `[vs, vs + span]` de uma faixa com `widthPx`
 * de largura. `beats` precisa estar em ordem crescente.
 */
export function pickBeatMarks(
  beats: readonly number[],
  vs: number,
  span: number,
  widthPx: number,
  mode: BeatViewMode = 'auto',
  minGapPx: number = MIN_BEAT_GAP_PX,
): BeatMark[] {
  if (mode === 'off' || beats.length === 0 || !(span > 0) || !(widthPx > 0)) return [];

  const lo = lowerBound(beats, vs - 1e-9);
  const hi = lowerBound(beats, vs + span + 1e-9);
  if (hi <= lo) return [];

  // Espaçamento médio da música INTEIRA (estável: não muda ao rolar a janela).
  const avgGap =
    beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : span;
  const pxPerSec = widthPx / span;

  // "Só as fortes" parte de 1 a cada 4; depois dobra até caberem sem se encostar.
  let stride = mode === 'strong' ? 4 : 1;
  while (stride < MAX_STRIDE && avgGap * stride * pxPerSec < minGapPx) stride *= 2;

  // Quando as marcações já são esparsas (stride ≥ 4), metade delas vira "forte".
  const strongStep = stride >= 4 ? stride * 2 : 4;

  const marks: BeatMark[] = [];
  for (let i = lo; i < hi; i++) {
    if (i % stride !== 0) continue;
    marks.push({ t: beats[i], strong: mode === 'strong' || i % strongStep === 0 });
  }
  return marks;
}
