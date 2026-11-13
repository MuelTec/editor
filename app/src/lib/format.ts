/** Largura do vídeo de saída (9:16). */
export const OUT_WIDTH = 1080;
/** Altura do vídeo de saída (9:16). */
export const OUT_HEIGHT = 1920;

/** Zona segura do TOPO do Story (barrinha de progresso, @). */
export const SAFE_TOP = 250;
/** Zona segura da BASE do Story (setinha, "Mensagem", link). */
export const SAFE_BOTTOM = 350;
/** Margem lateral dos textos (~6% da largura). */
export const SIDE_MARGIN = 64;
/** Folga mínima entre o vídeo nítido e o texto. */
export const VIDEO_GAP = 40;
/** Altura mínima de uma faixa de texto (abaixo disso, sobrepõe com scrim). */
export const MIN_BAND = 170;

/** Largura do vídeo de saída HORIZONTAL (16:9 — YouTube). */
export const HORIZONTAL_WIDTH = 1920;
/** Altura do vídeo de saída HORIZONTAL (16:9 — YouTube). */
export const HORIZONTAL_HEIGHT = 1080;

/** Zona segura do TOPO no feed (barra do player / navegação). */
export const H_SAFE_TOP = 90;
/** Zona segura da BASE no feed (controles, legenda, tempo). */
export const H_SAFE_BOTTOM = 150;
/** Margem lateral dos textos no horizontal (~5% da largura). */
export const H_SIDE_MARGIN = 96;

/**
 * Geometria de um quadro de saída (Etapa 9).
 *
 * Todo o motor de composição e legenda trabalha em cima disso — é o que
 * permite renderizar 9:16 E 16:9 com o MESMO código, mudando só os números.
 */
export interface FrameLayout {
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  sideMargin: number;
  videoGap: number;
  minBand: number;
}

/** Padrão: stories/Reels 1080×1920. */
export const VERTICAL_LAYOUT: FrameLayout = {
  width: OUT_WIDTH,
  height: OUT_HEIGHT,
  safeTop: SAFE_TOP,
  safeBottom: SAFE_BOTTOM,
  sideMargin: SIDE_MARGIN,
  videoGap: VIDEO_GAP,
  minBand: MIN_BAND,
};

/** YouTube/feed 1920×1080 — zonas seguras menores (não é Story). */
export const HORIZONTAL_LAYOUT: FrameLayout = {
  width: HORIZONTAL_WIDTH,
  height: HORIZONTAL_HEIGHT,
  safeTop: H_SAFE_TOP,
  safeBottom: H_SAFE_BOTTOM,
  sideMargin: H_SIDE_MARGIN,
  videoGap: VIDEO_GAP,
  minBand: MIN_BAND,
};

/** Feed quadrado 1080×1080 (Instagram). */
export const SQUARE_LAYOUT: FrameLayout = {
  width: 1080,
  height: 1080,
  safeTop: 120,
  safeBottom: 160,
  sideMargin: 72,
  videoGap: 32,
  minBand: 150,
};

/** Feed retrato 1080×1350 (4:5 — o maior formato vertical do feed). */
export const PORTRAIT_45_LAYOUT: FrameLayout = {
  width: 1080,
  height: 1350,
  safeTop: 140,
  safeBottom: 180,
  sideMargin: 72,
  videoGap: 36,
  minBand: 160,
};

/** Proporções de saída suportadas (Etapa 10 — inspirado no "Ratio" do CapCut). */
export type RatioId = '9:16' | '16:9' | '1:1' | '4:5';

export interface RatioInfo {
  id: RatioId;
  /** Rótulo curto pro chip da interface. */
  label: string;
  /** Onde costuma ser usado. */
  hint: string;
  width: number;
  height: number;
  layout: FrameLayout;
  /**
   * No modo VÍDEO ÚNICO: `'transmux'` = só trocar o envelope (sem recomprimir);
   * `'render'` = re-renderizar com fundo borrado + legenda.
   * Na montagem tudo é renderizado.
   */
  single: 'transmux' | 'render';
}

export const RATIOS: RatioInfo[] = [
  {
    id: '9:16',
    label: '9:16',
    hint: 'Stories/Reels',
    width: OUT_WIDTH,
    height: OUT_HEIGHT,
    layout: VERTICAL_LAYOUT,
    single: 'render',
  },
  {
    id: '16:9',
    label: '16:9',
    hint: 'YouTube',
    width: HORIZONTAL_WIDTH,
    height: HORIZONTAL_HEIGHT,
    layout: HORIZONTAL_LAYOUT,
    single: 'transmux',
  },
  {
    id: '1:1',
    label: '1:1',
    hint: 'Feed',
    width: SQUARE_LAYOUT.width,
    height: SQUARE_LAYOUT.height,
    layout: SQUARE_LAYOUT,
    single: 'render',
  },
  {
    id: '4:5',
    label: '4:5',
    hint: 'Feed retrato',
    width: PORTRAIT_45_LAYOUT.width,
    height: PORTRAIT_45_LAYOUT.height,
    layout: PORTRAIT_45_LAYOUT,
    single: 'render',
  },
];

/** Proporções que podem ser geradas ALÉM da principal. */
export const EXTRA_RATIOS: RatioInfo[] = RATIOS.filter((r) => r.id !== '9:16');

export function ratioInfo(id: RatioId): RatioInfo {
  return RATIOS.find((r) => r.id === id) ?? RATIOS[0];
}

/** Escolhe o layout pela proporção pedida. */
export function layoutFor(ratio: RatioId): FrameLayout {
  return RATIOS.find((r) => r.id === ratio)?.layout ?? VERTICAL_LAYOUT;
}
