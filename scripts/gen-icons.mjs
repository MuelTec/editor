// Gera os ícones PNG do app (web + Android) sem dependências externas.
// Uso: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- PNG mínimo (RGBA, 8 bits) ----------
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
    raw[y * (w * 4 + 1)] = 0; // filtro None
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- desenho ----------
const BG = [13, 15, 20]; // #0d0f14
const A = [124, 92, 255]; // roxo
const B = [255, 77, 148]; // rosa

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size;
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };

  // fundo com brilho radial suave
  const cx = S * 0.5;
  const cy = S * 0.42;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy) / (S * 0.9);
      const k = Math.max(0, 1 - d);
      set(
        x,
        y,
        lerp(BG[0], A[0], k * 0.35),
        lerp(BG[1], A[1], k * 0.35),
        lerp(BG[2], A[2], k * 0.35)
      );
    }
  }

  // moldura 9:16 (story) centralizada
  const fw = Math.round(S * 0.44);
  const fh = Math.round(S * 0.66);
  const fx0 = Math.round((S - fw) / 2);
  const fy0 = Math.round((S - fh) / 2);
  const r = Math.max(2, Math.round(S * 0.05));

  const inRound = (x, y) => {
    const lx = x - fx0;
    const ly = y - fy0;
    if (lx < 0 || ly < 0 || lx >= fw || ly >= fh) return false;
    const cxl = lx < r ? r : lx >= fw - r ? fw - r - 1 : lx;
    const cyl = ly < r ? r : ly >= fh - r ? fh - r - 1 : ly;
    return Math.hypot(lx - cxl, ly - cyl) <= r;
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRound(x, y)) continue;
      const t = (y - fy0) / fh;
      set(x, y, lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
    }
  }

  // borda clara da moldura
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRound(x, y)) continue;
      const edge = !inRound(x - 1, y) || !inRound(x + 1, y) || !inRound(x, y - 1) || !inRound(x, y + 1);
      if (edge) set(x, y, 245, 246, 255);
    }
  }

  // triângulo de play branco no centro
  const pw = S * 0.16;
  const ph = S * 0.19;
  const px0 = cx - pw * 0.4;
  const py0 = cy - ph / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const lx = (x - px0) / pw;
      const ly = (y - py0) / ph;
      if (lx < 0 || lx > 1 || ly < 0 || ly > 1) continue;
      // triângulo apontando para a direita: base à esquerda, vértice ao meio-direita
      if (Math.abs(ly - 0.5) <= lx / 2) set(x, y, 255, 255, 255);
    }
  }

  return encodePNG(S, S, px);
}

const targets = [
  ['app/public/icon.svg', null],
  ['app/public/icons/icon-192.png', 192],
  ['app/public/icons/icon-512.png', 512],
  ['app/public/icons/icon-maskable-512.png', 512],
  ['app/public/icons/apple-touch-icon.png', 180],
  ['app/public/icons/android-mdpi.png', 48],
  ['app/public/icons/android-hdpi.png', 72],
  ['app/public/icons/android-xhdpi.png', 96],
  ['app/public/icons/android-xxhdpi.png', 144],
  ['app/public/icons/android-xxxhdpi.png', 192],
];

for (const [rel, size] of targets) {
  if (!size) continue;
  const out = join(root, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, draw(size));
  console.log('ok', rel, size + 'x' + size);
}
