import { VERTICAL_LAYOUT, type FrameLayout } from './format';

/**
 * Módulo de legenda automática (Etapa 2).
 *
 * Regras:
 *  - nenhum texto cai nas zonas seguras (top 250px / base 350px no 9:16);
 *  - o texto só entra na faixa livre entre o vídeo nítido e as zonas seguras;
 *  - a cor é escolhida por contraste WCAG sobre o fundo realmente desenhado;
 *  - se o contraste não for suficiente, um scrim (véu escuro) é acrescentado.
 *
 * A geometria (tamanho, zonas, margens) vem de um `FrameLayout` — é assim
 * que o mesmo código serve o 9:16 e o 16:9 (Etapa 9).
 */

export type FontId = 'sans' | 'black' | 'serif' | 'mono';
export type CaptionColor = 'auto' | 'white' | 'black';
export type CaptionAlign = 'center' | 'left';
export type CaptionEffect = 'none' | 'shadow' | 'outline' | 'glow' | 'box' | 'highlight' | 'gradient';
/** Animação de ENTRADA da legenda (Etapa 10 — estilo CapCut). */
export type CaptionAnim = 'none' | 'fade' | 'rise' | 'pop';

export interface CaptionOptions {
  title: string;
  subtitle: string;
  /**
   * Onde o texto fica: centro do bloco, como fração do quadro (0 = borda
   * esquerda/topo, 1 = borda direita/base). Qualquer ponto vale — o bloco só
   * é empurrado pra dentro se passaria da borda.
   */
  x: number;
  y: number;
  /** Tamanho do texto principal, em pixels do quadro de 1080 de largura. */
  size: number;
  font: FontId;
  color: CaptionColor;
  align: CaptionAlign;
  uppercase: boolean;
  effect: CaptionEffect;
  /** Cor usada por brilho, caixa, destaque e degradê. */
  effectColor: string;
  /** Como o texto entra (0,5s). No vídeo único começa no tempo 0. */
  anim: CaptionAnim;
}

export const DEFAULT_CAPTION: CaptionOptions = {
  title: '',
  subtitle: '',
  x: 0.5,
  y: 0.78,
  size: 72,
  font: 'sans',
  color: 'auto',
  align: 'center',
  uppercase: true,
  effect: 'shadow',
  effectColor: '#ffd400',
  anim: 'rise',
};

/** Duração da animação de entrada, em segundos. */
export const CAPTION_ANIM_DURATION = 0.5;

interface FontDef {
  family: string;
  weight: number;
}

/** Fontes do próprio sistema: nada é baixado, o processamento segue 100% local. */
const FONT_STACKS: Record<FontId, FontDef> = {
  sans: {
    family:
      "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    weight: 800,
  },
  black: {
    family: "'Arial Black', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    weight: 900,
  },
  serif: {
    family: "Georgia, 'Times New Roman', Times, serif",
    weight: 700,
  },
  mono: {
    family:
      "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    weight: 700,
  },
};

export const FONT_OPTIONS: { id: FontId; label: string }[] = [
  { id: 'sans', label: 'Sans — moderna' },
  { id: 'black', label: 'Black — impacto' },
  { id: 'serif', label: 'Serif — elegante' },
  { id: 'mono', label: 'Mono — técnica' },
];

/** Atalhos de posição (só preenchem X/Y — dá pra ajustar do jeito que quiser depois). */
export const POSITION_PRESETS: { id: string; label: string; x: number; y: number }[] = [
  { id: 'top', label: 'Topo', x: 0.5, y: 0.16 },
  { id: 'center', label: 'Centro', x: 0.5, y: 0.5 },
  { id: 'bottom', label: 'Base', x: 0.5, y: 0.78 },
];

/** Limites do tamanho do texto (px no quadro de 1080 de largura). */
export const CAPTION_SIZE_MIN = 28;
export const CAPTION_SIZE_MAX = 160;

export const COLOR_OPTIONS: { id: CaptionColor; label: string }[] = [
  { id: 'auto', label: 'Automática' },
  { id: 'white', label: 'Branco' },
  { id: 'black', label: 'Preto' },
];

export const ALIGN_OPTIONS: { id: CaptionAlign; label: string }[] = [
  { id: 'center', label: 'Centralizado' },
  { id: 'left', label: 'À esquerda' },
];

export const EFFECT_OPTIONS: { id: CaptionEffect; label: string }[] = [
  { id: 'shadow', label: 'Sombra' },
  { id: 'outline', label: 'Contorno' },
  { id: 'glow', label: 'Brilho' },
  { id: 'box', label: 'Caixa' },
  { id: 'highlight', label: 'Destaque' },
  { id: 'gradient', label: 'Degradê' },
  { id: 'none', label: 'Nenhum' },
];

export const ANIM_OPTIONS: { id: CaptionAnim; label: string }[] = [
  { id: 'none', label: 'Nenhuma' },
  { id: 'fade', label: 'Fade' },
  { id: 'rise', label: 'Sobe' },
  { id: 'pop', label: 'Pop' },
];

/** Efeitos que usam a "cor do efeito". */
export const EFFECTS_WITH_COLOR: CaptionEffect[] = [
  'glow',
  'box',
  'highlight',
  'gradient',
];

export const EFFECT_COLORS: string[] = [
  '#ffd400',
  '#ff5a5f',
  '#ff7bd5',
  '#a78bfa',
  '#5b8cff',
  '#3ecf8e',
  '#ffffff',
  '#111111',
];

/** A legenda existe mesmo só com um dos campos preenchidos? */
export function hasCaptionText(c: CaptionOptions): boolean {
  return c.title.trim().length > 0 || c.subtitle.trim().length > 0;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export interface CaptionLine {
  text: string;
  size: number;
  /** Centro da linha (baseline 'middle'). */
  y: number;
}

export interface CaptionLayout {
  lines: CaptionLine[];
  align: CaptionAlign;
  font: FontId;
  color: string;
  effect: CaptionEffect;
  effectColor: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
  /** Faixa do véu escuro atrás do texto, ou null. */
  scrim: { top: number; bottom: number } | null;
  /**
   * Âncora horizontal das linhas: o CENTRO delas (alinhamento centralizado) ou
   * a borda ESQUERDA do bloco (alinhado à esquerda).
   */
  anchorX: number;
  /** Extensão horizontal do bloco (pro degradê e pra medir o contraste). */
  x0: number;
  x1: number;
}

interface Fit {
  size: number;
  lines: string[];
  subSize: number;
  subLines: string[];
  blockH: number;
  widest: number;
  lineH: number;
  subLineH: number;
  gap: number;
}

function fontStr(font: FontId, size: number): string {
  const def = FONT_STACKS[font];
  return `${def.weight} ${size}px ${def.family}`;
}

/** Quebra o texto em linhas respeitando quebras de linha manuais. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: FontId,
  size: number,
): { lines: string[]; widest: number } {
  ctx.font = fontStr(font, size);
  const lines: string[] = [];
  let widest = 0;

  for (const para of text.split('\n')) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let cur = '';
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (!cur || ctx.measureText(next).width <= maxWidth) {
        cur = next;
      } else {
        widest = Math.max(widest, ctx.measureText(cur).width);
        lines.push(cur);
        cur = word;
      }
    }
    widest = Math.max(widest, ctx.measureText(cur).width);
    lines.push(cur);
  }
  return { lines, widest };
}

/** Reduz o tamanho da fonte até o bloco caber na faixa e na largura útil. */
function fitText(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
  font: FontId,
  maxWidth: number,
  avail: number,
  /** Tamanho pedido: só diminui se uma palavra não couber na largura. */
  startSize = 116,
  minSize = 40,
): Fit {
  let best: Fit | null = null;
  for (let size = startSize; size >= minSize; size -= 4) {
    const t = wrapText(ctx, title, maxWidth, font, size);
    const subSize = subtitle
      ? Math.min(58, Math.max(Math.round(size * 0.46), Math.min(26, size)))
      : 0;
    const s = subtitle
      ? wrapText(ctx, subtitle, maxWidth, font, subSize)
      : { lines: [] as string[], widest: 0 };

    const lineH = Math.round(size * 1.12);
    const subLineH = subSize ? Math.round(subSize * 1.3) : 0;
    const gap = s.lines.length ? Math.round(size * 0.34) : 0;
    const blockH = t.lines.length * lineH + gap + s.lines.length * subLineH;
    const widest = Math.max(t.widest, s.widest);

    const fit: Fit = {
      size,
      lines: t.lines,
      subSize,
      subLines: s.lines,
      blockH,
      widest,
      lineH,
      subLineH,
      gap,
    };
    best = fit;
    if (blockH <= avail && widest <= maxWidth) return fit;
  }
  // Nem no menor tamanho coube: devolve o melhor esforço.
  return best as Fit;
}

/** Luminância relativa (WCAG) média de um retângulo do canvas. */
function sampleLuminance(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): number | null {
  try {
    const { data } = ctx.getImageData(x, y, Math.max(1, w), Math.max(1, h));
    const lin = (c: number) =>
      c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    let sum = 0;
    let n = 0;
    // Amostra a cada 16 pixels: barato e suficiente pra escolher a cor.
    for (let i = 0; i < data.length; i += 4 * 16) {
      sum +=
        0.2126 * lin(data[i] / 255) +
        0.7152 * lin(data[i + 1] / 255) +
        0.0722 * lin(data[i + 2] / 255);
      n++;
    }
    return n ? sum / n : null;
  } catch {
    return null;
  }
}

function contrastRatio(lum: number, white: boolean): number {
  const bg = Math.min(1, Math.max(0, lum));
  const hi = white ? 1 : bg;
  const lo = white ? bg : 0;
  return (hi + 0.05) / (lo + 0.05);
}

/** Limita `v` a [lo, hi]; se o intervalo for invertido (bloco maior que o quadro), vale `lo`. */
function clampRange(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Calcula o layout do texto no ponto (x, y) escolhido. O `ctx` precisa já ter
 * o fundo borrado e o vídeo nítido desenhados — é sobre eles, NO LUGAR onde o
 * texto vai ficar, que medimos o contraste.
 */
export function computeCaptionLayout(
  ctx: CanvasRenderingContext2D,
  opts: CaptionOptions,
  m: FrameLayout = VERTICAL_LAYOUT,
): CaptionLayout | null {
  const applyCase = (s: string) => (opts.uppercase ? s.toUpperCase() : s);
  const main = applyCase(opts.title.trim());
  const extra = applyCase(opts.subtitle.trim());
  const titleText = main || extra;
  const subtitleText = main ? extra : '';
  if (!titleText) return null;

  const maxWidth = m.width - m.sideMargin * 2;
  const wanted = Math.round(
    Math.min(CAPTION_SIZE_MAX, Math.max(CAPTION_SIZE_MIN, opts.size || DEFAULT_CAPTION.size)),
  );
  // Sem limite de altura: o texto tem o tamanho pedido (só quebra em linhas).
  const fit = fitText(ctx, titleText, subtitleText, opts.font, maxWidth, Infinity, wanted, 24);

  // Centro do bloco no ponto escolhido — e o bloco inteiro SEMPRE dentro do quadro.
  const edge = 24;
  const cx = Math.min(1, Math.max(0, opts.x)) * m.width;
  const cy = Math.min(1, Math.max(0, opts.y)) * m.height;
  const padX = Math.round(fit.size * 0.34); // folga da caixa/destaque
  const halfW = fit.widest / 2;

  let anchorX: number;
  let x0: number;
  if (opts.align === 'center') {
    anchorX = clampRange(cx, halfW + padX, m.width - halfW - padX);
    x0 = anchorX - halfW;
  } else {
    x0 = clampRange(cx - halfW, padX, m.width - fit.widest - padX);
    anchorX = x0;
  }
  const x1 = x0 + fit.widest;

  const lines: CaptionLine[] = [];
  let y = clampRange(cy - fit.blockH / 2, edge, m.height - edge - fit.blockH);
  for (const text of fit.lines) {
    lines.push({ text, size: fit.size, y: y + fit.lineH / 2 });
    y += fit.lineH;
  }
  if (fit.subLines.length) {
    y += fit.gap;
    for (const text of fit.subLines) {
      lines.push({ text, size: fit.subSize, y: y + fit.subLineH / 2 });
      y += fit.subLineH;
    }
  }
  if (!lines.length) return null;

  const blockTop = lines[0].y - lines[0].size * 0.62;
  const last = lines[lines.length - 1];
  const blockBottom = last.y + last.size * 0.62;

  // Escolhe a cor do TEXTO com maior razão de contraste (WCAG), medindo só
  // a região onde o texto cai.
  const sx = Math.max(0, Math.floor(x0 - 12));
  const lum = sampleLuminance(
    ctx,
    sx,
    Math.max(0, Math.floor(blockTop)),
    Math.max(1, Math.min(m.width, Math.ceil(x1 + 12)) - sx),
    Math.max(1, Math.ceil(blockBottom - blockTop)),
  );

  let color: string;
  if (opts.effect === 'box' || opts.effect === 'highlight') {
    // O texto cai em cima da própria caixa: contraste contra a cor do efeito.
    color = bestTextOn(opts.effectColor);
  } else if (opts.effect === 'gradient') {
    color = '#ffffff';
  } else if (opts.color === 'white') color = '#ffffff';
  else if (opts.color === 'black') color = '#000000';
  else if (lum === null) color = '#ffffff';
  else color = contrastRatio(lum, true) >= contrastRatio(lum, false) ? '#ffffff' : '#000000';

  // Caixa/destaque têm fundo próprio e o contorno garante a leitura; os demais
  // dependem do contraste com o que estiver atrás.
  const selfLegible =
    opts.effect === 'box' || opts.effect === 'highlight' || opts.effect === 'outline';
  const ratio = lum === null ? 4.6 : contrastRatio(lum, color === '#ffffff');
  const needScrim = !selfLegible && ratio < 4.5;
  const scrim = needScrim
    ? {
        top: Math.max(0, Math.floor(blockTop - 70)),
        bottom: Math.min(m.height, Math.ceil(blockBottom + 70)),
      }
    : null;

  return {
    lines,
    align: opts.align,
    font: opts.font,
    color,
    effect: opts.effect,
    effectColor: opts.effectColor,
    shadowColor:
      color === '#ffffff' ? 'rgba(0, 0, 0, 0.62)' : 'rgba(255, 255, 255, 0.5)',
    shadowBlur: Math.round(fit.size * 0.24),
    shadowOffsetY: Math.round(fit.size * 0.04),
    scrim,
    anchorX,
    x0,
    x1,
  };
}

/** Luminância relativa (WCAG) de uma cor hex. */
export function luminanceOf(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * lin((n >> 16) & 255) +
    0.7152 * lin((n >> 8) & 255) +
    0.0722 * lin(n & 255)
  );
}

/** Preto ou branco, o que tiver mais contraste sobre a cor dada. */
function bestTextOn(hex: string): string {
  return luminanceOf(hex) > 0.179 ? '#000000' : '#ffffff';
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Desenha a legenda numa camada transparente no tamanho do layout
 * (1080×1920 no 9:16, 1920×1080 no 16:9 — Etapa 9).
 * A camada é criada uma vez só e reaproveitada em todos os frames.
 */
export function renderCaptionLayer(
  layout: CaptionLayout,
  m: FrameLayout = VERTICAL_LAYOUT,
  /** Canvas de uma camada anterior: reaproveitado (arrastar o texto recria a camada a cada quadro). */
  reuse?: HTMLCanvasElement | null,
): HTMLCanvasElement {
  const canvas = reuse ?? document.createElement('canvas');
  if (canvas.width !== m.width) canvas.width = m.width;
  if (canvas.height !== m.height) canvas.height = m.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, m.width, m.height);

  const { lines, align, font, color, effect, effectColor } = layout;

  // 1) Véu escuro atrás do bloco (legibilidade / modo sobreposição)
  if (layout.scrim) {
    const gradient = ctx.createLinearGradient(
      0,
      layout.scrim.top,
      0,
      layout.scrim.bottom,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.58)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.58)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(
      0,
      layout.scrim.top,
      m.width,
      layout.scrim.bottom - layout.scrim.top,
    );
  }

  const x = layout.anchorX;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  // 2) Caixa / destaque atrás de cada linha
  if (effect === 'box' || effect === 'highlight') {
    ctx.fillStyle = effectColor;
    ctx.globalAlpha = effect === 'highlight' ? 0.88 : 0.95;
    for (const line of lines) {
      ctx.font = fontStr(font, line.size);
      const w = ctx.measureText(line.text).width;
      const padX = line.size * (effect === 'box' ? 0.3 : 0.22);
      const padY = line.size * (effect === 'box' ? 0.24 : 0.08);
      const left = (align === 'center' ? x - w / 2 : x) - padX;
      const top = line.y - line.size * 0.6 - padY;
      const h = line.size * 1.2 + padY * 2;
      roundRect(ctx, left, top, w + padX * 2, h, line.size * (effect === 'box' ? 0.2 : 0.08));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 3) Sombra / brilho
  const glowBlur = Math.max(20, Math.round(lines[0].size * 0.55));
  const applyShadow = () => {
    if (effect === 'none') {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    } else if (effect === 'glow') {
      ctx.shadowColor = effectColor;
      ctx.shadowBlur = glowBlur;
      ctx.shadowOffsetY = 0;
    } else {
      ctx.shadowColor = layout.shadowColor;
      ctx.shadowBlur =
        effect === 'box' || effect === 'highlight'
          ? Math.round(layout.shadowBlur * 0.6)
          : layout.shadowBlur;
      ctx.shadowOffsetY = layout.shadowOffsetY;
    }
  };

  // 4) Preenchimento (sólido ou degradê)
  const fill = () => {
    if (effect === 'gradient') {
      const g = ctx.createLinearGradient(layout.x0, 0, layout.x1, 0);
      g.addColorStop(0, effectColor);
      g.addColorStop(1, '#ffffff');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = color;
    }
  };

  const strokeColor =
    color === '#ffffff' ? 'rgba(0, 0, 0, 0.92)' : 'rgba(255, 255, 255, 0.94)';

  for (const line of lines) {
    ctx.font = fontStr(font, line.size);

    // Contorno desenhado primeiro, sem sombra (senão fica sujo)
    if (effect === 'outline') {
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, line.size * 0.14);
      ctx.strokeStyle = strokeColor;
      ctx.strokeText(line.text, x, line.y);
      ctx.restore();
    }

    applyShadow();
    fill();
    ctx.fillText(line.text, x, line.y);
    // Segunda passada reforça o brilho
    if (effect === 'glow') ctx.fillText(line.text, x, line.y);
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  return canvas;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/**
 * Centro do bloco de texto no espaço do layout — usado como pivô da animação
 * de entrada (fade/sobe/pop), que precisa escalar/translate em volta dele.
 */
export function captionBounds(
  layout: CaptionLayout,
  m: FrameLayout = VERTICAL_LAYOUT,
): { cx: number; cy: number } {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  if (!measureCtx) return { cx: m.width / 2, cy: m.height / 2 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const line of layout.lines) {
    measureCtx.font = fontStr(layout.font, line.size);
    const w = measureCtx.measureText(line.text).width;
    const left = layout.align === 'center' ? layout.anchorX - w / 2 : layout.anchorX;
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, left + w);
    minY = Math.min(minY, line.y - line.size * 0.62);
    maxY = Math.max(maxY, line.y + line.size * 0.62);
  }

  if (!Number.isFinite(minX)) return { cx: m.width / 2, cy: m.height / 2 };
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
