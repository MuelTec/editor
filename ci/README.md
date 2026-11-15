# CI do projeto

## build-apk.yml — ATIVO

O workflow do APK está em `.github/workflows/build-apk.yml` (ativado em
15/11/2026, no estilo do app Meu Player): a cada push no `main` o GitHub
Actions compila o app web, monta o Capacitor, assina o release e publica o
APK como artifact.

**Como usar:** push no `main` → aba **Actions** → **Build APK** →
**Artifacts** → baixar `editor-apk.zip` (contém o APK assinado).

- O token precisou ganhar o escopo `workflow` (`gh auth refresh -s workflow`)
  antes do push do arquivo de workflow.
- Os 4 secrets `ANDROID_KEYSTORE_*` **já estão** no repositório
  `MuelTec/editor` (keystore `editor.keystore`, alias `editor`) — a
  assinatura é a mesma do APK instalado (instala como atualização).

## deploy-pages.yml — ainda em espera

- **deploy-pages.yml** — Deploy Pages: publica `app/dist` no GitHub Pages
  pelo Actions (hoje o site é publicado pelo branch `gh-pages`, que já
  funciona; ao ativar este workflow, mude a fonte do Pages para
  "GitHub Actions"). Coloque-o em `.github/workflows/` para ativá-lo.
