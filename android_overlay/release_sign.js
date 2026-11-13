// Prepara a assinatura RELEASE do APK no build do CI.
// - Materializa o keystore a partir do secret ANDROID_KEYSTORE_B64
// - Injeta signingConfigs.release no android/app/build.gradle
// Roda logo antes do ./gradlew assembleRelease (ver .github/workflows/build-apk.yml)
const fs = require('fs');
const path = require('path');

const b64 = process.env.ANDROID_KEYSTORE_B64;
const sp = process.env.ANDROID_KEYSTORE_PASS;
const alias = process.env.ANDROID_KEY_ALIAS;
const kp = process.env.ANDROID_KEY_PASS || sp;

if (!b64 || !sp || !alias) {
  console.error('[release_sign] Faltam secrets: ANDROID_KEYSTORE_B64, ANDROID_KEYSTORE_PASS, ANDROID_KEY_ALIAS');
  process.exit(1);
}

// 1) Keystore
const ksPath = path.join('android', 'editor.keystore');
fs.writeFileSync(ksPath, Buffer.from(b64, 'base64'));
console.log('[release_sign] Keystore materializado (' + fs.statSync(ksPath).size + ' bytes)');

// 2) build.gradle: injeta signingConfigs.release e aplica no buildTypes.release
const gradlePath = path.join('android', 'app', 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');

if (!gradle.includes('signingConfigs {')) {
  gradle = gradle.replace(
    /buildTypes\s*\{/,
    [
      '    signingConfigs {',
      '        release {',
      "            storeFile file('../editor.keystore')",
      "            storePassword '" + sp + "'",
      "            keyAlias '" + alias + "'",
      "            keyPassword '" + kp + "'",
      '        }',
      '    }',
      '',
      '    buildTypes {'
    ].join('\n')
  );
}

// 3) aplica signingConfig no buildTypes.release (e SÓ nele — o primeiro
//    "release {" do arquivo é o do signingConfigs, por isso a busca parte
//    do índice de "buildTypes")
if (!gradle.includes('signingConfig signingConfigs.release')) {
  const btIdx = gradle.indexOf('buildTypes');
  const relIdx = gradle.indexOf('release', btIdx);
  const braceIdx = gradle.indexOf('{', relIdx);
  const close = /\n([ \t]*)\}/.exec(gradle.slice(braceIdx));
  if (btIdx < 0 || relIdx < 0 || braceIdx < 0 || !close) {
    console.error('[release_sign] Nao achei o bloco buildTypes.release em app/build.gradle');
    process.exit(1);
  }
  const at = braceIdx + close.index + 1; // início da linha de fechamento
  gradle =
    gradle.slice(0, at) +
    close[1] + '    signingConfig signingConfigs.release\n' +
    gradle.slice(at);
}

fs.writeFileSync(gradlePath, gradle);
console.log('[release_sign] signingConfigs.release injetado em app/build.gradle');
