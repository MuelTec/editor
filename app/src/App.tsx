import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type Transition = 'none' | 'fade';
type Anim = 'none' | 'zoom-in' | 'zoom-out';
type LibTab = 'audio' | 'texto' | 'efeitos' | 'transicoes';
type InspTab = 'video' | 'animacao' | 'ajuste';

interface Clip {
  id: string;
  name: string;
  url: string;
  duration: number;
  scale: number;
  brightness: number;
  contrast: number;
  saturation: number;
  transition: Transition;
  anim: Anim;
}
interface AudioTrack {
  name: string;
  url: string;
  duration: number;
}
interface TextClip {
  id: string;
  text: string;
  start: number;
  duration: number;
}

const PPS = 40; // pixels por segundo na timeline
const LABEL_W = 70; // largura do nome da trilha

const uid = () => Math.random().toString(36).slice(2, 9);

const fmt = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function readDuration(url: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve(isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => resolve(0);
    el.src = url;
  });
}

const btnStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  marginBottom: 8,
  borderRadius: 6,
  border: '1px solid #475569',
  background: '#1e293b',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'center',
};

const smallBtn: CSSProperties = {
  padding: '4px 10px',
  marginRight: 6,
  borderRadius: 4,
  border: '1px solid #475569',
  background: '#1e293b',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
};

const laneStyle = (width: number): CSSProperties => ({
  position: 'relative',
  display: 'inline-block',
  width,
  height: 32,
  verticalAlign: 'middle',
});

const PRESETS = [
  { name: 'Normal', b: 100, c: 100, s: 100 },
  { name: 'Preto e branco', b: 100, c: 110, s: 0 },
  { name: 'Vívido', b: 105, c: 110, s: 150 },
  { name: 'Escuro', b: 80, c: 120, s: 100 },
  { name: 'Claro', b: 120, c: 95, s: 105 },
];

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label className="label-small">
        {props.label}: {props.value}%
      </label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

export default function App() {
  const [libTab, setLibTab] = useState<LibTab>('audio');
  const [inspTab, setInspTab] = useState<InspTab>('video');
  const [clips, setClips] = useState<Clip[]>([]);
  const [audio, setAudio] = useState<AudioTrack | null>(null);
  const [texts, setTexts] = useState<TextClip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newText, setNewText] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0); // tempo global em segundos

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const seekLocal = useRef(0);

  // ---------- derivados ----------
  const starts = useMemo(() => {
    let acc = 0;
    return clips.map((c) => {
      const s = acc;
      acc += c.duration;
      return s;
    });
  }, [clips]);
  const total = clips.reduce((a, c) => a + c.duration, 0);

  const indexAt = (t: number) => {
    let idx = 0;
    for (let i = 0; i < starts.length; i++) if (t >= starts[i]) idx = i;
    return idx;
  };
  const activeIndex = clips.length ? indexAt(time) : -1;
  const active = activeIndex >= 0 ? clips[activeIndex] : null;
  const selected = clips.find((c) => c.id === selectedId) ?? null;
  const localTime = active ? time - starts[activeIndex] : 0;

  // ---------- play / pause ----------
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (playing) {
      v?.play().catch(() => setPlaying(false));
      a?.play().catch(() => {});
    } else {
      v?.pause();
      a?.pause();
    }
  }, [playing, active?.id, audio?.url]);

  const seek = (t: number) => {
    const clamped = Math.min(Math.max(0, t), total);
    const idx = indexAt(clamped);
    const local = clamped - (starts[idx] ?? 0);
    if (idx === activeIndex && videoRef.current) {
      videoRef.current.currentTime = local;
    } else {
      seekLocal.current = local;
    }
    setTime(clamped);
    if (audioRef.current) audioRef.current.currentTime = clamped;
  };

  const togglePlay = () => {
    if (!clips.length) return;
    if (!playing && time >= total - 0.05) seek(0);
    setPlaying((p) => !p);
  };

  // ---------- importação ----------
  const addVideos = async (files: FileList | null) => {
    if (!files) return;
    const novos: Clip[] = [];
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      const duration = await readDuration(url, 'video');
      if (duration <= 0) {
        URL.revokeObjectURL(url);
        continue;
      }
      novos.push({
        id: uid(),
        name: f.name,
        url,
        duration,
        scale: 100,
        brightness: 100,
        contrast: 100,
        saturation: 100,
        transition: 'none',
        anim: 'none',
      });
    }
    if (!novos.length) return;
    setClips((prev) => [...prev, ...novos]);
    setSelectedId(novos[0].id);
  };

  const addAudio = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (audio) URL.revokeObjectURL(audio.url);
    const url = URL.createObjectURL(f);
    const duration = await readDuration(url, 'audio');
    setAudio({ name: f.name, url, duration });
  };

  const removeAudio = () => {
    if (audio) URL.revokeObjectURL(audio.url);
    setAudio(null);
  };

  // ---------- edição ----------
  const updateSelected = (patch: Partial<Clip>) =>
    setClips((prev) => prev.map((c) => (c.id === selectedId ? { ...c, ...patch } : c)));

  const removeSelected = () => {
    if (!selected) return;
    URL.revokeObjectURL(selected.url);
    setClips((prev) => prev.filter((c) => c.id !== selected.id));
    setSelectedId(null);
    setPlaying(false);
    seekLocal.current = 0;
    setTime(0);
  };

  const moveSelected = (dir: -1 | 1) => {
    const i = clips.findIndex((c) => c.id === selectedId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= clips.length) return;
    const arr = [...clips];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setClips(arr);
  };

  const addText = () => {
    const t = newText.trim();
    if (!t) return;
    setTexts((prev) => [...prev, { id: uid(), text: t, start: time, duration: 3 }]);
    setNewText('');
  };

  const handleExport = () => {
    // TODO: ligar aqui o código de exportação do projeto (Mediabunny).
    alert('A exportação ainda não está conectada ao código de exportação do projeto.');
  };

  // ---------- efeitos visuais do preview ----------
  let fadeOpacity = 1;
  let animScale = 1;
  if (active) {
    const d = active.duration;
    if (active.transition === 'fade') {
      const edge = Math.min(0.5, d / 2);
      fadeOpacity = Math.max(0, Math.min(1, Math.min(localTime / edge, (d - localTime) / edge)));
    }
    const p = Math.min(1, Math.max(0, localTime / d));
    if (active.anim === 'zoom-in') animScale = 1 + 0.15 * p;
    if (active.anim === 'zoom-out') animScale = 1.15 - 0.15 * p;
  }
  const visibleTexts = texts.filter((t) => time >= t.start && time < t.start + t.duration);

  const laneW = Math.max(total, 30) * PPS;

  return (
    <div className="editor-container">
      {/* inputs escondidos */}
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(e) => {
          addVideos(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          addAudio(e.target.files);
          e.target.value = '';
        }}
      />
      {audio && (
        <audio
          ref={audioRef}
          src={audio.url}
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = time;
          }}
        />
      )}

      {/* 1. TOPBAR */}
      <header className="topbar">
        <div className="brand">Estúdio Editor</div>
        <div className="top-actions">
          <button className="btn-export" onClick={handleExport}>
            Exportar
          </button>
        </div>
      </header>

      {/* 2. LIBRARY PANEL */}
      <aside className="library-panel">
        <div className="library-tabs">
          {(
            [
              ['audio', 'Áudio'],
              ['texto', 'Texto'],
              ['efeitos', 'Efeitos'],
              ['transicoes', 'Transições'],
            ] as [LibTab, string][]
          ).map(([key, label]) => (
            <div
              key={key}
              className={`lib-tab${libTab === key ? ' active' : ''}`}
              onClick={() => setLibTab(key)}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="library-content">
          <button style={btnStyle} onClick={() => videoInputRef.current?.click()}>
            + Importar vídeo
          </button>

          {libTab === 'audio' && (
            <>
              <button style={btnStyle} onClick={() => audioInputRef.current?.click()}>
                + Importar áudio
              </button>
              {audio && (
                <p className="label-small">
                  {audio.name} ({fmt(audio.duration)}){' '}
                  <button style={smallBtn} onClick={removeAudio}>
                    Remover
                  </button>
                </p>
              )}
            </>
          )}

          {libTab === 'texto' && (
            <>
              <input
                type="text"
                value={newText}
                placeholder="Digite o texto"
                onChange={(e) => setNewText(e.target.value)}
                style={{ width: '100%', marginBottom: 8, boxSizing: 'border-box' }}
              />
              <button style={btnStyle} onClick={addText}>
                Adicionar na posição atual
              </button>
              <p className="label-small">O texto aparece por 3 segundos na trilha "Vídeo 2".</p>
            </>
          )}

          {libTab === 'efeitos' && (
            <>
              <p className="label-small">
                {selected ? 'Aplicar no clip selecionado:' : 'Selecione um clip na timeline.'}
              </p>
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  style={btnStyle}
                  disabled={!selected}
                  onClick={() => updateSelected({ brightness: p.b, contrast: p.c, saturation: p.s })}
                >
                  {p.name}
                </button>
              ))}
            </>
          )}

          {libTab === 'transicoes' && (
            <>
              <p className="label-small">
                {selected ? 'Aplicar no clip selecionado:' : 'Selecione um clip na timeline.'}
              </p>
              <button
                style={btnStyle}
                disabled={!selected}
                onClick={() => updateSelected({ transition: 'none' })}
              >
                Nenhuma
              </button>
              <button
                style={btnStyle}
                disabled={!selected}
                onClick={() => updateSelected({ transition: 'fade' })}
              >
                Fade (entrada e saída)
              </button>
            </>
          )}
        </div>
      </aside>

      {/* 3. PREVIEW PANEL */}
      <main className="preview-panel">
        <div
          className="preview-monitor"
          style={{ position: 'relative', overflow: 'hidden' }}
        >
          {active ? (
            <video
              ref={videoRef}
              src={active.url}
              playsInline
              muted={!!audio}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                opacity: fadeOpacity,
                filter: `brightness(${active.brightness}%) contrast(${active.contrast}%) saturate(${active.saturation}%)`,
                transform: `scale(${(active.scale / 100) * animScale})`,
              }}
              onTimeUpdate={(e) => setTime(starts[activeIndex] + e.currentTarget.currentTime)}
              onLoadedData={(e) => {
                e.currentTarget.currentTime = seekLocal.current;
                seekLocal.current = 0;
                if (playing) e.currentTarget.play().catch(() => {});
              }}
              onEnded={() => {
                if (activeIndex < clips.length - 1) {
                  setTime(starts[activeIndex + 1]);
                } else {
                  setTime(total);
                  setPlaying(false);
                }
              }}
            />
          ) : (
            <span>Monitor de Vídeo</span>
          )}

          {visibleTexts.map((t) => (
            <div
              key={t.id}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: '12%',
                textAlign: 'center',
                color: '#fff',
                fontSize: 22,
                fontWeight: 700,
                textShadow: '0 2px 6px rgba(0,0,0,0.9)',
                pointerEvents: 'none',
                padding: '0 12px',
              }}
            >
              {t.text}
            </div>
          ))}
        </div>

        <div className="preview-controls">
          <button style={{ ...smallBtn, marginRight: 10 }} onClick={togglePlay}>
            {playing ? '⏸ Pausar' : '▶ Tocar'}
          </button>
          <input
            type="range"
            min={0}
            max={total || 1}
            step={0.05}
            value={time}
            disabled={!clips.length}
            onChange={(e) => seek(Number(e.target.value))}
            style={{ width: '40%', verticalAlign: 'middle', marginRight: 10 }}
          />
          <span>
            {fmt(time)} / {fmt(total)}
          </span>
        </div>
      </main>

      {/* 4. INSPECTOR PANEL */}
      <aside className="inspector-panel">
        <div className="inspector-tabs">
          {(
            [
              ['video', 'Vídeo'],
              ['animacao', 'Animação'],
              ['ajuste', 'Ajuste'],
            ] as [InspTab, string][]
          ).map(([key, label]) => (
            <span
              key={key}
              className={inspTab === key ? 'active' : ''}
              onClick={() => setInspTab(key)}
              style={{ cursor: 'pointer' }}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="inspector-section">
          {!selected && <p className="label-small">Selecione um clip na timeline.</p>}

          {inspTab === 'video' && (
            <>
              <h4>Position & Size</h4>
              <Slider
                label="Escala"
                value={selected?.scale ?? 100}
                min={10}
                max={300}
                disabled={!selected}
                onChange={(v) => updateSelected({ scale: v })}
              />
            </>
          )}

          {inspTab === 'animacao' && (
            <>
              <h4>Animação do clip</h4>
              {(
                [
                  ['none', 'Nenhuma'],
                  ['zoom-in', 'Zoom in'],
                  ['zoom-out', 'Zoom out'],
                ] as [Anim, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  style={{
                    ...btnStyle,
                    borderColor: selected?.anim === key ? '#3b82f6' : '#475569',
                  }}
                  disabled={!selected}
                  onClick={() => updateSelected({ anim: key })}
                >
                  {label}
                </button>
              ))}
            </>
          )}

          {inspTab === 'ajuste' && (
            <>
              <h4>Cor</h4>
              <Slider
                label="Brilho"
                value={selected?.brightness ?? 100}
                min={0}
                max={200}
                disabled={!selected}
                onChange={(v) => updateSelected({ brightness: v })}
              />
              <Slider
                label="Contraste"
                value={selected?.contrast ?? 100}
                min={0}
                max={200}
                disabled={!selected}
                onChange={(v) => updateSelected({ contrast: v })}
              />
              <Slider
                label="Saturação"
                value={selected?.saturation ?? 100}
                min={0}
                max={200}
                disabled={!selected}
                onChange={(v) => updateSelected({ saturation: v })}
              />
            </>
          )}
        </div>
      </aside>

      {/* 5. TIMELINE PANEL */}
      <footer className="timeline-panel">
        <div className="timeline-toolbar">
          <button style={smallBtn} disabled={!selected} onClick={() => moveSelected(-1)}>
            ← Mover
          </button>
          <button style={smallBtn} disabled={!selected} onClick={() => moveSelected(1)}>
            Mover →
          </button>
          <button style={smallBtn} disabled={!selected} onClick={removeSelected}>
            Excluir clip
          </button>
        </div>

        <div className="timeline-scroll">
          <div style={{ position: 'relative', minWidth: LABEL_W + laneW + 40 }}>
            {/* Vídeo 1: clips em sequência */}
            <div className="timeline-track">
              <span style={{ display: 'inline-block', width: LABEL_W }}>Vídeo 1</span>
              <div
                style={laneStyle(laneW)}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  seek((e.clientX - rect.left) / PPS);
                }}
              >
                {clips.map((c, i) => (
                  <div
                    key={c.id}
                    title={c.name}
                    onClick={() => setSelectedId(c.id)}
                    style={{
                      position: 'absolute',
                      top: 2,
                      bottom: 2,
                      left: starts[i] * PPS,
                      width: Math.max(c.duration * PPS, 20),
                      boxSizing: 'border-box',
                      background: c.id === selectedId ? '#3b82f6' : '#475569',
                      border: c.id === selectedId ? '2px solid #fff' : '1px solid #1e293b',
                      borderRadius: 4,
                      color: '#fff',
                      fontSize: 11,
                      padding: '0 6px',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      lineHeight: '26px',
                      cursor: 'pointer',
                    }}
                  >
                    {c.name}
                  </div>
                ))}
              </div>
            </div>

            {/* Vídeo 2: textos */}
            <div className="timeline-track">
              <span style={{ display: 'inline-block', width: LABEL_W }}>Vídeo 2</span>
              <div style={laneStyle(laneW)}>
                {texts.map((t) => (
                  <div
                    key={t.id}
                    title="Clique duas vezes para remover"
                    onDoubleClick={() => setTexts((prev) => prev.filter((x) => x.id !== t.id))}
                    style={{
                      position: 'absolute',
                      top: 2,
                      bottom: 2,
                      left: t.start * PPS,
                      width: t.duration * PPS,
                      boxSizing: 'border-box',
                      background: '#a855f7',
                      borderRadius: 4,
                      color: '#fff',
                      fontSize: 11,
                      padding: '0 6px',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      lineHeight: '28px',
                      cursor: 'pointer',
                    }}
                  >
                    {t.text}
                  </div>
                ))}
              </div>
            </div>

            {/* Áudio */}
            <div className="timeline-track">
              <span style={{ display: 'inline-block', width: LABEL_W }}>Áudio</span>
              <div style={laneStyle(laneW)}>
                {audio && (
                  <div
                    title={audio.name}
                    style={{
                      position: 'absolute',
                      top: 2,
                      bottom: 2,
                      left: 0,
                      width: audio.duration * PPS,
                      boxSizing: 'border-box',
                      background: '#16a34a',
                      borderRadius: 4,
                      color: '#fff',
                      fontSize: 11,
                      padding: '0 6px',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      lineHeight: '28px',
                    }}
                  >
                    {audio.name}
                  </div>
                )}
              </div>
            </div>

            {/* Marcador de tempo */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: LABEL_W + time * PPS,
                width: 2,
                background: '#ef4444',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
      </footer>
    </div>
  );
}
