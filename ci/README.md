# CI pronta para ativar

Os dois workflows do projeto estão aqui, prontos. Eles estão **fora** de
`.github/workflows/` porque o push de arquivos de workflow exige o escopo
`workflow` no token do GitHub (o token atual tem só `repo`, `gist`,
`read:org`), e sem isso o git recusa o push inteiro.

## Como ativar (1 passo)

```bash
gh auth refresh -h github.com -s workflow
```

Abre um código de dispositivo no navegador (é preciso estar logado no
GitHub). Depois de autorizar, basta mover os arquivos e dar push:

```bash
cp ci/build-apk.yml ci/deploy-pages.yml .github/workflows/
# remova a linha "/.github/workflows/" do .gitignore
git add .github/workflows .gitignore
git commit -m "ativa CI" && git push
```

## O que cada um faz

- **build-apk.yml** — Build APK: compila o app web (Vite), monta o projeto
  Capacitor, copia os ícones, assina o release com o keystore guardado nos
  secrets (`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASS`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASS`) e publica o APK como artifact.
- **deploy-pages.yml** — Deploy Pages: publica `app/dist` no GitHub Pages
  pelo Actions (hoje o site é publicado pelo branch `gh-pages`, que já
  funciona; ao ativar este workflow, mude a fonte do Pages para
  "GitHub Actions").

Os secrets dos 4 `ANDROID_KEYSTORE_*` **já estão** no repositório
`MuelTec/editor` (keystore `editor.keystore`, alias `editor`).
