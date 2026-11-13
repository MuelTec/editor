import {
  CAPTION_ANIM_DURATION,
  captionBounds,
  computeCaptionLayout,
  renderCaptionLayer,
  type CaptionOptions,
} from './caption';
import {
  DEFAULT_ADJUSTMENTS,
  FILTER_MAP,
  adjustCss,
  applyFilterOverlay,
  applyWarmth,
  combineFilters,
  type Adjustments,
  type FilterId,
} from './filters';
import { VERTICAL_LAYOUT, type FrameLayout } from './format';

/**
 * Qualquer coisa que possa ser desenhada num retângulo: um `VideoSample`
 * (Mediabunny), um `<video>`, uma imagem…
 */
export interface FrameSource {
  width: number;
  height: number;
  draw(
    ctx: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/**
 * Detecta se o canvas suporta o filtro `blur()`.
 * (Safari antigo não suporta — usamos um fallback de redução/escala.)
 */
const supportsCanvasFilter = (() => {
  try {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return false;
    probe.filter = 'blur(1px)';
    return probe.filter === 'blur(1px)';
  } catch {
    return false;
  }
})();

let tinyCanvas: HTMLCanvasElement | null = null;

/** Retângulo que cobre toda a área (estilo "cover") com folga opcional nas bordas. */
function coverRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  overscan = 1,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.max(dstW / srcW, dstH / srcH) * overscan;
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh };
}

/** Retângulo contido (estilo "contain") centralizado. */
export function containRect(
  srcW: number,
  srcH: number,
  m: FrameLayout = VERTICAL_LAYOUT,
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.min(m.width / srcW, m.height / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { dx: (m.width - dw) / 2, dy: (m.height - dh) / 2, dw, dh };
}

/**
 * Desenha o quadro inteiro como FUNDO: preenchendo tudo ("cover"),
 * desfocado e com folga nas bordas (para o blur não criar vinhetas escuras).
 *
 * `baseFilter` é o filtro de cor do preset (Etapa 5) — combinado com o blur
 * na mesma string, já que `ctx.filter` aceita uma lista de filtros.
 */
function drawBlurredBackground(
  ctx: CanvasRenderingContext2D,
  source: FrameSource,
  baseFilter = 'none',
  m: FrameLayout = VERTICAL_LAYOUT,
): void {
  const srcW = source.width;
  const srcH = source.height;

  if (supportsCanvasFilter) {
    ctx.save();
    // Folga maior que o raio do blur: as bordas borradas caem fora do visível.
    // Atenção: 'none blur(4px)' é string INVÁLIDA e seria ignorada pelo
    // navegador (mantendo o filtro anterior) — por isso o 'none' some da lista.
    const blur = `blur(${Math.max(24, Math.round(m.width / 26))}px)`;
    ctx.filter = baseFilter === 'none' ? blur : `${baseFilter} ${blur}`;
    const r = coverRect(srcW, srcH, m.width, m.height, 1.25);
    source.draw(ctx, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
    return;
  }

  // Fallback (sem suporte a filtro): reduz muito a imagem e amplia de volta.
  const tinyW = Math.max(2, Math.round(m.width / 18));
  const tinyH = Math.max(2, Math.round(m.height / 18));
  if (!tinyCanvas || tinyCanvas.width !== tinyW || tinyCanvas.height !== tinyH) {
    tinyCanvas = document.createElement('canvas');
    tinyCanvas.width = tinyW;
    tinyCanvas.height = tinyH;
  }
  const tinyCtx = tinyCanvas.getContext('2d');
  if (!tinyCtx) return;

  const tr = coverRect(srcW, srcH, tinyCanvas.width, tinyCanvas.height, 1.25);
  tinyCtx.clearRect(0, 0, tinyCanvas.width, tinyCanvas.height);
  tinyCtx.save();
  tinyCtx.filter = baseFilter;
  source.draw(tinyCtx, tr.dx, tr.dy, tr.dw, tr.dh);
  tinyCtx.restore();

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const br = coverRect(tinyCanvas.width, tinyCanvas.height, m.width, m.height, 1.25);
  ctx.drawImage(tinyCanvas, br.dx, br.dy, br.dw, br.dh);
  ctx.restore();
}

/**
 * Uma camada de conteúdo: o quadro de um clipe, com opacidade, recorte e
 * deslocamento/escala opcionais (usados pelas transições da montagem).
 */
export interface FrameLayer {
  source: FrameSource;
  /** 0..1 — no crossfade, o clipe novo entra com alpha crescente. */
  alpha?: number;
  /** Recorte em coordenadas do layout (transição wipe). */
  clip?: { x: number; y: number; w: number; h: number } | null;
  /**
   * Deslocamento/escala da camada (Etapa 12): `scale` gira em torno do
   * centro do layout (transição zoom) e `x`/`y` deslocam em px do layout
   * (transição push).
   */
  transform?: { x?: number; y?: number; scale?: number };
}

/** Aplica o transform da camada (escala no centro + deslocamento). */
function applyLayerTransform(
  ctx: CanvasRenderingContext2D,
  transform: NonNullable<FrameLayer['transform']>,
  m: FrameLayout,
): void {
  const scale = transform.scale ?? 1;
  if (scale !== 1) {
    ctx.translate(m.width / 2, m.height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-m.width / 2, -m.height / 2);
  }
  const x = transform.x ?? 0;
  const y = transform.y ?? 0;
  if (x !== 0 || y !== 0) ctx.translate(x, y);
}

/** Extras de desenho aplicados entre o conteúdo e a legenda. */
export interface FrameExtras {
  /** Branco full-screen com essa opacidade (transição flash). */
  flash?: number;
  /**
   * Segundos desde o começo da animação de ENTRADA da legenda (Etapa 10).
   * `undefined` = desenha estático (sem animação).
   */
  animT?: number;
}

/**
 * Monta um quadro no tamanho do layout: fundo borrado + vídeo nítido no
 * centro + legenda (1080×1920 no 9:16, 1920×1080 no 16:9 — Etapa 9).
 *
 * Aceita UMA camada (fluxo de vídeo único) ou DUAS (transição da montagem).
 * A camada da legenda é construída uma única vez (a partir do primeiro frame,
 * quando ainda dá pra medir o contraste do fundo) e daí reaproveitada em
 * todos os frames — mantendo o processamento rápido e em memória constante.
 *
 * O filtro de cor (Etapa 5) é aplicado só no conteúdo; a legenda fica de fora
 * pra continuar nítida. Trocar o filtro reconstrói a camada (o contraste do
 * texto é medido sobre o fundo JÁ filtrado).
 */
export class FrameComposer {
  private captionLayer: HTMLCanvasElement | null = null;
  private captionKey = '';
  private captionPivot = { cx: 0, cy: 0 };

  constructor(
    private readonly caption?: CaptionOptions,
    private readonly filter: FilterId = 'none',
    private readonly layout: FrameLayout = VERTICAL_LAYOUT,
    private readonly adjust: Adjustments = DEFAULT_ADJUSTMENTS,
  ) {}

  render(
    ctx: CanvasRenderingContext2D,
    layers: FrameLayer[],
    extras?: FrameExtras,
  ): void {
    if (layers.length === 0) return;
    const preset = FILTER_MAP[this.filter];
    // Preset + ajustes finos na MESMA string (Etapa 10). O 'none' é removido
    // por combineFilters: `'none ...'` seria string inválida e ignorada.
    const baseFilter = combineFilters(preset?.css, adjustCss(this.adjust)) || 'none';
    const m = this.layout;

    // 1) Fundo desfocado cobrindo tudo (cada camada com sua opacidade —
    //    desenhadas em ordem, o alpha da segunda produz a fusão correta;
    //    o recorte também vale pro fundo, senão o wipe troca o fundo de uma vez)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, m.width, m.height);
    for (const layer of layers) {
      ctx.save();
      ctx.globalAlpha = layer.alpha ?? 1;
      if (layer.transform) applyLayerTransform(ctx, layer.transform, m);
      if (layer.clip) {
        ctx.beginPath();
        ctx.rect(layer.clip.x, layer.clip.y, layer.clip.w, layer.clip.h);
        ctx.clip();
      }
      drawBlurredBackground(ctx, layer.source, baseFilter, m);
      ctx.restore();
    }

    // 2) Vídeo nítido, contido, centralizado (com o mesmo filtro)
    for (const layer of layers) {
      const rect = containRect(layer.source.width, layer.source.height, m);
      ctx.save();
      ctx.globalAlpha = layer.alpha ?? 1;
      if (layer.transform) applyLayerTransform(ctx, layer.transform, m);
      if (layer.clip) {
        ctx.beginPath();
        ctx.rect(layer.clip.x, layer.clip.y, layer.clip.w, layer.clip.h);
        ctx.clip();
      }
      if (supportsCanvasFilter) ctx.filter = baseFilter;
      layer.source.draw(ctx, rect.dx, rect.dy, rect.dw, rect.dh);
      ctx.restore();
    }

    // 2b) Camadas extras do filtro (vinheta / tingimento)
    applyFilterOverlay(ctx, preset, m);
    // 2b2) Calor/frio dos ajustes (Etapa 10) — véu em 'soft-light'
    applyWarmth(ctx, this.adjust, m);

    // 2c) Flash da transição (entre conteúdo e legenda)
    if (extras?.flash && extras.flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, extras.flash);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, m.width, m.height);
      ctx.restore();
    }

    // 3) Legenda por cima (só na área livre / zonas seguras)
    if (this.caption) {
      const key = JSON.stringify([
        this.caption,
        this.filter,
        m.width,
        m.height,
        this.adjust,
      ]);
      if (key !== this.captionKey) {
        const first = layers[0].source;
        const rect = containRect(first.width, first.height, m);
        const layout = computeCaptionLayout(
          ctx,
          { top: rect.dy, bottom: rect.dy + rect.dh },
          this.caption,
          m,
        );
        this.captionLayer = layout ? renderCaptionLayer(layout, m) : null;
        if (layout) this.captionPivot = captionBounds(layout, m);
        this.captionKey = key;
      }

      if (this.captionLayer) {
        const anim = this.caption.anim;
        const t = extras?.animT;
        if (anim !== 'none' && t !== undefined && t < CAPTION_ANIM_DURATION) {
          // Entrada em 0,5s (Etapa 10): o texto entra suave, o véu junto.
          const p = Math.min(1, Math.max(0, t / CAPTION_ANIM_DURATION));
          const ease = 1 - Math.pow(1 - p, 3);
          ctx.save();
          if (anim === 'fade') {
            ctx.globalAlpha = ease;
          } else if (anim === 'rise') {
            ctx.globalAlpha = ease;
            ctx.translate(0, (1 - ease) * 56);
          } else {
            // pop com leve "overshoot" (elasticidade leve)
            const c1 = 1.70158;
            const c3 = c1 + 1;
            const back = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
            const scale = 0.86 + 0.14 * back;
            ctx.globalAlpha = Math.min(1, p * 1.6);
            ctx.translate(this.captionPivot.cx, this.captionPivot.cy);
            ctx.scale(scale, scale);
            ctx.translate(-this.captionPivot.cx, -this.captionPivot.cy);
          }
          ctx.drawImage(this.captionLayer, 0, 0);
          ctx.restore();
        } else {
          ctx.drawImage(this.captionLayer, 0, 0);
        }
      }
    }
  }
}
