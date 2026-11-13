/**
 * Filtros de cor (Etapa 5).
 *
 * Aplicados com `ctx.filter` no momento de desenhar o CONTEÚDO (fundo borrado +
 * vídeo nítido). A legenda nunca é filtrada — o texto precisa continuar nítido
 * e legível.
 *
 * Tudo roda no canvas do próprio dispositivo: 100% local.
 */

import { VERTICAL_LAYOUT, type FrameLayout } from './format';

export type FilterId =
  | 'none'
  | 'warm'
  | 'cool'
  | 'film'
  | 'bw'
  | 'vivid'
  | 'vintage'
  | 'noir';

export interface FilterPreset {
  id: FilterId;
  label: string;
  /** String aplicada em `ctx.filter` para o conteúdo. */
  css: string;
  /**
   * Camadas extras desenhadas POR CIMA do conteúdo (e sob a legenda):
   * usadas pra vinhetas e tingimentos que o `ctx.filter` não faz sozinho.
   */
  overlay?: {
    /** Gradiente radial escuro nas bordas. */
    vignette?: number;
    /** Cor translúcida em modo 'multiply' | 'screen' | 'overlay'. */
    tint?: { color: string; alpha: number; mode: GlobalCompositeOperation };
  };
}

export const FILTERS: FilterPreset[] = [
  { id: 'none', label: 'Original', css: 'none' },
  {
    id: 'vivid',
    label: 'Vívido',
    css: 'saturate(1.35) contrast(1.08)',
  },
  {
    id: 'warm',
    label: 'Quente',
    css: 'sepia(0.22) saturate(1.2) brightness(1.03) contrast(1.02)',
  },
  {
    id: 'cool',
    label: 'Frio',
    css: 'saturate(0.95) hue-rotate(-8deg) brightness(1.02) contrast(1.05)',
  },
  {
    id: 'film',
    label: 'Filme',
    css: 'sepia(0.28) saturate(0.9) contrast(1.14) brightness(0.98)',
    overlay: { vignette: 0.32 },
  },
  {
    id: 'vintage',
    label: 'Vintage',
    css: 'sepia(0.45) saturate(0.8) contrast(0.95) brightness(1.06)',
    overlay: { vignette: 0.28, tint: { color: '#ffd9a0', alpha: 0.14, mode: 'soft-light' } },
  },
  {
    id: 'bw',
    label: 'P&B',
    css: 'grayscale(1) contrast(1.12)',
  },
  {
    id: 'noir',
    label: 'Noir',
    css: 'grayscale(1) contrast(1.3) brightness(0.95)',
    overlay: { vignette: 0.5 },
  },
];

export const FILTER_MAP: Record<FilterId, FilterPreset> = Object.fromEntries(
  FILTERS.map((f) => [f.id, f]),
) as Record<FilterId, FilterPreset>;

export const DEFAULT_FILTER: FilterId = 'none';

/* --------------------------------------------------- ajustes (Etapa 10) */

/**
 * Ajustes finos de imagem (inspirados no "Adjust" do CapCut): deslizes que
 * somam ao preset de filtro. `1` (e `0` no calor) é o neutro.
 */
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturate: number;
  /** -1 (frio) .. 0 .. +1 (quente) — aplicado como véu em 'soft-light'. */
  warmth: number;
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  warmth: 0,
};

/** true quando todos os deslizes estão no neutro (não há o que aplicar). */
export function isNeutralAdjust(a?: Adjustments): boolean {
  if (!a) return true;
  return (
    Math.abs(a.brightness - 1) < 0.005 &&
    Math.abs(a.contrast - 1) < 0.005 &&
    Math.abs(a.saturate - 1) < 0.005 &&
    Math.abs(a.warmth) < 0.005
  );
}

/** String dos deslizes pra entrar na mesma lista de `ctx.filter` do preset. */
export function adjustCss(a?: Adjustments): string {
  if (!a || isNeutralAdjust(a)) return '';
  const parts: string[] = [];
  if (Math.abs(a.brightness - 1) >= 0.005) parts.push(`brightness(${a.brightness.toFixed(3)})`);
  if (Math.abs(a.contrast - 1) >= 0.005) parts.push(`contrast(${a.contrast.toFixed(3)})`);
  if (Math.abs(a.saturate - 1) >= 0.005) parts.push(`saturate(${a.saturate.toFixed(3)})`);
  return parts.join(' ');
}

/**
 * Junta as partes numa string válida de `ctx.filter`.
 * 'none' NUNCA entra na lista: `'none blur(4px)'` é string inválida e o
 * navegador ignoraria o filtro inteiro.
 */
export function combineFilters(...parts: (string | undefined | null)[]): string {
  const list = parts
    .flatMap((p) => (p ?? '').trim().split(/\s+/))
    .filter((p) => p && p !== 'none');
  return list.join(' ');
}

/**
 * Véu de temperatura (calor/frio) por cima do conteúdo — o `ctx.filter` não
 * tem um "temperature" de verdade. Chamar depois do preset, antes da legenda.
 */
export function applyWarmth(
  ctx: CanvasRenderingContext2D,
  a: Adjustments | undefined,
  m: FrameLayout = VERTICAL_LAYOUT,
): void {
  const w = a?.warmth ?? 0;
  if (Math.abs(w) < 0.005) return;
  ctx.save();
  ctx.globalAlpha = Math.min(0.4, Math.abs(w) * 0.4);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = w > 0 ? '#ff9a3c' : '#4aa8ff';
  ctx.fillRect(0, 0, m.width, m.height);
  ctx.restore();
}

/**
 * Desenha as camadas extras do filtro (vinheta / tingimento) sobre o conteúdo
 * já desenhado. Chamar SEMPRE antes da legenda.
 *
 * IMPORTANTE: usa o `FrameLayout` (1080×1920 no 9:16, 1920×1080 no 16:9 —
 * Etapa 9), não `ctx.canvas` — o compositor sempre trabalha em coordenadas do
 * layout, mesmo quando a prévia está em meia escala com `setTransform`.
 */
export function applyFilterOverlay(
  ctx: CanvasRenderingContext2D,
  preset: FilterPreset | undefined,
  m: FrameLayout = VERTICAL_LAYOUT,
): void {
  if (!preset?.overlay) return;
  const { vignette, tint } = preset.overlay;

  if (tint) {
    ctx.save();
    ctx.globalAlpha = tint.alpha;
    ctx.globalCompositeOperation = tint.mode;
    ctx.fillStyle = tint.color;
    ctx.fillRect(0, 0, m.width, m.height);
    ctx.restore();
  }

  if (vignette) {
    ctx.save();
    const g = ctx.createRadialGradient(
      m.width / 2,
      m.height / 2,
      Math.min(m.width, m.height) * 0.32,
      m.width / 2,
      m.height / 2,
      Math.max(m.width, m.height) * 0.72,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, m.width, m.height);
    ctx.restore();
  }
}
