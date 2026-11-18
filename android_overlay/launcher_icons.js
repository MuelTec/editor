// Aplica o icone do app no projeto Android gerado pelo Capacitor.
// Roda logo depois do `npx cap add android` (ver .github/workflows/build-apk.yml):
//   1) copia os PNGs legados de app/public/icons -> mipmap-*/ic_launcher(_round).png
//   2) copia o foreground adaptativo de android_overlay/launcher -> mipmap-*/ic_launcher_foreground.png
//   3) ajusta color/ic_launcher_background (usado pelo mipmap-anydpi-v26/ic_launcher.xml)
//
// Por que o passo 2 e 3 existem: no Android 8+ o launcher usa o XML adaptativo
// (mipmap-anydpi-v26/ic_launcher.xml), que tem PRIORIDADE sobre os PNGs legados.
// Sem isso o app mostrava o icone padrao do Capacitor (o X azul), mesmo com os
// PNGs corretos copiados.
const fs = require('fs');
const path = require('path');

const RES = path.join('android', 'app', 'src', 'main', 'res');
const ICONS = path.join('app', 'public', 'icons');
const FG = path.join('android_overlay', 'launcher');
// Media do degrade do fundo do icone: #0f0c1d -> #1c1434
const BG_COLOR = '#151029';

if (!fs.existsSync(RES)) {
  console.error('[launcher_icons] ' + RES + ' nao existe. Rode antes: npx cap add android');
  process.exit(1);
}

const DENSITIES = [
  ['mdpi', 108],
  ['hdpi', 162],
  ['xhdpi', 216],
  ['xxhdpi', 324],
  ['xxxhdpi', 432],
];

for (const [dpi, fgPx] of DENSITIES) {
  const dir = path.join(RES, 'mipmap-' + dpi);
  fs.mkdirSync(dir, { recursive: true });

  // Legado (Android <= 7 e fallback do manifest)
  const legacy = path.join(ICONS, 'android-' + dpi + '.png');
  if (!fs.existsSync(legacy)) {
    console.error('[launcher_icons] falta ' + legacy + ' (rode: node scripts/gen-icons.mjs)');
    process.exit(1);
  }
  fs.copyFileSync(legacy, path.join(dir, 'ic_launcher.png'));
  fs.copyFileSync(legacy, path.join(dir, 'ic_launcher_round.png'));

  // Foreground do icone adaptativo (Android 8+)
  const foreground = path.join(FG, 'mipmap-' + dpi, 'ic_launcher_foreground.png');
  if (!fs.existsSync(foreground)) {
    console.error('[launcher_icons] falta ' + foreground + ' (rode: node scripts/gen-icons.mjs)');
    process.exit(1);
  }
  fs.copyFileSync(foreground, path.join(dir, 'ic_launcher_foreground.png'));
  console.log('[launcher_icons] mipmap-' + dpi + ' ok (legado 100% + foreground ' + fgPx + 'px)');
}

// Cor de fundo do icone adaptativo
let patched = false;
for (const entry of fs.readdirSync(RES, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('values')) continue;
  const dir = path.join(RES, entry.name);
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.xml')) continue;
    const p = path.join(dir, file);
    const xml = fs.readFileSync(p, 'utf8');
    if (!xml.includes('name="ic_launcher_background"')) continue;
    const next = xml.replace(
      /<color name="ic_launcher_background"[^>]*>[^<]*<\/color>/,
      '<color name="ic_launcher_background">' + BG_COLOR + '</color>'
    );
    if (next !== xml) {
      fs.writeFileSync(p, next);
      patched = true;
      console.log('[launcher_icons] color/ic_launcher_background = ' + BG_COLOR + ' em ' + p);
    }
  }
}

if (!patched) {
  const dir = path.join(RES, 'values');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ic_launcher_background.xml');
  fs.writeFileSync(
    p,
    '<resources>\n    <color name="ic_launcher_background">' + BG_COLOR + '</color>\n</resources>\n'
  );
  console.log('[launcher_icons] color/ic_launcher_background = ' + BG_COLOR + ' criado em ' + p);
}

console.log('[launcher_icons] icone aplicado no projeto Android');
