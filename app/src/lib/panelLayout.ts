/**
 * Layout dos painéis do editor: tamanho de cada área, e quais estão escondidas.
 *
 * A grade do editor é guiada por três variáveis CSS (`--sidebar-w`,
 * `--inspector-w`, `--timeline-h`); a PRÉVIA ocupa o espaço que sobrar — por
 * isso, quando um painel cresce, o resto se ajusta sozinho.
 *
 * Este módulo é puro (sem DOM): dá pra testar sozinho.
 */

export type PanelId = 'lib' | 'insp' | 'tl';

export interface PanelLayout {
  /** Largura da biblioteca (px). `null` = tamanho padrão do CSS (que muda com a tela). */
  lib: number | null;
  /** Largura do inspetor (px). */
  insp: number | null;
  /** Altura da timeline (px). */
  tl: number | null;
  hideLib: boolean;
  hideInsp: boolean;
  hideTl: boolean;
}

export const DEFAULT_LAYOUT: PanelLayout = {
  lib: null,
  insp: null,
  tl: null,
  hideLib: false,
  hideInsp: false,
  hideTl: false,
};

export const LAYOUT_KEY = 'estudio.layout.v1';

/** Limites de cada painel (px). */
export const LIMITS: Record<PanelId, { min: number; max: number }> = {
  lib: { min: 200, max: 560 },
  insp: { min: 230, max: 520 },
  tl: { min: 150, max: 600 },
};

/** A prévia nunca fica menor que isso (px). */
export const MIN_PREVIEW_W = 260;
export const MIN_PREVIEW_H = 180;

/** Espaço disponível agora (tamanhos dos painéis VISÍVEIS; escondido = 0). */
export interface Space {
  width: number;
  height: number;
  headerH: number;
  lib: number;
  insp: number;
  tl: number;
}

const sizeKey = (id: PanelId): 'lib' | 'insp' | 'tl' => id;
const hideKey = (id: PanelId): 'hideLib' | 'hideInsp' | 'hideTl' =>
  id === 'lib' ? 'hideLib' : id === 'insp' ? 'hideInsp' : 'hideTl';

/** Limita um tamanho aos limites do painel E ao espaço que sobra pra prévia. */
export function clampPanel(id: PanelId, value: number, space: Space): number {
  const lim = LIMITS[id];
  let max = lim.max;
  if (id === 'lib') max = Math.min(max, space.width - space.insp - MIN_PREVIEW_W);
  else if (id === 'insp') max = Math.min(max, space.width - space.lib - MIN_PREVIEW_W);
  else max = Math.min(max, space.height - space.headerH - MIN_PREVIEW_H);
  // Tela pequena demais pra respeitar tudo: vale o mínimo do painel.
  const hi = Math.max(lim.min, max);
  const v = Number.isFinite(value) ? value : lim.min;
  return Math.round(Math.min(Math.max(v, lim.min), hi));
}

export function resizePanel(l: PanelLayout, id: PanelId, value: number): PanelLayout {
  return { ...l, [sizeKey(id)]: value };
}

/** Volta o painel ao tamanho padrão. */
export function resetPanel(l: PanelLayout, id: PanelId): PanelLayout {
  return { ...l, [sizeKey(id)]: null };
}

/** Esconde se estava visível; mostra se estava escondido (o mesmo botão faz os dois). */
export function togglePanel(l: PanelLayout, id: PanelId): PanelLayout {
  const k = hideKey(id);
  return { ...l, [k]: !l[k] };
}

export function isHidden(l: PanelLayout, id: PanelId): boolean {
  return l[hideKey(id)];
}

/**
 * Variáveis CSS do layout. `undefined` = não mexe (vale o CSS, que muda com o
 * tamanho da tela). O `min(..., vw/vh)` garante que, numa janela menor que a
 * de quando você ajustou, a prévia não some.
 */
export function layoutVars(l: PanelLayout): {
  '--sidebar-w'?: string;
  '--inspector-w'?: string;
  '--timeline-h'?: string;
} {
  const px = (n: number | null, cap: string): string | undefined =>
    n === null ? undefined : `min(${n}px, ${cap})`;
  return {
    '--sidebar-w': l.hideLib ? '0px' : px(l.lib, '36vw'),
    '--inspector-w': l.hideInsp ? '0px' : px(l.insp, '36vw'),
    '--timeline-h': l.hideTl ? '0px' : px(l.tl, '58vh'),
  };
}

/** Lê o que foi salvo; qualquer coisa estranha vira o padrão (nunca quebra o app). */
export function parseLayout(raw: string | null | undefined): PanelLayout {
  if (!raw) return { ...DEFAULT_LAYOUT };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return { ...DEFAULT_LAYOUT };
    const size = (v: unknown, id: PanelId): number | null => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      const { min, max } = LIMITS[id];
      return Math.round(Math.min(Math.max(v, min), max));
    };
    return {
      lib: size(o.lib, 'lib'),
      insp: size(o.insp, 'insp'),
      tl: size(o.tl, 'tl'),
      hideLib: o.hideLib === true,
      hideInsp: o.hideInsp === true,
      hideTl: o.hideTl === true,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function serializeLayout(l: PanelLayout): string {
  return JSON.stringify(l);
}
