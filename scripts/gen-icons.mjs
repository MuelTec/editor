// Gera ícones modernos e bonitos para o app (web + Android PWA)
// Uso: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- PNG mínimo (RGBA 8-bit) ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Desenho super moderno do ícone ----------
function lerp(a, b, t) {
  return Math.round(a + (b - a) * Math.min(1, Math.max(0, t)));
}

function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size;

  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    // Blend alfa suave
    if (a < 255) {
      const oldA = px[i + 3] / 255;
      const newA = a / 255;
      const outA = newA + oldA * (1 - newA);
      if (outA > 0) {
        px[i] = Math.round((r * newA + px[i] * oldA * (1 - newA)) / outA);
        px[i + 1] = Math.round((g * newA + px[i + 1] * oldA * (1 - newA)) / outA);
        px[i + 2] = Math.round((b * newA + px[i + 2] * oldA * (1 - newA)) / outA);
        px[i + 3] = Math.round(outA * 255);
      }
    } else {
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  };

  // Cores do gradiente moderno (Deep Violet #0e0a1f -> Neon Cyan / Purple / Pink)
  const C1 = [15, 12, 29];   // Fundo super dark violet
  const C2 = [28, 20, 52];   // Variação do fundo
  const G1 = [124, 77, 255]; // Neon Purple
  const G2 = [255, 64, 129]; // Neon Pink / Rose
  const G3 = [0, 229, 255];  // Neon Cyan / Blue

  // 1. Fundo com degradê diagonal + glow neon no centro
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const diag = (x + y) / (S * 2);
      let r = lerp(C1[0], C2[0], diag);
      let g = lerp(C1[1], C2[1], diag);
      let b = lerp(C1[2], C2[2], diag);

      // Glow radial neon atrás do símbolo
      const distCenter = Math.hypot(x - S * 0.5, y - S * 0.48) / (S * 0.5);
      if (distCenter < 1) {
        const glow = Math.pow(1 - distCenter, 2) * 0.35;
        r = lerp(r, G1[0], glow);
        g = lerp(g, G1[1], glow);
        b = lerp(b, G1[2], glow);
      }
      set(x, y, r, g, b, 255);
    }
  }

  // 2. Moldura 9:16 estilo Squircle / Smartphone moderno com vidro degradê
  const fw = Math.round(S * 0.46);
  const fh = Math.round(S * 0.72);
  const fx0 = Math.round((S - fw) / 2);
  const fy0 = Math.round((S - fh) / 2);
  const cornerR = Math.round(S * 0.08);

  const insideFrame = (x, y) => {
    const lx = x - fx0;
    const ly = y - fh0_offset(y);
    if (lx < 0 || ly < 0 || lx >= fw || ly >= fh) return false;
    const cx = lx < cornerR ? cornerR : lx >= fw - cornerR ? fw - cornerR - 1 : lx;
    const cy = ly < cornerR ? cornerR : ly >= fh - cornerR ? fh - cornerR - 1 : ly;
    return Math.hypot(lx - cx, ly - cy) <= cornerR;
  };

  function fh0_offset() { return fy0; }

  // Preenche a tela 9:16 com degradê vibrante (Cyan -> Purple -> Magenta)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!insideFrame(x, y)) continue;
      const tY = (y - fy0) / fh;
      let r, g, b;
      if (tY < 0.5) {
        const t = tY * 2;
        r = lerp(G3[0], G1[0], t);
        g = lerp(G3[1], G1[1], t);
        b = lerp(G3[2], G1[2], t);
      } else {
        const t = (tY - 0.5) * 2;
        r = lerp(G1[0], G2[0], t);
        g = lerp(G1[1], G2[1], t);
        b = lerp(G1[2], G2[2], t);
      }
      set(x, y, r, g, b, 255);
    }
  }

  // Borda brilhante moderna de cristal (Inner Glow / Light Border)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!insideFrame(x, y)) continue;
      const edge =
        !insideFrame(x - 2, y) ||
        !insideFrame(x + 2, y) ||
        !insideFrame(x, y - 2) ||
        !insideFrame(x, y + 2);
      if (edge) {
        set(x, y, 255, 255, 255, 230);
      }
    }
  }

  // 3. Ícone de Play / Câmera central com degradê branco-brilhante no centro
  const cx = S * 0.52; // Leve compensação para o triângulo parecer óptico-centrado
  const cy = S * 0.5;
  const pSize = S * 0.16;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Triângulo apontando para a DIREITA (Play moderno)
      const dx = (x - (cx - pSize * 0.4)) / (pSize * 1.1);
      const dy = Math.abs(y - cy) / (pSize * 0.85);

      if (dx >= 0 && dx <= 1 && dy <= (1 - dx * 0.85)) {
        set(x, y, 255, 255, 255, 255);
      }
    }
  }

  // 4. Detalhe de Reels / Filme (três traços discretos de corte em cima e embaixo)
  const notchW = Math.round(S * 0.12);
  const notchH = Math.round(S * 0.015);
  const notchY = fy0 + Math.round(S * 0.05);
  for (let y = notchY; y < notchY + notchH; y++) {
    for (let x = Math.round(S * 0.5 - notchW / 2); x < Math.round(S * 0.5 + notchW / 2); x++) {
      set(x, y, 255, 255, 255, 180);
    }
  }

  return { px, S };
}

function drawIcon(size) {
  const { px, S } = renderIcon(size);
  return encodePNG(S, S, px);
}

// ---------- Ícone adaptativo do Android (ic_launcher_foreground) ----------
// O Android 8+ usa o XML de mipmap-anydpi-v26 em vez dos PNGs legados.
// Ele pede um foreground de 108dp (por densidade) onde só a "zona segura"
// central (~72dp) fica visível sob a máscara do launcher. Renderizamos o
// ícone inteiro reduzido para caber nessa zona, com fundo transparente.
const ADAPTIVE_SCALE = 0.7;

function drawIconForeground(size) {
  const inner = Math.round(size * ADAPTIVE_SCALE);
  const { px, S } = renderIcon(inner);
  const canvas = Buffer.alloc(size * size * 4); // transparente
  const off = Math.round((size - S) / 2);
  for (let y = 0; y < S; y++) {
    px.copy(canvas, ((off + y) * size + off) * 4, y * S * 4, (y + 1) * S * 4);
  }
  return encodePNG(size, size, canvas);
}

// ---------- SVG ultra limpo e moderno ----------
const SVG_CONTENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f0c1d"/>
      <stop offset="100%" stop-color="#1c1434"/>
    </linearGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00e5ff"/>
      <stop offset="50%" stop-color="#7c4dff"/>
      <stop offset="100%" stop-color="#ff4081"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="16" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <!-- Glow Neon Fundo -->
  <circle cx="256" cy="256" r="160" fill="#7c4dff" opacity="0.25" filter="blur(30px)"/>
  <!-- Tela 9:16 Smartphone / Story -->
  <rect x="144" y="72" width="224" height="368" rx="40" fill="url(#frame)" stroke="#ffffff" stroke-width="8"/>
  <!-- Notch do Reels -->
  <rect x="224" y="92" width="64" height="8" rx="4" fill="#ffffff" opacity="0.8"/>
  <!-- Símbolo de Play Apontando pra Direita -->
  <path d="M236 212 L308 256 L236 300 Z" fill="#ffffff" filter="drop-shadow(0px 4px 12px rgba(0,0,0,0.3))"/>
</svg>`;

// Foreground do icone adaptativo do Android (mipmap-*/ic_launcher_foreground.png)
const dpiPx = [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]];
const foregroundTargets = dpiPx.map(([dpi, px]) => [
  `android_overlay/launcher/mipmap-${dpi}/ic_launcher_foreground.png`,
  px,
  'foreground',
]);

const targets = [
  ['app/public/icon.svg', 'svg'],
  ['app/public/icons/icon-192.png', 192],
  ['app/public/icons/icon-512.png', 512],
  ['app/public/icons/icon-maskable-512.png', 512],
  ['app/public/icons/apple-touch-icon.png', 180],
  ['app/public/icons/android-mdpi.png', 48],
  ['app/public/icons/android-hdpi.png', 72],
  ['app/public/icons/android-xhdpi.png', 96],
  ['app/public/icons/android-xxhdpi.png', 144],
  ['app/public/icons/android-xxxhdpi.png', 192],
  ...foregroundTargets,
];

// Filtro opcional: `node scripts/gen-icons.mjs foreground` só regenera os
// arquivos cujo caminho contém o texto (útil para não tocar nos ícones já existentes).
const filter = process.argv[2];

for (const [rel, size, kind] of targets) {
  if (filter && !rel.includes(filter)) continue;
  const out = join(root, rel);
  mkdirSync(dirname(out), { recursive: true });
  if (size === 'svg') {
    writeFileSync(out, SVG_CONTENT);
    console.log('ok SVG', rel);
  } else if (kind === 'foreground') {
    writeFileSync(out, drawIconForeground(size));
    console.log('ok PNG', rel, size + 'x' + size + ' (adaptativo)');
  } else {
    writeFileSync(out, drawIcon(size));
    console.log('ok PNG', rel, size + 'x' + size);
  }
}
