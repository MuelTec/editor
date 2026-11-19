import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  type InputAudioTrack,
  type InputVideoTrack,
  type WrappedCanvas,
} from 'mediabunny';
import type { CaptionOptions } from './caption';
import { FrameComposer, type FrameLayer } from './compose';
import type { TextClip } from './textTrack';
import { DEFAULT_ADJUSTMENTS, type Adjustments, type FilterId } from './filters';
import { VERTICAL_LAYOUT, layoutFor, type FrameLayout, type RatioId } from './format';

/**
 * MONTAGEM MULTI-CLIPE (Etapa 6).
 *
 * Lê N vídeos, monta uma timeline única com TRANSIÇÕES entre eles e grava um
 * único MP4 1080×1920 (H.264 + AAC) — tudo no dispositivo do usuário.
 *
 * Peças:
 *  - `MODELS`: os 3 modelos (filtro + transição + estilo de legenda)
 *  - `buildTimeline`: corta/sobrepõe os clipes pra calcular a timeline
 *  - `MontageRenderer`: decodifica os clipes e desenha cada quadro
 *  - `assembleMontage`: varre a timeline, codifica vídeo (CanvasSource) e
 *    áudio (AudioSampleSource) e finaliza o arquivo
 *  - `mixMontageAudio`/`extractClipWindow`: (Etapa 8) somam o áudio dos
 *    clipes com a TRILHA SONORA pela Web Audio antes de gravar
 */

// ---------------------------------------------------------------- modelos

export type TransitionId =
  | 'crossfade'
  | 'wipe'
  | 'flash'
  | 'zoom'
  | 'zoomOut'
  | 'push'
  | 'blur'
  | 'glitch'
  | 'flip3d'
  | 'pushVertical'
  | 'wipeVertical'
  | 'iris'
  | 'spin'
  | 'shake'
  | 'luma'
  | 'lightLeak'
  | 'fadeBlack';

/** Rótulos das transições pra UI (Etapa 12). */
export const TRANSITIONS: { id: TransitionId; label: string; hint: string }[] = [
  { id: 'crossfade', label: 'Dissolver', hint: 'Um clipe dissolve no outro' },
  { id: 'wipe', label: 'Varredura', hint: 'O novo entra numa passada lateral' },
  { id: 'flash', label: 'Flash', hint: 'Corte seco com luz branca' },
  { id: 'zoom', label: 'Zoom in', hint: 'O novo chega aproximando' },
  { id: 'zoomOut', label: 'Zoom out', hint: 'O novo cresce a partir do fundo' },
  { id: 'blur', label: 'Desfoque', hint: 'O novo surge desfocado até ficar nítido' },
  { id: 'glitch', label: 'Glitch', hint: 'Corte com distorção digital' },
  { id: 'push', label: 'Deslizar', hint: 'O novo desliza empurrando o anterior' },
  { id: 'flip3d', label: 'Girar 3D', hint: 'O vídeo gira como um cartão' },
  { id: 'pushVertical', label: 'Subir', hint: 'O novo sobe empurrando o anterior' },
  { id: 'wipeVertical', label: 'Cortina', hint: 'O novo desce cobrindo o quadro' },
  { id: 'iris', label: 'Círculo', hint: 'Abre num círculo a partir do centro' },
  { id: 'spin', label: 'Rotação', hint: 'Um gira pra dentro, o outro pra fora' },
  { id: 'shake', label: 'Tremor', hint: 'Sacudida rápida na hora da troca' },
  { id: 'luma', label: 'Brilho', hint: 'Cruza estourando a luz no meio' },
  { id: 'lightLeak', label: 'Luz âmbar', hint: 'Véu de luz quente na troca' },
  { id: 'fadeBlack', label: 'Escurecer', hint: 'Apaga no preto e acende o novo' },
];

/** Ruido pseudo-aleatório determinístico (tremor: mesma faixa = mesmo valor). */
function shakeNoise(i: number): number {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Aplica os efeitos de uma transição sobre as DUAS camadas da timeline
 * (`p` = 0..1 dentro da janela da transição).
 *
 * Extraído do `renderFrame` pra as MINIATURAS da biblioteca rodarem o MESMO
 * motor do arquivo final — o que você vê no chip é exatamente o efeito que
 * sai na exportação. Muta `layers` (alpha/clip/transform/glitch) e pode
 * reduzir pra UMA camada (corte seco no meio: flash/glitch). Devolve o véu
 * (flash) aplicado por cima do conteúdo.
 */
export function applyTransition(
  transition: TransitionId,
  p: number,
  layers: FrameLayer[],
  m: FrameLayout,
): { flash: number; flashColor?: string } {
  let flash = 0;
  let flashColor: string | undefined;
  if (layers.length < 2) return { flash, flashColor };

  if (transition === 'crossfade') {
    layers[1].alpha = p;
  } else if (transition === 'wipe') {
    layers[1].clip = {
      x: 0,
      y: 0,
      w: m.width * p,
      h: m.height,
    };
  } else if (transition === 'zoom') {
    // O novo chega aproximando (1,16 → 1) e o anterior sai ampliando.
    layers[1].alpha = p;
    layers[1].transform = { scale: 1 + 0.16 * (1 - p) };
    layers[0].transform = { scale: 1 + 0.08 * p };
  } else if (transition === 'zoomOut') {
    // O novo cresce a partir do fundo (0,86 → 1) e o anterior recua.
    layers[1].alpha = p;
    layers[1].transform = { scale: 0.86 + 0.14 * p };
    layers[0].transform = { scale: 1 - 0.08 * p };
    layers[0].alpha = 1 - p * 0.45;
  } else if (transition === 'blur') {
    // O novo surge desfocado até ficar nítido; o anterior desfoca na saída.
    layers[1].alpha = p;
    layers[1].blur = (1 - p) * 30;
    layers[1].transform = { scale: 1 + 0.05 * (1 - p) };
    layers[0].blur = p * 30;
    layers[0].alpha = 1 - p * 0.35;
  } else if (transition === 'glitch') {
    // Corte seco no meio mascarado por distorção digital (fatias + tintes).
    if (p < 0.5) layers.length = 1;
    const g = Math.sin(Math.PI * p) * 0.95;
    layers[0].glitch = g;
    if (layers.length > 1) layers[1].glitch = g;
    flash = g * 0.1;
  } else if (transition === 'flip3d') {
    // Gira como um cartão: espreme no eixo X e dá uma leve inclinação
    // vertical; o fundo NÃO gira (transformBg=false) — ele continua
    // cobrindo o quadro inteiro por trás do cartão.
    const angle = (p * Math.PI) / 2;
    const squash = 1 - 0.12 * Math.sin(Math.PI * p);
    layers[1].transform = { scaleX: Math.sin(angle), scaleY: squash };
    layers[0].transform = { scaleX: Math.cos(angle), scaleY: squash };
    layers[1].transformBg = false;
    layers[0].transformBg = false;
    layers[1].alpha = p;
    // Luz no meio do giro (esconde o momento edge-on do cartão).
    flash = Math.max(0, 1 - Math.abs(p - 0.5) * 5) * 0.55;
  } else if (transition === 'push') {
    // Empurrão horizontal: um cobre exatamente o vão que o outro abre.
    layers[1].transform = { x: (1 - p) * m.width };
    layers[0].transform = { x: -p * m.width };
  } else if (transition === 'pushVertical') {
    // Mesmo empurrão, mas no eixo Y: o novo sobe por cima.
    layers[1].transform = { y: (1 - p) * m.height };
    layers[0].transform = { y: -p * m.height };
  } else if (transition === 'wipeVertical') {
    // Cortina descendo: o novo é revelado de cima pra baixo.
    layers[1].clip = {
      x: 0,
      y: 0,
      w: m.width,
      h: m.height * p,
    };
  } else if (transition === 'iris') {
    // Máscara redonda abrindo do centro até cobrir os cantos.
    const r = (Math.hypot(m.width, m.height) / 2) * p;
    layers[1].clip = {
      x: m.width / 2 - r,
      y: m.height / 2 - r,
      w: r * 2,
      h: r * 2,
      circle: true,
    };
    flash = Math.sin(Math.PI * p) * 0.12;
  } else if (transition === 'spin') {
    // Rotação: o novo gira pra dentro e o anterior gira pra fora.
    // transformBg=false mantém o fundo cobrindo o quadro (mesmo truque
    // do "Girar 3D"), senão apareceriam cantos pretos girando.
    const angle = p * (Math.PI / 2);
    layers[1].transform = { rotate: angle, scale: 0.92 + 0.08 * p };
    layers[0].transform = { rotate: -angle * 0.6, scale: 1 + 0.1 * p };
    layers[1].transformBg = false;
    layers[0].transformBg = false;
    layers[1].alpha = p;
    flash = Math.max(0, 1 - Math.abs(p - 0.5) * 4) * 0.35;
  } else if (transition === 'shake') {
    // Tremor na troca, com a amplitude caindo até zerar.
    const amp = (1 - p) * 46;
    const step = Math.floor(p * 14);
    const dx = (shakeNoise(step) - 0.5) * amp;
    const dy = (shakeNoise(step + 9) - 0.5) * amp;
    layers[1].alpha = p;
    layers[1].transform = { x: dx, y: dy };
    layers[0].transform = { x: -dx * 0.6, y: -dy * 0.6 };
    flash = Math.sin(Math.PI * p) * 0.1;
  } else if (transition === 'luma') {
    // Cruza as camadas estourando a luz no meio do caminho.
    layers[1].alpha = p;
    layers[1].transform = { scale: 1 + 0.06 * (1 - p) };
    flash = Math.pow(Math.sin(Math.PI * p), 3) * 0.7;
  } else if (transition === 'lightLeak') {
    // A troca acontece sob um véu de luz quente.
    layers[1].alpha = p;
    flash = Math.sin(Math.PI * p) * 0.85;
    flashColor = '#ff9a3c';
  } else if (transition === 'fadeBlack') {
    // Apaga no preto e acende o clipe novo.
    layers[1].alpha = p;
    flash = Math.sin(Math.PI * p);
    flashColor = '#000000';
  } else {
    // flash: corte seco no meio + luz branca no pico
    if (p < 0.5) layers.length = 1;
    flash = Math.sin(Math.PI * p) * 0.92;
  }

  return { flash, flashColor };
}

export interface MontageModel {
  id: string;
  name: string;
  description: string;
  /** Filtro de cor aplicado ao conteúdo. */
  filter: FilterId;
  /** Tipo e duração da transição entre clipes. */
  transition: TransitionId;
  transitionDuration: number;
  /** Estilo de legenda que o modelo aplica (o texto é do usuário). */
  caption: Partial<CaptionOptions>;
}

export const MODELS: MontageModel[] = [
  {
    id: 'cinema',
    name: 'Cinema',
    description: 'Fusão suave e textos com degradê dourado',
    filter: 'none',
    transition: 'crossfade',
    transitionDuration: 0.8,
    caption: {
      font: 'black',
      effect: 'gradient',
      effectColor: '#ffd400',
      uppercase: true,
      align: 'center',
      color: 'auto',
    },
  },
  {
    id: 'vibrante',
    name: 'Vibrante',
    description: 'Corte com flash e textos com marca-texto',
    filter: 'none',
    transition: 'flash',
    transitionDuration: 0.5,
    caption: {
      font: 'black',
      effect: 'highlight',
      effectColor: '#ffd400',
      uppercase: true,
      align: 'center',
      color: 'auto',
    },
  },
  {
    id: 'nostalgico',
    name: 'Nostálgico',
    description: 'Varredura lateral e fonte serifada',
    filter: 'none',
    transition: 'wipe',
    transitionDuration: 0.7,
    caption: {
      font: 'serif',
      effect: 'shadow',
      uppercase: false,
      align: 'center',
      color: 'auto',
      effectColor: '#ffd400',
    },
  },
];

export const DEFAULT_MODEL = MODELS[0];

// ---------------------------------------------------------------- clipes

/**
 * Um clipe da montagem: o arquivo + o TRECHO usado dele (em segundos,
 * medidos a partir do início do arquivo). O mesmo vídeo pode entrar
 * recortado — é o que o usuário ajusta na lista.
 */
export interface MontageClip {
  file: File;
  /**
   * `image` = foto parada, que dura `trimEnd − trimStart` segundos (sem áudio).
   * Ausente = vídeo.
   */
  kind?: 'video' | 'image';
  trimStart: number;
  trimEnd: number;
  /** Transição do corte entre ESTE clipe e o PRÓXIMO. Ausente = a transição padrão da montagem. */
  transition?: TransitionId;
  /** Duração (s) dessa transição; 0 = corte seco. Ausente = a duração padrão da montagem. */
  transitionDuration?: number;
}

/** Imagens: duração padrão ao entrar na montagem e o máximo que dá pra esticar (s). */
export const IMAGE_DEFAULT_SECONDS = 3;
export const IMAGE_MAX_SECONDS = 30;

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
export const isImageFile = (f: File): boolean =>
  f.type.startsWith('image/') || IMAGE_RE.test(f.name);

/** Duração da transição de cada corte (n−1 valores): a do clipe, ou a padrão. */
export function junctionDurations(
  clips: readonly { transitionDuration?: number }[],
  fallback: number,
): number[] {
  return clips.slice(0, -1).map((c) => c.transitionDuration ?? fallback);
}

// ---------------------------------------------------------------- timeline

export interface TimelineClip {
  start: number;
  duration: number;
  end: number;
}

export interface Timeline {
  clips: TimelineClip[];
  /** Duração da transição que vem DEPOIS de cada clipe (n-1 valores). */
  transitions: number[];
  total: number;
}

/** Duração mínima de um clipe pra valer a pena transicionar nele. */
const MIN_CLIP_FOR_TRANSITION = 0.7;

/**
 * Monta a timeline: os clipes se sobrepõem pela duração da transição
 * (total = soma das durações − transições).
 */
export function buildTimeline(
  durations: number[],
  /** Duração da transição: um valor pra todos os cortes, ou um por corte (n−1). */
  baseDuration: number | readonly number[],
): Timeline {
  const n = durations.length;
  const baseAt = (i: number): number =>
    typeof baseDuration === 'number' ? baseDuration : (baseDuration[i] ?? 0);
  const transitions: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = durations[i];
    const b = durations[i + 1];
    const ok = a >= MIN_CLIP_FOR_TRANSITION && b >= MIN_CLIP_FOR_TRANSITION;
    transitions.push(ok ? Math.max(0, Math.min(baseAt(i), a * 0.4, b * 0.4)) : 0);
  }

  const clips: TimelineClip[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) cursor -= transitions[i - 1];
    clips.push({ start: cursor, duration: durations[i], end: cursor + durations[i] });
    cursor += durations[i];
  }

  return { clips, transitions, total: Math.max(cursor, 0) };
}

// ---------------------------------------------------------------- leitura

/** Lê dimensões/duração de um clipe sem decodificar (pra montar a lista na UI). */
export async function probeClip(
  file: File,
): Promise<{ width: number; height: number; duration: number }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    if (!(await input.canRead())) throw new Error('formato-ilegivel');
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('sem-video');
    const duration = await input.computeDuration();
    return {
      width: await track.getDisplayWidth(),
      height: await track.getDisplayHeight(),
      duration: Number.isFinite(duration) ? duration : 0,
    };
  } finally {
    input.dispose();
  }
}

/** Lê as dimensões de uma imagem (pra montar a lista na UI). */
export async function probeImage(file: File): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  try {
    return { width: bmp.width, height: bmp.height };
  } finally {
    bmp.close();
  }
}

/**
 * Decodifica a imagem UMA vez, num canvas de no máx. 2160px de lado (uma foto
 * de 12MP ocuparia ~48MB só no quadro — e a saída é no máx. 1920px).
 */
async function loadStill(file: File): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, 2160 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * k));
    canvas.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-indisponivel');
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bmp.close();
  }
}

/** O que a montagem precisa de um clipe: vídeo (ClipPlayer) e imagem (StillPlayer) fazem o mesmo papel. */
interface FramePlayer {
  seek(localTime: number): void;
  frameAt(localTime: number): Promise<FrameLayer['source'] | null>;
  close(): void;
}

/** Imagem parada: o mesmo quadro durante todo o clipe. */
class StillPlayer implements FramePlayer {
  constructor(private readonly canvas: HTMLCanvasElement) {}

  seek(): void {
    /* parada: não há o que reposicionar */
  }

  async frameAt(): Promise<FrameLayer['source'] | null> {
    const canvas = this.canvas;
    return {
      width: canvas.width,
      height: canvas.height,
      draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(canvas, dx, dy, dw, dh),
    };
  }

  close(): void {
    /* o canvas é coletado junto com o player */
  }
}

/**
 * Um clipe: mantém um leitor de quadros avançando em ordem (o tempo local de
 * um clipe sempre cresce, então dá pra usar um gerador sequencial).
 */
class ClipPlayer implements FramePlayer {
  private iterator: AsyncGenerator<WrappedCanvas, void, unknown>;
  private current: HTMLCanvasElement | OffscreenCanvas | null = null;
  private currentEnd = Number.NEGATIVE_INFINITY;
  private finished = false;

  constructor(
    private readonly sink: CanvasSink,
    startAt: number,
  ) {
    this.iterator = sink.canvases(Math.max(0, startAt));
  }

  /**
   * Pula o leitor pra `localTime` (Etapa 12).
   *
   * O gerador só anda pra frente; quando o tempo SAI da janela do quadro
   * atual (busca, loop da prévia, troca de clipe) a gente descarta o
   * gerador e abre outro a partir do destino — o Mediabunny recua até o
   * keyframe anterior sozinho. Sem isso, um salto de 10s tentava decodificar
   * 300 quadros de uma vez e a timeline travava.
   */
  seek(localTime: number): void {
    const t = Math.max(0, localTime);
    const dentro = t >= Math.max(0, this.currentEnd - 0.25) && this.current !== null;
    const perto = t <= this.currentEnd + 0.5;
    if (dentro && perto) return; // tocou no quadro atual, não precisa mexer
    if (!this.finished && t > this.currentEnd && t - this.currentEnd < 1.2) {
      return; // avanço normal: deixa o gerador correr
    }
    this.iterator.return?.(undefined);
    this.iterator = this.sink.canvases(t);
    this.current = null;
    this.currentEnd = Number.NEGATIVE_INFINITY;
    this.finished = false;
  }

  /** Quadro cobrindo o tempo local `localTime` (segura o último se acabar). */
  async frameAt(localTime: number): Promise<FrameLayer['source'] | null> {
    let guard = 0;
    while (!this.finished && this.currentEnd <= localTime && guard++ < 900) {
      const it = this.iterator;
      const { value, done } = await it.next();
      // Um seek() trocou o gerador enquanto esperávamos: esse resultado é do
      // gerador ANTIGO e não pode sobrescrever o estado novo (senão o clipe
      // volta a ficar congelado no último quadro).
      if (it !== this.iterator) continue;
      if (done || !value) {
        this.finished = true;
        break;
      }
      this.current = value.canvas;
      this.currentEnd = value.timestamp + Math.max(value.duration, 1 / 120);
    }
    const canvas = this.current;
    if (!canvas) return null;
    return {
      width: canvas.width,
      height: canvas.height,
      draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(canvas, dx, dy, dw, dh),
    };
  }

  close(): void {
    this.finished = true;
    void this.iterator.return?.(undefined);
  }
}

export interface MontageRendererOptions {
  clips: MontageClip[];
  transition: TransitionId;
  transitionDuration: number;
  filter: FilterId;
  /** Blocos de texto da trilha de texto (cada um com seu início/fim). */
  texts?: TextClip[];
  /** Ajustes finos de imagem (Etapa 10). */
  adjust?: Adjustments;
  /** De onde começar a decodificar (usado pra fazer seek na prévia). */
  startTime?: number;
  /** Geometria do quadro de saída (Etapa 9): 9:16 por padrão, 16:9 opcional. */
  layout?: FrameLayout;
  /** Prévia: caminho reduzido do blur (leve em tablets — Etapa 13). */
  fast?: boolean;
  /**
   * Limita a largura dos quadros decodificados (Etapa 15 — leveza).
   *
   * Sem isto o CanvasSink usa a largura DO ARQUIVO: um clipe 4K vira 3
   * canvases de ~33MB no pool (≈100MB de VRAM) e cada desenho reescala
   * 3840px pra caber no quadro — travava tablets. O preview nunca mostra
   * mais que 1080×1920, então acima disso é pixels jogados fora.
   * Export usa 1920 (nenhum detalhe visível se perde); prévia usa 720.
   */
  sinkMaxWidth?: number;
}

/**
 * Abre os clipes e desenha qualquer quadro da timeline no tamanho do layout
 * (1080×1920 no 9:16, 1920×1080 no 16:9 — Etapa 9).
 * Usado tanto pela prévia ao vivo quanto pelo arquivo final.
 */
export class MontageRenderer {
  readonly timeline: Timeline;
  readonly audioTracks: (InputAudioTrack | null)[] = [];
  /** Trecho de cada clipe dentro do arquivo (mesma ordem da timeline). */
  readonly trims: { trimStart: number; trimEnd: number }[] = [];
  /** Geometria do quadro que este renderer desenha. */
  readonly layout: FrameLayout;

  private readonly inputs: Input[] = [];
  private readonly players: FramePlayer[] = [];
  private composer: FrameComposer;
  /** Transição de cada corte (n−1): o clipe i liga com o i+1. */
  private junctionIds: TransitionId[];
  private filterId: FilterId;
  private adjust: Adjustments;
  private readonly fast: boolean;
  private disposed = false;

  private constructor(
    options: MontageRendererOptions,
    timeline: Timeline,
    players: FramePlayer[],
    audioTracks: (InputAudioTrack | null)[],
    inputs: Input[],
    trims: { trimStart: number; trimEnd: number }[],
    junctionIds: TransitionId[],
  ) {
    this.timeline = timeline;
    this.audioTracks = audioTracks;
    this.inputs.push(...inputs);
    this.trims.push(...trims);
    this.players.push(...players);
    this.junctionIds = junctionIds;
    this.layout = options.layout ?? VERTICAL_LAYOUT;
    this.adjust = options.adjust ?? DEFAULT_ADJUSTMENTS;
    this.filterId = options.filter;
    this.fast = options.fast ?? false;
    this.composer = new FrameComposer(
      options.texts,
      options.filter,
      this.layout,
      this.adjust,
      this.fast,
    );
  }

  static async create(options: MontageRendererOptions): Promise<MontageRenderer> {
    const clips = options.clips;
    if (clips.length === 0) throw new Error('Nenhum vídeo selecionado.');

    const inputs: Input[] = [];
    try {
      const durations: number[] = [];
      const trims: { trimStart: number; trimEnd: number }[] = [];
      /** Por clipe: a trilha de vídeo (vídeo) ou o quadro decodificado (imagem). */
      const sources: { video?: InputVideoTrack; still?: HTMLCanvasElement }[] = [];
      const audioTracks: (InputAudioTrack | null)[] = [];
      const sinkWidths: (number | undefined)[] = [];

      for (let i = 0; i < clips.length; i++) {
        const { file, trimStart, trimEnd } = clips[i];

        if (clips[i].kind === 'image') {
          // Imagem: sem arquivo de vídeo — dura o que o usuário escolheu, sem áudio.
          const still = await loadStill(file).catch(() => {
            throw new Error(`Não consegui ler a imagem "${file.name}".`);
          });
          const used = Math.max(0.3, trimEnd - trimStart);
          durations.push(used);
          trims.push({ trimStart: 0, trimEnd: used });
          sources.push({ still });
          audioTracks.push(null);
          // Alinha com `sources`: imagem não tem sink, mas ocupa o mesmo índice.
          sinkWidths.push(undefined);
          continue;
        }

        const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
        inputs.push(input);

        if (!(await input.canRead())) {
          throw new Error(`Não consegui ler o clipe "${file.name}".`);
        }
        const video = await input.getPrimaryVideoTrack();
        if (!video) throw new Error(`O clipe "${file.name}" não tem vídeo.`);
        if (!(await video.canDecode())) {
          throw new Error(`Este navegador não sabe decodificar "${file.name}".`);
        }

        const fileDuration = await input.computeDuration();
        if (!Number.isFinite(fileDuration) || fileDuration <= 0) {
          throw new Error(`Não consegui medir a duração de "${file.name}".`);
        }
        const start = Math.min(Math.max(0, trimStart), Math.max(0, fileDuration - 0.1));
        const end = Math.min(Math.max(start + 0.1, trimEnd), fileDuration);
        const used = end - start;
        if (!(used > 0.09)) {
          throw new Error(`O clipe "${file.name}" precisa de pelo menos 0,1s de trecho.`);
        }
        durations.push(used);
        trims.push({ trimStart: start, trimEnd: end });
        sources.push({ video });
        audioTracks.push(await input.getPrimaryAudioTrack());

        // Teto de decodificação (Etapa 15): só corta acima do limite — clipe
        // pequeno segue no tamanho original (nada de ampliar).
        const cap = options.sinkMaxWidth;
        let sinkWidth: number | undefined;
        if (cap && cap > 0) {
          const displayWidth = await video.getDisplayWidth();
          if (displayWidth > cap) sinkWidth = Math.round(cap);
        }
        sinkWidths.push(sinkWidth);
      }

      // Cada corte tem a sua duração (a do clipe, ou a padrão).
      const timeline = buildTimeline(
        durations,
        junctionDurations(clips, options.transitionDuration),
      );

      // Leitores: o tempo do arquivo = trimStart + posição na timeline do clipe.
      const startAt = options.startTime ?? 0;
      const players: FramePlayer[] = [];
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (src.still) {
          players.push(new StillPlayer(src.still));
        } else if (src.video) {
          // Largura decodificada limitada (Etapa 15): só corta acima do teto —
          // clipe pequeno decodifica no tamanho original, sem reescalonar pra cima.
          const w = sinkWidths[i];
          const sink = new CanvasSink(
            src.video,
            w ? { poolSize: 3, width: w } : { poolSize: 3 },
          );
          const localStart =
            trims[i].trimStart + Math.max(0, startAt - timeline.clips[i].start);
          players.push(new ClipPlayer(sink, localStart));
        }
      }

      const junctionIds = clips
        .slice(0, -1)
        .map((c) => c.transition ?? options.transition);
      return new MontageRenderer(
        options,
        timeline,
        players,
        audioTracks,
        inputs,
        trims,
        junctionIds,
      );
    } catch (e) {
      for (const input of inputs) input.dispose();
      throw e;
    }
  }

  /** Troca textos/filtro/ajustes sem reabrir os arquivos. */
  update(options: {
    texts?: TextClip[];
    filter?: FilterId;
    adjust?: Adjustments;
  }): void {
    const adjustChanged = !!options.adjust && options.adjust !== this.adjust;
    const filterChanged = options.filter !== undefined && options.filter !== this.filterId;
    if (options.adjust) this.adjust = options.adjust;
    if (options.filter !== undefined) this.filterId = options.filter;
    if (adjustChanged || filterChanged) {
      this.composer = new FrameComposer(
        options.texts,
        this.filterId,
        this.layout,
        this.adjust,
        this.fast,
      );
    } else {
      // Só os textos mudaram (editar/arrastar): mantém o compositor e as camadas.
      this.composer.setTexts(options.texts);
    }
  }

  /** Usa a mesma transição em TODOS os cortes. */
  setTransition(transition: TransitionId): void {
    this.junctionIds = this.junctionIds.map(() => transition);
  }

  /**
   * Move os leitores de quadro pra posição `t` (Etapa 12).
   *
   * Chamado pela prévia quando o usuário arrasta a barra, quando o loop
   * reinicia e quando um salto grande acontece: em vez de decodificar tudo
   * que ficou pra trás, cada leitor reabre a partir do destino.
   */
  seek(t: number): void {
    const { clips, total } = this.timeline;
    const time = Math.min(Math.max(t, 0), Math.max(total - 0.001, 0));
    for (let i = 0; i < this.players.length; i++) {
      const clip = clips[i];
      const fileTime =
        time >= clip.start && time < clip.end
          ? this.trims[i].trimStart + (time - clip.start)
          : time < clip.start
            ? this.trims[i].trimStart
            : this.trims[i].trimEnd;
      this.players[i].seek(fileTime);
    }
  }

  /**
   * Janela de áudio global do clipe i: `[from, to]`.
   *
   * O áudio acompanha o corte VISUAL: em crossfade/wipe o clipe anterior acaba
   * onde o próximo começa; no flash ambos trocam no meio da transição — assim
   * nunca ficam dois sons tocando ao mesmo tempo.
   */
  audioRange(i: number): [number, number] {
    const { clips, transitions, total } = this.timeline;
    // flash e glitch são CORTE SECO no meio da transição (o áudio acompanha).
    // Cada corte tem a sua transição: olha a do corte de ANTES e a de DEPOIS.
    const hardCutAt = (j: number): boolean =>
      this.junctionIds[j] === 'flash' || this.junctionIds[j] === 'glitch';
    const start = clips[i].start;
    const from = i > 0 && hardCutAt(i - 1) ? start + transitions[i - 1] / 2 : start;
    const to =
      i >= clips.length - 1
        ? total
        : clips[i + 1].start + (hardCutAt(i) ? transitions[i] / 2 : 0);
    return [from, Math.max(from, to)];
  }

  /** Desenha o quadro da timeline no instante `t` (segundos). */
  async renderFrame(ctx: CanvasRenderingContext2D, t: number): Promise<void> {
    if (this.disposed) return;
    const { clips, transitions, total } = this.timeline;
    const time = Math.min(Math.max(t, 0), Math.max(total - 0.001, 0));

    const active: number[] = [];
    for (let i = 0; i < clips.length; i++) {
      if (time >= clips[i].start && time < clips[i].end) active.push(i);
    }
    if (active.length === 0) {
      // Fora de qualquer clipe (borda exata) → usa o último que já começou.
      for (let i = clips.length - 1; i >= 0; i--) {
        if (time >= clips[i].start) {
          active.push(i);
          break;
        }
      }
      if (active.length === 0) active.push(0);
    }

    const layers: FrameLayer[] = [];
    for (const i of active) {
      // Posição na timeline → tempo dentro do ARQUIVO (pula o que foi cortado)
      const fileTime = this.trims[i].trimStart + (time - clips[i].start);
      const source = await this.players[i].frameAt(fileTime);
      if (source) layers.push({ source, alpha: 1 });
    }
    if (layers.length === 0) return;

    let flash = 0;
    let flashColor: string | undefined;
    if (layers.length === 2) {
      const b = active[1];
      const window = transitions[b - 1];
      const p =
        window > 0
          ? Math.min(1, Math.max(0, (time - clips[b].start) / window))
          : 1;
      ({ flash, flashColor } = applyTransition(
        this.junctionIds[b - 1] ?? 'crossfade',
        p,
        layers,
        this.layout,
      ));
    }

    this.composer.render(ctx, layers, {
      flash,
      flashColor,
      // Tempo da montagem: decide quais textos estão no ar e a animação de
      // entrada de cada um — prévia e arquivo usam o MESMO valor.
      time,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const player of this.players) player.close();
    for (const input of this.inputs) input.dispose();
    this.inputs.length = 0;
  }
}

// ---------------------------------------------------------------- exportação

export interface AssembleMontageOptions {
  clips: MontageClip[];
  transition: TransitionId;
  transitionDuration: number;
  filter: FilterId;
  texts?: TextClip[];
  /** Ajustes finos de imagem (Etapa 10): somados ao filtro do modelo. */
  adjust?: Adjustments;
  /** Teto da largura decodificada (Etapa 15): padrão 1920 — ver `MontageRendererOptions`. */
  sinkMaxWidth?: number;
  fps?: number;
  withAudio?: boolean;
  /**
   * Proporção do arquivo (Etapa 10): `9:16` (padrão, 1080×1920), `16:9`
   * (1920×1080), `1:1` (1080×1080) ou `4:5` (1080×1350). A montagem é
   * RENDERIZADA no outro tamanho (fundo borrado + vídeo contido + legenda),
   * não é transmux.
   */
  ratio?: RatioId;
  /** Trilha sonora opcional (Etapa 8): mixada por cima do áudio dos clipes. */
  music?: File | null;
  /** Volume da música, 0..1 (padrão 0,7). */
  musicVolume?: number;
  /**
   * Por onde a música começa (Etapa 12): segundos dentro do arquivo — é a
   * "timeline pra escolher o tempo da música". Com loop, depois do fim ela
   * volta ao início do arquivo (0), não ao offset.
   */
  musicOffset?: number;
  onProgress?: (progress: number, label: string) => void;
}

export interface AssembleMontageResult {
  blob: Blob;
  warnings: string[];
  duration: number;
}

/** Monta os clipes num único MP4 (H.264 + AAC) no tamanho da orientação. */
export async function assembleMontage(
  options: AssembleMontageOptions,
): Promise<AssembleMontageResult> {
  const warnings: string[] = [];
  const fps = options.fps ?? 30;
  const layout = layoutFor(options.ratio ?? '9:16');
  // Teto do export (Etapa 15): 1920 cobre tudo que é visível em qualquer
  // proporção (o fundo borrado é a única área maior — e está desfocado).
  const renderer = await MontageRenderer.create({
    ...options,
    layout,
    sinkMaxWidth: options.sinkMaxWidth ?? 1920,
  });

  try {
    const { timeline } = renderer;

    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Não foi possível criar o canvas de renderização.');

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      quality: new Quality('high'),
    });
    output.addVideoTrack(videoSource, { frameRate: fps });

    // Trilha sonora (Etapa 8): decodifica ANTES de começar a codificar pra
    // falhar rápido (e avisar) se o arquivo não for áudio de verdade.
    let musicBuffer: AudioBuffer | null = null;
    if (options.withAudio !== false && options.music) {
      musicBuffer = await decodeMusicFile(options.music);
      if (!musicBuffer) {
        warnings.push('Não consegui ler o arquivo de música — ele ficou de fora.');
      }
    }

    // Áudio: entra como trilha separada, com o tempo de cada clipe deslocado
    // pro lugar certo da timeline. Com música, o caminho é o mix completo.
    let audioSource: AudioSampleSource | null = null;
    const hasAudio = renderer.audioTracks.some(Boolean) || !!musicBuffer;
    if (options.withAudio !== false && hasAudio) {
      const aacOk = await canEncodeAudio('aac').catch(() => false);
      if (aacOk) {
        audioSource = new AudioSampleSource({
          codec: 'aac',
          quality: new Quality(128e3),
        });
        output.addAudioTrack(audioSource);
      } else {
        warnings.push('Este navegador não codifica AAC — a montagem sai sem áudio.');
      }
    } else if (options.withAudio !== false && !options.clips.every((c) => c.kind === 'image')) {
      warnings.push('Nenhum dos clipes tem áudio.');
    }

    await output.start();

    const frameCount = Math.max(1, Math.ceil(timeline.total * fps));
    const videoShare = audioSource ? 0.85 : 0.95;
    for (let i = 0; i < frameCount; i++) {
      const t = i / fps;
      await renderer.renderFrame(ctx, t);
      await videoSource.add(t, 1 / fps);
      if (i % 8 === 0) {
        options.onProgress?.(
          (i / frameCount) * videoShare,
          'Renderizando os quadros da montagem…',
        );
        // Devolve tempo ao navegador pra interface não travar.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    videoSource.close();

    if (audioSource) {
      if (musicBuffer) {
        // Mix completo (Etapa 8): clipes + música somados pela Web Audio,
        // resampleados juntos e escritos no trilho de saída.
        const mixed = await mixMontageAudio(
          renderer,
          musicBuffer,
          options.musicVolume ?? 0.7,
          warnings,
          options.onProgress,
          options.musicOffset ?? 0,
        );
        await writeMixedBuffer(audioSource, mixed, options.onProgress);
      } else {
        const n = renderer.audioTracks.length;
        for (let i = 0; i < n; i++) {
          const track = renderer.audioTracks[i];
          if (!track) continue;
          const start = renderer.timeline.clips[i].start;
          const [from, to] = renderer.audioRange(i);
          if (to - from <= 0.01) continue;
          try {
            const stat = await addClipAudio(
              audioSource,
              track,
              start,
              renderer.trims[i].trimStart,
              from,
              to,
            );
            if (stat.samples === 0) {
              warnings.push(
                `O clipe ${i + 1} não tem áudio no trecho usado (o áudio dele não cobre esse trecho).`,
              );
            }
          } catch (e) {
            warnings.push(
              `O áudio do clipe ${i + 1} ficou de fora${
                e instanceof Error && e.message ? ` (${e.message})` : ''
              }.`,
            );
          }
          options.onProgress?.(
            videoShare + ((i + 1) / n) * (0.97 - videoShare),
            'Juntando o áudio dos clipes…',
          );
        }
      }
      audioSource.close();
    }

    options.onProgress?.(0.98, 'Finalizando o arquivo…');
    await output.finalize();

    const buffer = output.target.buffer;
    if (!buffer) throw new Error('A montagem terminou sem gerar arquivo.');

    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      warnings,
      duration: timeline.total,
    };
  } finally {
    await renderer.dispose();
  }
}

/**
 * Lê o áudio de um clipe na janela `[fromGlobal, toGlobal]`, desloca pro lugar
 * certo da timeline e recorta nas pontas (sem sobrepor o clipe vizinho).
 *
 * `trimStart` é o deslocamento do trecho escolhido dentro do arquivo: o tempo
 * do arquivo vira tempo global por `global = clipStart + (arquivo − trimStart)`.
 */
async function addClipAudio(
  source: AudioSampleSource,
  track: InputAudioTrack,
  clipStart: number,
  trimStart: number,
  fromGlobal: number,
  toGlobal: number,
): Promise<{ samples: number; frames: number; first: number | null; last: number | null; firstTs: number }> {
  const sink = new AudioSampleSink(track);
  const firstTs = await track.getFirstTimestamp();
  const stat = { samples: 0, frames: 0, first: null as number | null, last: null as number | null, firstTs };
  // Áudio e vídeo do arquivo compartilham o MESMO relógio (spec de MP4/WebM):
  // o tempo do arquivo já é o tempo do vídeo — não se soma `firstTs` nele.
  // `firstTs` só limita o início, porque o áudio pode começar depois do vídeo
  // (o gravador enche o buffer antes de escrever o primeiro sample).
  const localStart = Math.max(
    firstTs,
    trimStart + Math.max(0, fromGlobal - clipStart),
  );
  const localEnd = trimStart + Math.max(0, toGlobal - clipStart);
  if (localEnd <= localStart) return stat;

  for await (const sample of sink.samples(localStart, localEnd)) {
    const rate = sample.sampleRate;
    // Mesma convenção do renderFrame: global = clipStart + (arquivo − trimStart).
    const globalTs = clipStart + (sample.timestamp - trimStart);
    let usable = sample;

    try {
      // O primeiro sample pode começar antes da janela → aparar o começo;
      // e o final nunca deve invadir o clipe seguinte.
      const skip = Math.max(0, Math.round((fromGlobal - globalTs) * rate));
      const limit = Math.floor((toGlobal - globalTs) * rate);
      const end = Math.min(sample.numberOfFrames, limit);
      // Sample inteiro fora da janela (ou aparado até virar vazio) → pula.
      if (end <= skip) {
        sample.close();
        continue;
      }
      if (skip > 0 || end < sample.numberOfFrames) {
        const trimmed = sample.trim(skip, end);
        sample.close();
        usable = trimmed;
      }

      // Cópia em f32 interleaved com o timestamp global novo — nunca negativo
      // (o arredondamento do recorte pode deixar um resíduo minúsculo).
      const bytes = usable.allocationSize({ planeIndex: 0, format: 'f32' });
      const buffer = new Uint8Array(bytes);
      usable.copyTo(buffer, { planeIndex: 0, format: 'f32' });
      const shifted = new AudioSample({
        data: buffer,
        format: 'f32',
        numberOfChannels: usable.numberOfChannels,
        sampleRate: usable.sampleRate,
        timestamp: Math.max(0, globalTs + skip / rate),
      });
      const usedFrames = usable.numberOfFrames;
      const usedRate = usable.sampleRate;
      usable.close();

      await source.add(shifted);
      stat.samples++;
      stat.frames += usedFrames;
      const g = shifted.timestamp;
      if (stat.first === null || g < stat.first) stat.first = g;
      const gEnd = g + usedFrames / usedRate;
      if (stat.last === null || gEnd > stat.last) stat.last = gEnd;
      shifted.close();
    } catch (e) {
      usable.close();
      throw e;
    }
  }
  return stat;
}

// -------------------------------------------------- trilha sonora (Etapa 8)

/** Taxa do mix final: a Web Audio resampleia clipes e música pra cá. */
const MIX_RATE = 48000;

/** Lê um arquivo de áudio (mp3/m4a/wav/ogg…) num AudioBuffer. */
async function decodeMusicFile(file: File): Promise<AudioBuffer | null> {
  try {
    const bytes = await file.arrayBuffer();
    // OfflineAudioContext decodifica sem precisar de gesto do usuário —
    // um AudioContext comum ficaria suspenso até o primeiro clique.
    const probe = new OfflineAudioContext(2, 1, MIX_RATE);
    const buffer = await probe.decodeAudioData(bytes);
    return buffer.duration > 0 ? buffer : null;
  } catch {
    return null;
  }
}

/**
 * Extrai o áudio do clipe na janela `[fromGlobal, toGlobal]` para um
 * AudioBuffer que cobre a janela inteira (na taxa nativa do arquivo).
 *
 * Mesmo relógio do `addClipAudio`: `global = clipStart + (arquivo − trimStart)`
 * e `firstTs` só limita o início. O que não tem áudio vira silêncio dentro
 * do buffer — é o que permite somar tudo depois sem perder o alinhamento.
 */
async function extractClipWindow(
  track: InputAudioTrack,
  clipStart: number,
  trimStart: number,
  fromGlobal: number,
  toGlobal: number,
  createBuffer: (channels: number, frames: number, rate: number) => AudioBuffer,
): Promise<AudioBuffer | null> {
  const sink = new AudioSampleSink(track);
  const firstTs = await track.getFirstTimestamp();
  const localStart = Math.max(
    firstTs,
    trimStart + Math.max(0, fromGlobal - clipStart),
  );
  const localEnd = trimStart + Math.max(0, toGlobal - clipStart);
  if (localEnd <= localStart) return null;

  let buffer: AudioBuffer | null = null;

  for await (const sample of sink.samples(localStart, localEnd)) {
    const rate = sample.sampleRate;
    const channels = sample.numberOfChannels;
    if (!buffer) {
      const frames = Math.max(1, Math.ceil((toGlobal - fromGlobal) * rate));
      buffer = createBuffer(channels, frames, rate);
    }

    const globalTs = clipStart + (sample.timestamp - trimStart);
    const skip = Math.max(0, Math.round((fromGlobal - globalTs) * rate));
    const limit = Math.floor((toGlobal - globalTs) * rate);
    const end = Math.min(sample.numberOfFrames, limit);
    if (end <= skip) {
      sample.close();
      continue;
    }

    // f32 INTERLEAVED: formato não planar = um plano só com tudo misturado.
    const bytes = sample.allocationSize({ planeIndex: 0, format: 'f32' });
    const raw = new Uint8Array(bytes);
    sample.copyTo(raw, { planeIndex: 0, format: 'f32' });
    const interleaved = new Float32Array(
      raw.buffer,
      raw.byteOffset,
      raw.byteLength >> 2,
    );
    sample.close();

    // Onde o primeiro frame USADO cai na janela (negativo se o sample começou
    // antes de `fromGlobal`: aí só o que sobra entra).
    const base = Math.round((globalTs - fromGlobal) * rate) + skip;
    const planeCount = Math.min(channels, buffer.numberOfChannels);
    for (let ch = 0; ch < planeCount; ch++) {
      const dst = buffer.getChannelData(ch);
      for (let f = skip; f < end; f++) {
        const i = base + (f - skip);
        if (i >= 0 && i < dst.length) dst[i] = interleaved[f * channels + ch];
      }
    }
  }
  return buffer;
}

/**
 * Soma o áudio dos clipes COM a trilha sonora num AudioBuffer só.
 *
 * A Web Audio faz o trabalho pesado — soma as fontes, aplica o ganho da
 * música, resampleia tudo pra MIX_RATE e corta no fim da timeline — sem
 * nenhum DSP escrito à mão aqui.
 */
async function mixMontageAudio(
  renderer: MontageRenderer,
  music: AudioBuffer,
  musicVolume: number,
  warnings: string[],
  onProgress?: (progress: number, label: string) => void,
  musicOffset = 0,
): Promise<AudioBuffer> {
  const total = renderer.timeline.total;
  const frames = Math.max(1, Math.ceil(total * MIX_RATE));
  const ctx = new OfflineAudioContext(2, frames, MIX_RATE);

  // 1) Áudio dos clipes, cada um na sua janela da timeline.
  const windows: { track: InputAudioTrack; i: number; from: number; to: number }[] = [];
  for (let i = 0; i < renderer.audioTracks.length; i++) {
    const track = renderer.audioTracks[i];
    if (!track) continue;
    const [from, to] = renderer.audioRange(i);
    if (to - from <= 0.01) continue;
    windows.push({ track, i, from, to });
  }

  let done = 0;
  for (const { track, i, from, to } of windows) {
    try {
      const clipBuffer = await extractClipWindow(
        track,
        renderer.timeline.clips[i].start,
        renderer.trims[i].trimStart,
        from,
        to,
        (channels, len, rate) => ctx.createBuffer(channels, len, rate),
      );
      if (!clipBuffer) {
        warnings.push(
          `O clipe ${i + 1} não tem áudio no trecho usado (o áudio dele não cobre esse trecho).`,
        );
      } else {
        const node = ctx.createBufferSource();
        node.buffer = clipBuffer;
        node.connect(ctx.destination);
        // O buffer cobre exatamente [from, to] → começar em `from` alinha o
        // primeiro frame com o lugar certo da timeline.
        node.start(from);
      }
    } catch (e) {
      warnings.push(
        `O áudio do clipe ${i + 1} ficou de fora${
          e instanceof Error && e.message ? ` (${e.message})` : ''
        }.`,
      );
    }
    done++;
    onProgress?.(
      0.85 + (done / Math.max(1, windows.length)) * 0.09,
      'Juntando o áudio dos clipes…',
    );
    // Devolve tempo ao navegador (a decodificação pesa em clipe grande).
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // 2) Música: loop se for mais curta que a montagem, volume do usuário e
  //    fades curtos pra não começar nem terminar estalando.
  const volume = Math.min(1, Math.max(0, musicVolume));
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const musicNode = ctx.createBufferSource();
  musicNode.buffer = music;
  if (music.duration < total) musicNode.loop = true;
  musicNode.connect(gain);

  const g = gain.gain;
  g.setValueAtTime(0, 0);
  if (total >= 1) {
    g.linearRampToValueAtTime(volume, Math.min(0.25, total * 0.2));
    g.setValueAtTime(volume, Math.max(0, total - 0.6));
    g.linearRampToValueAtTime(0, total);
  } else {
    g.setValueAtTime(volume, 0);
  }
  // Offset escolhido na timeline da música (Etapa 12): começa daí e, no
  // loop, volta pro início do arquivo.
  const offset = Math.min(
    Math.max(0, musicOffset),
    Math.max(0, music.duration - 0.05),
  );
  musicNode.start(0, offset);

  onProgress?.(0.945, 'Mixando a trilha sonora…');
  return await ctx.startRendering();
}

/**
 * Escreve o mix no trilho de saída em pedaços f32 interleaved com
 * timestamps contíguos a partir de 0 (a Web Audio entrega em planar).
 */
async function writeMixedBuffer(
  source: AudioSampleSource,
  buffer: AudioBuffer,
  onProgress?: (progress: number, label: string) => void,
): Promise<void> {
  const channels = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const total = buffer.length;
  const planes: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) planes.push(buffer.getChannelData(ch));

  const chunk = 4096;
  const chunks = Math.max(1, Math.ceil(total / chunk));
  for (let index = 0; index < chunks; index++) {
    const offset = index * chunk;
    const frames = Math.min(chunk, total - offset);
    const data = new Float32Array(frames * channels);
    for (let ch = 0; ch < channels; ch++) {
      const src = planes[ch];
      for (let f = 0; f < frames; f++) data[f * channels + ch] = src[offset + f];
    }
    const sample = new AudioSample({
      data,
      format: 'f32',
      numberOfChannels: channels,
      sampleRate: rate,
      timestamp: offset / rate,
    });
    await source.add(sample);
    sample.close();

    if (index % 16 === 0) {
      onProgress?.(0.95 + (index / chunks) * 0.02, 'Escrevendo o mix no arquivo…');
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.(0.97, 'Escrevendo o mix no arquivo…');
}
