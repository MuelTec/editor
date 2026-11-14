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
  POSITION_OPTIONS,
  hasCaptionText,
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
  MODELS,
  TRANSITIONS,
  assembleMontage,
  probeClip,
  type MontageClip,
  type TransitionId,
} from './lib/montage';
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  startLivePreview,
  startMontagePreview,
  type MontagePreview,
} from './lib/preview';
import { toHorizontal, toVertical } from './lib/toVertical';

/**
 * EDITOR ESTILO CAPCUT (Etapa 12).
 *
 * Layout em grid profissional:
 *  - Topbar: marca, voltar e exportar;
 *  - Library (esquerda): mídia/modelos/áudio;
 *  - Preview (centro): monitor de saída;
 *  - Inspector (direita): ajustes/legenda/saída;
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
type InspTab = 'ajustes' | 'legenda' | 'saida';

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
}

const VIDEO_RE = /\.(mp4|mov|webm|m4v|mkv)$/i;
const isVideoFile = (f: File): boolean =>
  f.type.startsWith('video/') || VIDEO_RE.test(f.name);

/** Converte a lista da UI pro formato do motor de montagem. */
const toMontageClips = (list: ClipInfo[]): MontageClip[] =>
  list.map((c) => ({ file: c.file, trimStart: c.trimStart, trimEnd: c.trimEnd }));

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
  const [extraRatios, setExtraRatios] = useState<RatioId[]>(['16:9']);
  const [outputs, setOutputs] = useState<ExtraOutput[]>([]);

  // ------------------------------------------------------------ estilo
  const [caption, setCaption] = useState<CaptionOptions>(DEFAULT_CAPTION);
  const [filter, setFilter] = useState<FilterId>('none');
  const [adjust, setAdjust] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [playing, setPlaying] = useState(false);
  const [singleTime, setSingleTime] = useState(0);

  // ------------------------------------------------------------ montagem
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [modelId, setModelId] = useState(DEFAULT_MODEL.id);
  /** Transição escolhida à mão (null = usa a do modelo). */
  const [customTransition, setCustomTransition] = useState<TransitionId | null>(null);
  /** Duração escolhida à mão (null = usa a do modelo). */
  const [customTransitionDuration, setCustomTransitionDuration] = useState<number | null>(null);
  const [trimmingId, setTrimmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [montageTime, setMontageTime] = useState(0);
  const [montageDuration, setMontageDuration] = useState(0);
  const [montagePlaying, setMontagePlaying] = useState(true);

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
  const musicCanvasRef = useRef<HTMLCanvasElement>(null);
  const montagePreviewRef = useRef<MontagePreview | null>(null);
  const timeTickRef = useRef(0);
  const musicOffsetRef = useRef(0);
  const musicDraggingRef = useRef(false);

  // Analisa a música quando o arquivo é escolhido.
  useEffect(() => {
    if (!music) {
      setMusicAnalysis(null);
      setMusicOffset(0);
      return;
    }
    void (async () => {
      const res = await analyzeMusic(music);
      setMusicAnalysis(res);
    })();
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

  // Memoizado: sem isso viraria objeto novo a cada render (10×/s pela barra
  // de tempo) e o efeito de atualização da prévia rodaria sem parar.
  const montageCaption = useMemo(
    () => (hasCaptionText(caption) ? { ...caption, ...model.caption } : undefined),
    [caption, model],
  );

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
    let live: { stop(): void } | null = null;
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
      live = startLivePreview(
        v,
        c,
        hasCaptionText(caption) ? caption : undefined,
        true,
        filter,
        adjust,
      );
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
    };
  }, [caption, filter, adjust, mode, phase, file]);

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
        filter: model.filter,
        caption: montageCaption,
        adjust,
        guides: true,
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
          // Atualiza a barra no máx. 10×/s pra não repintar a UI a 60fps.
          if (Math.abs(t - timeTickRef.current) >= 0.1) {
            timeTickRef.current = t;
            setMontageTime(t);
            setMontageDuration(d);
          } else if (t === 0 && timeTickRef.current !== 0) {
            timeTickRef.current = 0;
            setMontageTime(0);
          }
        },
      });
      montagePreviewRef.current = api;
      setMontageTime(0);
      setMontageDuration(api.duration);
    }, 300);

    return () => {
      window.clearTimeout(timer);
      api?.stop();
      if (montagePreviewRef.current === api) montagePreviewRef.current = null;
    };
    // `model`/`montageCaption`/`adjust` ficam de fora de propósito: trocas
    // quentes entram pelo efeito logo abaixo, sem reabrir os arquivos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, clips]);

  // Troca quente de modelo/legenda/ajustes/transição na prévia da montagem.
  useEffect(() => {
    const api = montagePreviewRef.current;
    if (!api) return;
    void api.update({
      transition: currentTransition,
      transitionDuration: currentTransitionDuration,
      filter: model.filter,
      caption: montageCaption,
      adjust,
      guides: true,
    });
  }, [model, montageCaption, adjust, currentTransition, currentTransitionDuration]);

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

  // ------------------------------------------------------- forma de onda
  // Desenha a faixa de música: onda + BATIDAS destacadas + handle do
  // início + playhead sincronizado com a montagem.
  useEffect(() => {
    const canvas = musicCanvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      const w = Math.max(160, parent?.clientWidth ?? 480);
      const h = 76;
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

      // 1) Forma de onda
      const peaks = musicAnalysis.peaks;
      const bars = Math.min(peaks.length, Math.floor(w / 3));
      const barW = w / bars;
      ctx.fillStyle = '#26b9ff';
      ctx.globalAlpha = 0.65;
      for (let i = 0; i < bars; i++) {
        const p = peaks[Math.floor((i / bars) * peaks.length)] ?? 0;
        const bh = Math.max(2, p * (h - 16));
        ctx.fillRect(i * barW, (h - bh) / 2, Math.max(1, barW - 1), bh);
      }
      ctx.globalAlpha = 1;

      // 2) Região ignorada (antes do início escolhido) escurecida
      if (offset > 0.02) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
        ctx.fillRect(0, 0, (offset / dur) * w, h);
        ctx.fillStyle = '#969696';
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('pulado', 6, 12);
      }

      // 3) BATIDAS destacadas
      const beats = musicAnalysis.beats;
      ctx.fillStyle = '#ff4d6d';
      for (const b of beats) {
        const x = (b / dur) * w;
        ctx.fillRect(x, 4, 1.5, h - 8);
        // pontinho no topo pra destacar mais
        ctx.fillRect(x - 2, 4, 5.5, 4);
      }

      // 4) Handle do início da música
      const hx = (offset / dur) * w;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hx - 1, 0, 2, h);
      ctx.beginPath();
      ctx.moveTo(hx - 6, 0);
      ctx.lineTo(hx + 6, 0);
      ctx.lineTo(hx, 9);
      ctx.closePath();
      ctx.fill();

      // 5) Playhead da montagem (posição dentro da música, com loop)
      if (montageDuration > 0) {
        const inMusic = (montageTime + offset) % dur;
        const px = (inMusic / dur) * w;
        ctx.fillStyle = '#ffd400';
        ctx.fillRect(px - 1, 0, 2, h);
      }
    };

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [musicAnalysis, musicOffset, montageDuration, montageTime, music]);

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
    setTrimmingId(null);
    setMontageTime(0);
    setMontageDuration(0);
    setMontagePlaying(true);
    setSingleTime(0);
    setPlaying(false);
    setLibTab('midia');
  }, []);

  const pickFile = useCallback(
    async (picked: File | null | undefined) => {
      if (!picked) return;
      if (!isVideoFile(picked)) {
        setError('Esse arquivo não parece ser um vídeo.');
        setPhase('error');
        return;
      }

      reset();
      setMode('single');
      setFile(picked);
      setPhase('ready');
      setPreviewUrl(URL.createObjectURL(picked));

      // Lê as dimensões/duração pela prévia
      try {
        const url = URL.createObjectURL(picked);
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
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('metadata'));
        });

        const duration = await durationOf(video);
        setInfo({
          name: picked.name,
          size: picked.size,
          width: video.videoWidth,
          height: video.videoHeight,
          duration,
        });
        URL.revokeObjectURL(url);
      } catch {
        // Prévia falhou — o usuário ainda pode tentar converter
        setInfo({ name: picked.name, size: picked.size, width: 0, height: 0, duration: 0 });
      }
    },
    [reset],
  );

  // Adiciona clipes à montagem (leitura de dimensões/duração sem decodificar).
  const addClips = useCallback(
    async (picked: FileList | File[] | null | undefined) => {
      if (!picked) return;
      const arr = Array.from(picked).filter(isVideoFile);
      if (arr.length === 0) {
        setError('Nenhum arquivo de vídeo foi reconhecido.');
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
          const meta = await probeClip(f);
          if (!meta.duration) throw new Error('sem-duração');
          added.push({
            id: `${f.name}-${f.size}-${added.length}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            file: f,
            name: f.name,
            size: f.size,
            width: meta.width,
            height: meta.height,
            duration: meta.duration,
            trimStart: 0,
            trimEnd: meta.duration,
          });
        } catch {
          failed.push(f.name);
        }
      }

      if (failed.length > 0) {
        setNotice(
          failed.length === arr.length
            ? 'Não consegui ler nenhum desses arquivos como vídeo.'
            : `Foram ignorados: ${failed.join(', ')}`,
        );
      }
      if (added.length > 0) setClips((prev) => [...prev, ...added]);
    },
    [],
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
      currentTransitionDuration,
      montageDuration,
    );
    if (snapped) {
      setClips((prev) =>
        prev.map((c, i) => ({
          ...c,
          trimStart: snapped[i].trimStart,
          trimEnd: snapped[i].trimEnd,
        })),
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

    const cap = hasCaptionText(caption) ? caption : undefined;

    try {
      const { blob, warnings: w } = await toVertical(file, setProgress, cap, filter, {
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
              : await toVertical(file, setProgress, cap, filter, {
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
  }, [file, resultUrl, caption, filter, adjust, extraRatios]);

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
      filter: model.filter,
      caption: montageCaption,
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
    montageCaption,
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
      else pickFile(e.dataTransfer.files?.[0]);
    },
    [addClips, mode, pickFile],
  );

  /** Clica/arrasta na régua ou na trilha de vídeo → navega no tempo. */
  const seekFromEvent = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, total: number) => {
      if (total <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const t = p * total;
      if (mode === 'montage') seekMontage(t);
      else seekSingle(t);
    },
    [mode, seekMontage, seekSingle],
  );

  /** Arrasta o handle do início da música na forma de onda. */
  const offsetFromEvent = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!musicAnalysis) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const dur = musicAnalysis.duration;
      setMusicOffset(Math.min(Math.max(0, p * dur), Math.max(0, dur - 0.5)));
    },
    [musicAnalysis],
  );

  const working = phase === 'working';
  const montageReady = phase === 'ready' && mode === 'montage';
  const singleReady = phase === 'ready' && mode === 'single' && !!file;

  // Tempos da timeline
  const videoTotal = mode === 'montage' ? montageDuration : (info?.duration ?? 0);
  const videoCurrent = mode === 'montage' ? montageTime : singleTime;
  const playheadPct =
    videoTotal > 0 ? Math.min(100, (videoCurrent / videoTotal) * 100) : 0;

  // Régua: passo adaptativo
  const rulerStep =
    videoTotal > 120 ? 15 : videoTotal > 60 ? 10 : videoTotal > 20 ? 5 : 1;
  const rulerTicks: number[] = [];
  for (let t = 0; t <= videoTotal + 0.001; t += rulerStep) rulerTicks.push(t);

  const totalClipDuration = clips.reduce(
    (s, c) => s + Math.max(0.1, c.trimEnd - c.trimStart),
    0,
  );

  const exportDisabled =
    working || phase === 'idle' || phase === 'error' || (mode === 'montage' && clips.length === 0);

  const exportLabel = working
    ? 'Processando…'
    : mode === 'montage'
      ? `Exportar (${clips.length} clipe${clips.length === 1 ? '' : 's'})`
      : 'Exportar 9:16';

  const doExport = () => {
    if (mode === 'single') void convert();
    else void generateMontage();
  };

  return (
    <div className="editor-container">
      {/* ============================ 1. TOPBAR ============================ */}
      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src="./icon.svg" alt="" width={26} height={26} />
          <span className="brand-name">Estúdio</span>
          {phase !== 'idle' && (
            <button className="btn btn--back" onClick={reset}>
              ← Voltar
            </button>
          )}
        </div>
        <span className="badge-local" title="Seu vídeo nunca sai deste dispositivo">
          100% no seu aparelho
        </span>
        <div className="top-actions">
          <button className="btn-export" onClick={doExport} disabled={exportDisabled}>
            {exportLabel}
          </button>
        </div>
      </header>

      {/* ============================ 2. LIBRARY =========================== */}
      <aside className="library-panel">
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
              {(phase === 'idle' || phase === 'error') && (
                <div className="mode-row" role="radiogroup" aria-label="Modo de trabalho">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'single'}
                    className={`mode-chip${mode === 'single' ? ' mode-chip--on' : ''}`}
                    onClick={() => {
                      reset();
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
                      reset();
                      setMode('montage');
                    }}
                  >
                    Montagem
                  </button>
                </div>
              )}

              {(phase === 'idle' || phase === 'error') && (
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
                      ? 'Escolha os vídeos da montagem'
                      : 'Escolha um vídeo'}
                  </h3>
                  <p className="dropzone-hint">
                    {mode === 'montage'
                      ? 'Um ou mais arquivos — a ordem da lista é a ordem da montagem'
                      : 'Arraste aqui ou toque para selecionar'}
                  </p>
                  <p className="dropzone-hint">MP4 · MOV · WebM</p>
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
                        <li key={c.id} className="clip-item">
                          <span className="clip-index">{i + 1}</span>
                          <div className="clip-info">
                            <span className="clip-name" title={c.name}>
                              {c.name}
                            </span>
                            <span className="clip-meta">
                              {c.width ? `${c.width}×${c.height} · ` : ''}
                              {formatDuration(c.trimEnd - c.trimStart)}
                              {c.trimStart > 0.05 || c.trimEnd < c.duration - 0.05
                                ? ` (de ${formatDuration(c.duration)})`
                                : ''}
                            </span>

                            {trimmingId === c.id && (
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
                              title="Escolher o trecho deste clipe"
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
                    + Adicionar vídeos
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
                        <span className="model-tags">
                          <span className="model-tag">
                            {FILTERS.find((f) => f.id === m.filter)?.label ?? m.filter}
                          </span>
                          <span className="model-tag">
                            {TRANSITIONS.find((t) => t.id === m.transition)?.label}{' '}
                            {m.transitionDuration.toFixed(1)}s
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>

                  <h4 className="lib-heading">Transição entre clipes</h4>
                  <div className="chip-row">
                    <button
                      type="button"
                      className={`chip${customTransition === null ? ' chip--on' : ''}`}
                      onClick={() => setCustomTransition(null)}
                      title="Usa a transição do modelo escolhido"
                    >
                      Automática
                    </button>
                    {TRANSITIONS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`chip${customTransition === t.id ? ' chip--on' : ''}`}
                        title={t.hint}
                        onClick={() => setCustomTransition(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <label className="field field--block">
                    <span>
                      Duração da transição —{' '}
                      {currentTransitionDuration.toFixed(1).replace('.', ',')}s
                    </span>
                    <input
                      type="range"
                      min={0.2}
                      max={1.5}
                      step={0.1}
                      value={currentTransitionDuration}
                      onChange={(e) =>
                        setCustomTransitionDuration(Number(e.target.value))
                      }
                    />
                  </label>
                  <p className="form-hint">
                    A transição aparece <strong>entre cada clipe</strong> na
                    timeline. O modelo já vem com filtro + legenda prontos — a
                    transição escolhida aqui sobrescreve a dele.
                  </p>
                </>
              ) : (
                <>
                  <h4 className="lib-heading">Filtro de cor</h4>
                  <div className="chip-row" role="radiogroup" aria-label="Filtro de cor">
                    {FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        role="radio"
                        aria-checked={filter === f.id}
                        className={`chip${filter === f.id ? ' chip--on' : ''}`}
                        onClick={() => setFilter(f.id)}
                      >
                        {f.label}
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
          {libTab === 'audio' && (
            <>
              <h4 className="lib-heading">Trilha sonora</h4>
              <input
                ref={musicInputRef}
                type="file"
                accept="audio/*"
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
                    Ou arraste o <strong>handle branco</strong> direto na forma de
                    onda da timeline (embaixo). Tudo antes dele é pulado.
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

        {/* Inputs sempre montados (fora das abas) */}
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mp4,.mov,.webm,.m4v,.mkv"
          multiple={mode === 'montage'}
          hidden
          onChange={(e) => {
            if (mode === 'montage') void addClips(e.target.files);
            else void pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={addInputRef}
          type="file"
          accept="video/*,.mp4,.mov,.webm,.m4v,.mkv"
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
        {/* ---------- HERO (vazio) ---------- */}
        {phase === 'idle' && (
          <div className="hero">
            <img className="hero-icon" src="./icon.svg" alt="" width={96} height={96} />
            <h2>Transforme vídeos em Stories e Reels</h2>
            <p>
              Legendas automáticas, filtros, transições, trilha com batidas —
              tudo 100% no seu aparelho.
            </p>
            <button
              className="btn-export btn-export--big"
              onClick={() => inputRef.current?.click()}
            >
              Escolher vídeos
            </button>
          </div>
        )}

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
              />
            </div>
            <div className="preview-controls">
              <button className="btn btn--tiny" onClick={togglePlay}>
                {playing ? '⏸ Pausar' : '▶ Reproduzir'}
              </button>
              <span className="preview-time">
                {formatDuration(singleTime)} / {formatDuration(info?.duration ?? 0)}
              </span>
              <span className="preview-hint">arraste na timeline para navegar</span>
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
                transição: {TRANSITIONS.find((t) => t.id === currentTransition)?.label}
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
          </>
        )}

        {/* ---------- ERRO ---------- */}
        {phase === 'error' && error && (
          <div className="error-box">
            <h3>Não deu certo 😕</h3>
            <p>{error}</p>
            <button className="btn-export" onClick={reset}>
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
              ['legenda', 'Legenda'],
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
                    onChange={(e) =>
                      setAdjust({ ...adjust, [key]: Number(e.target.value) })
                    }
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

        {/* ---------- LEGENDA ---------- */}
        {inspTab === 'legenda' && (
          <div className="inspector-section">
            <h4>Legenda automática</h4>
            <label className="field field--block">
              <span>Texto principal</span>
              <textarea
                rows={2}
                value={caption.title}
                placeholder="Ex.: A moto dos sonhos"
                onChange={(e) => setCaption({ ...caption, title: e.target.value })}
              />
            </label>
            <label className="field field--block">
              <span>Subtítulo</span>
              <input
                type="text"
                value={caption.subtitle}
                placeholder="Opcional — detalhe ou chamada"
                onChange={(e) => setCaption({ ...caption, subtitle: e.target.value })}
              />
            </label>
            <div className="form-grid-2">
              <label className="field">
                <span>Posição</span>
                <select
                  value={caption.position}
                  onChange={(e) =>
                    setCaption({
                      ...caption,
                      position: e.target.value as CaptionOptions['position'],
                    })
                  }
                >
                  {POSITION_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Fonte</span>
                <select
                  value={caption.font}
                  onChange={(e) =>
                    setCaption({
                      ...caption,
                      font: e.target.value as CaptionOptions['font'],
                    })
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
                  value={caption.color}
                  onChange={(e) =>
                    setCaption({
                      ...caption,
                      color: e.target.value as CaptionOptions['color'],
                    })
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
                  value={caption.align}
                  onChange={(e) =>
                    setCaption({
                      ...caption,
                      align: e.target.value as CaptionOptions['align'],
                    })
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
                  value={caption.effect}
                  onChange={(e) =>
                    setCaption({
                      ...caption,
                      effect: e.target.value as CaptionOptions['effect'],
                    })
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
                  value={caption.anim}
                  onChange={(e) =>
                    setCaption({
                      ...caption,
                      anim: e.target.value as CaptionOptions['anim'],
                    })
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
                checked={caption.uppercase}
                onChange={(e) => setCaption({ ...caption, uppercase: e.target.checked })}
              />
              Caixa alta
            </label>

            {EFFECTS_WITH_COLOR.includes(caption.effect) && (
              <div className="swatch-group">
                <span className="swatch-label">Cor do efeito</span>
                <div className="swatches">
                  {EFFECT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`swatch${caption.effectColor === c ? ' swatch--on' : ''}`}
                      style={{ background: c }}
                      aria-label={`Cor ${c}`}
                      onClick={() => setCaption({ ...caption, effectColor: c })}
                    />
                  ))}
                </div>
              </div>
            )}
            <p className="form-hint">
              O texto entra só na área livre entre o vídeo e as{' '}
              <strong>zonas seguras</strong> — e a cor é escolhida pelo contraste
              com o fundo de verdade.
            </p>
          </div>
        )}

        {/* ---------- SAÍDA ---------- */}
        {inspTab === 'saida' && (
          <div className="inspector-section">
            <h4>Proporção de saída</h4>
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
                      setExtraRatios(
                        on
                          ? extraRatios.filter((x) => x !== r.id)
                          : [...extraRatios, r.id],
                      )
                    }
                  >
                    {r.label} · {r.hint}
                  </button>
                );
              })}
            </div>
            <p className="form-hint">
              Principal sempre em{' '}
              <strong>
                9:16 ({OUT_WIDTH}×{OUT_HEIGHT})
              </strong>
              . Cada proporção extra vira mais um MP4/H.264 gerado com a mesma
              timeline.
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
          <span className="tl-time">
            {formatDuration(videoCurrent)} / {formatDuration(videoTotal)}
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

          <span className="tl-hint">
            {mode === 'montage'
              ? 'clique na régua para navegar · arraste o handle na música para escolher o início'
              : 'clique na régua para navegar'}
          </span>
        </div>

        <div className="timeline-tracks">
          {/* Régua + trilha de vídeo (mesma escala) */}
          <div
            className="tl-stack"
            onClick={(e) => seekFromEvent(e, videoTotal)}
            role="presentation"
          >
            <div className="tl-ruler">
              {rulerTicks.map((t) => (
                <span key={t} className="tl-tick" style={{ left: `${videoTotal > 0 ? (t / videoTotal) * 100 : 0}%` }}>
                  <i />
                  {formatDuration(t)}
                </span>
              ))}
            </div>

            <div className="tl-track tl-track--video">
              {mode === 'montage' && clips.length > 0 ? (
                clips.map((c, i) => {
                  const w =
                    (Math.max(0.1, c.trimEnd - c.trimStart) /
                      Math.max(0.1, totalClipDuration)) *
                    100;
                  return (
                    <div
                      key={c.id}
                      className="tl-clip"
                      style={{ width: `${w}%` }}
                      title={`${i + 1}. ${c.name} — ${formatDuration(c.trimEnd - c.trimStart)}`}
                    >
                      <span className="tl-clip-idx">{i + 1}</span>
                      <span className="tl-clip-name">{c.name}</span>
                      {i < clips.length - 1 && (
                        <span
                          className="tl-clip-transition"
                          title={TRANSITIONS.find((t) => t.id === currentTransition)?.label}
                        />
                      )}
                    </div>
                  );
                })
              ) : mode === 'single' && info ? (
                <div
                  className="tl-clip tl-clip--single"
                  style={{
                    width: `${Math.max(2, playheadPct)}%`,
                    maxWidth: '100%',
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

              {/* Batidas da música destacadas na trilha (Etapa 12) */}
              {mode === 'montage' &&
                timelineBeats.map((t, i) => (
                  <span
                    key={`beat-${i}`}
                    className="tl-beat"
                    style={{ left: `${(t / Math.max(0.1, montageDuration)) * 100}%` }}
                    title={`Batida em ${formatDuration(t)}`}
                  />
                ))}
            </div>

            <div className="tl-playhead" style={{ left: `${playheadPct}%` }} />
          </div>

          {/* Trilha de música: forma de onda + batidas + handle do início */}
          <div className="tl-track tl-track--music">
            <canvas
              ref={musicCanvasRef}
              className="tl-music-canvas"
              onPointerDown={(e) => {
                if (!musicAnalysis) return;
                musicDraggingRef.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                offsetFromEvent(e);
              }}
              onPointerMove={(e) => {
                if (musicDraggingRef.current) offsetFromEvent(e);
              }}
              onPointerUp={() => {
                musicDraggingRef.current = false;
              }}
              onPointerCancel={() => {
                musicDraggingRef.current = false;
              }}
              style={{ cursor: musicAnalysis ? 'ew-resize' : 'default' }}
            />
          </div>
        </div>
      </footer>
    </div>
  );
}
