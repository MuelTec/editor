import type { CaptionOptions } from './caption';
import { FrameComposer } from './compose';
import type { Adjustments, FilterId } from './filters';
import {
  OUT_HEIGHT,
  OUT_WIDTH,
  SAFE_BOTTOM,
  SAFE_TOP,
  SIDE_MARGIN,
  VERTICAL_LAYOUT,
} from './format';
import { MontageRenderer, type MontageClip, type TransitionId } from './montage';

/**
 * Prévia AO VIVO do resultado (Etapa 4): o MESMO compositor do export rodando
 * em cima do `<video>` — fundo borrado + vídeo nítido + legenda com efeitos.
 * Ou seja: o que você vê é literalmente o que sai no arquivo.
 *
 * As linhas tracejadas mostram as zonas seguras do Instagram (só na prévia,
 * elas nunca entram no arquivo exportado).
 */

export interface LivePreview {
  stop(): void;
}

/** Tamanho do canvas de prévia — meia escala do export (1080×1920). */
export const PREVIEW_WIDTH = 540;
export const PREVIEW_HEIGHT = 960;

function drawGuides(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.setLineDash([18, 14]);

  ctx.beginPath();
  ctx.moveTo(0, SAFE_TOP);
  ctx.lineTo(OUT_WIDTH, SAFE_TOP);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, OUT_HEIGHT - SAFE_BOTTOM);
  ctx.lineTo(OUT_WIDTH, OUT_HEIGHT - SAFE_BOTTOM);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.font = '700 40px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillText('fim da zona segura', SIDE_MARGIN, SAFE_TOP - 22);
  ctx.fillText('fim da zona segura', SIDE_MARGIN, OUT_HEIGHT - SAFE_BOTTOM + 58);
  ctx.restore();
}

/**
 * Inicia a prévia animada. Chame `stop()` na limpeza do efeito.
 * O canvas deve ter as dimensões declaradas em `PREVIEW_WIDTH/HEIGHT`.
 */
export function startLivePreview(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  caption?: CaptionOptions,
  guides = false,
  filter: FilterId = 'none',
  adjust?: Adjustments,
  /** Prévia: caminho reduzido do blur (leve em tablets — Etapa 13). */
  fast = false,
): LivePreview {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return { stop: () => {} };

  // Uma instância só: a camada da legenda é reconstruída só quando muda.
  const composer = new FrameComposer(caption, filter, VERTICAL_LAYOUT, adjust, fast);
  const scale = canvas.width / OUT_WIDTH;
  let raf = 0;
  let stopped = false;

  const draw = () => {
    if (stopped) return;
    raf = requestAnimationFrame(draw);

    if (video.readyState < 2 || !video.videoWidth) return;
    if (document.hidden) return;

    // Todo o compositor trabalha em coordenadas 1080×1920;
    // a transformação só reduz o desenho pro tamanho do canvas de prévia.
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    composer.render(
      ctx,
      [
        {
          source: {
            width: video.videoWidth,
            height: video.videoHeight,
            draw: (c, dx, dy, dw, dh) => c.drawImage(video, dx, dy, dw, dh),
          },
        },
      ],
      // Animação de entrada da legenda acompanha o relógio do vídeo.
      { animT: video.currentTime },
    );
    if (guides) drawGuides(ctx);
  };

  draw();

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}

// ------------------------------------------------- prévia da montagem (Etapa 6)

export interface MontagePreviewOptions {
  clips: MontageClip[];
  transition: TransitionId;
  transitionDuration: number;
  filter: FilterId;
  caption?: CaptionOptions;
  /** Ajustes finos de imagem (Etapa 10). */
  adjust?: Adjustments;
  guides?: boolean;
  /**
   * Caminho reduzido do blur (Etapa 13): em tablets/Android WebView o
   * `ctx.filter = blur(42px)` em 1080×1920 derruba o quadro durante as
   * transições. A prévia usa `true`; o export continua na qualidade cheia.
   */
  fast?: boolean;
  /** (tempoAtual, duração) em segundos — pra barra de posição da UI. */
  onTime?: (time: number, duration: number) => void;
}

export interface MontagePreview {
  stop(): void;
  setPaused(paused: boolean): void;
  seek(time: number): void;
  /** Recria o renderer (trocou modelo/legenda/filtro ou a lista de clipes). */
  update(options: Partial<MontagePreviewOptions>): Promise<void>;
  readonly duration: number;
}

/**
 * Prévia da MONTAGEM: o MESMO `MontageRenderer` do export rodando em rAF com
 * um relógio próprio (loop no fim), desenhando quadro a quadro com as
 * transições reais — o que você vê é o que sai no arquivo.
 */
export function startMontagePreview(
  canvas: HTMLCanvasElement,
  options: MontagePreviewOptions,
): MontagePreview {
  const ctx = canvas.getContext('2d', { alpha: false });
  const scale = canvas.width / OUT_WIDTH;

  let current: MontagePreviewOptions = { ...options };
  let renderer: MontageRenderer | null = null;
  let creating: Promise<void> | null = null;
  let raf = 0;
  let stopped = false;
  let paused = false;
  let clock = 0; // tempo da montagem (s)
  let lastFrame = 0; // timestamp do rAF anterior
  let drawing = false; // evita sobrepor renders assíncronos
  let generation = 0; // invalida renders de um renderer antigo

  const ensureRenderer = async (): Promise<void> => {
    if (stopped) return;
    const gen = ++generation;
    const next = await MontageRenderer.create({
      clips: current.clips,
      transition: current.transition,
      transitionDuration: current.transitionDuration,
      filter: current.filter,
      caption: current.caption,
      adjust: current.adjust,
      fast: current.fast,
      startTime: clock,
    });
    if (stopped || gen !== generation) {
      await next.dispose();
      return;
    }
    const old = renderer;
    renderer = next;
    await old?.dispose();
  };

  const kick = () => {
    creating = ensureRenderer()
      .catch(() => {
        // erro de leitura: a UI pode chamar update() de novo; mantém o loop vivo
      })
      .finally(() => {
        creating = null;
      });
  };

  kick();

  const drawFrame = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(drawFrame);
    if (!ctx || document.hidden) return;

    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;

    const total = renderer?.timeline.total ?? 0;
    if (total > 0) {
      if (!paused) {
        clock += dt;
        if (clock >= total) clock = 0; // loop
      }
      // Sempre avisa a UI, MESMO pausado: é por aqui que a duração chega
      // quando a prévia nasce pausada (senão a timeline ficava 0:00/0:00).
      options.onTime?.(clock, total);
    }

    if (drawing || !renderer || creating) return;
    drawing = true;
    const gen = generation;
    const t = clock;
    // Todo o compositor trabalha em coordenadas 1080×1920;
    // a transformação só reduz o desenho pro tamanho do canvas de prévia.
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    renderer
      .renderFrame(ctx, t)
      .then(() => {
        if (gen === generation && current.guides) drawGuides(ctx);
      })
      .catch(() => {})
      .finally(() => {
        drawing = false;
      });
  };

  raf = requestAnimationFrame(drawFrame);

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      const r = renderer;
      renderer = null;
      void r?.dispose();
    },
    setPaused: (p: boolean) => {
      paused = p;
      lastFrame = 0;
    },
    seek: (time: number) => {
      clock = Math.max(0, time);
      lastFrame = 0;
      renderer?.seek(clock);
    },
    update: async (next: Partial<MontagePreviewOptions>) => {
      const clipsChanged = next.clips && next.clips !== current.clips;
      const timelineChanged =
        (next.transition && next.transition !== current.transition) ||
        (next.transitionDuration !== undefined &&
          next.transitionDuration !== current.transitionDuration);
      current = { ...current, ...next };
      // A timeline muda quando a lista (ou o trim) ou a transição mudam →
      // reabre os clipes. Legenda/filtro dão pra trocar quente.
      if (clipsChanged || timelineChanged) {
        kick();
        await creating;
      } else if (renderer) {
        renderer.update({
          caption: current.caption,
          filter: current.filter,
          adjust: current.adjust,
        });
      }
      // Garante que o clock não estoura a timeline nova.
      const total = renderer?.timeline.total ?? 0;
      if (total > 0 && clock >= total) clock = 0;
    },
    get duration() {
      return renderer?.timeline.total ?? 0;
    },
  };
}
