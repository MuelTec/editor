import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALIGN_OPTIONS,
  ANIM_OPTIONS,
  COLOR_OPTIONS,
  DEFAULT_CAPTION,
  EFFECT_COLORS,
  EFFECT_OPTIONS,
  EFFECTS_WITH_COLOR,
  FONT_OPTIONS,
  CAPTION_SIZE_MAX,
  CAPTION_SIZE_MIN,
  POSITION_PRESETS,
  type CaptionOptions,
} from './lib/caption';
import { EXTRA_RATIOS, OUT_HEIGHT, OUT_WIDTH, ratioInfo, type RatioId } from './lib/format';
import {
  DEFAULT_ADJUSTMENTS,
  FILTERS,
  type Adjustments,
  type FilterId,
} from './lib/filters';
import { analyzeMusic, beatsInTimeline, snapCutsToBeats, type MusicAnalysis } from './lib/beats';
import {
  DEFAULT_MODEL,
  IMAGE_DEFAULT_SECONDS,
  IMAGE_MAX_SECONDS,
  MODELS,
  TRANSITIONS,
  assembleMontage,
  buildTimeline,
  isImageFile,
  junctionDurations,
  probeClip,
  probeImage,
  type MontageClip,
  type TransitionId,
} from './lib/montage';
import {
  averageJunction,
  cutEnd,
  cutStart,
  fileTimeAt,
  locateClip,
  removeClipById,
  replaceClip,
  splitClip,
} from './lib/clipOps';
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  startLivePreview,
  startMontagePreview,
  type LivePreview,
  type MontagePreview,
} from './lib/preview';
import {
  PROJECT_FPS,
  duplicateText,
  formatTimecode,
  isTextActive,
  moveText,
  newTextClip,
  stepTime,
  withRange,
  type TextClip,
} from './lib/textTrack';
import {
  DEFAULT_LAYOUT,
  LAYOUT_KEY,
  clampPanel,
  isHidden,
  layoutVars,
  parseLayout,
  resetPanel,
  resizePanel,
  serializeLayout,
  togglePanel,
  type PanelId,
  type PanelLayout,
  type Space,
} from './lib/panelLayout';
import { toHorizontal, toVertical } from './lib/toVertical';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type History,
} from './lib/history';
import HomeScreen, { type HomeToolId } from './HomeScreen';
import { FilterThumb, TransitionThumb } from './ThumbPreview';

/** Estado editável que o desfazer/refazer devolve inteiro. */
interface EditSnapshot {
  clips: ClipInfo[];
  texts: TextClip[];
  modelId: string;
  customFilter: FilterId | null;
}

/** Mesmos elementos = mesmo passo (não empurra histórico à toa). */
function sameSnapshot(a: EditSnapshot, b: EditSnapshot): boolean {
  return (
    a.clips === b.clips &&
    a.texts === b.texts &&
    a.modelId === b.modelId &&
    a.customFilter === b.customFilter
  );
}

/**
 * EDITOR ESTILO CAPCUT (Etapa 12).
 *
 * Layout em grid profissional:
 *  - Topbar: marca, voltar e exportar;
 *  - Library (esquerda): mídia/modelos/áudio;
 *  - Preview (centro): monitor de saída;
 *  - Inspector (direita): ajustes/texto/saída;
 *  - Timeline (baixo): régua, clipes, forma de onda com BATIDAS e
 *    handle pra escolher o início da música.
 *
 * Todo o motor (lib/) é o mesmo das etapas anteriores — aqui só
 * conectamos as peças nos lugares certos.
 */

type Phase = 'idle' | 'ready' | 'working' | 'done' | 'error';
type Mode = 'single' | 'montage';
type Stage = 'vertical' | 'output' | 'montage';
type LibTab = 'midia' | 'modelos' | 'audio';
type InspTab = 'ajustes' | 'texto' | 'saida';

/** Uma saída EXTRA gerada além da principal 9:16 (Etapa 10). */
interface ExtraOutput {
  ratio: RatioId;
  url: string;
  size: number;
}

interface FileInfo {
  name: string;
  size: number;
  width: number;
  height: number;
  duration: number;
}

interface ClipInfo extends FileInfo {
  id: string;
  file: File;
  /** Trecho usado dentro do arquivo (Etapa 7 — trim). */
  trimStart: number;
  trimEnd: number;
  /** Vídeo ou imagem (imagem = foto parada que dura `trimEnd − trimStart` s). */
  kind: 'video' | 'image';
  /** Transição do corte entre ESTE clipe e o PRÓXIMO (ausente = a padrão da montagem). */
  transition?: TransitionId;
  /** Duração dessa transição; 0 = corte seco (ausente = a padrão). */
  transitionDuration?: number;
}

const VIDEO_RE = /\.(mp4|mov|webm|m4v|mkv)$/i;
const isVideoFile = (f: File): boolean =>
  f.type.startsWith('video/') || VIDEO_RE.test(f.name);

/** Converte a lista da UI pro formato do motor de montagem. */
const toMontageClips = (list: ClipInfo[]): MontageClip[] =>
  list.map((c) => ({
    file: c.file,
    kind: c.kind,
    trimStart: c.trimStart,
    trimEnd: c.trimEnd,
    transition: c.transition,
    transitionDuration: c.transitionDuration,
  }));

/** Aceita vídeo OU imagem. */
const isMediaFile = (f: File): boolean => isVideoFile(f) || isImageFile(f);

/** Mesmo `accept` dos seletores de arquivo (vídeo + imagem). */
const MEDIA_ACCEPT =
  'video/*,image/*,.mp4,.mov,.webm,.m4v,.mkv,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif';

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Tempo de trim com 1 casa decimal (0,8s). */
const formatTrim = (seconds: number): string =>
  `${Math.max(0, seconds).toFixed(1).replace('.', ',')}s`;

/**
 * Passos da régua em segundos, do mais fino ao mais grosso (Etapa 13):
 * o passo escolhido é o primeiro cujo `passo × 10` cobre a janela visível
 * (≈10 marcações na tela), independentemente do zoom.
 */
const RULER_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

/** Rótulo da régua adaptado ao passo (0,5s · 12s · 2:30). */
const formatTick = (seconds: number, step: number): string =>
  step < 1 ? `${seconds.toFixed(1).replace('.', ',')}s` : formatDuration(seconds);

/** Rótulo de um quadro na régua em zoom máximo: `0:03` na virada do segundo, `12f` nos demais. */
const formatFrameTick = (frame: number, fps: number): string =>
  frame % fps === 0 ? formatDuration(frame / fps) : `${frame % fps}f`;

/** Lê segundos de um campo de texto (aceita vírgula); `undefined` se inválido. */
const parseSeconds = (value: string): number | undefined => {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Ícone de painel (esquerda / direita / embaixo): cheio = visível, vazado = escondido. */
function PanelIcon({ side, filled }: { side: 'left' | 'right' | 'bottom'; filled: boolean }) {
  const bar =
    side === 'left'
      ? { x: 1.5, y: 2.5, w: 4.5, h: 11 }
      : side === 'right'
        ? { x: 10, y: 2.5, w: 4.5, h: 11 }
        : { x: 1.5, y: 9, w: 13, h: 4.5 };
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect
        x={bar.x}
        y={bar.y}
        width={bar.w}
        height={bar.h}
        rx="1.2"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

export default function App() {
  // ------------------------------------------------------------ projeto
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<Mode>('single');
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultSize, setResultSize] = useState(0);
  const [resultDuration, setResultDuration] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('vertical');
  const [step, setStep] = useState(1);
  const [steps, setSteps] = useState(1);
  // ---- saídas extras / proporções (Etapa 10)
  // Só o 9:16 por padrão: cada proporção extra é um arquivo a mais (e mais tempo de espera).
  const [extraRatios, setExtraRatios] = useState<RatioId[]>([]);
  const [outputs, setOutputs] = useState<ExtraOutput[]>([]);

  // ------------------------------------------------------------ estilo
  /** Blocos de texto da trilha de texto (cada um com início, fim e estilo). */
  const [texts, setTexts] = useState<TextClip[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  /** Tamanho de cada painel e quais estão escondidos (salvo no aparelho). */
  const [layout, setLayout] = useState<PanelLayout>(() => {
    try {
      return parseLayout(localStorage.getItem(LAYOUT_KEY));
    } catch {
      return { ...DEFAULT_LAYOUT };
    }
  });
  /** Qual divisor está sendo arrastado agora (estilo do cursor + destaque). */
  const [resizing, setResizing] = useState<PanelId | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ id: PanelId; x0: number; y0: number; start: number } | null>(null);
  /** Onde o cursor deve ficar quando a prévia da montagem for recriada (dividir/cortar/excluir). */
  const pendingSeekRef = useRef<number | null>(null);
  /** Último tempo da prévia da montagem: ela é recriada a cada edição e o cursor não pode voltar ao 0. */
  const lastMontageClockRef = useRef(0);
  const [filter, setFilter] = useState<FilterId>('none');
  const [adjust, setAdjust] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [playing, setPlaying] = useState(false);
  const [singleTime, setSingleTime] = useState(0);
  /** Identifica a leitura de metadados mais recente (erro 8). */
  const pickIdRef = useRef(0);
  /** Arrasto na régua/trilha (scrub por toque ou mouse — erro 14). */
  const scrubbingRef = useRef(false);

  // ------------------------------------------------------------ montagem
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [modelId, setModelId] = useState(DEFAULT_MODEL.id);
  /** Transição escolhida à mão (null = usa a do modelo). */
  const [customTransition, setCustomTransition] = useState<TransitionId | null>(null);
  /** Duração escolhida à mão (null = usa a do modelo). */
  const [customTransitionDuration, setCustomTransitionDuration] = useState<number | null>(null);
  const [trimmingId, setTrimmingId] = useState<string | null>(null);
  /**
   * Filtro escolhido pra montagem inteira.
   * `null` = seguir o modelo, mas o padrão é `'none'`: o modelo NÃO injeta
   * filtro sozinho — quem escolhe é você.
   */
  const [customFilter, setCustomFilter] = useState<FilterId | null>('none');
  // ------------------------------------- histórico (desfazer / refazer)
  /**
   * Pilha de passos. Guardamos só REFERÊNCIAS do estado vivo (clips/texts/...),
   * então desfazer não duplica memória — e `sameSnapshot` impede que o efeito
   * abaixo regrave o próprio passo que ele acabou de aplicar.
   */
  const [hist, setHist] = useState<History<EditSnapshot> | null>(null);

  /** Guarda um passo depois de cada edição (roda após o commit). */
  useEffect(() => {
    const cur: EditSnapshot = { clips, texts, modelId, customFilter };
    if (!hist) {
      setHist(createHistory(cur));
      return;
    }
    if (sameSnapshot(hist.present, cur)) return;
    setHist(pushHistory(hist, cur, Date.now()));
  }, [clips, texts, modelId, customFilter, hist]);

  /** Volta um passo (clips + textos + modelo + filtro de uma vez). */
  const undo = useCallback(() => {
    const next = hist ? undoHistory(hist) : null;
    if (!next) return;
    setHist(next);
    setClips(next.present.clips);
    setTexts(next.present.texts);
    setModelId(next.present.modelId);
    setCustomFilter(next.present.customFilter);
  }, [hist]);

  /** Avança um passo desfeito. */
  const redo = useCallback(() => {
    const next = hist ? redoHistory(hist) : null;
    if (!next) return;
    setHist(next);
    setClips(next.present.clips);
    setTexts(next.present.texts);
    setModelId(next.present.modelId);
    setCustomFilter(next.present.customFilter);
  }, [hist]);

  /** Ctrl+Z = desfazer · Ctrl+Shift+Z ou Ctrl+Y = refazer (não mexe em quem digita). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
  /** Clipe selecionado na timeline (dividir/cortar/excluir). */
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  /** Corte selecionado: o que liga este clipe ao PRÓXIMO (transição própria). */
  const [selectedJunctionId, setSelectedJunctionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [montageTime, setMontageTime] = useState(0);
  const [montageDuration, setMontageDuration] = useState(0);
  const [montagePlaying, setMontagePlaying] = useState(true);

  // ------------------------------------------- zoom da linha do tempo
  // Só a LINHA dá zoom (Etapa 13) — o app inteiro fica na mesma escala.
  /** 1 = linha inteira; 4 = 25% da duração visível. */
  const [zoom, setZoom] = useState(1);
  /** Instante (s) visível no início da linha quando há zoom. */
  const [viewStart, setViewStart] = useState(0);

  // ------------------------------------------------------------ música
  const [music, setMusic] = useState<File | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.7);
  const [musicOffset, setMusicOffset] = useState(0); // Etapa 12
  const [musicAnalysis, setMusicAnalysis] = useState<MusicAnalysis | null>(null); // Etapa 12

  // ------------------------------------------------------------ painéis
  const [libTab, setLibTab] = useState<LibTab>('midia');
  const [inspTab, setInspTab] = useState<InspTab>('ajustes');

  const inputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const resultVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const montageCanvasRef = useRef<HTMLCanvasElement>(null);
  const musicAudioRef = useRef<HTMLAudioElement>(null);
  /**
   * O elemento da onda como ESTADO: o efeito que a desenha precisa rodar quando
   * a linha do tempo aparece (ela não existe na Home). Sem isto o ref já era
   * `null` na primeira execução e o efeito nunca mais era reexecutado — a onda
   * ficava um canvas cru de 300×150 até alguém mexer num slider.
   */
  const [musicCanvasEl, setMusicCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const attachMusicCanvas = useCallback((el: HTMLCanvasElement | null) => {
    setMusicCanvasEl(el);
  }, []);
  const montagePreviewRef = useRef<MontagePreview | null>(null);
  const timeTickRef = useRef(0);
  const musicOffsetRef = useRef(0);
  const musicDraggingRef = useRef(false);
  /**
   * Espelho de `montagePlaying` em ref: a prévia é recriada por um efeito
   * que não pode depender do estado (senão reabriria os arquivos a cada
   * play/pause) — sem isso ela voltava TOCANDO com a UI mostrando ▶ (Etapa 13).
   */
  const montagePlayingRef = useRef(true);
  /** Ponto de partida do pan da música (cliente X + offset inicial). */
  const musicDragStartRef = useRef<{ x: number; offset: number } | null>(null);
  /** Contêiner da linha do tempo (zoom/pan por scroll — Etapa 13). */
  const tlTracksRef = useRef<HTMLDivElement>(null);
  /** Trilha régua+vídeo: o retângulo de referência do clique/arrasto no tempo. */
  const tlStackRef = useRef<HTMLDivElement>(null);
  /** Distância (px) percorrida no gesto de scrub atual: < limiar = "clique". */
  const scrubMovedRef = useRef(0);
  /** Ponto onde o ponteiro começou o gesto de scrub. */
  const scrubOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** Prévia ao vivo do vídeo único: dá pra atualizar sem recriar (não volta a tocar). */
  const livePreviewRef = useRef<LivePreview | null>(null);
  /** Últimos textos/filtro/ajustes — a prévia nasce com eles e depois só recebe update(). */
  const singleStyleRef = useRef<{ texts: TextClip[]; filter: FilterId; adjust: Adjustments }>({
    texts: [],
    filter: 'none',
    adjust: DEFAULT_ADJUSTMENTS,
  });
  singleStyleRef.current = { texts, filter, adjust };
  /** Arrasto de um bloco de texto na trilha (mover / puxar a ponta). */
  const textDragRef = useRef<{
    id: string;
    kind: 'move' | 'start' | 'end';
    x0: number;
    secPerPx: number;
    orig: TextClip;
  } | null>(null);
  /** Arrasto do texto selecionado direto na prévia (posição livre). */
  const canvasDragRef = useRef<{
    id: string;
    x0: number;
    y0: number;
    ox: number;
    oy: number;
    w: number;
    h: number;
  } | null>(null);

  // Analisa a música quando o arquivo é escolhido.
  useEffect(() => {
    // Sempre que a música muda (ou sai), zera análise e início: o offset
    // da faixa anterior podia passar da duração da nova (erro 3).
    setMusicAnalysis(null);
    setMusicOffset(0);
    if (!music) return;
    let cancelled = false;
    analyzeMusic(music)
      .then((res) => {
        if (!cancelled) setMusicAnalysis(res);
      })
      .catch(() => {
        if (!cancelled) setNotice('Não consegui analisar essa música. Tente outro arquivo.');
      });
    return () => {
      cancelled = true;
    };
  }, [music]);

  useEffect(() => {
    musicOffsetRef.current = musicOffset;
  }, [musicOffset]);

  const musicUrl = useMemo(
    () => (music ? URL.createObjectURL(music) : null),
    [music],
  );
  useEffect(() => {
    return () => {
      if (musicUrl) URL.revokeObjectURL(musicUrl);
    };
  }, [musicUrl]);

  const model = MODELS.find((m) => m.id === modelId) ?? DEFAULT_MODEL;
  const currentTransition: TransitionId = customTransition ?? model.transition;
  const currentTransitionDuration = customTransitionDuration ?? model.transitionDuration;
  const currentFilter: FilterId = customFilter ?? model.filter;

  // Batidas convertidas pro TEMPO DA MONTAGEM (com loop da música) —
  // desenhadas como marcações na trilha de vídeo (Etapa 12).
  const timelineBeats = useMemo(
    () =>
      musicAnalysis && montageDuration > 0
        ? beatsInTimeline(
            musicAnalysis.beats,
            musicAnalysis.duration,
            musicOffset,
            montageDuration,
          )
        : [],
    [musicAnalysis, montageDuration, musicOffset],
  );

  // Libera a URL do vídeo de resultado quando troca/limpa
  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  // Libera as URLs das saídas extras (16:9, 1:1, 4:5) quando a lista muda
  useEffect(() => {
    return () => {
      for (const o of outputs) URL.revokeObjectURL(o.url);
    };
  }, [outputs]);

  // Libera a URL da prévia
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Prévia AO VIVO (vídeo único): o compositor do export rodando em cima do vídeo.
  useEffect(() => {
    if (phase !== 'ready' || mode !== 'single' || !file) return;
    let cancelled = false;
    let live: LivePreview | null = null;
    let timer = 0;
    let waitTimer = 0;

    const begin = () => {
      const v = previewRef.current;
      const c = canvasRef.current;
      if (cancelled || !v || !c) return;
      if (v.readyState < 2) {
        const onLoad = () => begin();
        v.addEventListener('loadeddata', onLoad, { once: true });
        waitTimer = window.setTimeout(
          () => v.removeEventListener('loadeddata', onLoad),
          4000,
        );
        return;
      }
      const style = singleStyleRef.current;
      live = startLivePreview(
        v,
        c,
        style.texts,
        true,
        style.filter,
        style.adjust,
        true, // fast (Etapa 13)
      );
      livePreviewRef.current = live;
      void v
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    };

    timer = window.setTimeout(begin, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(waitTimer);
      live?.stop();
      if (livePreviewRef.current === live) livePreviewRef.current = null;
    };
    // Textos/filtro/ajustes NÃO recriam a prévia (ela voltaria a tocar sozinha
    // — ruim pra olhar quadro a quadro): entram pelo efeito logo abaixo.
  }, [mode, phase, file]);

  // Troca quente de textos/filtro/ajustes na prévia do vídeo único.
  useEffect(() => {
    livePreviewRef.current?.update({ texts, filter, adjust });
  }, [texts, filter, adjust]);

  // Relógio da prévia de vídeo único (alimenta o playhead da timeline).
  useEffect(() => {
    if (phase !== 'ready' || mode !== 'single' || !playing) return;
    const id = window.setInterval(() => {
      const v = previewRef.current;
      if (v) setSingleTime(v.currentTime);
    }, 120);
    return () => window.clearInterval(id);
  }, [phase, mode, playing]);

  // Prévia da MONTAGEM: criada quando a lista de clipes (ou o trim) muda.
  useEffect(() => {
    if (phase !== 'ready' || mode !== 'montage' || clips.length === 0) return;
    const canvas = montageCanvasRef.current;
    if (!canvas) return;

    // Debounce: mexendo nos sliders de trim a lista muda a cada tick —
    // esperamos parar antes de reabrir os arquivos.
    let api: MontagePreview | null = null;
    const timer = window.setTimeout(() => {
      api = startMontagePreview(canvas, {
        clips: toMontageClips(clips),
        transition: currentTransition,
        transitionDuration: currentTransitionDuration,
        filter: currentFilter,
        texts,
        adjust,
        guides: true,
        // Depois de uma edição (dividir/cortar) o cursor fica onde estava.
        startTime: pendingSeekRef.current ?? lastMontageClockRef.current,
        // Etapa 13: prévia no caminho reduzido do blur (não trava tablets).
        fast: true,
        onTime: (t, d) => {
          // Trilha alinhada com a prévia (busca, loop e troca de clipe).
          const audio = musicAudioRef.current;
          if (
            audio &&
            !audio.paused &&
            Number.isFinite(audio.duration) &&
            audio.duration > 0
          ) {
            const expected = (t + musicOffsetRef.current) % audio.duration;
            // Tolerância folgada: só reencaixa quando a prévia e o áudio
            // divergiram de verdade (busca, fim da música, troca de clipe).
            if (Math.abs(audio.currentTime - expected) > 1) {
              audio.currentTime = expected;
            }
          }
          // A duração é idempotente (mesmo valor = sem re-render) e precisa
          // chegar mesmo com a prévia pausada — aí o onTime é a única via.
          setMontageDuration(d);
          // Atualiza o tempo no máx. 10×/s pra não repintar a UI a 60fps.
          if (Math.abs(t - timeTickRef.current) >= 0.1) {
            timeTickRef.current = t;
            setMontageTime(t);
          } else if (t === 0 && timeTickRef.current !== 0) {
            timeTickRef.current = 0;
            setMontageTime(0);
          }
        },
      });
      montagePreviewRef.current = api;
      // Respeita o play/pause atual: sem isso a prévia recriada voltava
      // tocando mesmo com a UI em ▶ (dessincronia — Etapa 13).
      api.setPaused(!montagePlayingRef.current);
      const startAt = pendingSeekRef.current ?? lastMontageClockRef.current;
      pendingSeekRef.current = null;
      timeTickRef.current = startAt;
      setMontageTime(startAt);
      setMontageDuration(api.duration);
    }, 300);

    return () => {
      window.clearTimeout(timer);
      if (api) lastMontageClockRef.current = api.time;
      api?.stop();
      if (montagePreviewRef.current === api) montagePreviewRef.current = null;
    };
    // `model`/`texts`/`adjust` ficam de fora de propósito: trocas
    // quentes entram pelo efeito logo abaixo, sem reabrir os arquivos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, clips]);

  // Troca quente de modelo/textos/ajustes/transição na prévia da montagem.
  useEffect(() => {
    const api = montagePreviewRef.current;
    if (!api) return;
    void api.update({
      transition: currentTransition,
      transitionDuration: currentTransitionDuration,
      filter: currentFilter,
      texts,
      adjust,
      guides: true,
    });
  }, [model, currentFilter, texts, adjust, currentTransition, currentTransitionDuration]);

  // Sincroniza o <audio> da prévia: fonte, volume e play/pause.
  // Um efeito só porque o elemento monta DEPOIS (só existe com clipes na
  // tela) — efeitos separados perdiam essa primeira sincronização.
  useEffect(() => {
    const el = musicAudioRef.current;
    if (!el) return;
    const want = musicUrl ?? '';
    if ((el.getAttribute('src') ?? '') !== want) {
      if (want) el.src = want;
      else el.removeAttribute('src');
      el.load();
    }
    el.volume = musicVolume;
    const shouldPlay =
      !!want && phase === 'ready' && mode === 'montage' && montagePlaying;
    if (shouldPlay) {
      // Autoplay bloqueado destrava na primeira interação do usuário.
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, [musicUrl, musicVolume, montagePlaying, phase, mode, clips]);

  // --------------------------------------------- escala da linha do tempo
  // Tudo na linha usa a MESMA janela [viewStart, viewStart + viewSpan]
  // (Etapa 13): régua, clipes, batidas, playhead e a onda da música.
  const videoTotal = mode === 'montage' ? montageDuration : (info?.duration ?? 0);
  const videoCurrent = mode === 'montage' ? montageTime : singleTime;
  const viewSpan = videoTotal > 0 ? videoTotal / Math.max(1, zoom) : 0;
  const viewStartClamped =
    viewSpan >= videoTotal || viewSpan <= 0
      ? 0
      : Math.min(Math.max(0, viewStart), Math.max(0, videoTotal - viewSpan));

  /** Tempo (s) → % horizontal dentro da janela visível (0–100). */
  const posPct = (t: number): number =>
    viewSpan > 0
      ? Math.min(100, Math.max(0, ((t - viewStartClamped) / viewSpan) * 100))
      : 0;

  // Régua: passo adaptativo ao ZOOM (não à duração total).
  const rulerStep = viewSpan > 0 ? RULER_STEPS.find((s) => s * 10 >= viewSpan) ?? 1800 : 1;
  const rulerTicks: number[] = [];
  if (viewSpan > 0) {
    const end = viewStartClamped + viewSpan;
    for (
      let t = Math.ceil(viewStartClamped / rulerStep) * rulerStep;
      t <= end + 1e-6;
      t += rulerStep
    ) {
      rulerTicks.push(Math.round(t * 1000) / 1000);
    }
  }

  // Zoom de QUADROS: com poucos quadros na janela, a régua marca cada quadro
  // (e só rotula alguns) — dá pra mirar um quadro exato com o cursor.
  const visibleFrames = viewSpan * PROJECT_FPS;
  const frameMode = viewSpan > 0 && visibleFrames <= 90;
  const frameTicks: { t: number; label: string | null }[] = [];
  if (frameMode) {
    const f0 = Math.ceil(viewStartClamped * PROJECT_FPS - 1e-6);
    const f1 = Math.floor((viewStartClamped + viewSpan) * PROJECT_FPS + 1e-6);
    const every = Math.max(1, Math.ceil(visibleFrames / 12));
    for (let f = f0; f <= f1; f++) {
      frameTicks.push({
        t: f / PROJECT_FPS,
        label: f % every === 0 ? formatFrameTick(f, PROJECT_FPS) : null,
      });
    }
  }

  // Posição REAL dos clipes — com a sobreposição das transições, do jeito
  // que o motor monta (Etapa 13: antes cada clipe só tinha % da largura).
  const montageTimeline = useMemo(
    () =>
      mode === 'montage' && clips.length > 0
        ? buildTimeline(
            clips.map((c) => Math.max(0.1, c.trimEnd - c.trimStart)),
            junctionDurations(clips, currentTransitionDuration),
          )
        : null,
    [mode, clips, currentTransitionDuration],
  );

  // Batidas como elementos do DOM só quando são poucas: com centenas elas já
  // aparecem no canvas da música e o DOM ficava pesado no tablet (erro 11).
  const visibleBeatEls = useMemo(() => {
    const vis = timelineBeats.filter(
      (t) => t >= viewStartClamped && t <= viewStartClamped + viewSpan,
    );
    return vis.length > 120 ? [] : vis;
  }, [timelineBeats, viewStartClamped, viewSpan]);

  // ------------------------------------------------------- forma de onda
  // Desenha a faixa de música NA ESCALA DA LINHA (Etapa 13): a janela
  // visível [viewStart, viewStart+viewSpan] é mapeada pra música com loop
  // ((offset + t) % dur) — onda, batidas e playhead acompanham o zoom.
  useEffect(() => {
    const canvas = musicCanvasEl;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      const w = Math.max(160, parent?.clientWidth ?? 480);
      // Acompanha a altura da faixa (padrão igual às outras trilhas).
      const h = Math.max(24, Math.round(parent?.clientHeight ?? 54));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, 0, w, h);

      if (!musicAnalysis) {
        ctx.fillStyle = '#6b6b6b';
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          music ? 'Analisando a música…' : 'Sem trilha sonora — adicione na aba Áudio',
          w / 2,
          h / 2 + 4,
        );
        return;
      }

      const dur = Math.max(0.1, musicAnalysis.duration);
      const offset = Math.min(Math.max(0, musicOffset), Math.max(0, dur - 0.05));
      const span = Math.max(0.1, viewSpan || dur);
      const vs = viewStartClamped;
      const cycles = Math.ceil(span / dur) + 1;
      /** Tempo da linha (s) → posição na música (com loop). */
      const musicAt = (t: number): number => (offset + t) % dur;

      // 1) Forma de onda na escala da JANELA (1 barra ≈ 3px) — com zoom a
      //    onda se abre junto com a linha, em vez de 829 batidas espremidas.
      const peaks = musicAnalysis.peaks;
      const barW = 3;
      const bars = Math.max(1, Math.floor(w / barW));
      ctx.fillStyle = '#26b9ff';
      ctx.globalAlpha = 0.65;
      for (let i = 0; i < bars; i++) {
        const mt = musicAt(vs + (i / bars) * span);
        const p =
          peaks[Math.min(peaks.length - 1, Math.floor((mt / dur) * peaks.length))] ?? 0;
        const bh = Math.max(2, p * (h - 16));
        ctx.fillRect(i * barW, (h - bh) / 2, Math.max(1, barW - 1), bh);
      }
      ctx.globalAlpha = 1;

      // 2) Trecho PULADO da música (antes do offset): entra depois do fim
      //    do loop — (t % dur) ∈ [dur − offset, dur).
      if (offset > 0.02) {
        const firstCycle = Math.floor(vs / dur);
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        for (let k = firstCycle; k <= firstCycle + cycles; k++) {
          const t0 = k * dur + (dur - offset);
          const t1 = t0 + offset;
          if (t0 > vs + span) break;
          if (t1 <= vs) continue;
          const x0 = Math.max(0, ((Math.max(t0, vs) - vs) / span) * w);
          const x1 = Math.min(w, ((Math.min(t1, vs + span) - vs) / span) * w);
          if (x1 <= x0) continue;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
          ctx.fillRect(x0, 0, x1 - x0, h);
          ctx.fillStyle = '#969696';
          ctx.fillText('pulado', x0 + 4, 12);
        }
      }

      // 3) BATIDAS da música já convertidas pro TEMPO DA LINHA — só as
      //    visíveis, na escala da janela (no zoom elas se abrem).
      //    Denso (espaço < 12px) → só a linha; aberto → linha + pontinho.
      const visible = timelineBeats.filter((b) => b >= vs && b <= vs + span);
      const showDots = visible.length > 0 && visible.length <= w / 12;
      ctx.fillStyle = '#ff4d6d';
      for (const b of visible) {
        const x = ((b - vs) / span) * w;
        ctx.fillRect(x, 4, 1.5, h - 8);
        if (showDots) ctx.fillRect(x - 2, 4, 5.5, 4); // pontinho no topo
      }

      // 4) Início da música (posição 0 do arquivo) — marcador BRANCO.
      const musicZero = (dur - offset) % dur; // primeiro t em que a música está em 0
      const firstZero = Math.max(0, Math.ceil((vs - musicZero) / dur));
      ctx.fillStyle = '#ffffff';
      for (let k = firstZero; k <= firstZero + cycles; k++) {
        const t = musicZero + k * dur;
        if (t > vs + span) break;
        if (t < vs) continue;
        const x = ((t - vs) / span) * w;
        ctx.fillRect(x - 1, 0, 2, h);
        ctx.fillRect(x - 5, 0, 10, 3);
      }

      // 5) Playhead da linha (amarelo) — MESMO x do playhead branco.
      if (videoTotal > 0) {
        const t = Math.min(Math.max(0, videoCurrent), videoTotal);
        if (t >= vs && t <= vs + span) {
          const x = ((t - vs) / span) * w;
          ctx.fillStyle = '#ffd400';
          ctx.fillRect(x - 1, 0, 2, h);
          ctx.fillRect(x - 5, h - 3, 10, 3);
        }
      }
    };

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [
    musicCanvasEl,
    musicAnalysis,
    musicOffset,
    timelineBeats,
    videoCurrent,
    videoTotal,
    viewSpan,
    viewStartClamped,
    music,
  ]);

  // Auto-follow do playhead (Etapa 13): só enquanto TOCA e com zoom, mantém
  // o tempo visível na janela com folga — parado, a linha não anda sozinha.
  useEffect(() => {
    if (phase !== 'ready' || videoTotal <= 0 || zoom <= 1 || viewSpan <= 0) return;
    const playingNow = mode === 'montage' ? montagePlaying : playing;
    if (!playingNow) return;
    const margin = viewSpan * 0.12;
    const t = videoCurrent;
    const vs = viewStartClamped;
    if (t >= vs + margin && t <= vs + viewSpan - margin) return;
    const target =
      t < vs + margin ? t - margin : t - viewSpan + margin;
    setViewStart(
      Math.min(Math.max(0, target), Math.max(0, videoTotal - viewSpan)),
    );
  }, [
    phase,
    mode,
    montagePlaying,
    playing,
    videoCurrent,
    videoTotal,
    viewSpan,
    viewStartClamped,
    zoom,
  ]);

  // ---------------------------------------------------------- controles
  const togglePlay = useCallback(() => {
    const v = previewRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().then(() => setPlaying(true)).catch(() => undefined);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, []);

  const toggleMontagePlay = useCallback(() => {
    const api = montagePreviewRef.current;
    if (!api) return;
    const next = !montagePlaying;
    api.setPaused(!next);
    montagePlayingRef.current = next;
    setMontagePlaying(next);
  }, [montagePlaying]);

  const seekMontage = useCallback((time: number) => {
    montagePreviewRef.current?.seek(time);
    setMontageTime(time);
    const audio = musicAudioRef.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (time + musicOffsetRef.current) % audio.duration;
    }
  }, []);

  const seekSingle = useCallback((time: number) => {
    const v = previewRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, time);
    setSingleTime(v.currentTime);
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setFile(null);
    setInfo(null);
    setProgress(0);
    setProgressLabel('');
    setWarnings([]);
    setError(null);
    setNotice(null);
    setResultUrl(null);
    setResultSize(0);
    setResultDuration(0);
    setPreviewUrl(null);
    setOutputs([]);
    setStage('vertical');
    setStep(1);
    setSteps(1);
    setClips([]);
    setTexts([]);
    setSelectedTextId(null);
    setSelectedClipId(null);
    setSelectedJunctionId(null);
    pendingSeekRef.current = null;
    lastMontageClockRef.current = 0;
    setTrimmingId(null);
    setMontageTime(0);
    setMontageDuration(0);
    setMontagePlaying(true);
    montagePlayingRef.current = true;
    setZoom(1);
    setViewStart(0);
    setSingleTime(0);
    setPlaying(false);
    setLibTab('midia');
  }, []);

  /** "Tentar de novo": se há projeto (vídeo ou clipes), volta a editar sem perder nada. */
  const retry = useCallback(() => {
    const hasProject =
      (mode === 'montage' && clips.length > 0) || (mode === 'single' && !!file);
    if (hasProject) {
      setError(null);
      setWarnings([]);
      setPhase('ready');
    } else {
      reset();
    }
  }, [mode, clips.length, file, reset]);

  const pickFile = useCallback(
    async (picked: File | null | undefined) => {
      if (!picked) return;
      if (!isVideoFile(picked)) {
        setError('Esse arquivo não parece ser um vídeo.');
        setPhase('error');
        return;
      }

      reset();
      const myId = ++pickIdRef.current;
      setMode('single');
      setMusic(null); // a trilha só vale na Montagem (erro 4)
      setFile(picked);
      setPhase('ready');
      setPreviewUrl(URL.createObjectURL(picked));

      // Lê as dimensões/duração pela prévia
      let url: string | null = null;
      try {
        url = URL.createObjectURL(picked);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = url;

        const durationOf = (v: HTMLVideoElement): Promise<number> =>
          new Promise((resolve) => {
            if (Number.isFinite(v.duration) && v.duration > 0) {
              resolve(v.duration);
              return;
            }
            // WebM/streams às vezes só revelam a duração ao buscar o fim
            const onDuration = () => {
              if (Number.isFinite(v.duration) && v.duration > 0) resolve(v.duration);
            };
            v.addEventListener('durationchange', onDuration);
            const failSafe = setTimeout(() => resolve(v.duration), 1500);
            v.currentTime = 1e6;
            v.addEventListener(
              'seeked',
              () => {
                clearTimeout(failSafe);
                resolve(Number.isFinite(v.duration) ? v.duration : 0);
              },
              { once: true },
            );
          });

        await new Promise<void>((resolve, reject) => {
          // Sem isso, um codec não suportado podia travar aqui pra sempre.
          const t = window.setTimeout(() => reject(new Error('timeout')), 8000);
          video.onloadedmetadata = () => {
            window.clearTimeout(t);
            resolve();
          };
          video.onerror = () => {
            window.clearTimeout(t);
            reject(new Error('metadata'));
          };
        });

        const duration = await durationOf(video);
        // Outro vídeo foi escolhido enquanto este lia: descarta o resultado velho.
        if (pickIdRef.current !== myId) return;
        setInfo({
          name: picked.name,
          size: picked.size,
          width: video.videoWidth,
          height: video.videoHeight,
          duration,
        });
      } catch {
        // Prévia falhou — o usuário ainda pode tentar converter
        if (pickIdRef.current === myId) {
          setInfo({ name: picked.name, size: picked.size, width: 0, height: 0, duration: 0 });
        }
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    },
    [reset],
  );

  // Adiciona clipes à montagem (leitura de dimensões/duração sem decodificar).
  const addClips = useCallback(
    async (picked: FileList | File[] | null | undefined) => {
      if (!picked) return;
      const arr = Array.from(picked).filter(isMediaFile);
      if (arr.length === 0) {
        setError('Nenhum arquivo de vídeo ou imagem foi reconhecido.');
        setPhase('error');
        return;
      }

      setMode('montage');
      setPhase('ready');
      setError(null);
      setNotice(null);

      const added: ClipInfo[] = [];
      const failed: string[] = [];
      for (const f of arr) {
        try {
          const id = `${f.name}-${f.size}-${added.length}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
          if (isImageFile(f)) {
            // Imagem: dura 3s por padrão e dá pra esticar até 30s.
            const meta = await probeImage(f);
            added.push({
              id,
              file: f,
              name: f.name,
              size: f.size,
              width: meta.width,
              height: meta.height,
              duration: IMAGE_MAX_SECONDS,
              trimStart: 0,
              trimEnd: IMAGE_DEFAULT_SECONDS,
              kind: 'image',
            });
            continue;
          }
          const meta = await probeClip(f);
          if (!meta.duration) throw new Error('sem-duração');
          added.push({
            id,
            file: f,
            name: f.name,
            size: f.size,
            width: meta.width,
            height: meta.height,
            duration: meta.duration,
            trimStart: 0,
            trimEnd: meta.duration,
            kind: 'video',
          });
        } catch {
          failed.push(f.name);
        }
      }

      if (failed.length > 0) {
        setNotice(
          failed.length === arr.length
            ? 'Não consegui ler nenhum desses arquivos como vídeo ou imagem.'
            : `Foram ignorados: ${failed.join(', ')}`,
        );
      }
      if (added.length > 0) setClips((prev) => [...prev, ...added]);
    },
    [],
  );

  /** Escolha de UM arquivo no modo Vídeo único: imagem vira uma montagem de 1 clipe. */
  const pickAny = useCallback(
    (f: File | null | undefined) => {
      if (f && isImageFile(f)) void addClips([f]);
      else void pickFile(f);
    },
    [addClips, pickFile],
  );

  const removeClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const moveClip = useCallback((id: string, dir: -1 | 1) => {
    setClips((prev) => {
      const i = prev.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  // Ajuste do trecho (trim) — mantém pelo menos 0,3s entre as pontas.
  const setClipTrim = useCallback(
    (id: string, trimStart: number, trimEnd: number) => {
      setClips((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                trimStart: Math.min(Math.max(0, trimStart), Math.max(0, c.duration - 0.3)),
                trimEnd: Math.max(
                  Math.min(c.duration, trimEnd),
                  Math.min(c.duration, 0.3),
                ),
              }
            : c,
        ),
      );
    },
    [],
  );

  /**
   * Sincroniza os CORTES da montagem com as batidas da música (Etapa 12):
   * estica/encolhe o clipe anterior pra cada corte parar na batida mais
   * próxima. Os trims voltam pra lista e a prévia se atualiza sozinha.
   */
  const snapToBeats = useCallback(() => {
    if (!musicAnalysis || clips.length < 2 || montageDuration <= 0) {
      setNotice('Adicione ao menos 2 clipes e uma música para sincronizar.');
      return;
    }
    const snapped = snapCutsToBeats(
      clips.map((c) => ({
        trimStart: c.trimStart,
        trimEnd: c.trimEnd,
        duration: c.duration,
      })),
      musicAnalysis.beats,
      musicAnalysis.duration,
      musicOffset,
      // Cada corte pode ter a sua duração: o cálculo das batidas usa a média.
      averageJunction(clips, currentTransitionDuration),
      montageDuration,
    );
    if (snapped) {
      setClips((prev) =>
        prev.map((c, i) =>
          c.kind === 'image'
            ? // Imagem: só a duração muda (nunca "começa" no meio da foto).
              { ...c, trimStart: 0, trimEnd: Math.max(0.5, snapped[i].trimEnd - snapped[i].trimStart) }
            : { ...c, trimStart: snapped[i].trimStart, trimEnd: snapped[i].trimEnd },
        ),
      );
      setNotice('⚡ Cortes encaixados nas batidas da música.');
    } else {
      setNotice('Nenhuma batida encontrada perto dos cortes.');
    }
  }, [musicAnalysis, clips, montageDuration, musicOffset, currentTransitionDuration]);

  /**
   * Capa PNG (Etapa 10): desenha o frame atual do vídeo do resultado em tamanho
   * intrínseco e baixa como imagem — serve de thumbnail/capa pro post.
   */
  const downloadCover = useCallback(async () => {
    const v = resultVideoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) =>
      c.toBlob(res, 'image/png'),
    );
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `capa-${mode === 'montage' ? 'montagem' : 'vertical'}-${Date.now()}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, [mode]);

  const convert = useCallback(async () => {
    if (!file) return;
    setPhase('working');
    setProgress(0);
    setStage('vertical');
    setError(null);
    setWarnings([]);
    setOutputs([]);
    const totalSteps = 1 + extraRatios.length;
    setSteps(totalSteps);
    setStep(1);
    setProgressLabel('');

    try {
      const { blob, warnings: w } = await toVertical(file, setProgress, texts, filter, {
        adjust,
      });
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(blob));
      setResultSize(blob.size);
      const allWarnings = [...w];
      const made: ExtraOutput[] = [];

      // Etapa 10: demais proporções. 16:9 costuma ser só troca de envelope;
      // 1:1 e 4:5 são RENDERIZADOS com o mesmo pipeline (fundo borrado+legenda).
      for (let i = 0; i < extraRatios.length; i++) {
        const rInfo = ratioInfo(extraRatios[i]);
        setStage('output');
        setStep(i + 2);
        setProgress(0);
        setProgressLabel(
          `Etapa ${i + 2} de ${totalSteps} — Gerando ${rInfo.label} (${rInfo.hint})…`,
        );
        try {
          const out =
            rInfo.single === 'transmux'
              ? await toHorizontal(file, setProgress)
              : await toVertical(file, setProgress, texts, filter, {
                  layout: rInfo.layout,
                  adjust,
                });
          allWarnings.push(...out.warnings);
          made.push({
            ratio: rInfo.id,
            url: URL.createObjectURL(out.blob),
            size: out.blob.size,
          });
        } catch (e) {
          allWarnings.push(
            `A saída ${rInfo.label} não foi gerada (${
              e instanceof Error && e.message ? e.message : 'erro desconhecido'
            }) — as demais estão prontas.`,
          );
        }
      }

      setOutputs(made);
      setWarnings([...new Set(allWarnings)]);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido ao processar o vídeo.');
      setPhase('error');
    }
  }, [file, resultUrl, texts, filter, adjust, extraRatios]);

  // Etapa 6: monta todos os clipes num único MP4 9:16.
  // Etapa 10: cada proporção extra vira mais UMA passada de render.
  const generateMontage = useCallback(async () => {
    if (clips.length === 0) return;
    setPhase('working');
    setStage('montage');
    setProgress(0);
    const totalSteps = 1 + extraRatios.length;
    setSteps(totalSteps);
    setStep(1);
    setProgressLabel(
      totalSteps > 1
        ? `Etapa 1 de ${totalSteps} — Preparando os clipes…`
        : 'Preparando os clipes…',
    );
    setError(null);
    setWarnings([]);
    setOutputs([]);

    const base = {
      clips: toMontageClips(clips),
      transition: currentTransition,
      transitionDuration: currentTransitionDuration,
      filter: currentFilter,
      texts,
      adjust,
      music,
      musicVolume,
      musicOffset,
    };
    const prefix = totalSteps > 1 ? `Etapa 1 de ${totalSteps} — ` : '';

    try {
      const { blob, warnings: w, duration } = await assembleMontage({
        ...base,
        onProgress: (p, label) => {
          setProgress(p);
          setProgressLabel(prefix + label);
        },
      });
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(blob));
      setResultSize(blob.size);
      setResultDuration(duration);
      const allWarnings = [...w];
      const made: ExtraOutput[] = [];

      for (let i = 0; i < extraRatios.length; i++) {
        const rInfo = ratioInfo(extraRatios[i]);
        setStage('output');
        setStep(i + 2);
        setProgress(0);
        setProgressLabel(
          `Etapa ${i + 2} de ${totalSteps} — Gerando ${rInfo.label} (${rInfo.hint})…`,
        );
        try {
          const extra = await assembleMontage({
            ...base,
            ratio: rInfo.id,
            onProgress: (p, label) => {
              setProgress(p);
              setProgressLabel(`Etapa ${i + 2} de ${totalSteps} — ${label}`);
            },
          });
          allWarnings.push(...extra.warnings);
          made.push({
            ratio: rInfo.id,
            url: URL.createObjectURL(extra.blob),
            size: extra.blob.size,
          });
        } catch (e) {
          // A principal 9:16 continua boa: só avisa que esta saída não saiu.
          allWarnings.push(
            `A saída ${rInfo.label} falhou (${
              e instanceof Error && e.message ? e.message : 'erro desconhecido'
            }) — a montagem 9:16 está disponível.`,
          );
        }
      }

      setOutputs(made);
      setWarnings([...new Set(allWarnings)]);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido ao montar os clipes.');
      setPhase('error');
    }
  }, [
    clips,
    currentTransition,
    currentTransitionDuration,
    model,
    currentFilter,
    texts,
    adjust,
    music,
    musicVolume,
    musicOffset,
    resultUrl,
    extraRatios,
  ]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (mode === 'montage') void addClips(e.dataTransfer.files);
      else pickAny(e.dataTransfer.files?.[0]);
    },
    [addClips, mode, pickAny],
  );

  /**
   * Clica/arrasta em QUALQUER trilha → navega no tempo da JANELA visível.
   *
   * O retângulo de referência é o da trilha régua+vídeo (`tlStackRef`), não o
   * elemento que recebeu o evento: assim o clique vale igual na régua, nos
   * clipes, nos textos e nas margens do contêiner.
   */
  const seekFromEvent = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (videoTotal <= 0 || viewSpan <= 0) return;
      const rect = tlStackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      // Sempre num quadro inteiro (como nos editores de vídeo).
      const t = stepTime(viewStartClamped + p * viewSpan, 0, videoTotal);
      if (mode === 'montage') seekMontage(t);
      else seekSingle(t);
    },
    [mode, seekMontage, seekSingle, viewStartClamped, viewSpan, videoTotal],
  );

  /** Toca a partir do ponto onde o cursor está (clique limpo na timeline). */
  const playFromCursor = useCallback(() => {
    if (phase !== 'ready' || videoTotal <= 0) return;
    if (mode === 'montage') {
      if (!montagePreviewRef.current || montagePlayingRef.current) return;
      toggleMontagePlay();
    } else {
      const v = previewRef.current;
      if (!v || !v.paused) return;
      void v.play().then(() => setPlaying(true)).catch(() => undefined);
    }
  }, [mode, phase, toggleMontagePlay, videoTotal]);

  /**
   * Fim do gesto na timeline: se o ponteiro mal se moveu era um CLIQUE →
   * o vídeo passa a tocar a partir dali; se moveu, era arrasto (scrub) e a
   * gente só solta o cursor onde ele parou.
   */
  const endScrub = useCallback(() => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    const moved = scrubMovedRef.current;
    scrubOriginRef.current = null;
    if (moved < 6) playFromCursor();
  }, [playFromCursor]);

  /**
   * Arrasta a forma de onda = move a MÚSICA sob a linha do tempo (Etapa 13).
   * Na escala da janela: 1px = viewSpan/largura segundos, e arrastar pra
   * direita leva o conteúdo junto (offset diminui).
   */
  const startMusicDrag = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!musicAnalysis) return;
      musicDragStartRef.current = { x: e.clientX, offset: musicOffset };
      // Ponteiro sintético/não-ativo pode lançar — o arrasto funciona mesmo.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignora */
      }
    },
    [musicAnalysis, musicOffset],
  );

  const moveMusicDrag = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const start = musicDragStartRef.current;
      if (!start || !musicAnalysis) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const span = Math.max(0.1, viewSpan || musicAnalysis.duration);
      const dxSec = ((e.clientX - start.x) / Math.max(1, rect.width)) * span;
      const dur = musicAnalysis.duration;
      setMusicOffset(
        Math.min(Math.max(0, start.offset - dxSec), Math.max(0, dur - 0.5)),
      );
    },
    [musicAnalysis, viewSpan],
  );

  /** Zoom da linha no centro (ou num tempo âncora, tipo o cursor do mouse). */
  const zoomBy = useCallback(
    (factor: number, anchorTime?: number) => {
      if (videoTotal <= 0) return;
      const zMin = 1;
      const zMax = Math.max(1, videoTotal / 0.5); // no mínimo 0,5s visíveis
      const next = Math.min(zMax, Math.max(zMin, zoom * factor));
      const span = videoTotal / zoom;
      const anchor = anchorTime ?? viewStartClamped + span / 2;
      const rel = span > 0 ? (anchor - viewStartClamped) / span : 0.5;
      const nextSpan = videoTotal / next;
      if (next !== zoom) setZoom(next);
      setViewStart(Math.max(0, anchor - rel * nextSpan));
    },
    [videoTotal, zoom, viewStartClamped],
  );

  /** Move a janela da linha (fração da janela visível): pan sem roda do mouse, pra tablet. */
  const panBy = useCallback(
    (fraction: number) => {
      if (videoTotal <= 0) return;
      const span = videoTotal / zoom;
      setViewStart(
        Math.min(
          Math.max(0, videoTotal - span),
          Math.max(0, viewStartClamped + fraction * span),
        ),
      );
    },
    [videoTotal, zoom, viewStartClamped],
  );

  /** Volta pra linha inteira. */
  const fitView = useCallback(() => {
    setZoom(1);
    setViewStart(0);
  }, []);

  // ------------------------------------------------ quadro a quadro + texto
  const canEditTimeline = phase === 'ready' && videoTotal > 0;
  const sel = texts.find((t) => t.id === selectedTextId) ?? null;

  /** Pausa a prévia e devolve o tempo EXATO em que ela parou. */
  const pauseAndGetTime = useCallback((): number => {
    if (mode === 'montage') {
      const api = montagePreviewRef.current;
      if (!api) return 0;
      api.setPaused(true);
      montagePlayingRef.current = false;
      setMontagePlaying(false);
      return api.time;
    }
    const v = previewRef.current;
    if (!v) return 0;
    v.pause();
    setPlaying(false);
    return v.currentTime;
  }, [mode]);

  /** Anda `n` quadros (negativo = volta). Pausa a prévia pra você ver o quadro parado. */
  const stepFrames = useCallback(
    (n: number) => {
      if (videoTotal <= 0) return;
      const next = stepTime(pauseAndGetTime(), n, videoTotal);
      if (mode === 'montage') seekMontage(next);
      else seekSingle(next);
      // Com zoom, a janela acompanha o cursor (o auto-follow só vale tocando).
      if (zoom > 1 && viewSpan > 0) {
        const margin = viewSpan * 0.12;
        if (next < viewStartClamped + margin || next > viewStartClamped + viewSpan - margin) {
          const target =
            next < viewStartClamped + margin ? next - margin : next - viewSpan + margin;
          setViewStart(Math.min(Math.max(0, target), Math.max(0, videoTotal - viewSpan)));
        }
      }
    },
    [mode, pauseAndGetTime, seekMontage, seekSingle, videoTotal, zoom, viewSpan, viewStartClamped],
  );

  /** Estilo de um texto NOVO: padrão + o jeito do modelo (na montagem). */
  const newTextStyle = useCallback(
    (): CaptionOptions => ({
      ...DEFAULT_CAPTION,
      ...(mode === 'montage' ? model.caption : {}),
      title: 'Seu texto',
    }),
    [mode, model],
  );

  /** Cria um bloco de texto no ponto onde está o cursor. */
  const addText = useCallback(() => {
    if (videoTotal <= 0) return;
    const at =
      mode === 'montage'
        ? (montagePreviewRef.current?.time ?? montageTime)
        : (previewRef.current?.currentTime ?? singleTime);
    const clip = newTextClip(at, videoTotal, newTextStyle());
    // Já tem texto no ar nesse trecho? O novo nasce mais acima pra não cobrir o outro.
    const overlaps = texts.filter((t) => t.start < clip.end && t.end > clip.start).length;
    if (overlaps > 0) {
      clip.style = { ...clip.style, y: Math.max(0.1, clip.style.y - 0.1 * overlaps) };
    }
    setTexts((list) => [...list, clip]);
    setSelectedTextId(clip.id);
    setInspTab('texto');
  }, [mode, montageTime, singleTime, videoTotal, newTextStyle, texts]);

  /** Muda o estilo do texto selecionado (patch funcional: nada se perde). */
  const patchSelected = useCallback(
    (patch: Partial<CaptionOptions>) => {
      if (!selectedTextId) return;
      setTexts((list) =>
        list.map((t) =>
          t.id === selectedTextId ? { ...t, style: { ...t.style, ...patch } } : t,
        ),
      );
    },
    [selectedTextId],
  );

  /** Muda início/fim do texto selecionado (alinha a quadros e respeita a timeline). */
  const commitRange = useCallback(
    (range: { start?: number; end?: number }) => {
      if (!selectedTextId) return;
      if (range.start === undefined && range.end === undefined) return;
      setTexts((list) =>
        list.map((t) => (t.id === selectedTextId ? withRange(t, range, videoTotal) : t)),
      );
    },
    [selectedTextId, videoTotal],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedTextId) return;
    setTexts((list) => list.filter((t) => t.id !== selectedTextId));
    setSelectedTextId(null);
  }, [selectedTextId]);

  const duplicateSelected = useCallback(() => {
    const cur = texts.find((t) => t.id === selectedTextId);
    if (!cur) return;
    const copy = duplicateText(cur, videoTotal);
    setTexts((list) => [...list, copy]);
    setSelectedTextId(copy.id);
  }, [texts, selectedTextId, videoTotal]);

  // Arrastar um bloco na trilha: corpo = mover, pontas = início/fim.
  const beginTextDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, clip: TextClip, kind: 'move' | 'start' | 'end') => {
      e.stopPropagation(); // senão a trilha acharia que é "navegar no tempo"
      setSelectedTextId(clip.id);
      setInspTab('texto');
      const track = e.currentTarget.closest('.tl-track--text');
      const width = Math.max(1, track?.getBoundingClientRect().width ?? 1);
      textDragRef.current = { id: clip.id, kind, x0: e.clientX, secPerPx: viewSpan / width, orig: clip };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ponteiro sintético: segue sem captura */
      }
    },
    [viewSpan],
  );

  const moveTextDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = textDragRef.current;
      if (!d) return;
      const dt = (e.clientX - d.x0) * d.secPerPx;
      setTexts((list) =>
        list.map((t) => {
          if (t.id !== d.id) return t;
          if (d.kind === 'move') return moveText(d.orig, dt, videoTotal);
          if (d.kind === 'start') return withRange(d.orig, { start: d.orig.start + dt }, videoTotal);
          return withRange(d.orig, { end: d.orig.end + dt }, videoTotal);
        }),
      );
    },
    [videoTotal],
  );

  const endTextDrag = useCallback(() => {
    textDragRef.current = null;
  }, []);

  // Arrastar na PRÉVIA move o texto selecionado (relativo ao ponto onde você
  // pegou — o texto não "pula" pro dedo). Só vale com o cursor dentro do bloco.
  const selActive = !!sel && isTextActive(sel, videoCurrent);

  const beginCanvasDrag = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!sel || !isTextActive(sel, videoCurrent)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      canvasDragRef.current = {
        id: sel.id,
        x0: e.clientX,
        y0: e.clientY,
        ox: sel.style.x,
        oy: sel.style.y,
        w: rect.width,
        h: rect.height,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ponteiro sintético: segue sem captura */
      }
    },
    [sel, videoCurrent],
  );

  const moveCanvasDrag = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = canvasDragRef.current;
    if (!d) return;
    // "Ímã" no centro: perto de 50% ele encaixa (fácil centralizar).
    const snap = (v: number) => (Math.abs(v - 0.5) < 0.012 ? 0.5 : v);
    const x = snap(Math.min(1, Math.max(0, d.ox + (e.clientX - d.x0) / d.w)));
    const y = snap(Math.min(1, Math.max(0, d.oy + (e.clientY - d.y0) / d.h)));
    setTexts((list) =>
      list.map((t) => (t.id === d.id ? { ...t, style: { ...t.style, x, y } } : t)),
    );
  }, []);

  const endCanvasDrag = useCallback(() => {
    canvasDragRef.current = null;
  }, []);

  const canvasDragProps = {
    onPointerDown: beginCanvasDrag,
    onPointerMove: moveCanvasDrag,
    onPointerUp: endCanvasDrag,
    onPointerCancel: endCanvasDrag,
    style: selActive ? { touchAction: 'none' as const, cursor: 'move' } : undefined,
  };

  // -------------------------------------------- dividir / cortar / excluir clipes
  const newClipId = useCallback(
    () => `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    [],
  );

  // Selecionar um texto limpa a seleção do clipe e vice-versa (o Delete age no último escolhido).
  useEffect(() => {
    if (selectedTextId) setSelectedClipId(null);
  }, [selectedTextId]);
  useEffect(() => {
    if (selectedClipId) setSelectedTextId(null);
  }, [selectedClipId]);

  /** O vídeo único como UM clipe da montagem (é assim que dá pra dividir/cortar). */
  const singleAsClip = useCallback((): ClipInfo | null => {
    if (!file || !info || info.duration <= 0) return null;
    return {
      id: newClipId(),
      file,
      name: info.name,
      size: info.size,
      width: info.width,
      height: info.height,
      duration: info.duration,
      trimStart: 0,
      trimEnd: info.duration,
      kind: 'video',
    };
  }, [file, info, newClipId]);

  /** O vídeo único vira uma montagem (filtro, ajustes e textos continuam) com o cursor onde estava. */
  const turnIntoMontage = useCallback(
    (list: ClipInfo[], at: number, select: string | null) => {
      previewRef.current?.pause();
      setPlaying(false);
      setCustomFilter(filter);
      setMode('montage');
      setFile(null);
      setInfo(null);
      setPreviewUrl(null);
      setClips(list);
      setSelectedClipId(select);
      pendingSeekRef.current = at;
      setNotice('Este vídeo virou uma montagem de clipes, para você poder editar os trechos.');
    },
    [filter],
  );

  /** Qual clipe está sob o cursor da montagem, e o tempo do ARQUIVO nesse ponto. */
  const clipUnderCursor = useCallback((): {
    index: number;
    clip: ClipInfo;
    ft: number;
    t: number;
  } | null => {
    if (!montageTimeline) return null;
    const t = montagePreviewRef.current?.time ?? montageTime;
    const index = locateClip(montageTimeline, t);
    const clip = clips[index];
    if (index < 0 || !clip) return null;
    return { index, clip, t, ft: fileTimeAt(clip, montageTimeline.clips[index].start, t) };
  }, [montageTimeline, montageTime, clips]);

  const NEAR_EDGE = 'Leve o cursor para dentro do clipe (a pelo menos 0,3s das pontas).';

  /** Divide o clipe sob o cursor em dois (o mesmo vídeo, emendado, com corte seco). */
  const splitAtPlayhead = useCallback(() => {
    if (mode === 'single') {
      const base = singleAsClip();
      if (!base) return;
      const t = previewRef.current?.currentTime ?? singleTime;
      const parts = splitClip(base, t, newClipId);
      if (!parts) {
        setNotice(NEAR_EDGE);
        return;
      }
      turnIntoMontage(parts, t, parts[1].id);
      return;
    }
    const at = clipUnderCursor();
    if (!at) return;
    const parts = splitClip(at.clip, at.ft, newClipId);
    if (!parts) {
      setNotice(NEAR_EDGE);
      return;
    }
    pendingSeekRef.current = at.t;
    setClips((prev) => replaceClip(prev, at.clip.id, parts));
    setSelectedClipId(parts[1].id);
  }, [mode, singleAsClip, singleTime, newClipId, turnIntoMontage, clipUnderCursor]);

  /** Corta o começo (tudo antes do cursor) ou o fim (tudo depois dele) do clipe sob o cursor. */
  const applyCut = useCallback(
    (which: 'start' | 'end') => {
      if (mode === 'single') {
        const base = singleAsClip();
        if (!base) return;
        const t = previewRef.current?.currentTime ?? singleTime;
        const cut = which === 'start' ? cutStart(base, t) : cutEnd(base, t);
        if (!cut) {
          setNotice(NEAR_EDGE);
          return;
        }
        turnIntoMontage([cut], which === 'start' ? 0 : t, cut.id);
        return;
      }
      const at = clipUnderCursor();
      if (!at || !montageTimeline) return;
      const cut = which === 'start' ? cutStart(at.clip, at.ft) : cutEnd(at.clip, at.ft);
      if (!cut) {
        setNotice(NEAR_EDGE);
        return;
      }
      // Cortou o começo: o cursor vai pro novo começo do clipe (o resto "puxa" pra cá).
      pendingSeekRef.current = which === 'start' ? montageTimeline.clips[at.index].start : at.t;
      setClips((prev) => prev.map((c) => (c.id === at.clip.id ? cut : c)));
      setSelectedClipId(cut.id);
    },
    [mode, singleAsClip, singleTime, turnIntoMontage, clipUnderCursor, montageTimeline],
  );

  /** Exclui o clipe selecionado (ou, sem seleção, o que está sob o cursor). */
  const deleteClip = useCallback(() => {
    if (mode !== 'montage') return;
    const id =
      selectedClipId && clips.some((c) => c.id === selectedClipId)
        ? selectedClipId
        : clipUnderCursor()?.clip.id;
    if (!id) return;
    const idx = clips.findIndex((c) => c.id === id);
    // O clipe seguinte "sobe" pro lugar dele: o cursor fica ali.
    pendingSeekRef.current = montageTimeline?.clips[idx]?.start ?? 0;
    setClips((prev) => removeClipById(prev, id));
    setSelectedClipId(null);
    setSelectedJunctionId((j) => (j === id ? null : j));
  }, [mode, selectedClipId, clips, clipUnderCursor, montageTimeline]);

  // ---------------------------------------------- transição de CADA corte
  const jIndex = selectedJunctionId ? clips.findIndex((c) => c.id === selectedJunctionId) : -1;
  /** O clipe cujo corte (com o PRÓXIMO) está selecionado — `null` = editando o padrão de todos. */
  const jClip = jIndex >= 0 && jIndex < clips.length - 1 ? clips[jIndex] : null;
  const jDuration = jClip
    ? (jClip.transitionDuration ?? currentTransitionDuration)
    : currentTransitionDuration;
  const jCut = !!jClip && jDuration <= 0;
  const hasJunctionOverrides = clips.some(
    (c) => c.transition !== undefined || c.transitionDuration !== undefined,
  );

  const patchClip = useCallback((id: string, patch: Partial<ClipInfo>) => {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  /** Escolhe a transição deste corte (se ele estava em corte seco, volta a ter transição). */
  const setJunction = useCallback((id: string, transition: TransitionId) => {
    setClips((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              transition,
              transitionDuration: c.transitionDuration === 0 ? undefined : c.transitionDuration,
            }
          : c,
      ),
    );
  }, []);
  const setJunctionCut = useCallback(
    (id: string) => patchClip(id, { transition: undefined, transitionDuration: 0 }),
    [patchClip],
  );
  const clearJunction = useCallback(
    (id: string) => patchClip(id, { transition: undefined, transitionDuration: undefined }),
    [patchClip],
  );
  const setJunctionDuration = useCallback(
    (id: string, d: number) => patchClip(id, { transitionDuration: d }),
    [patchClip],
  );
  /** Copia a transição deste corte pra todos os outros. */
  const applyJunctionToAll = useCallback((id: string) => {
    setClips((prev) => {
      const src = prev.find((c) => c.id === id);
      if (!src) return prev;
      return prev.map((c) => ({
        ...c,
        transition: src.transition,
        transitionDuration: src.transitionDuration,
      }));
    });
  }, []);
  const clearAllJunctions = useCallback(() => {
    setClips((prev) =>
      prev.map((c) => ({ ...c, transition: undefined, transitionDuration: undefined })),
    );
  }, []);

  /** Seleciona o corte e abre a aba onde se escolhe a transição dele. */
  const selectJunction = useCallback((id: string) => {
    setSelectedJunctionId(id);
    setLibTab('modelos');
    setLayout((l) => (l.hideLib ? { ...l, hideLib: false } : l));
  }, []);

  // Atalhos (como nos editores): ← → = 1 quadro (Shift = 10), Espaço = tocar/pausar,
  // Delete = apaga o texto selecionado. Não atrapalha quem está digitando.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) {
        return;
      }
      if (phase !== 'ready' || videoTotal <= 0) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        stepFrames((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      } else if (e.code === 'Space' && tag !== 'BUTTON') {
        e.preventDefault();
        if (mode === 'montage') toggleMontagePlay();
        else togglePlay();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTextId) {
        e.preventDefault();
        setTexts((list) => list.filter((t) => t.id !== selectedTextId));
        setSelectedTextId(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'montage' && selectedClipId) {
        e.preventDefault();
        deleteClip();
      } else if ((e.key === 's' || e.key === 'S') && !e.shiftKey && mode === 'montage') {
        e.preventDefault();
        splitAtPlayhead();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    phase,
    mode,
    videoTotal,
    selectedTextId,
    selectedClipId,
    stepFrames,
    toggleMontagePlay,
    togglePlay,
    deleteClip,
    splitAtPlayhead,
  ]);

  // ------------------------------------------------ layout dos painéis
  // Salva o layout (tamanhos + o que está escondido) pra voltar do jeito que ficou.
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, serializeLayout(layout));
    } catch {
      /* sem armazenamento disponível: segue sem salvar */
    }
  }, [layout]);

  // A onda da música e outras peças medem o próprio tamanho no evento "resize":
  // depois de mexer nos painéis, avisa pra todas se redesenharem.
  useEffect(() => {
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(id);
  }, [layout]);

  /** Tamanhos atuais dos painéis VISÍVEIS (medidos na tela) — pra limitar o arrasto. */
  const measureSpace = useCallback((): Space | null => {
    const root = editorRef.current;
    if (!root) return null;
    const w = (q: string) => root.querySelector<HTMLElement>(q)?.offsetWidth ?? 0;
    const h = (q: string) => root.querySelector<HTMLElement>(q)?.offsetHeight ?? 0;
    return {
      width: root.clientWidth,
      height: root.clientHeight,
      headerH: h('.topbar'),
      lib: w('.library-panel'),
      insp: w('.inspector-panel'),
      tl: h('.timeline-panel'),
    };
  }, []);

  const beginResize = useCallback(
    (id: PanelId) => (e: React.PointerEvent<HTMLDivElement>) => {
      const space = measureSpace();
      if (!space) return;
      e.preventDefault();
      const start = id === 'lib' ? space.lib : id === 'insp' ? space.insp : space.tl;
      resizeRef.current = { id, x0: e.clientX, y0: e.clientY, start };
      setResizing(id);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ponteiro sintético: segue sem captura */
      }
    },
    [measureSpace],
  );

  const moveResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = resizeRef.current;
      if (!r) return;
      const space = measureSpace();
      if (!space) return;
      // Biblioteca cresce puxando pra direita; inspetor e timeline, puxando pra esquerda / pra cima.
      const raw =
        r.id === 'lib'
          ? r.start + (e.clientX - r.x0)
          : r.id === 'insp'
            ? r.start - (e.clientX - r.x0)
            : r.start - (e.clientY - r.y0);
      setLayout((l) => resizePanel(l, r.id, clampPanel(r.id, raw, space)));
    },
    [measureSpace],
  );

  const endResize = useCallback(() => {
    resizeRef.current = null;
    setResizing(null);
  }, []);

  /** Teclado no divisor: setas mexem 16px (Shift = 48px). */
  const keyResize = useCallback(
    (id: PanelId) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      const grow = id === 'lib' ? 'ArrowRight' : id === 'insp' ? 'ArrowLeft' : 'ArrowUp';
      const shrink = id === 'lib' ? 'ArrowLeft' : id === 'insp' ? 'ArrowRight' : 'ArrowDown';
      if (e.key !== grow && e.key !== shrink) return;
      const space = measureSpace();
      if (!space) return;
      e.preventDefault();
      const step = e.shiftKey ? 48 : 16;
      const cur = id === 'lib' ? space.lib : id === 'insp' ? space.insp : space.tl;
      setLayout((l) =>
        resizePanel(l, id, clampPanel(id, cur + (e.key === grow ? step : -step), space)),
      );
    },
    [measureSpace],
  );

  const working = phase === 'working';
  const montageReady = phase === 'ready' && mode === 'montage';
  const singleReady = phase === 'ready' && mode === 'single' && !!file;
  // Splash fechada mas ainda sem vídeo: era o "estado vazio" que antes vivia no
  // `idle`. Sem isso o "Novo Projeto" caía numa tela em branco, sem dropzone.
  const emptyState = phase === 'ready' && !file && clips.length === 0;

  // Zoom/pan da linha pelo scroll (Etapa 13): Ctrl+role = zoom NO CURSOR,
  // role = pan. `passive:false` porque o preventDefault trava o scroll da
  // página enquanto o ponteiro está sobre a linha do tempo.
  useEffect(() => {
    const el = tlTracksRef.current;
    if (!el || videoTotal <= 0) return;
    const onWheel = (e: WheelEvent) => {
      // Sem zoom e sem Ctrl não há o que mover: deixa a página rolar.
      if (!(e.ctrlKey || e.metaKey) && zoom <= 1) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const span = videoTotal / zoom;
      if (e.ctrlKey || e.metaKey) {
        const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / width));
        zoomBy(e.deltaY > 0 ? 1 / 1.2 : 1.2, viewStartClamped + p * span);
      } else {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const secPerPx = span / width;
        setViewStart((vs) =>
          Math.min(Math.max(0, videoTotal - span), Math.max(0, vs + d * secPerPx)),
        );
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [videoTotal, zoom, viewStartClamped, zoomBy]);

  const exportDisabled =
    working ||
    phase === 'idle' ||
    phase === 'error' ||
    (mode === 'single' && !file) ||
    (mode === 'montage' && clips.length === 0);

  // Quantos ARQUIVOS saem: o 9:16 + as proporções extras marcadas. (Antes o botão
  // dizia "Exportar (3 clipes)", parecendo que sairiam 3 arquivos — a montagem junta tudo em 1.)
  const fileCount = 1 + extraRatios.length;
  const exportLabel = working
    ? 'Processando…'
    : `${mode === 'montage' ? 'Exportar montagem' : 'Exportar vídeo'}${
        fileCount > 1 ? ` · ${fileCount} arquivos` : ''
      }`;

  const doExport = () => {
    if (mode === 'single') void convert();
    else void generateMontage();
  };

  /** Atalho da tela inicial: abre o editor já na aba certa. */
  const openTool = (id: HomeToolId) => {
    const needsVideo = id === 'legendas' || id === 'ajustes';
    setMode('single');
    setPhase('ready');
    setLibTab(id === 'musica' ? 'audio' : id === 'filtros' ? 'modelos' : 'midia');
    if (needsVideo) setInspTab(id === 'legendas' ? 'texto' : 'ajustes');
    if (file) setNotice(null);
    else if (needsVideo)
      setNotice('Escolha um vídeo primeiro — depois é só trocar de aba aí em cima.');
    else setNotice('Ainda não tem vídeo: abra a aba Mídia e escolha um arquivo.');
  };

  // Tela inicial (estilo CapCut): enquanto não existe projeto não montamos o
  // editor. `reset()` volta pra cá, então "Voltar" e "Novo vídeo" também caem aqui.
  if (phase === 'idle') {
    return (
      <HomeScreen
        onNewProject={() => {
          setMode('single');
          setPhase('ready');
          setLibTab('midia');
          setInspTab('ajustes');
          setNotice(null);
        }}
        onNewMontage={() => {
          setMode('montage');
          setPhase('ready');
          setLibTab('midia');
          setInspTab('ajustes');
          setNotice(null);
        }}
        onTool={openTool}
      />
    );
  }

  return (
    <div
      ref={editorRef}
      className={`editor-container${layout.hideLib ? ' hide-lib' : ''}${
        layout.hideInsp ? ' hide-insp' : ''
      }${layout.hideTl ? ' hide-tl' : ''}${
        resizing ? (resizing === 'tl' ? ' is-resizing-y' : ' is-resizing-x') : ''
      }`}
      style={layoutVars(layout) as unknown as React.CSSProperties}
    >
      {/* ============================ 1. TOPBAR ============================ */}
      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src="./icon.svg" alt="" width={26} height={26} />
          <span className="brand-name">Estúdio</span>
          <button className="btn btn--back" onClick={reset} disabled={working}>
            ← Voltar
          </button>
        </div>
        <div className="top-actions">
          {/* O MESMO botão esconde e mostra cada painel (o tamanho escolhido é mantido). */}
          <div className="layout-toggles" role="group" aria-label="Mostrar ou esconder painéis">
            {(
              [
                ['lib', 'left', 'Biblioteca'],
                ['tl', 'bottom', 'Linha do tempo'],
                ['insp', 'right', 'Inspetor'],
              ] as const
            ).map(([id, side, label]) => {
              const hidden = isHidden(layout, id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`btn btn--tiny btn--toggle${hidden ? '' : ' btn--on'}`}
                  aria-pressed={!hidden}
                  title={`${hidden ? 'Mostrar' : 'Esconder'}: ${label}`}
                  onClick={() => setLayout((l) => togglePanel(l, id))}
                >
                  <PanelIcon side={side} filled={!hidden} />
                  <span className="lt-label">{label}</span>
                </button>
              );
            })}
          </div>
          <button className="btn-export" onClick={doExport} disabled={exportDisabled}>
            {exportLabel}
          </button>
        </div>
      </header>

      {/* ============================ 2. LIBRARY =========================== */}
      <aside className="library-panel">
        <>
            <div className="library-tabs" role="tablist">
              {(
                [
                  ['midia', 'Mídia'],
                  ['modelos', mode === 'montage' ? 'Modelos' : 'Filtros'],
                  ['audio', 'Áudio'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={libTab === id}
                  className={`lib-tab${libTab === id ? ' active' : ''}`}
                  onClick={() => setLibTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="library-content">
              {notice && (
                <div className="notice-pill" onClick={() => setNotice(null)} title="Clique para fechar">
                  {notice}
                </div>
              )}

              {/* ---------------- ABA MÍDIA ---------------- */}
              {libTab === 'midia' && (
                <>
                  {(emptyState || phase === 'error') && (
                    <div className="mode-row" role="radiogroup" aria-label="Modo de trabalho">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={mode === 'single'}
                        className={`mode-chip${mode === 'single' ? ' mode-chip--on' : ''}`}
                        onClick={() => {
                          if (file || clips.length > 0) reset();
                          else setPhase('ready');
                          setMode('single');
                        }}
                      >
                        Vídeo único
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={mode === 'montage'}
                        className={`mode-chip${mode === 'montage' ? ' mode-chip--on' : ''}`}
                        onClick={() => {
                          if (file || clips.length > 0) reset();
                          else setPhase('ready');
                          setMode('montage');
                        }}
                      >
                        Montagem
                      </button>
                    </div>
                  )}

              {(emptyState || phase === 'error') && (
                <section
                  className={`dropzone ${isDragging ? 'dropzone--active' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => inputRef.current?.click()}
                >
                  <div className="dropzone-icon">🎬</div>
                  <h3>
                    {mode === 'montage'
                      ? 'Escolha os vídeos e imagens da montagem'
                      : 'Escolha um vídeo'}
                  </h3>
                  <p className="dropzone-hint">
                    {mode === 'montage'
                      ? 'Um ou mais arquivos — a ordem da lista é a ordem da montagem'
                      : 'Arraste aqui ou toque para selecionar (uma imagem vira montagem)'}
                  </p>
                  <p className="dropzone-hint">MP4 · MOV · WebM · JPG · PNG</p>
                </section>
              )}

              {/* Vídeo único carregado: metadados */}
              {singleReady && info && (
                <div className="meta-card">
                  <div className="meta-title" title={info.name}>
                    {info.name}
                  </div>
                  <div className="meta-grid">
                    <span>Resolução</span>
                    <strong>{info.width ? `${info.width}×${info.height}` : '—'}</strong>
                    <span>Duração</span>
                    <strong>{formatDuration(info.duration)}</strong>
                    <span>Tamanho</span>
                    <strong>{formatBytes(info.size)}</strong>
                  </div>
                  <button className="btn btn--ghost btn--block" onClick={() => inputRef.current?.click()}>
                    Trocar vídeo
                  </button>
                </div>
              )}

              {/* Montagem: lista de clipes */}
              {montageReady && (
                <>
                  {clips.length === 0 ? (
                    <p className="muted">
                      Adicione ao menos um vídeo — a ordem da lista é a ordem da
                      montagem.
                    </p>
                  ) : (
                    <ol className="clip-list">
                      {clips.map((c, i) => (
                        <li
                          key={c.id}
                          className={`clip-item${selectedClipId === c.id ? ' clip-item--on' : ''}`}
                          onClick={() => setSelectedClipId(c.id)}
                        >
                          <span className="clip-index">{i + 1}</span>
                          <div className="clip-info">
                            <span className="clip-name" title={c.name}>
                              {c.kind === 'image' ? '🖼 ' : ''}
                              {c.name}
                            </span>
                            <span className="clip-meta">
                              {c.width ? `${c.width}×${c.height} · ` : ''}
                              {formatDuration(c.trimEnd - c.trimStart)}
                              {c.kind !== 'image' &&
                              (c.trimStart > 0.05 || c.trimEnd < c.duration - 0.05)
                                ? ` (de ${formatDuration(c.duration)})`
                                : ''}
                            </span>

                            {trimmingId === c.id && c.kind === 'image' && (
                              <div className="clip-trim">
                                <label className="clip-trim-row">
                                  <span>
                                    Duração da imagem{' '}
                                    <strong>{formatTrim(c.trimEnd - c.trimStart)}</strong>
                                  </span>
                                  <input
                                    type="range"
                                    min={0.5}
                                    max={IMAGE_MAX_SECONDS}
                                    step={0.1}
                                    value={c.trimEnd - c.trimStart}
                                    aria-label="Duração da imagem"
                                    onChange={(e) => setClipTrim(c.id, 0, Number(e.target.value))}
                                  />
                                </label>
                                <div className="clip-trim-actions">
                                  <button
                                    className="btn btn--tiny"
                                    onClick={() => setTrimmingId(null)}
                                  >
                                    Ok
                                  </button>
                                </div>
                              </div>
                            )}
                            {trimmingId === c.id && c.kind !== 'image' && (
                              <div className="clip-trim">
                                <label className="clip-trim-row">
                                  <span>
                                    Início <strong>{formatTrim(c.trimStart)}</strong>
                                  </span>
                                  <input
                                    type="range"
                                    min={0}
                                    max={c.duration}
                                    step={0.1}
                                    value={c.trimStart}
                                    aria-label="Início do trecho"
                                    onChange={(e) =>
                                      setClipTrim(
                                        c.id,
                                        Math.min(Number(e.target.value), c.trimEnd - 0.3),
                                        c.trimEnd,
                                      )
                                    }
                                  />
                                </label>
                                <label className="clip-trim-row">
                                  <span>
                                    Fim <strong>{formatTrim(c.trimEnd)}</strong> · usa{' '}
                                    <strong>{formatTrim(c.trimEnd - c.trimStart)}</strong>
                                  </span>
                                  <input
                                    type="range"
                                    min={0}
                                    max={c.duration}
                                    step={0.1}
                                    value={c.trimEnd}
                                    aria-label="Fim do trecho"
                                    onChange={(e) =>
                                      setClipTrim(
                                        c.id,
                                        c.trimStart,
                                        Math.max(Number(e.target.value), c.trimStart + 0.3),
                                      )
                                    }
                                  />
                                </label>
                                <div className="clip-trim-actions">
                                  <button
                                    className="btn btn--tiny"
                                    onClick={() => setClipTrim(c.id, 0, c.duration)}
                                  >
                                    Corte inteiro
                                  </button>
                                  <button
                                    className="btn btn--tiny"
                                    onClick={() => setTrimmingId(null)}
                                  >
                                    Ok
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="clip-actions">
                            <button
                              className={`btn btn--tiny${trimmingId === c.id ? ' btn--on' : ''}`}
                              aria-label="Recortar clipe"
                              title="Escolher o trecho (vídeo) ou a duração (imagem) deste clipe"
                              onClick={() =>
                                setTrimmingId(trimmingId === c.id ? null : c.id)
                              }
                            >
                              ✂
                            </button>
                            <button
                              className="btn btn--tiny"
                              aria-label="Subir clipe"
                              disabled={i === 0}
                              onClick={() => moveClip(c.id, -1)}
                            >
                              ↑
                            </button>
                            <button
                              className="btn btn--tiny"
                              aria-label="Descer clipe"
                              disabled={i === clips.length - 1}
                              onClick={() => moveClip(c.id, 1)}
                            >
                              ↓
                            </button>
                            <button
                              className="btn btn--tiny btn--danger"
                              aria-label="Remover clipe"
                              onClick={() => removeClip(c.id)}
                            >
                              ✕
                            </button>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                  <button
                    className="btn btn--ghost btn--block"
                    onClick={() => addInputRef.current?.click()}
                  >
                    + Adicionar vídeos ou imagens
                  </button>
                </>
              )}
            </>
          )}

          {/* ---------------- ABA MODELOS / FILTROS ---------------- */}
          {libTab === 'modelos' && (
            <>
              {mode === 'montage' ? (
                <>
                  <h4 className="lib-heading">Modelo da montagem</h4>
                  <div className="model-list" role="radiogroup" aria-label="Modelo da montagem">
                    {MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="radio"
                        aria-checked={modelId === m.id}
                        className={`model-card${modelId === m.id ? ' model-card--on' : ''}`}
                        onClick={() => setModelId(m.id)}
                      >
                        <span className="model-name">{m.name}</span>
                        <span className="model-desc">{m.description}</span>
                      </button>
                    ))}
                  </div>

                  <h4 className="lib-heading">Transição entre clipes</h4>
                  {jClip ? (
                    <div className="junction-banner">
                      <span>
                        Editando só o corte{' '}
                        <strong>
                          {jIndex + 1} → {jIndex + 2}
                        </strong>
                      </span>
                      <button
                        type="button"
                        className="btn btn--tiny"
                        onClick={() => setSelectedJunctionId(null)}
                      >
                        Todos os cortes
                      </button>
                    </div>
                  ) : (
                    <p className="form-hint">
                      Vale para <strong>todos os cortes</strong>. Para uma transição{' '}
                      <strong>diferente em um corte</strong>, toque no marcador{' '}
                      <span className="junction-glyph">⇄</span> entre dois clipes na linha do
                      tempo.
                    </p>
                  )}
                  <div className="chip-row">
                    {jClip ? (
                      <>
                        <button
                          type="button"
                          className={`chip${
                            jClip.transition === undefined && jClip.transitionDuration === undefined
                              ? ' chip--on'
                              : ''
                          }`}
                          onClick={() => clearJunction(jClip.id)}
                          title="Este corte segue a transição padrão da montagem"
                        >
                          Padrão
                        </button>
                        <button
                          type="button"
                          className={`chip${jCut ? ' chip--on' : ''}`}
                          onClick={() => setJunctionCut(jClip.id)}
                          title="Sem transição: um clipe entra direto no outro"
                        >
                          Corte seco
                        </button>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => applyJunctionToAll(jClip.id)}
                          title="Copia a transição deste corte para todos os outros"
                        >
                          Aplicar a todos
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`chip${customTransition === null ? ' chip--on' : ''}`}
                          onClick={() => setCustomTransition(null)}
                          title="Usa a transição do modelo escolhido"
                        >
                          Automática
                        </button>
                        {hasJunctionOverrides && (
                          <button
                            type="button"
                            className="chip"
                            onClick={clearAllJunctions}
                            title="Remove as transições personalizadas de cada corte"
                          >
                            Limpar cortes personalizados
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div className="chip-row chip-row--thumbs">
                    {TRANSITIONS.map((t) => {
                      const on = jClip
                        ? !jCut && jClip.transition === t.id
                        : customTransition === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={`chip chip--thumb${on ? ' chip--on' : ''}`}
                          title={t.hint}
                          aria-pressed={on}
                          onClick={() =>
                            jClip ? setJunction(jClip.id, t.id) : setCustomTransition(t.id)
                          }
                        >
                          <TransitionThumb transition={t.id} active={on} />
                          <span className="chip-label">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <label className="field field--block">
                    <span>
                      Duração da transição —{' '}
                      {jCut ? 'corte seco' : `${jDuration.toFixed(1).replace('.', ',')}s`}
                    </span>
                    <input
                      type="range"
                      min={0.2}
                      max={1.5}
                      step={0.1}
                      value={Math.max(0.2, jDuration)}
                      onChange={(e) =>
                        jClip
                          ? setJunctionDuration(jClip.id, Number(e.target.value))
                          : setCustomTransitionDuration(Number(e.target.value))
                      }
                    />
                  </label>
                  <p className="form-hint">
                    Cada corte pode ter a <strong>sua</strong> transição e duração. O modelo vem
                    com legenda pronta — o que você escolher aqui sobrescreve a transição dele.
                  </p>

                  <h4 className="lib-heading">Filtro de cor</h4>
                  <div
                    className="chip-row chip-row--thumbs"
                    role="radiogroup"
                    aria-label="Filtro de cor da montagem"
                  >
                    {FILTERS.map((f) => {
                      const on = customFilter === f.id;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          className={`chip chip--thumb${on ? ' chip--on' : ''}`}
                          onClick={() => setCustomFilter(f.id)}
                        >
                          <FilterThumb filter={f.id} />
                          <span className="chip-label">{f.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="form-hint">
                    Escolhido por você — vale para a <strong>montagem inteira</strong> (vídeo e
                    fundo borrado), na prévia e no arquivo. Nada é aplicado sozinho.
                  </p>
                </>
              ) : (
                <>
                  <h4 className="lib-heading">Filtro de cor</h4>
                  <div
                    className="chip-row chip-row--thumbs"
                    role="radiogroup"
                    aria-label="Filtro de cor"
                  >
                    {FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        role="radio"
                        aria-checked={filter === f.id}
                        className={`chip chip--thumb${filter === f.id ? ' chip--on' : ''}`}
                        onClick={() => setFilter(f.id)}
                      >
                        <FilterThumb filter={f.id} />
                        <span className="chip-label">{f.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="form-hint">
                    Aplicado ao <strong>vídeo e ao fundo borrado</strong> — a
                    legenda fica de fora pra continuar nítida. Válido na prévia e
                    no arquivo.
                  </p>
                </>
              )}
            </>
          )}

          {/* ---------------- ABA ÁUDIO ---------------- */}
          {libTab === 'audio' && mode === 'single' && (
            <>
              <h4 className="lib-heading">Trilha sonora</h4>
              <p className="muted">
                A trilha sonora com batidas funciona na <strong>Montagem</strong>. No
                modo Vídeo único o áudio original do vídeo é mantido. Troque o modo na
                aba Mídia (tela inicial) para usar música.
              </p>
            </>
          )}

          {libTab === 'audio' && mode === 'montage' && (
            <>
              <h4 className="lib-heading">Trilha sonora</h4>
              <input
                ref={musicInputRef}
                type="file"
                accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.mpeg"
                hidden
                onChange={(e) => {
                  const picked = e.target.files?.[0] ?? null;
                  if (picked) setMusic(picked);
                  e.target.value = '';
                }}
              />
              <div className="music-row">
                <button
                  type="button"
                  className="btn btn--ghost btn--block"
                  onClick={() => musicInputRef.current?.click()}
                >
                  {music ? 'Trocar música' : '🎵 Escolher música'}
                </button>
                {music && (
                  <button
                    type="button"
                    className="btn btn--tiny btn--danger"
                    onClick={() => setMusic(null)}
                    aria-label="Remover a música"
                  >
                    ✕
                  </button>
                )}
              </div>
              {music && (
                <div className="meta-title music-name" title={music.name}>
                  {music.name}
                </div>
              )}

              {music && musicAnalysis && (
                <div className="music-meta">
                  <span>⏱ {formatDuration(musicAnalysis.duration)}</span>
                  <span>
                    {musicAnalysis.bpm ? `${musicAnalysis.bpm} BPM` : 'BPM —'}
                  </span>
                  <span>🥁 {musicAnalysis.beats.length} batidas</span>
                </div>
              )}
              {music && !musicAnalysis && (
                <p className="muted">Analisando as batidas…</p>
              )}

              {musicAnalysis && (
                <>
                  <label className="field field--block">
                    <span>
                      Início da música — {musicOffset.toFixed(1).replace('.', ',')}s
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, musicAnalysis.duration - 0.5)}
                      step={0.1}
                      value={musicOffset}
                      onChange={(e) => setMusicOffset(Number(e.target.value))}
                    />
                  </label>
                  <p className="form-hint">
                    Ou <strong>arraste a onda</strong> na timeline (embaixo) para
                    mover a música sob a linha. O marcador branco é o começo da
                    trilha; tudo antes dele é pulado.
                  </p>

                  {mode === 'montage' && (
                    <button
                      className="btn btn--primary btn--block"
                      onClick={snapToBeats}
                      disabled={clips.length < 2}
                    >
                      ⚡ Sincronizar cortes com as batidas
                    </button>
                  )}
                </>
              )}

              <label className="field field--block">
                <span>Volume — {Math.round(musicVolume * 100)}%</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={musicVolume}
                  onChange={(e) => setMusicVolume(Number(e.target.value))}
                />
              </label>
              <p className="form-hint">
                A música entra <strong>por cima</strong> do áudio dos clipes, com
                loop automático e cortes que podem encaixar nas batidas. Tudo
                acontece no seu dispositivo.
              </p>
            </>
          )}
        </div>

        </>

        {/* Inputs sempre montados (fora das abas) */}
        <input
          ref={inputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple={mode === 'montage'}
          hidden
          onChange={(e) => {
            if (mode === 'montage') void addClips(e.target.files);
            else pickAny(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={addInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void addClips(e.target.files);
            e.target.value = '';
          }}
        />
      </aside>

      {/* ============================ 3. PREVIEW =========================== */}
      <main className="preview-panel">
        {/* ---------- VÍDEO ÚNICO ---------- */}
        {singleReady && (
          <>
            <div className="preview-monitor preview-monitor--portrait">
              <canvas
                ref={canvasRef}
                className="preview-canvas"
                width={PREVIEW_WIDTH}
                height={PREVIEW_HEIGHT}
                aria-label="Prévia do resultado"
                {...canvasDragProps}
              />
            </div>
            <div className="preview-controls">
              <button className="btn btn--tiny" onClick={togglePlay}>
                {playing ? '⏸ Pausar' : '▶ Reproduzir'}
              </button>
              <span className="preview-time">
                {formatDuration(singleTime)} / {formatDuration(info?.duration ?? 0)}
              </span>
              <span className="preview-hint">
                {selActive
                  ? 'arraste na prévia para mover o texto'
                  : 'arraste na timeline para navegar'}
              </span>
            </div>
            {/* Vídeo-fonte oculto: alimenta a prévia ao vivo */}
            <video
              ref={previewRef}
              src={previewUrl ?? undefined}
              muted
              loop
              playsInline
              className="video-hidden"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          </>
        )}

        {/* ---------- MONTAGEM ---------- */}
        {montageReady && (
          <>
            <div className="preview-monitor preview-monitor--portrait">
              <canvas
                ref={montageCanvasRef}
                className="preview-canvas"
                width={PREVIEW_WIDTH}
                height={PREVIEW_HEIGHT}
                aria-label="Prévia da montagem"
                {...canvasDragProps}
              />
            </div>
            <div className="preview-controls">
              <button className="btn btn--tiny" onClick={toggleMontagePlay}>
                {montagePlaying ? '⏸ Pausar' : '▶ Reproduzir'}
              </button>
              <span className="preview-time">
                {formatDuration(montageTime)} / {formatDuration(montageDuration)}
              </span>
              <span className="preview-hint">
                {selActive
                  ? 'arraste na prévia para mover o texto'
                  : `transição: ${TRANSITIONS.find((t) => t.id === currentTransition)?.label ?? ''}`}
              </span>
            </div>
            <audio ref={musicAudioRef} loop hidden />
          </>
        )}

        {/* ---------- PROCESSANDO ---------- */}
        {working && (
          <div className="progress-overlay">
            <div className="spinner" aria-hidden />
            <h3>
              {stage === 'montage'
                ? 'Montando seus clipes…'
                : stage === 'vertical'
                  ? 'Gerando a versão 9:16…'
                  : progressLabel || 'Gerando as proporções extras…'}
            </h3>
            <p className="muted">
              {stage === 'montage'
                ? 'Renderizando quadro a quadro com as transições e juntando o áudio.'
                : stage === 'vertical'
                  ? 'Montando o 9:16 com fundo borrado e legenda, frame a frame.'
                  : 'Mesmo pipeline do 9:16 — numa geometria diferente.'}
            </p>
            <div className="progress">
              <div
                className="progress-bar"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span className="progress-label">
              {progressLabel ||
                (steps > 1 ? `Etapa ${step} de ${steps}` : 'Processando no seu dispositivo')}
              {' — '}
              {Math.round(progress * 100)}%
            </span>
          </div>
        )}

        {/* ---------- RESULTADO ---------- */}
        {phase === 'done' && resultUrl && (
          <>
            <div className="preview-monitor preview-monitor--portrait">
              <video
                ref={resultVideoRef}
                src={resultUrl}
                controls
                autoPlay
                muted
                loop
                playsInline
              />
            </div>
            <div className="preview-controls">
              <a
                className="btn-export"
                href={resultUrl}
                download={`${mode === 'montage' ? 'montagem' : 'vertical'}-${Date.now()}.mp4`}
              >
                ⬇ Baixar MP4
              </a>
              <button className="btn btn--tiny" onClick={downloadCover}>
                🖼 Capa PNG
              </button>
              <button
                className="btn btn--tiny"
                onClick={() => {
                  if (mode === 'montage') {
                    setResultUrl(null);
                    setPhase('ready');
                  } else {
                    reset();
                  }
                }}
              >
                ← {mode === 'montage' ? 'Voltar e editar' : 'Novo vídeo'}
              </button>
            </div>
            {warnings.length > 0 && (
              <ul className="warnings">
                {warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* ---------- ERRO ---------- */}
        {phase === 'error' && error && (
          <div className="error-box">
            <h3>Não deu certo 😕</h3>
            <p>{error}</p>
            <button className="btn-export" onClick={retry}>
              Tentar de novo
            </button>
          </div>
        )}
      </main>

      {/* =========================== 4. INSPECTOR ========================== */}
      <aside className="inspector-panel">
        <div className="inspector-tabs" role="tablist">
          {(
            [
              ['ajustes', 'Ajustes'],
              ['texto', 'Texto'],
              ['saida', 'Saída'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={inspTab === id}
              className={`inspector-tab${inspTab === id ? ' active' : ''}`}
              onClick={() => setInspTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ---------- AJUSTES ---------- */}
        {inspTab === 'ajustes' && (
          <div className="inspector-section">
            <h4>Ajustes de imagem</h4>
            <div className="adjust-grid adjust-grid--one">
              {(
                [
                  ['brightness', 'Brilho', 0.6, 1.5, 0.02],
                  ['contrast', 'Contraste', 0.6, 1.6, 0.02],
                  ['saturate', 'Saturação', 0, 2, 0.02],
                  ['warmth', 'Calor', -1, 1, 0.05],
                ] as const
              ).map(([key, label, min, max, stepSize]) => (
                <label className="field" key={key}>
                  <span>
                    {label} —{' '}
                    {key === 'warmth'
                      ? adjust.warmth > 0.005
                        ? 'quente'
                        : adjust.warmth < -0.005
                          ? 'frio'
                          : 'neutro'
                      : Math.round(adjust[key] * 100) + '%'}
                  </span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={stepSize}
                    value={adjust[key]}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setAdjust((a) => ({ ...a, [key]: val }));
                    }}
                    aria-label={label}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() => setAdjust(DEFAULT_ADJUSTMENTS)}
            >
              ↺ Redefinir ajustes
            </button>
            <p className="form-hint">
              Somam ao filtro/modelo escolhido, na prévia e em todas as saídas.
            </p>
          </div>
        )}

        {/* ---------- TEXTO ---------- */}
        {inspTab === 'texto' && (
          <div className="inspector-section">
            <h4>Textos na linha do tempo</h4>
            <div className="text-actions">
              <button
                type="button"
                className="btn btn--accent"
                onClick={addText}
                disabled={!canEditTimeline}
              >
                + Texto no cursor
              </button>
            </div>

            {texts.length === 0 ? (
              <p className="form-hint">
                Nenhum texto ainda. Posicione o cursor onde o texto deve entrar e clique em{' '}
                <strong>+ Texto</strong>. Depois, na linha do tempo, arraste o bloco para movê-lo e
                puxe as pontas para ajustar o início e o fim.
              </p>
            ) : (
              <div className="text-list" role="listbox" aria-label="Textos do vídeo">
                {[...texts]
                  .sort((a, b) => a.start - b.start)
                  .map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="option"
                      aria-selected={t.id === selectedTextId}
                      className={`text-item${t.id === selectedTextId ? ' text-item--on' : ''}`}
                      onClick={() => setSelectedTextId(t.id)}
                    >
                      <span className="text-item-name">{t.style.title.trim() || 'Sem texto'}</span>
                      <small>
                        {formatTimecode(t.start)} → {formatTimecode(t.end)}
                      </small>
                    </button>
                  ))}
              </div>
            )}

            {sel && (
              <>
                <div className="form-grid-2">
                  <label className="field">
                    <span>Início (s)</span>
                    <input
                      key={`s-${sel.id}-${sel.start}`}
                      type="number"
                      min={0}
                      step={1 / PROJECT_FPS}
                      defaultValue={sel.start.toFixed(2)}
                      onBlur={(e) => commitRange({ start: parseSeconds(e.target.value) })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Fim (s)</span>
                    <input
                      key={`e-${sel.id}-${sel.end}`}
                      type="number"
                      min={0}
                      step={1 / PROJECT_FPS}
                      defaultValue={sel.end.toFixed(2)}
                      onBlur={(e) => commitRange({ end: parseSeconds(e.target.value) })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  </label>
                </div>
                <p className="form-hint">
                  Dura {(sel.end - sel.start).toFixed(2).replace('.', ',')}s (
                  {Math.round((sel.end - sel.start) * PROJECT_FPS)} quadros).
                </p>
                <div className="text-actions">
                  <button type="button" className="btn btn--tiny" onClick={duplicateSelected}>
                    Duplicar
                  </button>
                  <button
                    type="button"
                    className="btn btn--tiny btn--danger"
                    onClick={deleteSelected}
                  >
                    Excluir
                  </button>
                </div>

                    <label className="field field--block">
                      <span>Texto principal</span>
                      <textarea
                        rows={2}
                        value={sel.style.title}
                        placeholder="Ex.: A moto dos sonhos"
                        onChange={(e) => patchSelected({ title: e.target.value })}
                      />
                    </label>
                    <label className="field field--block">
                      <span>Subtítulo</span>
                      <input
                        type="text"
                        value={sel.style.subtitle}
                        placeholder="Opcional — detalhe ou chamada"
                        onChange={(e) => patchSelected({ subtitle: e.target.value })}
                      />
                    </label>
                    <div className="field field--block">
                      <span>Posição — vale qualquer ponto da tela</span>
                      <div className="chip-row">
                        {POSITION_PRESETS.map((p) => {
                          const on =
                            Math.abs(sel.style.x - p.x) < 0.01 && Math.abs(sel.style.y - p.y) < 0.01;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              aria-pressed={on}
                              className={`chip${on ? ' chip--on' : ''}`}
                              onClick={() => patchSelected({ x: p.x, y: p.y })}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label className="field field--block">
                      <span>Horizontal — {Math.round(sel.style.x * 100)}%</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(sel.style.x * 100)}
                        onChange={(e) => patchSelected({ x: Number(e.target.value) / 100 })}
                      />
                    </label>
                    <label className="field field--block">
                      <span>Vertical — {Math.round(sel.style.y * 100)}%</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(sel.style.y * 100)}
                        onChange={(e) => patchSelected({ y: Number(e.target.value) / 100 })}
                      />
                    </label>
                    <div className="form-grid-2">
                      <label className="field">
                        <span>Tamanho — {Math.round(sel.style.size)}</span>
                        <input
                          type="range"
                          min={CAPTION_SIZE_MIN}
                          max={CAPTION_SIZE_MAX}
                          step={2}
                          value={sel.style.size}
                          onChange={(e) => patchSelected({ size: Number(e.target.value) })}
                        />
                      </label>
                      <label className="field">
                        <span>Fonte</span>
                        <select
                          value={sel.style.font}
                          onChange={(e) =>
                            patchSelected({ font: e.target.value as CaptionOptions['font'] })
                          }
                        >
                          {FONT_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Cor</span>
                        <select
                          value={sel.style.color}
                          onChange={(e) =>
                            patchSelected({ color: e.target.value as CaptionOptions['color'] })
                          }
                        >
                          {COLOR_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Alinhamento</span>
                        <select
                          value={sel.style.align}
                          onChange={(e) =>
                            patchSelected({ align: e.target.value as CaptionOptions['align'] })
                          }
                        >
                          {ALIGN_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Efeito</span>
                        <select
                          value={sel.style.effect}
                          onChange={(e) =>
                            patchSelected({ effect: e.target.value as CaptionOptions['effect'] })
                          }
                        >
                          {EFFECT_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Animação</span>
                        <select
                          value={sel.style.anim}
                          onChange={(e) =>
                            patchSelected({ anim: e.target.value as CaptionOptions['anim'] })
                          }
                        >
                          {ANIM_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="check">
                      <input
                        type="checkbox"
                        checked={sel.style.uppercase}
                        onChange={(e) => patchSelected({ uppercase: e.target.checked })}
                      />
                      Caixa alta
                    </label>

                    {EFFECTS_WITH_COLOR.includes(sel.style.effect) && (
                      <div className="swatch-group">
                        <span className="swatch-label">Cor do efeito</span>
                        <div className="swatches">
                          {EFFECT_COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              className={`swatch${sel.style.effectColor === c ? ' swatch--on' : ''}`}
                              style={{ background: c }}
                              aria-label={`Cor ${c}`}
                              onClick={() => patchSelected({ effectColor: c })}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                <p className="form-hint">
                  Com o cursor dentro do bloco, <strong>arraste o texto na prévia</strong> para
                  colocá-lo onde quiser (ele encaixa no centro). As linhas tracejadas são as{' '}
                  <strong>zonas seguras</strong> do Instagram: fora delas, a interface do app pode
                  cobrir o texto. A cor é escolhida pelo contraste com o que está atrás. Delete apaga
                  o texto selecionado.
                </p>
              </>
            )}
          </div>
        )}

        {/* ---------- SAÍDA ---------- */}
        {inspTab === 'saida' && (
          <div className="inspector-section">
            <h4>O que será exportado</h4>
            <p className="export-summary">
              {mode === 'montage'
                ? `A montagem junta os ${clips.length} clipe${clips.length === 1 ? '' : 's'} em `
                : 'Vai gerar '}
              <strong>{fileCount === 1 ? '1 arquivo' : `${fileCount} arquivos`}</strong>
              {': '}9:16 ({OUT_WIDTH}×{OUT_HEIGHT})
              {extraRatios.length > 0
                ? ` + ${extraRatios.map((r) => ratioInfo(r).label).join(' + ')}`
                : ''}
              .
            </p>
            <div className="chip-row" role="group" aria-label="Arquivo principal e proporções extras">
              <span className="chip chip--on chip--fixed" title="O arquivo principal é sempre gerado">
                ✓ 9:16 · principal
              </span>
              {extraRatios.length > 0 && (
                <button
                  type="button"
                  className="chip"
                  onClick={() => setExtraRatios([])}
                  title="Desmarca as proporções extras: sai só o 9:16"
                >
                  Só o 9:16
                </button>
              )}
            </div>
            <h4 className="inspector-gap">Arquivos extras (opcional)</h4>
            <div className="chip-row" role="group" aria-label="Proporções extras">
              {EXTRA_RATIOS.map((r) => {
                const on = extraRatios.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={on}
                    className={`chip${on ? ' chip--on' : ''}`}
                    onClick={() =>
                      setExtraRatios((prev) =>
                        prev.includes(r.id)
                          ? prev.filter((x) => x !== r.id)
                          : [...prev, r.id],
                      )
                    }
                  >
                    {r.label} · {r.hint}
                  </button>
                );
              })}
            </div>
            <p className="form-hint">
              O <strong>9:16</strong> é sempre gerado. Marque outras proporções só se quiser
              mais arquivos: cada uma vira <strong>um MP4 a mais</strong> (e mais tempo de espera).
              Nada extra é gerado se você não marcar.
            </p>

            <button
              className="btn-export btn--block"
              onClick={doExport}
              disabled={exportDisabled}
            >
              {exportLabel}
            </button>

            {phase === 'done' && (
              <>
                <h4 className="inspector-gap">Arquivos prontos</h4>
                <a
                  className="btn btn--primary btn--block"
                  href={resultUrl ?? '#'}
                  download={`${mode === 'montage' ? 'montagem' : 'vertical'}-${Date.now()}.mp4`}
                >
                  ⬇ Baixar principal 9:16 · {formatBytes(resultSize)}
                </a>
                {mode === 'montage' && (
                  <p className="form-hint">Duração: {formatDuration(resultDuration)}</p>
                )}
                {outputs.map((o) => {
                  const rInfo = ratioInfo(o.ratio);
                  return (
                    <a
                      key={o.ratio}
                      className="btn btn--ghost btn--block"
                      href={o.url}
                      download={`${mode === 'montage' ? 'montagem' : 'video'}-${rInfo.label.replace(':', 'x')}-${Date.now()}.mp4`}
                    >
                      ⬇ {rInfo.label} · {formatBytes(o.size)}
                    </a>
                  );
                })}
                <button className="btn btn--ghost btn--block" onClick={downloadCover}>
                  🖼 Baixar capa (PNG)
                </button>
              </>
            )}

            {warnings.length > 0 && (
              <ul className="warnings">
                {warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>

      {/* ============================ 5. TIMELINE ========================== */}
      <footer className="timeline-panel">
        <div className="timeline-toolbar">
          <button
            className="btn btn--tiny"
            disabled={phase !== 'ready'}
            onClick={() => (mode === 'montage' ? toggleMontagePlay() : togglePlay())}
          >
            {mode === 'montage'
              ? montagePlaying
                ? '⏸'
                : '▶'
              : playing
                ? '⏸'
                : '▶'}
          </button>
          <button
            className="btn btn--tiny"
            onClick={() => stepFrames(-1)}
            disabled={!canEditTimeline}
            aria-label="Quadro anterior"
            title="Quadro anterior (←) · Shift+← volta 10"
          >
            ◂
          </button>
          <button
            className="btn btn--tiny"
            onClick={() => stepFrames(1)}
            disabled={!canEditTimeline}
            aria-label="Próximo quadro"
            title="Próximo quadro (→) · Shift+→ avança 10"
          >
            ▸
          </button>
          <button
            className="btn btn--tiny"
            onClick={undo}
            disabled={!canEditTimeline || !hist || !canUndo(hist)}
            aria-label="Desfazer"
            title="Desfazer (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            className="btn btn--tiny"
            onClick={redo}
            disabled={!canEditTimeline || !hist || !canRedo(hist)}
            aria-label="Refazer"
            title="Refazer (Ctrl+Shift+Z)"
          >
            ↷
          </button>
          <span className="tl-time" title="minutos : segundos : quadros">
            {formatTimecode(videoCurrent)} / {formatTimecode(videoTotal)}
          </span>
          <button
            className="btn btn--tiny btn--accent"
            onClick={addText}
            disabled={!canEditTimeline}
            title="Cria um texto no ponto onde está o cursor"
          >
            + Texto
          </button>
          <span className="tl-edit-tools" role="group" aria-label="Editar clipes">
            <button
              className="btn btn--tiny"
              onClick={splitAtPlayhead}
              disabled={!canEditTimeline}
              title="Divide o clipe em dois, no ponto do cursor (S)"
            >
              ✂ Dividir
            </button>
            <button
              className="btn btn--tiny"
              onClick={() => applyCut('start')}
              disabled={!canEditTimeline}
              title="Corta tudo o que vem ANTES do cursor, no clipe sob ele"
            >
              Cortar início
            </button>
            <button
              className="btn btn--tiny"
              onClick={() => applyCut('end')}
              disabled={!canEditTimeline}
              title="Corta tudo o que vem DEPOIS do cursor, no clipe sob ele"
            >
              Cortar fim
            </button>
            <button
              className="btn btn--tiny btn--danger"
              onClick={deleteClip}
              disabled={!canEditTimeline || mode !== 'montage'}
              title="Exclui o clipe selecionado (ou o que está sob o cursor) — Delete"
            >
              Excluir
            </button>
          </span>

          {mode === 'montage' && musicAnalysis && (
            <>
              <span className="tl-badge">
                {musicAnalysis.bpm ? `${musicAnalysis.bpm} BPM` : 'BATIDAS'}
              </span>
              <button
                className="btn btn--tiny btn--accent"
                onClick={snapToBeats}
                disabled={clips.length < 2}
                title="Encaixa os cortes da montagem nas batidas da música"
              >
                ⚡ Cortar nas batidas
              </button>
            </>
          )}

          {/* Zoom da linha do tempo (Etapa 13): só a linha dá zoom */}
          <span className="tl-zoom">
            <button
              className="btn btn--tiny"
              onClick={() => zoomBy(1 / 1.4)}
              disabled={videoTotal <= 0 || zoom <= 1}
              title="Diminuir zoom (Ctrl+role na linha)"
            >
              −
            </button>
            <span className="tl-zoom-label">{Math.round(zoom * 100)}%</span>
            <button
              className="btn btn--tiny"
              onClick={() => zoomBy(1.4)}
              disabled={videoTotal <= 0 || zoom >= videoTotal / 0.5 - 0.001}
              title="Aumentar zoom (Ctrl+role na linha)"
            >
              +
            </button>
            <button
              className="btn btn--tiny"
              onClick={fitView}
              disabled={videoTotal <= 0 || zoom <= 1}
              title="Ver a linha do tempo inteira"
            >
              Ajustar
            </button>
            <button
              className="btn btn--tiny"
              onClick={() => panBy(-0.5)}
              disabled={videoTotal <= 0 || zoom <= 1}
              aria-label="Mover a linha do tempo para trás"
              title="Mover para trás"
            >
              ◀
            </button>
            <button
              className="btn btn--tiny"
              onClick={() => panBy(0.5)}
              disabled={videoTotal <= 0 || zoom <= 1}
              aria-label="Mover a linha do tempo para frente"
              title="Mover para frente"
            >
              ▶
            </button>
          </span>

          <span className="tl-hint">
            {mode === 'montage'
              ? 'arraste para navegar · clique para tocar dali · ← → quadro a quadro · Ctrl+role = zoom · arraste a onda para ajustar a música'
              : 'arraste para navegar · clique para tocar dali · ← → quadro a quadro · Ctrl+role = zoom'}
          </span>
        </div>

        <div
          className="timeline-tracks"
          ref={tlTracksRef}
          onPointerDown={(e) => {
            // Só o botão primário: botão direito/middle não "navega".
            if (e.button !== 0) return;
            scrubbingRef.current = true;
            scrubMovedRef.current = 0;
            scrubOriginRef.current = { x: e.clientX, y: e.clientY };
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* ponteiro sintético: segue sem captura */
            }
            seekFromEvent(e);
          }}
          onPointerMove={(e) => {
            if (!scrubbingRef.current) return;
            const o = scrubOriginRef.current;
            if (o) {
              scrubMovedRef.current = Math.max(
                scrubMovedRef.current,
                Math.hypot(e.clientX - o.x, e.clientY - o.y),
              );
            }
            seekFromEvent(e); // arrastando = avança e volta livremente
          }}
          onPointerUp={() => {
            if (!scrubbingRef.current) return;
            endScrub();
          }}
          onPointerCancel={() => {
            scrubbingRef.current = false;
            scrubOriginRef.current = null;
          }}
        >
          {/* Régua + trilha de vídeo (mesma escala/janela visível) */}
          <div className="tl-stack" role="presentation" ref={tlStackRef}>
            <div className="tl-ruler">
              {frameMode
                ? frameTicks.map((f) => (
                    <span
                      key={f.t}
                      className={`tl-tick${f.label ? '' : ' tl-tick--minor'}`}
                      style={{ left: `${posPct(f.t)}%` }}
                    >
                      <i />
                      {f.label}
                    </span>
                  ))
                : rulerTicks.map((t) => (
                    <span key={t} className="tl-tick" style={{ left: `${posPct(t)}%` }}>
                      <i />
                      {formatTick(t, rulerStep)}
                    </span>
                  ))}
            </div>

            <div className="tl-track tl-track--video">
              {mode === 'montage' && clips.length > 0 && montageTimeline ? (
                clips.map((c, i) => {
                  const seg = montageTimeline.clips[i];
                  // Fora da janela visível → fora do DOM (linhas com zoom).
                  if (
                    !seg ||
                    seg.end < viewStartClamped ||
                    seg.start > viewStartClamped + viewSpan
                  ) {
                    return null;
                  }
                  const left = posPct(seg.start);
                  const width = Math.max(1, posPct(seg.end) - left);
                  return (
                    <div
                      key={c.id}
                      className={`tl-clip${selectedClipId === c.id ? ' tl-clip--on' : ''}${
                        c.kind === 'image' ? ' tl-clip--image' : ''
                      }`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      // Clicar seleciona (e a régua também navega até ali — sem stopPropagation).
                      onPointerDown={() => setSelectedClipId(c.id)}
                      title={`${i + 1}. ${c.name} — ${formatDuration(c.trimEnd - c.trimStart)}`}
                    >
                      <span className="tl-clip-idx">{i + 1}</span>
                      <span className="tl-clip-name">
                        {c.kind === 'image' ? '🖼 ' : ''}
                        {c.name}
                      </span>
                    </div>
                  );
                })
              ) : mode === 'single' && info ? (
                <div
                  className="tl-clip tl-clip--single"
                  style={{
                    left: `${posPct(0)}%`,
                    width: `${Math.max(1, posPct(videoTotal) - posPct(0))}%`,
                  }}
                  title={info.name}
                >
                  <span className="tl-clip-name">{info.name}</span>
                </div>
              ) : (
                <span className="tl-empty">
                  {mode === 'montage'
                    ? 'Arraste os vídeos na aba Mídia para montar a timeline'
                    : 'Escolha um vídeo para começar'}
                </span>
              )}

              {/* Marcadores de transição = sobreposição REAL dos clipes */}
              {montageTimeline?.transitions.map((td, i) => {
                if (td <= 0.01) return null;
                const seg = montageTimeline.clips[i];
                if (!seg) return null;
                const t1 = seg.end;
                const t0 = t1 - td;
                if (t1 < viewStartClamped || t0 > viewStartClamped + viewSpan) return null;
                const left = posPct(t0);
                const width = Math.max(1, posPct(t1) - left);
                return (
                  <span
                    key={`tr-${i}`}
                    className="tl-clip-transition"
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={
                      TRANSITIONS.find((t) => t.id === (clips[i]?.transition ?? currentTransition))
                        ?.label
                    }
                  />
                );
              })}

              {/* Um marcador ⇄ em CADA corte: toque pra escolher a transição daquele corte */}
              {mode === 'montage' &&
                montageTimeline &&
                clips.map((c, i) => {
                  if (i >= clips.length - 1) return null;
                  const a = montageTimeline.clips[i];
                  const b = montageTimeline.clips[i + 1];
                  if (!a || !b) return null;
                  const center = (b.start + a.end) / 2;
                  if (center < viewStartClamped || center > viewStartClamped + viewSpan) {
                    return null;
                  }
                  const cut =
                    (c.transitionDuration ?? currentTransitionDuration) <= 0 ||
                    montageTimeline.transitions[i] <= 0.01;
                  const label = cut
                    ? 'Corte seco'
                    : (TRANSITIONS.find((t) => t.id === (c.transition ?? currentTransition))
                        ?.label ?? '');
                  return (
                    <button
                      key={`jn-${c.id}`}
                      type="button"
                      className={`tl-junction${selectedJunctionId === c.id ? ' tl-junction--on' : ''}${
                        cut ? ' tl-junction--cut' : ''
                      }`}
                      style={{ left: `${posPct(center)}%` }}
                      onPointerDown={(e) => {
                        e.stopPropagation(); // não é "navegar no tempo"
                        selectJunction(c.id);
                      }}
                      aria-label={`Transição entre os clipes ${i + 1} e ${i + 2}: ${label}`}
                      title={`${i + 1} → ${i + 2}: ${label} — toque para editar`}
                    >
                      ⇄
                    </button>
                  );
                })}

              {/* Batidas da música destacadas — só as visíveis na janela */}
              {mode === 'montage' &&
                visibleBeatEls.map((t) => (
                    <span
                      key={`beat-${t}`}
                      className="tl-beat"
                      style={{ left: `${posPct(t)}%` }}
                      title={`Batida em ${formatDuration(t)}`}
                    />
                  ))}
            </div>

            {/* Trilha de TEXTO: cada bloco aparece só entre o início e o fim dele.
                Corpo = mover · pontas = início/fim · clicar = selecionar. */}
            <div className="tl-track tl-track--text">
              {texts.length === 0 && videoTotal > 0 && (
                <span className="tl-empty tl-empty--text">
                  Sem texto — use “+ Texto” para criar um no cursor
                </span>
              )}
              {texts.map((t) => {
                if (
                  viewSpan <= 0 ||
                  t.end < viewStartClamped ||
                  t.start > viewStartClamped + viewSpan
                ) {
                  return null;
                }
                const left = ((t.start - viewStartClamped) / viewSpan) * 100;
                const width = ((t.end - t.start) / viewSpan) * 100;
                const on = t.id === selectedTextId;
                return (
                  <div
                    key={t.id}
                    className={`tl-text${on ? ' tl-text--on' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    onPointerDown={(e) => beginTextDrag(e, t, 'move')}
                    onPointerMove={moveTextDrag}
                    onPointerUp={endTextDrag}
                    onPointerCancel={endTextDrag}
                    title={`${t.style.title.trim() || 'Texto'} — ${formatTimecode(t.start)} → ${formatTimecode(t.end)}`}
                  >
                    <span
                      className="tl-text-handle tl-text-handle--start"
                      onPointerDown={(e) => beginTextDrag(e, t, 'start')}
                      aria-label="Início do texto"
                    />
                    <span className="tl-text-label">{t.style.title.trim() || 'Sem texto'}</span>
                    <span
                      className="tl-text-handle tl-text-handle--end"
                      onPointerDown={(e) => beginTextDrag(e, t, 'end')}
                      aria-label="Fim do texto"
                    />
                  </div>
                );
              })}
            </div>

            <div className="tl-playhead" style={{ left: `${posPct(videoCurrent)}%` }} />
          </div>

          {/* Trilha de música: onda + batidas NA ESCALA DA JANELA.
              Arrastar = move a música por baixo da linha (Etapa 13). */}
          <div className="tl-track tl-track--music">
            <canvas
              ref={attachMusicCanvas}
              className="tl-music-canvas"
              onPointerDown={(e) => {
                if (!musicAnalysis) return; // sem música → a timeline toda navega
                e.stopPropagation(); // arrastar aqui move a MÚSICA, não o cursor
                musicDraggingRef.current = true;
                startMusicDrag(e);
              }}
              onPointerMove={(e) => {
                if (musicDraggingRef.current) moveMusicDrag(e);
              }}
              onPointerUp={(e) => {
                const start = musicDragStartRef.current;
                const moved = start ? Math.abs(e.clientX - start.x) : Number.MAX_SAFE_INTEGER;
                musicDraggingRef.current = false;
                musicDragStartRef.current = null;
                // Clique limpo (sem arrastar) = navega e toca, como nas outras trilhas.
                if (moved < 6) {
                  seekFromEvent(e);
                  playFromCursor();
                }
              }}
              onPointerCancel={() => {
                musicDraggingRef.current = false;
                musicDragStartRef.current = null;
              }}
              style={{ cursor: musicAnalysis ? 'grab' : 'default' }}
            />
          </div>
        </div>
      </footer>

      {/* ===================== DIVISORES (arrastar = redimensionar) =====================
          Arraste para aumentar/diminuir; duplo clique volta ao tamanho padrão.
          A prévia ocupa o espaço que sobrar, então as outras áreas se ajustam sozinhas. */}
      {(
        [
          ['lib', 'vertical', 'Redimensionar a biblioteca'],
          ['insp', 'vertical', 'Redimensionar o inspetor'],
          ['tl', 'horizontal', 'Redimensionar a linha do tempo'],
        ] as const
      ).map(([id, orientation, label]) =>
        isHidden(layout, id) ? null : (
          <div
            key={id}
            className={`resizer resizer--${id}${resizing === id ? ' resizer--active' : ''}`}
            role="separator"
            aria-orientation={orientation}
            aria-label={label}
            tabIndex={0}
            title="Arraste para redimensionar · duplo clique restaura o tamanho"
            onPointerDown={beginResize(id)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={() => setLayout((l) => resetPanel(l, id))}
            onKeyDown={keyResize(id)}
          />
        ),
      )}
    </div>
  );
}
