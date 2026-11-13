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
import { DEFAULT_MODEL, MODELS, assembleMontage, probeClip, type MontageClip } from './lib/montage';
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  startLivePreview,
  startMontagePreview,
  type MontagePreview,
} from './lib/preview';
import { toHorizontal, toVertical } from './lib/toVertical';

type Phase = 'idle' | 'ready' | 'working' | 'done' | 'error';
type Mode = 'single' | 'montage';
type Stage = 'vertical' | 'output' | 'montage';

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
  const [caption, setCaption] = useState<CaptionOptions>(DEFAULT_CAPTION);
  const [filter, setFilter] = useState<FilterId>('none');
  const [playing, setPlaying] = useState(false);
  const [stage, setStage] = useState<Stage>('vertical');
  // ---- saídas extras / proporções (Etapa 10)
  const [extraRatios, setExtraRatios] = useState<RatioId[]>(['16:9']);
  const [outputs, setOutputs] = useState<ExtraOutput[]>([]);
  const [step, setStep] = useState(1);
  const [steps, setSteps] = useState(1);
  // ---- ajustes finos de imagem (Etapa 10)
  const [adjust, setAdjust] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);

  // ---- montagem (Etapa 6)
  const [clips, setClips] = useState<ClipInfo[]>([]);
  const [modelId, setModelId] = useState(DEFAULT_MODEL.id);
  const [trimmingId, setTrimmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [montageTime, setMontageTime] = useState(0);
  const [montageDuration, setMontageDuration] = useState(0);
  const [montagePlaying, setMontagePlaying] = useState(true);

  // ---- trilha sonora (Etapa 8)
  const [music, setMusic] = useState<File | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.7);

  const inputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const resultVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const montageCanvasRef = useRef<HTMLCanvasElement>(null);
  const musicAudioRef = useRef<HTMLAudioElement>(null);
  const montagePreviewRef = useRef<MontagePreview | null>(null);
  const timeTickRef = useRef(0);

  // URL da música pra prévia (recriada só quando o arquivo muda).
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
  // Memoizado: sem isso viraria objeto novo a cada render (10×/s pela barra de
  // tempo) e o efeito de atualização da prévia rodaria sem parar.
  const montageCaption = useMemo(
    () => (hasCaptionText(caption) ? { ...caption, ...model.caption } : undefined),
    [caption, model],
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
        transition: model.transition,
        transitionDuration: model.transitionDuration,
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
            const expected = t % audio.duration;
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

  // Troca quente de modelo/legenda/ajustes na prévia da montagem.
  useEffect(() => {
    const api = montagePreviewRef.current;
    if (!api) return;
    void api.update({
      transition: model.transition,
      transitionDuration: model.transitionDuration,
      filter: model.filter,
      caption: montageCaption,
      adjust,
      guides: true,
    });
  }, [model, montageCaption, adjust]);

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
      // Autoplay bloqueado destrava na primeira interção do usuário.
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, [musicUrl, musicVolume, montagePlaying, phase, mode, clips]);

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
      audio.currentTime = time % audio.duration;
    }
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
        const info = ratioInfo(extraRatios[i]);
        setStage('output');
        setStep(i + 2);
        setProgress(0);
        setProgressLabel(
          `Etapa ${i + 2} de ${totalSteps} · Gerando ${info.label} (${info.hint})…`,
        );
        try {
          const out =
            info.single === 'transmux'
              ? await toHorizontal(file, setProgress)
              : await toVertical(file, setProgress, cap, filter, {
                  layout: info.layout,
                  adjust,
                });
          allWarnings.push(...out.warnings);
          made.push({
            ratio: info.id,
            url: URL.createObjectURL(out.blob),
            size: out.blob.size,
          });
        } catch (e) {
          allWarnings.push(
            `A saída ${info.label} não foi gerada (${
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
      totalSteps > 1 ? 'Etapa 1 de ' + totalSteps + ' · Preparando os clipes…' : 'Preparando os clipes…',
    );
    setError(null);
    setWarnings([]);
    setOutputs([]);

    const base = {
      clips: toMontageClips(clips),
      transition: model.transition,
      transitionDuration: model.transitionDuration,
      filter: model.filter,
      caption: montageCaption,
      adjust,
      music,
      musicVolume,
    };
    const prefix = totalSteps > 1 ? `Etapa 1 de ${totalSteps} · ` : '';

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
        const info = ratioInfo(extraRatios[i]);
        setStage('output');
        setStep(i + 2);
        setProgress(0);
        setProgressLabel(
          `Etapa ${i + 2} de ${totalSteps} · Gerando ${info.label} (${info.hint})…`,
        );
        try {
          const extra = await assembleMontage({
            ...base,
            ratio: info.id,
            onProgress: (p, label) => {
              setProgress(p);
              setProgressLabel(`Etapa ${i + 2} de ${totalSteps} · ${label}`);
            },
          });
          allWarnings.push(...extra.warnings);
          made.push({
            ratio: info.id,
            url: URL.createObjectURL(extra.blob),
            size: extra.blob.size,
          });
        } catch (e) {
          // A principal 9:16 continua boa: só avisa que esta saída não saiu.
          allWarnings.push(
            `A saída ${info.label} falhou (${
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
    model,
    montageCaption,
    adjust,
    music,
    musicVolume,
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

  const working = phase === 'working';
  const montageReady = phase === 'ready' && mode === 'montage';

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">◧</span>
          {phase !== 'idle' && (
            <button className="btn btn--ghost btn--back" onClick={reset}>
              ← Voltar
            </button>
          )}
          <div>
            <h1>Estúdio</h1>
            <p className="tagline">
              Vídeo horizontal → vertical e montagem automática
            </p>
          </div>
        </div>
        <span className="badge-local" title="Seu vídeo nunca sai deste dispositivo">
          🔒 100% no seu aparelho
        </span>
      </header>

      <main className="main">
        {/* ---------- ESCOLHER VÍDEO(S) ---------- */}
        {(phase === 'idle' || phase === 'error') && (
          <>
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
                🎞 Vídeo único
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
                🧩 Montagem (vários clipes)
              </button>
            </div>

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
              <h2>
                {mode === 'montage'
                  ? 'Escolha os vídeos da montagem'
                  : 'Escolha um vídeo horizontal'}
              </h2>
              <p>
                {mode === 'montage'
                  ? 'Arraste um ou mais vídeos — a ordem da lista vira a ordem da montagem'
                  : 'Arraste aqui ou toque para selecionar'}
              </p>
              <p className="dropzone-hint">MP4 · MOV · WebM</p>
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
            </section>
          </>
        )}

        {/* ---------- VÍDEO ÚNICO: revisar e converter ---------- */}
        {phase === 'ready' && mode === 'single' && file && (
          <section className="panel">
            <div className="preview-grid">
              <div className="preview-card">
                <h3>Vídeo original</h3>
                <div className="video-frame video-frame--landscape">
                  <video
                    ref={previewRef}
                    src={previewUrl ?? undefined}
                    controls
                    muted
                    loop
                    playsInline
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                </div>
                {info && (
                  <dl className="meta">
                    <div>
                      <dt>Arquivo</dt>
                      <dd title={info.name}>{info.name}</dd>
                    </div>
                    <div>
                      <dt>Resolução</dt>
                      <dd>{info.width ? `${info.width}×${info.height}` : '—'}</dd>
                    </div>
                    <div>
                      <dt>Duração</dt>
                      <dd>{formatDuration(info.duration)}</dd>
                    </div>
                    <div>
                      <dt>Tamanho</dt>
                      <dd>{formatBytes(info.size)}</dd>
                    </div>
                  </dl>
                )}
              </div>

              <div className="preview-card preview-card--target">
                <h3>Saída — prévia ao vivo</h3>
                <div className="video-frame video-frame--portrait">
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
                  <span className="preview-hint">
                    arraste no original pra mudar o momento
                  </span>
                </div>
                <p className="target-note">
                  O mesmo compositor do arquivo: fundo borrado + vídeo nítido +
                  legenda. Linhas tracejadas = zonas seguras (só na prévia).
                </p>
              </div>
            </div>

            {/* ---------- ETAPA 5: filtros ---------- */}
            <section className="panel panel--form">
              <h3>Filtro</h3>
              <div className="filter-row" role="radiogroup" aria-label="Filtro de cor">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={filter === f.id}
                    className={`filter-chip${filter === f.id ? ' filter-chip--on' : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <p className="form-hint">
                Aplicado ao <strong>vídeo e ao fundo borrado</strong> — a legenda
                fica de fora pra continuar nítida. Válido na prévia e no arquivo.
              </p>
            </section>

            {/* ---------- ETAPA 10: ajustes finos ---------- */}
            <section className="panel panel--form">
              <h3>Ajustes de imagem</h3>
              <div className="adjust-grid">
                {(
                  [
                    ['brightness', 'Brilho', 0.6, 1.5, 0.02],
                    ['contrast', 'Contraste', 0.6, 1.6, 0.02],
                    ['saturate', 'Saturação', 0, 2, 0.02],
                    ['warmth', 'Calor', -1, 1, 0.05],
                  ] as const
                ).map(([key, label, min, max, step]) => (
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
                      step={step}
                      value={adjust[key]}
                      onChange={(e) =>
                        setAdjust({ ...adjust, [key]: Number(e.target.value) })
                      }
                      aria-label={label}
                    />
                  </label>
                ))}
              </div>
              <div className="style-row">
                <button
                  type="button"
                  className="btn btn--tiny"
                  onClick={() => setAdjust(DEFAULT_ADJUSTMENTS)}
                >
                  ↺ Redefinir ajustes
                </button>
                <p className="form-hint form-hint--tight">
                  Somam ao filtro escolhido. Tudo no seu dispositivo, no mesmo
                  quadro da prévia.
                </p>
              </div>
            </section>

            {/* ---------- ETAPA 2: legenda automática ---------- */}
            <section className="panel panel--form">
              <h3>Legenda automática (opcional)</h3>
              <div className="form-grid">
                <label className="field field--wide">
                  <span>Texto principal</span>
                  <textarea
                    rows={2}
                    value={caption.title}
                    placeholder="Ex.: A moto dos sonhos"
                    onChange={(e) => setCaption({ ...caption, title: e.target.value })}
                  />
                </label>
                <label className="field field--wide">
                  <span>Subtítulo</span>
                  <input
                    type="text"
                    value={caption.subtitle}
                    placeholder="Opcional — detalhe, crédito ou chamada"
                    onChange={(e) => setCaption({ ...caption, subtitle: e.target.value })}
                  />
                </label>
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
                  <span>Animação de entrada</span>
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

              <div className="style-row">
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
                          className={`swatch${
                            caption.effectColor === c ? ' swatch--on' : ''
                          }`}
                          style={{ background: c }}
                          aria-label={`Cor ${c}`}
                          onClick={() => setCaption({ ...caption, effectColor: c })}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <p className="form-hint">
                O texto entra só na área livre entre o vídeo e as{' '}
                <strong>zonas seguras</strong> (250px no topo, 350px na base) — e a
                cor é escolhida pelo contraste com o fundo de verdade.
              </p>
            </section>

            <div className="options-row">
              <div className="ratio-block">
                <span className="ratio-label">Gerar também (opcional)</span>
                <div className="ratio-row" role="group" aria-label="Proporções extras">
                  {EXTRA_RATIOS.map((r) => {
                    const on = extraRatios.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={on}
                        className={`ratio-chip${on ? ' ratio-chip--on' : ''}`}
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
              </div>
              <p className="form-hint form-hint--tight">
                Cada proporção vira mais um MP4/H.264. A 16:9 costuma ser só
                troca de envelope (sem recomprimir); 1:1 e 4:5 são renderizados
                com fundo borrado e legenda, como o 9:16.
              </p>
            </div>

            <div className="actions">
              <button className="btn btn--ghost" onClick={reset}>
                Trocar vídeo
              </button>
              <button className="btn btn--primary" onClick={convert}>
                {extraRatios.length > 0
                  ? `Gerar ${1 + extraRatios.length} saídas →`
                  : 'Gerar versão vertical →'}
              </button>
            </div>
          </section>
        )}

        {/* ---------- ETAPA 6: montagem multi-clipe ---------- */}
        {montageReady && (
          <section className="panel">
            <div className="preview-grid">
              <div className="preview-card">
                <h3>Clipes da montagem ({clips.length})</h3>
                {notice && <p className="notice">⚠️ {notice}</p>}
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
                            {' · '}
                            {formatBytes(c.size)}
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
                            className={`btn btn--tiny${
                              trimmingId === c.id ? ' btn--on' : ''
                            }`}
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
                <div className="actions">
                  <button
                    className="btn btn--ghost"
                    onClick={() => addInputRef.current?.click()}
                  >
                    + Adicionar vídeos
                  </button>
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
                </div>
              </div>

              <div className="preview-card preview-card--target">
                <h3>Prévia da montagem</h3>
                {/* Trilha sonora da prévia (mesma do arquivo final). */}
                <audio ref={musicAudioRef} loop hidden />
                <div className="video-frame video-frame--portrait">
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
                  <input
                    className="seek"
                    type="range"
                    min={0}
                    max={Math.max(montageDuration, 0.1)}
                    step={0.05}
                    value={Math.min(montageTime, montageDuration)}
                    onChange={(e) => seekMontage(Number(e.target.value))}
                    aria-label="Posição da montagem"
                  />
                  <span className="preview-hint">
                    {formatDuration(montageTime)} / {formatDuration(montageDuration)}
                  </span>
                </div>
                <p className="target-note">
                  O mesmo motor do arquivo final: transições, filtro e legenda do
                  modelo escolhido. Linhas tracejadas = zonas seguras (só na
                  prévia).
                </p>
              </div>
            </div>

            {/* Modelos: filtro + transição + estilo de legenda */}
            <section className="panel panel--form">
              <h3>Modelo da montagem</h3>
              <div className="model-row" role="radiogroup" aria-label="Modelo da montagem">
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
                        {m.transition === 'crossfade'
                          ? 'Fusão'
                          : m.transition === 'wipe'
                            ? 'Varredura'
                            : 'Flash'}{' '}
                        {m.transitionDuration.toFixed(1)}s
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="form-hint">
                O modelo aplica <strong>filtro + transição + estilo de legenda</strong>{' '}
                de uma vez. O texto é o mesmo dos campos abaixo — trocar de modelo
                atualiza a prévia na hora.
              </p>
            </section>

            {/* Trilha sonora (Etapa 8): mixada com o áudio dos clipes */}
            <section className="panel panel--form">
              <h3>Trilha sonora (opcional)</h3>
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
                  className="btn btn--ghost"
                  onClick={() => musicInputRef.current?.click()}
                >
                  {music ? ' Trocar música' : '🎵 Escolher música'}
                </button>
                {music && (
                  <>
                    <span className="music-name" title={music.name}>
                      {music.name}
                    </span>
                    <button
                      type="button"
                      className="btn btn--tiny"
                      onClick={() => setMusic(null)}
                      aria-label="Remover a música"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
              {music && (
                <label className="field field--wide">
                  <span>
                    Volume da música — {Math.round(musicVolume * 100)}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={musicVolume}
                    onChange={(e) => setMusicVolume(Number(e.target.value))}
                    aria-label="Volume da música"
                  />
                </label>
              )}
              <p className="form-hint">
                A música entra <strong>por cima</strong> do áudio dos clipes, com
                loop automático se for mais curta que a montagem e volume que
                você controla. A mixagem inteira acontece no seu dispositivo —
                o arquivo de música nunca sai daqui.
              </p>
            </section>

            {/* Legenda (texto compartilhado; o modelo cuida do estilo) */}
            <section className="panel panel--form">
              <h3>Legenda automática (opcional)</h3>
              <div className="form-grid">
                <label className="field field--wide">
                  <span>Texto principal</span>
                  <textarea
                    rows={2}
                    value={caption.title}
                    placeholder="Ex.: Bastidores do projeto"
                    onChange={(e) => setCaption({ ...caption, title: e.target.value })}
                  />
                </label>
                <label className="field field--wide">
                  <span>Subtítulo</span>
                  <input
                    type="text"
                    value={caption.subtitle}
                    placeholder="Opcional — detalhe, crédito ou chamada"
                    onChange={(e) => setCaption({ ...caption, subtitle: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Animação de entrada</span>
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
              <p className="form-hint">
                A legenda entra uma vez, no começo da montagem (0,5s). Fonte,
                efeito e cores vêm do modelo; o texto só vai na área livre,
                respeitando as <strong>zonas seguras</strong>.
              </p>
            </section>

            {/* Ajustes finos (Etapa 10) */}
            <section className="panel panel--form">
              <h3>Ajustes de imagem</h3>
              <div className="adjust-grid">
                {(
                  [
                    ['brightness', 'Brilho', 0.6, 1.5, 0.02],
                    ['contrast', 'Contraste', 0.6, 1.6, 0.02],
                    ['saturate', 'Saturação', 0, 2, 0.02],
                    ['warmth', 'Calor', -1, 1, 0.05],
                  ] as const
                ).map(([key, label, min, max, step]) => (
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
                      step={step}
                      value={adjust[key]}
                      onChange={(e) =>
                        setAdjust({ ...adjust, [key]: Number(e.target.value) })
                      }
                      aria-label={label}
                    />
                  </label>
                ))}
              </div>
              <div className="style-row">
                <button
                  type="button"
                  className="btn btn--tiny"
                  onClick={() => setAdjust(DEFAULT_ADJUSTMENTS)}
                >
                  ↺ Redefinir ajustes
                </button>
                <p className="form-hint form-hint--tight">
                  Somam ao filtro do modelo na prévia e em todas as saídas.
                </p>
              </div>
            </section>

            {/* Proporções extras (Etapa 10 — inspirado no "Ratio" do CapCut) */}
            <div className="options-row">
              <div className="ratio-block">
                <span className="ratio-label">Gerar também (opcional)</span>
                <div className="ratio-row" role="group" aria-label="Proporções extras">
                  {EXTRA_RATIOS.map((r) => {
                    const on = extraRatios.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={on}
                        className={`ratio-chip${on ? ' ratio-chip--on' : ''}`}
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
              </div>
              <p className="form-hint">
                Cada proporção é <strong>renderizada de novo</strong> com a
                mesma timeline, transições, legenda e ajustes — só muda a
                geometria (1920×1080, 1080×1080 ou 1080×1350).
              </p>
            </div>

            <div className="actions">
              <button className="btn btn--ghost" onClick={reset}>
                Trocar clipes
              </button>
              <button
                className="btn btn--primary"
                onClick={generateMontage}
                disabled={clips.length === 0}
              >
                {clips.length === 0
                  ? 'Adicione vídeos primeiro'
                  : extraRatios.length > 0
                    ? `Gerar ${1 + extraRatios.length} saídas (${clips.length} clipes) →`
                    : `Gerar montagem (${clips.length} clipes) →`}
              </button>
            </div>
          </section>
        )}

        {/* ---------- PROCESSANDO ---------- */}
        {working && (
          <section className="panel panel--center">
            <div className="spinner" aria-hidden />
            <h2>
              {stage === 'montage'
                ? 'Montando seus clipes…'
                : stage === 'vertical'
                  ? 'Gerando a versão 9:16…'
                  : progressLabel || 'Gerando as proporções extras…'}
            </h2>
            <p className="muted">
              {stage === 'montage'
                ? 'Renderizando quadro a quadro com as transições do modelo e juntando o áudio.'
                : stage === 'vertical'
                  ? 'Montando o 9:16 com fundo borrado e legenda, frame a frame.'
                  : 'Mesmo pipeline do 9:16 — fundo borrado, vídeo contido, legenda e ajustes — numa geometria diferente.'}
            </p>
            <p className="progress-step">
              {progressLabel ||
                (steps > 1
                  ? `Etapa ${step} de ${steps}`
                  : 'Processando no seu dispositivo')}
            </p>
            <div className="progress">
              <div
                className="progress-bar"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="progress-label">{Math.round(progress * 100)}%</p>
          </section>
        )}

        {/* ---------- RESULTADO ---------- */}
        {phase === 'done' && resultUrl && (
          <section className="panel">
            <div className="preview-grid">
              <div className="preview-card preview-card--target">
                <h3>{mode === 'montage' ? 'Montagem ✅' : 'Vídeo vertical ✅'}</h3>
                <div className="video-frame video-frame--portrait">
                  <video
                    ref={resultVideoRef}
                    src={resultUrl}
                    controls
                    autoPlay
                    loop
                    playsInline
                  />
                </div>
                <dl className="meta">
                  <div>
                    <dt>Resolução</dt>
                    <dd>
                      {OUT_WIDTH}×{OUT_HEIGHT}
                    </dd>
                  </div>
                  {mode === 'montage' && (
                    <div>
                      <dt>Duração</dt>
                      <dd>{formatDuration(resultDuration)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Tamanho</dt>
                    <dd>{formatBytes(resultSize)}</dd>
                  </div>
                </dl>
              </div>

              <div className="preview-card">
                <h3>Pronto!</h3>

                {outputs.length > 0 && (
                  <div className="horizontal-block">
                    <h4>
                      Outras proporções ({outputs.length}) — geradas com o
                      mesmo pipeline
                    </h4>
                    {outputs.map((o) => {
                      const info = ratioInfo(o.ratio);
                      return (
                        <div key={o.ratio} className="extra-output">
                          <div
                            className="video-frame"
                            style={{
                              width:
                                info.width >= info.height ? '100%' : '240px',
                              aspectRatio: `${info.width} / ${info.height}`,
                              margin: '0 auto',
                            }}
                          >
                            <video src={o.url} controls />
                          </div>
                          <dl className="meta">
                            <div>
                              <dt>
                                {info.label} · {info.hint}
                              </dt>
                              <dd>
                                {info.width}×{info.height} · {formatBytes(o.size)}
                              </dd>
                            </div>
                          </dl>
                          <a
                            className="btn btn--tiny"
                            href={o.url}
                            download={`${
                              mode === 'montage' ? 'montagem' : 'video'
                            }-${info.label.replace(':', 'x')}-${Date.now()}.mp4`}
                          >
                            ⬇️ Baixar {info.label}
                          </a>
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="muted">
                  Tudo em MP4/H.264 — o formato que o YouTube, o Instagram e
                  qualquer player abrem.
                </p>
                {warnings.length > 0 && (
                  <ul className="warnings">
                    {warnings.map((w) => (
                      <li key={w}>⚠️ {w}</li>
                    ))}
                  </ul>
                )}
                <div className="actions actions--column">
                  <a
                    className="btn btn--primary"
                    href={resultUrl}
                    download={`${
                      mode === 'montage' ? 'montagem' : 'vertical'
                    }-${Date.now()}.mp4`}
                  >
                    ⬇️{' '}
                    {mode === 'montage'
                      ? 'Baixar montagem (Stories/Reels)'
                      : 'Baixar vertical (Stories/Reels)'}
                  </a>
                  <button className="btn btn--ghost" onClick={downloadCover}>
                    🖼️ Baixar capa (PNG)
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={() => {
                      if (mode === 'montage') {
                        // Volta pra editar os clipes, mantendo a lista
                        setResultUrl(null);
                        setPhase('ready');
                      } else {
                        reset();
                      }
                    }}
                  >
                    {mode === 'montage' ? 'Voltar e editar' : 'Processar outro vídeo'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ---------- ERRO ---------- */}
        {phase === 'error' && error && (
          <section className="panel panel--center">
            <div className="error-box">
              <h2>Não deu certo 😕</h2>
              <p>{error}</p>
              <button className="btn btn--primary" onClick={reset}>
                Tentar de novo
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>
          Etapa 6–10 do estudo — montagem multi-clipe com 3 modelos, trilha
          sonora, proporções 9:16 / 16:9 / 1:1 / 4:5, ajustes de imagem,
          animação de legenda e capa PNG.
        </p>
      </footer>
    </div>
  );
}
