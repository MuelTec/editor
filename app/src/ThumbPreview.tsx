import { useEffect, useRef, useState } from 'react';
import { FrameComposer, type FrameLayer, type FrameSource } from './lib/compose';
import { DEFAULT_ADJUSTMENTS, type FilterId } from './lib/filters';
import type { FrameLayout } from './lib/format';
import { applyTransition, type TransitionId } from './lib/montage';

/**
 * MINIATURAS DE APRESENTAÇÃO (filtros e transições — Etapa 14).
 *
 * Cada chip da biblioteca ganha um canvas pequeno que roda o MESMO motor do
 * arquivo final: `FrameComposer` (filtro + vinhetas) e `applyTransition`
 * (a função usada pelo preview e pela exportação). O que você vê no chip é
 * exatamente o efeito que sai no vídeo — nada de preview "de mentira".
 *
 * Filtros são estáticos (efeito de cor não anima). Transições ficam paradas
 * num quadro representativo e animam em loop ao passar o mouse/foco no chip —
 * ou continuamente quando são a transição selecionada. Respeita
 * `prefers-reduced-motion`.
 *
 * As cenas são sintéticas (pôr do sol / dia / cartela de cores) porque os
 * chips precisam de algo pra mostrar antes de o usuário escolher um vídeo.
 */

/** Quadro das miniaturas em coordenadas de layout (16:10). */
const THUMB_LAYOUT: FrameLayout = {
  width: 240,
  height: 150,
  safeTop: 0,
  safeBottom: 0,
  sideMargin: 0,
  videoGap: 0,
  minBand: 0,
};

/** Progresso do quadro PARADO de cada transição (o pico de luz/preto de
 *  algumas ficaria ilegível no chip — ex.: "Escurecer" em p=0,5 é tudo
 *  preto). As demais usam 0,5 (meio da troca). */
const STATIC_P: Partial<Record<TransitionId, number>> = {
  flash: 0.15,
  glitch: 0.6,
  flip3d: 0.35,
  spin: 0.4,
  luma: 0.3,
  lightLeak: 0.18,
  fadeBlack: 0.15,
};

/** Loop da miniatura animada: 1s de troca + 0,8s parada no clipe novo. */
const CYCLE_MS = 1800;
const TRANSITION_MS = 1000;

type SceneKind = 'warm' | 'cool' | 'card';

/** Pinta uma cena sintética num retângulo (usada pelo FrameSource). */
function paintScene(
  ctx: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  kind: SceneKind,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();

  // Céu
  const sky = ctx.createLinearGradient(dx, dy, dx, dy + dh);
  if (kind === 'warm') {
    sky.addColorStop(0, '#ff7a59');
    sky.addColorStop(0.55, '#ffb26b');
    sky.addColorStop(1, '#ffd9a0');
  } else if (kind === 'cool') {
    sky.addColorStop(0, '#1e63ff');
    sky.addColorStop(0.6, '#4dd0ff');
    sky.addColorStop(1, '#b3ecff');
  } else {
    sky.addColorStop(0, '#3d7bff');
    sky.addColorStop(0.55, '#8fd0ff');
    sky.addColorStop(1, '#d9f2ff');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(dx, dy, dw, dh);

  // Sol / lua
  ctx.fillStyle = kind === 'cool' ? '#eafcff' : kind === 'warm' ? '#fff3b0' : '#ffd54a';
  ctx.beginPath();
  ctx.arc(dx + dw * 0.72, dy + dh * 0.3, Math.min(dw, dh) * 0.16, 0, Math.PI * 2);
  ctx.fill();

  // Montanhas distantes
  const hillFar = kind === 'warm' ? '#5b2a6b' : kind === 'cool' ? '#0b7a6b' : '#2e9e4f';
  ctx.fillStyle = hillFar;
  ctx.beginPath();
  ctx.moveTo(dx, dy + dh);
  ctx.lineTo(dx, dy + dh * 0.62);
  ctx.quadraticCurveTo(dx + dw * 0.3, dy + dh * 0.42, dx + dw * 0.55, dy + dh * 0.66);
  ctx.quadraticCurveTo(dx + dw * 0.8, dy + dh * 0.86, dx + dw, dy + dh * 0.6);
  ctx.lineTo(dx + dw, dy + dh);
  ctx.closePath();
  ctx.fill();

  // Montanhas próximas
  const hillNear = kind === 'warm' ? '#2d1440' : kind === 'cool' ? '#04524c' : '#1c7a3a';
  ctx.fillStyle = hillNear;
  ctx.beginPath();
  ctx.moveTo(dx, dy + dh);
  ctx.lineTo(dx, dy + dh * 0.82);
  ctx.quadraticCurveTo(dx + dw * 0.45, dy + dh * 0.66, dx + dw, dy + dh * 0.88);
  ctx.lineTo(dx + dw, dy + dh);
  ctx.closePath();
  ctx.fill();

  // Referência de cor (cartela de filtros): vermelho + amarelo
  if (kind === 'card') {
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(dx + dw * 0.26, dy + dh * 0.5, Math.min(dw, dh) * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffeb3b';
    ctx.fillRect(dx + dw * 0.44, dy + dh * 0.48, dw * 0.16, dh * 0.1);
  }

  ctx.restore();
}

function makeScene(kind: SceneKind): FrameSource {
  return {
    width: THUMB_LAYOUT.width,
    height: THUMB_LAYOUT.height,
    draw(ctx, dx, dy, dw, dh) {
      paintScene(ctx, dx, dy, dw, dh, kind);
    },
  };
}

const SCENE_WARM = makeScene('warm');
const SCENE_COOL = makeScene('cool');
const SCENE_CARD = makeScene('card');

/** Miniatura de um FILTRO: cartela de cores com o preset aplicado (estática). */
export function FilterThumb({ filter }: { filter: FilterId }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const composer = new FrameComposer(
      undefined,
      filter,
      THUMB_LAYOUT,
      DEFAULT_ADJUSTMENTS,
      false,
    );
    composer.render(ctx, [{ source: SCENE_CARD, alpha: 1 }]);
  }, [filter]);

  return (
    <canvas
      ref={canvasRef}
      width={THUMB_LAYOUT.width}
      height={THUMB_LAYOUT.height}
      className="thumb-canvas"
      aria-hidden="true"
    />
  );
}

/**
 * Miniatura de uma TRANSIÇÃO: cena quente → cena fria com o MESMO
 * `applyTransition` do preview/export. Anima ao hover/foco do chip (ou
 * continuamente, quando é a transição selecionada).
 */
export function TransitionThumb({
  transition,
  active = false,
}: {
  transition: TransitionId;
  active?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState(false);
  const [reducedMotion] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const playing = (hovered || active) && !reducedMotion;

  // O canvas é `pointer-events: none` (não pode engolir o clique do chip):
  // o listener pendura no BOTÃO pai.
  useEffect(() => {
    const btn = canvasRef.current?.closest('button');
    if (!btn) return;
    const on = () => setHovered(true);
    const off = () => setHovered(false);
    btn.addEventListener('pointerenter', on);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('focus', on);
    btn.addEventListener('blur', off);
    return () => {
      btn.removeEventListener('pointerenter', on);
      btn.removeEventListener('pointerleave', off);
      btn.removeEventListener('focus', on);
      btn.removeEventListener('blur', off);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const composer = new FrameComposer(
      undefined,
      'none',
      THUMB_LAYOUT,
      DEFAULT_ADJUSTMENTS,
      false,
    );

    const draw = (p: number) => {
      const layers: FrameLayer[] = [
        { source: SCENE_WARM, alpha: 1 },
        { source: SCENE_COOL, alpha: 1 },
      ];
      const { flash, flashColor } = applyTransition(transition, p, layers, THUMB_LAYOUT);
      composer.render(ctx, layers, { flash, flashColor });
    };

    // Quadro parado primeiro (nunca fica em branco), depois o loop se tocar.
    draw(STATIC_P[transition] ?? 0.5);
    if (!playing) return;

    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // ~30fps: miniatura de 240px não precisa de 60.
      if (now - last < 33) return;
      last = now;
      const t = (now - start) % CYCLE_MS;
      draw(Math.min(1, t / TRANSITION_MS));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transition, playing]);

  return (
    <canvas
      ref={canvasRef}
      width={THUMB_LAYOUT.width}
      height={THUMB_LAYOUT.height}
      className="thumb-canvas"
      aria-hidden="true"
    />
  );
}
