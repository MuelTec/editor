import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  type VideoSample,
} from 'mediabunny';
import type { CaptionOptions } from './caption';
import { FrameComposer } from './compose';
import type { Adjustments, FilterId } from './filters';
import { DEFAULT_ADJUSTMENTS } from './filters';
import { OUT_HEIGHT, OUT_WIDTH, VERTICAL_LAYOUT, type FrameLayout } from './format';

export { OUT_HEIGHT, OUT_WIDTH };

export type ProgressFn = (progress: number) => void;

export interface ConversionResult {
  blob: Blob;
  warnings: string[];
}

export interface RenderOptions {
  /** Proporção/geometria de saída (Etapa 10). Padrão: 9:16 1080×1920. */
  layout?: FrameLayout;
  /** Ajustes finos de imagem (brilho/contraste/saturação/calor). */
  adjust?: Adjustments;
}

let mainCanvas: HTMLCanvasElement | null = null;
let mainCtx: CanvasRenderingContext2D | null = null;

function ensureCanvases(
  m: FrameLayout = VERTICAL_LAYOUT,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!mainCanvas || mainCanvas.width !== m.width || mainCanvas.height !== m.height) {
    mainCanvas = document.createElement('canvas');
    mainCanvas.width = m.width;
    mainCanvas.height = m.height;
    mainCtx = mainCanvas.getContext('2d', { alpha: false });
    if (!mainCtx) throw new Error('Não foi possível criar o canvas de renderização.');
  }
  if (!mainCtx) throw new Error('Canvas indisponível.');
  return { canvas: mainCanvas, ctx: mainCtx };
}

/**
 * Converte um vídeo horizontal em vertical (1080×1920 por padrão), com fundo
 * borrado e, opcionalmente, uma legenda automática nas zonas seguras.
 * `opts.layout` serve pra gerar outras proporções (1:1, 4:5 — Etapa 10).
 * Processado 100% no aparelho do usuário.
 */
export async function toVertical(
  file: File,
  onProgress: ProgressFn,
  caption?: CaptionOptions,
  filter: FilterId = 'none',
  opts?: RenderOptions,
): Promise<ConversionResult> {
  const layout = opts?.layout ?? VERTICAL_LAYOUT;
  const adjust = opts?.adjust ?? DEFAULT_ADJUSTMENTS;

  if (typeof VideoEncoder === 'undefined') {
    throw new Error(
      'Este navegador não suporta processamento de vídeo (WebCodecs). ' +
        'Use uma versão recente do Chrome, Edge, Safari ou Firefox.',
    );
  }

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

  try {
    if (!(await input.canRead())) {
      throw new Error('Não consegui ler este arquivo. Tente um vídeo MP4, MOV ou WebM.');
    }

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });

    // A camada da legenda é montada no primeiro frame e reaproveitada.
    const composer = new FrameComposer(caption, filter, layout, adjust);

    const conversion = await Conversion.init({
      input,
      output,
      video: {
        // Fixamos H.264: é o que todos os players (e o YouTube) abrem.
        codec: 'avc',
        quality: new Quality('high'),
        processedWidth: layout.width,
        processedHeight: layout.height,
        process: (sample: VideoSample) => {
          const { canvas, ctx } = ensureCanvases(layout);
          composer.render(
            ctx,
            [
              {
                source: {
                  width: sample.displayWidth,
                  height: sample.displayHeight,
                  draw: (c, dx, dy, dw, dh) => sample.draw(c, dx, dy, dw, dh),
                },
              },
            ],
            // Animação de entrada da legenda começa no tempo 0 do vídeo.
            { animT: sample.timestamp },
          );
          return canvas;
        },
      },
      // Forçamos AAC também no áudio: sem isso, a Mediabunny COPIA o codec
      // original (um WebM/Opus viraria MP4/Opus — que o Instagram não abre).
      // Com AAC, vídeos do iPhone (já AAC) são copiados e os demais são
      // codificados de novo.
      audio: { codec: 'aac' },
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((t) => t.reason).join(', ');
      throw new Error(
        `Não foi possível converter este vídeo${reasons ? ` (${reasons})` : ''}.`,
      );
    }

    const warnings: string[] = [];
    conversion.onProgress = onProgress;
    await conversion.execute();

    // Áudio pode ter sido descartado se o navegador não souber codificar.
    for (const track of conversion.discardedTracks) {
      if (track.track.type === 'audio') {
        warnings.push('O áudio foi removido: este navegador não sabe codificar o formato dele.');
      }
    }

    const buffer = output.target.buffer;
    if (!buffer) throw new Error('A conversão terminou sem gerar arquivo.');

    return { blob: new Blob([buffer], { type: 'video/mp4' }), warnings };
  } finally {
    input.dispose();
  }
}

/**
 * Gera a versão HORIZONTAL em MP4/H.264 — normalmente só troca o "envelope"
 * (transmux: copia os pacotes, sem recomprimir). Se o codec de origem não
 * puder ser copiado, a Mediabunny codifica de novo automaticamente.
 */
export async function toHorizontal(
  file: File,
  onProgress: ProgressFn,
): Promise<ConversionResult> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

  try {
    if (!(await input.canRead())) {
      throw new Error('Não consegui ler este arquivo para a versão horizontal.');
    }

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });

    // Forçamos H.264 + AAC: é o que todo player abre.
    // Se a origem já for H.264/AAC (vídeo do iPhone), os pacotes são COPIADOS
    // sem recomprimir; se não for, a Mediabunny codifica de novo.
    const conversion = await Conversion.init({
      input,
      output,
      video: { codec: 'avc' },
      audio: { codec: 'aac' },
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((t) => t.reason).join(', ');
      throw new Error(
        `Não foi possível gerar a versão horizontal${reasons ? ` (${reasons})` : ''}.`,
      );
    }

    const warnings: string[] = [];
    conversion.onProgress = onProgress;
    await conversion.execute();

    for (const track of conversion.discardedTracks) {
      if (track.track.type === 'audio') {
        warnings.push('O áudio foi removido da versão horizontal.');
      }
    }

    const buffer = output.target.buffer;
    if (!buffer) throw new Error('A versão horizontal terminou sem gerar arquivo.');

    return { blob: new Blob([buffer], { type: 'video/mp4' }), warnings };
  } finally {
    input.dispose();
  }
}

/** Baixa um blob como arquivo. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
