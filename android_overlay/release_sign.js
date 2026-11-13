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

gradle = gradle.replace(
  /release\s*\{([\s\S]*?)\n(\s*)\}/,
  (m, inner, ind) => {
    if (inner.includes('signingConfig')) return m;
    return 'release {' + inner + '\n' + ind + '    signingConfig signingConfigs.release\n' + ind + '}';
  }
);

fs.writeFileSync(gradlePath, gradle);
console.log('[release_sign] signingConfigs.release injetado em app/build.gradle');
