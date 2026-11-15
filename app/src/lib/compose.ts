import {
  CAPTION_ANIM_DURATION,
  captionBounds,
  computeCaptionLayout,
  hasCaptionText,
  renderCaptionLayer,
} from './caption';
import { activeTexts, type TextClip } from './textTrack';
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
 *
 * `fast` (prévia): em vez de aplicar `blur(42px)` direto no GPU — caro em
 * tablets/Android WebView — desenha REDUZIDO (1/18) e amplia de volta. O
 * blur pequeno no canvas reduzido custa uma fração e o resultado ampliado
 * é equivalente.
 */
function drawBlurredBackground(
  ctx: CanvasRenderingContext2D,
  source: FrameSource,
  baseFilter = 'none',
  m: FrameLayout = VERTICAL_LAYOUT,
  fast = false,
): void {
  const srcW = source.width;
  const srcH = source.height;

  if (supportsCanvasFilter && !fast) {
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

  // Caminho reduzido (fallback sem filtro OU modo rápido da prévia):
  // reduz muito a imagem e amplia de volta — o próprio upscale borracha,
  // e um blur pequeno no canvas reduzido fecha o efeito.
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
  if (fast && supportsCanvasFilter) {
    // Raio equivalente em escala reduzida (blur cheio ≈ width/26).
    const full = Math.max(24, Math.round(m.width / 26));
    const scaled = Math.max(1, Math.round(full / (m.width / tinyW)));
    const blur = `blur(${scaled}px)`;
    tinyCtx.filter = baseFilter === 'none' ? blur : `${baseFilter} ${blur}`;
  } else {
    tinyCtx.filter = baseFilter;
  }
  source.draw(tinyCtx, tr.dx, tr.dy, tr.dw, tr.dh);
  tinyCtx.restore();

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // 'high' é resampling caro no CPU: só no fallback sem filtro. No modo
  // rápido a fonte já está borrada e o upscale não precisa dele (Etapa 13).
  if (!fast) ctx.imageSmoothingQuality = 'high';
  const br = coverRect(tinyCanvas.width, tinyCanvas.height, m.width, m.height, 1.25);
  ctx.drawImage(tinyCanvas, br.dx, br.dy, br.dw, br.dh);
  ctx.restore();
}

/**
 * Desenha o VÍDEO NÍTIDO com um blur de transição aplicado.
 *
 * No modo `fast` (prévia), o blur do GPU é substituído pela mesma técnica
 * reduzida do fundo: desenha pequeno com blur pequeno e amplia — muito mais
 * leve em tablets, onde `ctx.filter = blur(30px)` em 1080×1920 derruba o
 * quadro.
 */
function drawBlurredContent(
  ctx: CanvasRenderingContext2D,
  source: FrameSource,
  baseFilter: string,
  blurPx: number,
  rect: { dx: number; dy: number; dw: number; dh: number },
  m: FrameLayout,
  fast: boolean,
): void {
  if (!fast || !supportsCanvasFilter) {
    const filter = combineFilters(baseFilter, `blur(${Math.round(blurPx)}px)`);
    if (supportsCanvasFilter) ctx.filter = filter || 'none';
    source.draw(ctx, rect.dx, rect.dy, rect.dw, rect.dh);
    return;
  }

  const tinyW = Math.max(2, Math.round(m.width / 18));
  const tinyH = Math.max(2, Math.round(m.height / 18));
  if (!tinyCanvas || tinyCanvas.width !== tinyW || tinyCanvas.height !== tinyH) {
    tinyCanvas = document.createElement('canvas');
    tinyCanvas.width = tinyW;
    tinyCanvas.height = tinyH;
  }
  const tinyCtx = tinyCanvas.getContext('2d');
  if (!tinyCtx) return;

  const tr = containRect(source.width, source.height, {
    ...m,
    width: tinyW,
    height: tinyH,
  });
  tinyCtx.clearRect(0, 0, tinyW, tinyH);
  tinyCtx.save();
  const scaled = Math.max(1, Math.round(blurPx / (m.width / tinyW)));
  const filter = combineFilters(baseFilter, `blur(${scaled}px)`);
  tinyCtx.filter = filter || 'none';
  source.draw(tinyCtx, tr.dx, tr.dy, tr.dw, tr.dh);
  tinyCtx.restore();

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // Copia o canvas reduzido INTEIRO (o blur sangra pra fora do retângulo).
  // Qualidade padrão: a fonte já está borrada, 'high' só custaria CPU.
  ctx.drawImage(tinyCanvas, 0, 0, tinyW, tinyH, 0, 0, m.width, m.height);
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
  /** Recorte em coordenadas do layout (transição wipe). `circle` vira máscara redonda. */
  clip?: { x: number; y: number; w: number; h: number; circle?: boolean } | null;
  /**
   * Deslocamento/escala da camada (Etapa 12): `scale` gira em torno do
   * centro do layout (transição zoom), `x`/`y` deslocam em px do layout
   * (transição push), `scaleX`/`scaleY` fazem o efeito de GIRA 3D
   * (transição flip — cartão virando) e `rotate` gira em radianos
   * (transição Spin).
   */
  transform?: {
    x?: number;
    y?: number;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    /** Rotação em radianos em torno do centro do layout (transição Spin). */
    rotate?: number;
  };
  /** Raio de desfoque em px do layout (transição blur). */
  blur?: number;
  /** Intensidade 0..1 do glitch (fatias deslocadas + tintes, Etapa 12). */
  glitch?: number;
  /**
   * Se o FUNDO borrado acompanha o transform da camada (padrão `true`).
   * A transição 3D desliga isso: o fundo continua cobrindo o quadro inteiro
   * enquanto só o vídeo nítido gira por cima dele.
   */
  transformBg?: boolean;
}

/** Aplica o transform da camada (escala/rotação no centro + deslocamento). */
function applyLayerTransform(
  ctx: CanvasRenderingContext2D,
  transform: NonNullable<FrameLayer['transform']>,
  m: FrameLayout,
): void {
  const scale = transform.scale ?? 1;
  const scaleX = transform.scaleX ?? 1;
  const scaleY = transform.scaleY ?? 1;
  const rotate = transform.rotate ?? 0;
  const sx = scale * scaleX;
  const sy = scale * scaleY;
  if (sx !== 1 || sy !== 1 || rotate !== 0) {
    ctx.translate(m.width / 2, m.height / 2);
    if (rotate !== 0) ctx.rotate(rotate);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.translate(-m.width / 2, -m.height / 2);
  }
  const x = transform.x ?? 0;
  const y = transform.y ?? 0;
  if (x !== 0 || y !== 0) ctx.translate(x, y);
}

/** Aplica o recorte da camada: retângulo (wipe) ou círculo (iris). */
function applyLayerClip(
  ctx: CanvasRenderingContext2D,
  clip: NonNullable<FrameLayer['clip']>,
): void {
  ctx.beginPath();
  if (clip.circle) {
    ctx.ellipse(
      clip.x + clip.w / 2,
      clip.y + clip.h / 2,
      Math.abs(clip.w) / 2,
      Math.abs(clip.h) / 2,
      0,
      0,
      Math.PI * 2,
    );
  } else {
    ctx.rect(clip.x, clip.y, clip.w, clip.h);
  }
  ctx.clip();
}

/** Pseudo-aleatório determinístico (mesmo valor pra mesma faixa). */
function bandNoise(i: number): number {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** Extras de desenho aplicados entre o conteúdo e a legenda. */
export interface FrameExtras {
  /** Véu full-screen com essa opacidade (transições flash/luz/preto). */
  flash?: number;
  /** Cor do véu (padrão branco). Preto = transição "Escurecer". */
  flashColor?: string;
  /**
   * Tempo (s) deste quadro na timeline de SAÍDA. Decide quais blocos de texto
   * estão no ar e quanto da animação de entrada de cada um já rodou
   * (`time - início do bloco`). `undefined` = tempo 0.
   */
  time?: number;
}

/** Camada de um bloco de texto já montada (reaproveitada enquanto ele está no ar). */
interface TextLayerEntry {
  key: string;
  layer: HTMLCanvasElement | null;
  pivot: { cx: number; cy: number };
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
  /**
   * Uma camada por bloco de texto, criada quando ele entra no ar e descartada
   * quando sai (cada camada é um canvas do tamanho do quadro — não dá pra
   * guardar dezenas ao mesmo tempo num tablet).
   */
  private readonly textLayers = new Map<string, TextLayerEntry>();
  /** Buffer do glitch (1 desenho de vídeo + cópias de faixa — Etapa 13). */
  private glitchBuffer: HTMLCanvasElement | null = null;

  constructor(
    private texts?: readonly TextClip[],
    private readonly filter: FilterId = 'none',
    private readonly layout: FrameLayout = VERTICAL_LAYOUT,
    private readonly adjust: Adjustments = DEFAULT_ADJUSTMENTS,
    /** Prévia: usa o caminho reduzido do blur (leve em tablets). */
    private readonly fast = false,
  ) {}

  /**
   * Troca SÓ os textos, mantendo as camadas já montadas: arrastar um texto
   * refaz a camada dele reaproveitando o mesmo canvas (e os outros textos nem
   * são tocados), em vez de alocar um quadro inteiro a cada movimento.
   */
  setTexts(texts: readonly TextClip[] | undefined): void {
    this.texts = texts;
  }

  private ensureGlitchBuffer(m: FrameLayout): HTMLCanvasElement | null {
    let buf = this.glitchBuffer;
    if (!buf || buf.width !== m.width || buf.height !== m.height) {
      buf = document.createElement('canvas');
      buf.width = m.width;
      buf.height = m.height;
      this.glitchBuffer = buf;
    }
    return buf;
  }

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
      // Blur da transição entra na MESMA string de filtro do preset.
      const layerFilter = layer.blur
        ? combineFilters(baseFilter, `blur(${Math.round(layer.blur)}px)`)
        : baseFilter;
      ctx.save();
      ctx.globalAlpha = layer.alpha ?? 1;
      if (layer.transform && layer.transformBg !== false) {
        applyLayerTransform(ctx, layer.transform, m);
      }
      if (layer.clip) applyLayerClip(ctx, layer.clip);
      drawBlurredBackground(ctx, layer.source, layerFilter, m, this.fast);
      ctx.restore();
    }

    // 2) Vídeo nítido, contido, centralizado (com o mesmo filtro)
    for (const layer of layers) {
      const rect = containRect(layer.source.width, layer.source.height, m);
      const layerFilter = layer.blur
        ? combineFilters(baseFilter, `blur(${Math.round(layer.blur)}px)`)
        : baseFilter;
      ctx.save();
      ctx.globalAlpha = layer.alpha ?? 1;
      if (layer.transform) applyLayerTransform(ctx, layer.transform, m);
      if (layer.clip) applyLayerClip(ctx, layer.clip);
      if (layer.glitch && layer.glitch > 0) {
        // GLITCH (Etapa 12/13): 1 desenho de vídeo num buffer + faixas
        // copiadas do próprio buffer — antes eram 7 desenhos de vídeo com
        // filtro, o que travava tablets.
        const g = Math.min(1, layer.glitch);
        const bands = 7;
        const bandH = m.height / bands;
        const buf = this.ensureGlitchBuffer(m);
        const bctx = buf?.getContext('2d');
        if (bctx && buf) {
          bctx.setTransform(1, 0, 0, 1, 0, 0);
          bctx.clearRect(0, 0, m.width, m.height);
          bctx.save();
          if (supportsCanvasFilter) bctx.filter = layerFilter;
          layer.source.draw(bctx, rect.dx, rect.dy, rect.dw, rect.dh);
          bctx.restore();
          for (let b = 0; b < bands; b++) {
            const jitter = (bandNoise(b) - 0.5) * 2;
            const shift = jitter * g * m.width * 0.06;
            ctx.save();
            ctx.beginPath();
            ctx.rect(-m.width, b * bandH, m.width * 3, bandH + 1);
            ctx.clip();
            ctx.translate(shift, 0);
            ctx.drawImage(
              buf,
              0,
              b * bandH,
              m.width,
              bandH + 1,
              0,
              b * bandH,
              m.width,
              bandH + 1,
            );
            ctx.restore();
          }
        }
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = (layer.alpha ?? 1) * 0.32 * g;
        ctx.fillStyle = '#00ffd5';
        ctx.fillRect(0, bandH * 2, m.width, bandH);
        ctx.fillStyle = '#ff2a68';
        ctx.fillRect(0, bandH * 5, m.width, bandH);
        ctx.restore();
      } else if (layer.blur && layer.blur > 0) {
        // Transição "Desfoque": no modo rápido o blur sai pelo caminho
        // reduzido (mesma técnica do fundo) — leve em tablets.
        drawBlurredContent(ctx, layer.source, baseFilter, layer.blur, rect, m, this.fast);
      } else {
        if (supportsCanvasFilter) ctx.filter = layerFilter;
        layer.source.draw(ctx, rect.dx, rect.dy, rect.dw, rect.dh);
      }
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
      ctx.fillStyle = extras.flashColor ?? '#ffffff';
      ctx.fillRect(0, 0, m.width, m.height);
      ctx.restore();
    }

    // 3) Textos por cima (só os que estão no ar neste instante, e só na área
    //    livre / zonas seguras). Primeiro MONTA as camadas novas (medindo o
    //    contraste num quadro ainda limpo), depois desenha todas.
    const time = extras?.time ?? 0;
    const active = activeTexts(this.texts, time).filter((c) => hasCaptionText(c.style));
    const entries = active.map((clip) => this.ensureTextLayer(ctx, clip, m));
    for (let i = 0; i < active.length; i++) {
      this.drawTextLayer(ctx, active[i], entries[i], time - active[i].start);
    }
    // Libera as camadas dos textos que saíram do ar.
    if (this.textLayers.size > active.length) {
      const live = new Set(active.map((c) => c.id));
      for (const id of [...this.textLayers.keys()]) {
        if (!live.has(id)) this.textLayers.delete(id);
      }
    }
  }

  /** Monta (ou reaproveita) a camada de um bloco de texto. */
  private ensureTextLayer(
    ctx: CanvasRenderingContext2D,
    clip: TextClip,
    m: FrameLayout,
  ): TextLayerEntry {
    const key = JSON.stringify([clip.style, this.filter, m.width, m.height, this.adjust]);
    const cached = this.textLayers.get(clip.id);
    if (cached && cached.key === key) return cached;

    const layout = computeCaptionLayout(ctx, clip.style, m);
    const entry: TextLayerEntry = {
      key,
      // Arrastar o texto recria a camada a cada quadro: reaproveita o canvas
      // da anterior em vez de alocar 1080×1920 de novo toda vez.
      layer: layout ? renderCaptionLayer(layout, m, cached?.layer) : null,
      pivot: layout ? captionBounds(layout, m) : { cx: 0, cy: 0 },
    };
    this.textLayers.set(clip.id, entry);
    return entry;
  }

  /** Desenha a camada de um bloco com a animação de entrada (0,5s). */
  private drawTextLayer(
    ctx: CanvasRenderingContext2D,
    clip: TextClip,
    entry: TextLayerEntry,
    t: number,
  ): void {
    if (!entry.layer) return;
    const anim = clip.style.anim;
    if (anim !== 'none' && t < CAPTION_ANIM_DURATION) {
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
        ctx.translate(entry.pivot.cx, entry.pivot.cy);
        ctx.scale(scale, scale);
        ctx.translate(-entry.pivot.cx, -entry.pivot.cy);
      }
      ctx.drawImage(entry.layer, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(entry.layer, 0, 0);
    }
  }
}
