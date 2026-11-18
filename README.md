# 🎬 Editor — Vídeo Vertical Automático

Transforme fotos e vídeos **horizontais** em layouts bonitos **9:16**
(Stories / Reels) com legenda automática, montagem, trilha sonora e
exportação **100% local** — nada sai do seu aparelho.

**▶ Testar agora: [https://mueltec.github.io/editor/](https://mueltec.github.io/editor/)**

## O que ele faz

- **Conversão 16:9 → 9:16** sem cortar: o fundo é o próprio vídeo borrado
  com a imagem nítida ao centro.
- **Legenda automática** com auto-ajuste de tamanho, cor por contraste
  (WCAG), scrim automático e efeitos (fade, rise, pop).
- **Montagem automática** multi-clipe com 3 modelos, transições, trim,
  filtros de cor (8 opções) e ajustes (brilho, contraste, saturação, calor).
- **Trilha sonora** local com mixagem.
- **Exportação** em MP4 **H.264 (avc) + AAC** — aceito no YouTube e no
  Instagram.
- **Proporções extras**: 9:16 (1080×1920), 16:9 (1920×1080), 1:1
  (1080×1080) e 4:5 (1080×1350) + **capa PNG** ("pacote CapCut").
- **Offline**: usa só fontes do sistema, sem Google Fonts e sem servidor.

## Como usar no celular (iOS)

O app é um site público (PWA):

1. Abra **[mueltec.github.io/editor](https://mueltec.github.io/editor/)**
   no Safari do iPhone.
2. **Compartilhar** → **Adicionar à Tela de Início**.
3. Abre em tela cheia, como um app.

> iOS não permite `.ipa` fora da App Store — este é o mesmo caminho usado
> no app **Casinhas**.

## APK (Android)

Baixe na página de **[Releases](../../releases)** do repositório
(`editor-v1.0.apk`, assinado com o keystore do projeto).

> O workflow **Build APK** roda a cada push em `main`, sobe o APK novo como
> artefato do Actions **e atualiza esta release** — o link acima sempre baixa
> a versão mais recente.

- Instale dando permissão de "fontes desconhecidas" ao instalador.
- Também dá pra instalar pelo site no Chrome: **⋮ → Instalar app**.

## Desenvolver localmente

```bash
cd app
npm ci
npm run dev      # http://localhost:5173
npm run build    # gera app/dist
```

## CI (pronta para ativar)

Os workflows de **Build APK** e **Deploy Pages** estão em [`ci/`](ci/)
com instruções no [`ci/README.md`](ci/README.md) — é preciso dar ao token
o escopo `workflow` (`gh auth refresh -s workflow`) antes de movê-los para
`.github/workflows/`.

## Stack

Vite + React + TypeScript, [Mediabunny](https://github.com/Vanilagy/mediabunny)
(MPL-2.0) para ler/escrever mídia via WebCodecs, Capacitor 6 no Android.
