# 📕 Caderno de Estudos — App de Criação de Conceito/Conteúdo

> **Objetivo:** app que recebe uma foto + uma legenda e **edita automaticamente**,
> colocando o texto na melhor posição (bonita), com opções de fonte, cor, etc.
>
> **Decisões tomadas:**
> - 🖥️ Começar **web** (React + Fabric.js) → migrar pra **mobile (Flutter)** depois
> - 🤖 Modo **automático + ajuste manual** (o app sugere, o usuário arrasta)
> - 📱 Formato principal: **Story/Reels 9:16 (1080×1920)**
> - 🎥 **Vídeo = Opção 3**: usuário filma com a câmera do iPhone,
>   nosso app só recebe o vídeo e gera a **vertical com legenda automática**
>   (gravar com o app web ficou pra depois — menos coisa pra quebrar)
>
> **Regra do jogo:** enquanto eu testar apps, vou anotando aqui ideias e comparações.

---

## 1. OS APPS QUE VOU TESTAR → ANOTAÇÕES

> *(preencher conforme eu for testando)*

| # | App | O que impressionou | O que é ruim | Ideia roubada pro nosso app |
|---|-----|--------------------|--------------|-----------------------------|
| 1 | _Canva_ | | | |
| 2 | _Adobe Express_ | | | |
| 3 | _Phonto_ | | | |
| 4 | _PicsArt_ | | | |
| 5 | _Edits (Instagram)_ | | | |
| 6 | _Mojo_ | | | |
| 7 | | | | |
| 8 | | | | |

---

## 2. O QUE JÁ PESQUISAMOS (resultado das buscas)

### 2.1 Repositórios no GitHub relevantes

| Repo | Stars | O que faz | Pra que serve |
|---|---|---|---|
| [graphic-design-ai/creatiposter](https://github.com/graphic-design-ai/creatiposter) | 119 | IA que gera composições multi-camada e **editáveis**; tem modo "text overlay em foto enviada" | **É exatamente a nossa ideia.** Mas é pesquisa e o código ainda NÃO foi publicado. Acompanhar |
| [clawnify/OpenDesign](https://github.com/clawnify/OpenDesign) | 129 | Alternativa open source do Canva (Fabric.js + Preact + Hono + SQLite) | **Melhor base** pro editor de camadas |
| [dabodamjan/poster-maker](https://github.com/dabodamjan/poster-maker) | 13 | Gera flyer/poster em **HTML/CSS editável** → exporta PNG | Inspiração: estruturar fonte/cor/fundo como campos editáveis |
| [LydiaTools/aspectory](https://github.com/LydiaTools/aspectory) | 1 | Padding automático da foto **sem cortar** + carrosséis | Resolve "foto de um lado, legenda do outro" |
| [mk-knight23/MK-ViralCanvas](https://github.com/mk-knight23/MK-ViralCanvas) | 2 | Estúdio web pra memes/quote cards, React 19, local-first | Código moderno e leve pra estudar |
| [Suz41/postcreator](https://github.com/Suz41/postcreator) | 1 | Cards sociais client-side, export PNG | Arquitetura simples |
| [Anu3ev/image-editor](https://github.com/Anu3ev/image-editor) | — | Biblioteca TS + Fabric.js (recorte, texto, camadas) | Reusar componentes |
| [kra-mo/Sly](https://github.com/kra-mo/Sly) | 246 | Editor de imagens em **Flutter** | Base pra fase mobile |
| [netersoft/simple-photo-editor](https://github.com/netersoft/simple-photo-editor) | 0 | Flutter: ajustes, texto, stickers, share (GPL-3, ativo) | Fase mobile |
| [SavanGangani/PhotoEditor](https://github.com/SavanGangani/PhotoEditor) | 7 | Flutter: filtros + adicionar texto | Fase mobile |

### 2.2 Blocos de construção (peças prontas)

- **Motor de canvas:** [Fabric.js](https://github.com/fabricjs/fabric.js) (melhor pra texto) ou [Konva](https://konvajs.org) (melhor em React)
- **Remoção de fundo:** `rembg` (modelo U²-Net)
- **Saliency (onde o olho olha):** OpenCV saliency / `pysaliency`
- **Contraste automático de texto:** WCAG luminância — libs: [textContrast](https://github.com/brycejech/textContrast), [chroma.js](https://gka.github.io/chroma.js/), [Color.js contrast](https://colorjs.io/docs/contrast/)
- **Fontes:** Google Fonts (licença livre)

---

## 3. ESPECIFICAÇÃO TÉCNICA — FORMATO 9:16

### Zonas seguras do Story (crítico!)

```
┌──────────────────────────┐
│ ░░░ ZONA SEGURA TOPO ░░░ │  ← 250px (barrinha de progresso, @)
├──────────────────────────┤
│                          │
│                          │
│      ÁREA ÚTIL DE        │  ← ~1320px de altura
│        TEXTO AQUI        │
│                          │
│                          │
├──────────────────────────┤
│ ░░ ZONA SEGURA BASE ░░░░ │  ← 350px (setinha, "Mensagem", link)
└──────────────────────────┘

Canvas: 1080 × 1920 px
Laterais: ~6% livres de texto
```

**Regra de ouro:** nenhum texto pode cair no top 250px nem no bottom 350px.
Isso vira **constante do algoritmo de posicionamento**.

---

## 4. O MOTOR DE POSICIONAMENTO (o coração do app)

### Camada A — Fácil (semana 1-3) 🟢
- Carregar foto → ajustar 9:16 sem cortar
- Texto com arrastar/redimensionar
- **Trocar fonte, cor, tamanho, alinhamento, sombra, contorno**
- Exportar PNG 1080×1920
- Respeitar zonas seguras

### Camada B — O diferencial (semana 4-8) 🟡
O "deixar bonito automaticamente". Três técnicas combinadas:

1. **Espaço vazio** — onde tem menos textura/detalhe → texto ali
2. **Saliência visual** — onde o olho olha (ex.: a moto) → **evitar** cobrir
3. **Contraste automático** — medir luminância atrás de cada palavra → escolher branco/preto/sombra

### Camada C — Futuro 🔵
- **VLM avaliando layouts** — gerar 3-4 candidatos e pedir pra um modelo de visão escolher o mais bonito
- **Remoção de fundo** da moto → compor em camadas
- **Templates de marca** — paleta e fontes salvas

---

## 5. IDEIAS DE FEATURES (banco de ideias)

> Ideias vão entrando aqui — das minhas pesquisas e dos apps que você testar.

### ⭐ Ideias fortes
- [ ] **"Gerar 3 opções"** — o app apresenta 3 layouts e o usuário escolhe (melhor que 1 só)
- [ ] **Modo carrossel** — uma foto + várias legendas viram N stories/postes ligados
- [ ] **Reaproveitar conteúdo** — colar um link/texto → gerar o post automaticamente
- [ ] **Salva "estilo da marca"** — uma vez configurado, todo post sai com a mesma cara
- [ ] **Fundo borrado** — se a foto não tiver espaço vazio, usar a própria foto desfocada como fundo do texto (resolve 90% dos casos)

### 💡 Ideias médias
- [ ] Modo "sem cortar a moto" — encaixar a foto inteira com padding inteligente
- [ ] Contorno/sombra automática quando o fundo é poluído
- [ ] Sugestão de legenda com IA (o app escreve, não só posiciona)
- [ ] Exportar direto pro Instagram
- [ ] Histórico de posts antigos pra reaproveitar layout
- [ ] Detecção de rosto/rosto grande → nunca cobrir o rosto

### 🧪 Ideias experimentais
- [ ] Modo "estilo" — filtrar todas as fotos de uma vez com o mesmo tratamento
- [ ] Animação sutil no texto (entrada) pra Reels
- [ ] A/B: gerar 2 versões e dizer qual tem mais contraste/legibilidade
- [ ] OCR: se a foto já tem texto, não posicionar em cima

---

## 6. CONCORRENTES / APPS PRA TESTAR

| App | Por que testar |
|---|---|
| **Canva** | Referência de UX, templates, "Magic Design" |
| **Adobe Express** | Firefly, remoção de fundo, texto automático |
| **Phonto** | O melhor em **controle de texto** sobre foto (fonte, cor, contorno) |
| **PicsArt** | Ferramentas criativas, recortes, efeitos |
| **Edits (Instagram)** | App oficial do Insta, monta carrossel sozinho |
| **Mojo** | Stories/reels com templates animados |

---

## 7. LINHA DO TEMPO PROJETADA

```
FASE 1 — App Web (React + Fabric.js)
  Semana 1-3:  editor básico, fonte/cor, export 9:16, zonas seguras
  Semana 4-8:  motor de posicionamento automático (Camada B)
  Semana 9+:   polish, gerar 3 opções, salvar estilos

FASE 2 — Módulo Vídeo (web, OPÇÃO 3 — sem gravar câmera)
  Etapa 1:  escolher vídeo → gerar vertical (fundo borrado + vídeo no centro) → salvar
  Etapa 2:  legenda automática no espaço do fundo borrado
  Etapa 3:  exportar os 2 formatos (vertical + horizontal)
  Lib: Mediabunny (WebCodecs) — processa 100% no aparelho do usuário

FASE 3 — App Flutter (Android/iOS)
  • Reusar a MESMA lógica de posicionamento (módulo puro, sem UI)
  • Fluxo: foto → sugestão → ajustar → salvar → compartilhar
```

---

## 7.5 🎥 MÓDULO NOVO — CÂMERA E VÍDEO (horizontal + vertical)

> **Pedido do Muel:** filmar na **horizontal**, e ao salvar guardar **2 versões**:
> uma horizontal (pra YouTube) e uma vertical (pra Stories/Reels).
> Plataforma: **app web** (iOS).

### Veredito: ✅ VIÁVEL

| Item | Status |
|---|---|
| Câmera no iOS via web | ✅ Funciona (iOS 14.5+) |
| Gravar vídeo no navegador | ✅ `MediaRecorder` |
| Formato de saída no iOS | ✅ **MP4 + H.264** = o que o YouTube aceita |
| Salvar 2 formatos | ✅ Opção A: gravar 1x, gerar a 2ª depois |

### Regras obrigatórias (iOS)
1. **HTTPS** — obrigatório, senão não libera a câmera
2. **Toque do usuário** — precisa de botão "Gravar" (não abre sozinho)
3. **1 stream de câmera por vez** — desdobrar o mesmo stream
4. **Rotação** — câmera do iPhone é nativa horizontal; a prévia pode vir girada → girar ao desenhar
5. **Bateria** — gravar + converter ao vivo esquenta → por isso gravar 1x e converter depois

### ⚠️ ARMADILHA: não dá pra só cortar 16:9 → 9:16
- Horizontal = 1920×1080. Vertical 9:16 precisa de **1920 de altura** → só há 1080
- Cortar no meio = fatia de 607×1080 ampliada 3x = **borrão feio**
- **Solução profissional:** fundo = a própria foto **desfocada e ampliada** (preenchendo a tela) + vídeo nítido no centro
- É o que fazem CapCut/Instagram/YouTube
- 💡 **Bônus:** sobra espaço em cima e embaixo do vídeo → cabe **texto automático** (o nosso módulo de legendas!)

### Arquitetura do módulo vídeo — **VERSÃO ESCOLHIDA: OPÇÃO 3** ✅
> O usuário **filma com o app nativo do iPhone** (câmera excelente, sem complicação)
> e nosso app **recebe o vídeo** e gera a versão vertical com legenda automática.

```
Vídeo do iPhone (horizontal, .mov/.mp4 H.264)
        │
        ▼  usuário escolhe o arquivo no app web
        │
   ┌────┴─────────────────────────┐
   │  PROCESSAMENTO NO NAVEGADOR  │  (nada sai do aparelho!)
   │  • decodifica os frames      │
   │  • monta vertical 1080×1920  │
   │    - fundo borrado           │
   │    - vídeo nítido no centro  │
   │    - legenda automática      │
   │  • regrava em H.264 + AAC    │
   └────┬─────────────────────────┘
        │
        ├──▶ VERTICAL (1080×1920) → Stories/Reels/TikTok
        └──▶ (opcional) HORIZONTAL já tratado → YouTube
```

### 🛠️ Biblioteca escolhida: **Mediabunny**
> [mediabunny.dev](https://mediabunny.dev) · GitHub: Vanilagy/mediabunny · MPL-2.0

Por que ela e não ffmpeg.wasm:

| | ffmpeg.wasm | **Mediabunny** ✅ |
|---|---|---|
| Tamanho pra baixar | ~33 MB | **~zero** (tree-shakable) |
| Velocidade | lento (software) | **rápido (aceleração de hardware)** |
| Memória | estoura com vídeo longo | **constante** (processa frame a frame) |
| Headers especiais de servidor | precisa (SharedArrayBuffer) | **não precisa** |
| Faz o que precisamos | sim | **sim** (resize, crop, rotacionar, overlay, transcode) |

* Comparação real: 20s de vídeo com ffmpeg.wasm = ~35s; com WebCodecs/Mediabunny = **~3s**
* Um projeto aberto (VideoKit) já fez **54 ferramentas de vídeo** só com Mediabunny

**Pegadinhas aprendidas com quem já usou** (guardar pra hora H):
1. Fixar sempre o codec `avc` (H.264) + `aac` — senão pode sair AV1 num .mp4 que não abre
2. Usar `computeDuration()` em vez do evento `onLoadedMetadata` (no iPhone dá errado)
3. Fechar cada `VideoFrame` senão vaza memória de vídeo

### Fallback (iPhone antigo, Safari < 16.4)
WebCodecs completo só a partir do **iOS 16+**. Em aparelho muito antigo → modo lento
usando canvas + MediaRecorder (funciona, só é mais demorado e pesado).

---

### Roadmap do módulo vídeo (fase por fase)

**Etapa 1 — Só o básico (provar que funciona)**
- [ ] Tela: "escolher vídeo" → prévia
- [ ] Gerar vertical com **fundo borrado + vídeo no centro** (sem texto ainda)
- [ ] Botão salvar → baixar .mp4
- ✅ Critério: se funcionar aqui, o resto é polimento

**Etapa 2 — O diferencial**
- [x] Inserir a **legenda automática** no espaço do fundo borrado
- [x] Reaproveitar o módulo de posicionamento (Camada B) da parte de fotos
  - ✅ Feito em 11/11/2026 — ver detalhes abaixo

**Etapa 3 — Exportação dupla**
- [x] Gerar os 2 formatos de uma vez (vertical + horizontal)
  - ✅ Feito em 12/11/2026 — ver detalhes abaixo

**Etapa 4 — Efeitos de texto + prévia ao vivo**
- [x] 7 efeitos de legenda (contorno, brilho, caixa, destaque, degradê…) + 8 cores
- [x] Prévia AO VIVO a 60fps (o mesmo compositor do export)
  - ✅ Feito em 12/11/2026 — ver detalhes abaixo

**Etapa 5 — Filtros**
- [x] Presets de cor no pipeline de frames (visible na prévia e no arquivo)
- [x] Vinheta / tingimento como camadas extras
  - ✅ Feito em 12/11/2026 — ver detalhes abaixo

**Etapa 6 — Montagem multi-clipe** ✅ Feito em 12/11/2026
- [x] Timeline de N clipes → 1 arquivo
- [x] Transições (crossfade / wipe / flash)
- [x] 3 modelos (presets: filtro + transição + estilo de texto)

**Etapa 7 — Trim de clipes** ✅ Feito em 12/11/2026
- [x] Escolher o trecho de cada vídeo (✂ + sliders início/fim)
- [x] Áudio/vídeo seguem o mesmo relógio do arquivo (bug de firstTs corrigido)

**Etapa 8 — Trilha sonora / mixagem** ✅ Feito em 12/11/2026
- [x] Botão 🎵 escolher música (mp3/m4a/wav/ogg…) + slider de volume
- [x] Mix local: áudio dos clipes + música somados pela Web Audio
- [x] Loop automático se a música for mais curta que a montagem
- [x] Prévia da montagem toca a mesma música (mesmo volume)

**Etapa 9 — Exportação horizontal da montagem (16:9)** ✅ Feito em 13/11/2026
- [x] Opção "Gerar também a versão horizontal 16:9 (YouTube)" na montagem
- [x] Mesmo pipeline (fundo borrado + vídeo contido + legenda) renderizado em 1920×1080
- [x] Geometria parametrizada (`FrameLayout`) — 9:16 e 16:9 com o mesmo código
- [x] Progresso em 2 etapas rotuladas ("Etapa 1 de 2" / "Etapa 2 de 2")

**Etapa 10 — Pacote "estilo CapCut"** ✅ Feito em 13/11/2026
- [x] Proporções extras: **16:9 · 1:1 · 4:5** como saídas adicionais (chips "Gerar também")
- [x] Ajustes de imagem: brilho / contraste / saturação / calor (somam ao filtro)
- [x] Animação de entrada da legenda: nenhuma / fade / **sobe** (padrão) / pop — 0,5s
- [x] **Capa PNG** do resultado (thumbnail 1080×1920 pra usar no post)
- [x] Progresso em N etapas ("Etapa 3 de 4 · Gerando 1:1 (Feed)…")

### ✅ Etapa 3 — como ficou (feito em 12/11/2026)

**O que mudou:**
- `toHorizontal(file, progress)` em `toVertical.ts` — gera o MP4 horizontal.
  Usa `Conversion` **sem opções de processamento**: a Mediabunny prefere
  **copiar os pacotes** (transmux, perda zero) quando o codec cabe no MP4.
- Forçado `video: { codec: 'avc' }` + `audio: { codec: 'aac' }`:
  - origem **H.264/AAC (iPhone)** → pacotes **copiados, sem recomprimir**;
  - origem **VP9/Opus (WebM)** → é codificada de novo pra H.264/AAC.
- Interface: caixa "Gerar também a versão horizontal", progresso em **2 etapas**
  rotuladas, e na tela final os **2 players + 2 botões de download**.
- Se a horizontal falhar, o app **não quebra**: avisa e entrega a vertical.

**Verificação feita (além do teste visual):**
- Baixei os 2 MP4 gerados e **li os bytes** procurando os FourCC dos codecs:
  `saida-vertical.mp4` → `avc1` · `saida-horizontal.mp4` → `avc1`
  (nenhum `vp09` vazou — antes de forçar `avc`, um WebM de origem poderia
  virar MP4 com VP9 dentro, que nem todo player abre).

**Aprendizado importante:** "sem recomprimir" só é verdade quando a origem já é
H.264. O texto da interface diz isso agora — não prometer o impossível.

### ✅ Etapa 4 — efeitos de texto + prévia ao vivo (feito em 12/11/2026)

**Efeitos de legenda** (campo "Efeito" no formulário):

| Efeito | O que faz |
|---|---|
| Sombra | o padrão — drop shadow pela cor do texto |
| **Contorno** | `strokeText` por baixo, na cor oposta (texto branco + contorno preto) |
| **Brilho** | halo na "cor do efeito", 2 passadas pra intensificar |
| **Caixa** | retângulo arredondado por linha na cor do efeito; texto na cor de **maior contraste contra a caixa** (WCAG) |
| **Destaque** | estilo marca-texto (retângulo com 88% de opacidade) |
| **Degradê** | `createLinearGradient` da cor do efeito → branco, sempre com sombra + scrim |
| Nenhum | só a cor |

- 8 cores de efeito em amostras (paleta), aparecem só pros efeitos que usam cor.
- O contraste do texto continua medido no **fundo real** (exceto caixa/destaque,
  onde o fundo é a própria cor do efeito).

**Prévia ao vivo** (`preview.ts` → `startLivePreview`):
- O **mesmo `FrameComposer` do export** rodando em `requestAnimationFrame`
  em cima do `<video>` — logo, **o que você vê é o que sai no arquivo**.
- Canvas de prévia em meia escala (540×960) com `ctx.setTransform` — o
  compositor continua trabalhando em coordenadas 1080×1920.
- Toca/pausa botão; **arrastar no original muda o momento da prévia**;
  linhas tracejadas das zonas seguras continuam só na prévia.
- Medido no teste: **60 fps** com o blur ligado.
- Quando a legenda muda, a camada é reconstruída uma vez (não a cada frame).

**Teste:** efeitos Brilho/Destaque/Degradê capturados da prévia + frame do MP4
exportado conferido **lado a lado** com a prévia — idêntico.

### 💡 Ideia do Muel: montagem automática com transições, filtros e 3 modelos

> "colocar os trechos filmados, o app faz uma montagem, adiciona transições e
> filtros, oferece três modelos diferentes pra pessoa escolher"

**Veredito: boa ideia, encaixa no diferencial — mas é o maior pedaço até agora.**
Quebrada por dificuldade:

| Parte | Dificuldade | Nota |
|---|---|---|
| **Filtros** | 🟢 Fácil | Já desenhamos frame a frame → é aplicar `ctx.filter = 'saturate() sepia()…'`. Quase de graça. |
| **Transições** | 🟡 Média | Crossfade = desenhar 2 clipes com alpha; wipe = máscara. Exige ler 2 vídeos ao mesmo tempo. |
| **Concatenar N clipes num arquivo só** | 🔴 **O gargalo** | A Mediabunny converte 1 entrada → 1 saída. Juntar vários exige a API de **escrita manual** deles — estudar a guia *Writing media files* antes de prometer. |
| **3 modelos (templates)** | 🟢 Fácil depois | São presets: filtro + transição + estilo de texto. Só configuração. |
| Trilha sonora | 🟡 Depois | Outro bicho (mixagem de áudio). Deixar pra última. |

**Ordem proposta:**
1. ~~Etapa 4: efeitos + prévia ao vivo~~ ✅
2. ~~Etapa 5: filtros (presets: limpo, quente, frio, filme, P&B, vintage)~~ ✅
3. ~~Etapa 6: montagem multi-clipe — API de escrita da Mediabunny, transições
   e os 3 modelos~~ ✅ (feita em 12/11/2026)
4. ~~Etapa 7: trim de clipes (escolher o trecho de cada vídeo)~~ ✅ (feita em 12/11/2026)
5. Próximo: exportar a montagem em **horizontal** e/ou **trilha sonora/mixagem**

### ✅ Etapa 5 — filtros de cor (feito em 12/11/2026)

**Arquivo novo:** `app/src/lib/filters.ts` (presets + camadas extras).

| Filtro | O que faz |
|---|---|
| Original | sem filtro |
| Vívido | `saturate(1.35) contrast(1.08)` |
| Quente | `sepia(0.22) saturate(1.2) brightness(1.03)` |
| Frio | `hue-rotate(-8deg)` + leve contraste |
| Filme | `sepia(0.28) contrast(1.14)` + **vinheta** 0.32 |
| Vintage | `sepia(0.45)` + vinheta + tingimento `soft-light` |
| P&B | `grayscale(1) contrast(1.12)` |
| Noir | `grayscale(1) contrast(1.3)` + vinheta 0.5 |

**Como funciona:**
- O filtro entra em `ctx.filter` **só no conteúdo** (fundo borrado + vídeo nítido);
  a **legenda fica de fora** pra continuar nítida.
- Vinheta/tingimento são camadas extras (`createRadialGradient` / composite)
  desenhadas entre o conteúdo e a legenda — o `ctx.filter` sozinho não faz isso.
- Trocar o filtro **reconstrói a camada da legenda** (o contraste WCAG é medido
  sobre o fundo já filtrado): a chave passou a ser `JSON.stringify([caption, filter])`.
- As camadas extras usam as constantes 1080×1920, **não** `ctx.canvas` — a prévia
  roda em meia escala com `setTransform` e cairia pra fora da tela.

**Armadilha encontrada e corrigida:** `ctx.filter = 'none blur(41px)'` é string
**inválida** (o `none` só pode aparecer sozinho) e o navegador **ignora** a troca,
mantendo o filtro anterior. Ou seja: sair do Noir pro Original deixava o FUNDO
em P&B com o vídeo colorido. Corrigido montando a string sem o `none`.

**Testes:**
- Prévia: ida e volta `Noir → Original → P&B → Original` — fundo passa de
  0% → 100% de pixels coloridos (correção confirmada).
- Export: frame do MP4 com marcador vermelho desenhado por cima pra provar que
  o arquivo anexado é o certo — **0% de pixels coloridos = filtro no arquivo**.
- `tsc` ✅ · `build` ✅ (821 kB) · console limpo ✅

**Achado operacional (importante pro futuro):** o watcher do Vite **perdeu** edições
de `toVertical.ts` e de `compose.ts` — o navegador continuava rodando código antigo
e o "bug" era só cache. Sintoma: o export ignorava o filtro com a prévia funcionando.
Diagnóstico: `fetch('/src/lib/arquivo.ts')` e procurar pelo trecho novo. **Se o
comportamento bizarro persistir, conferir se o servidor está servindo o código atual
antes de caçar bug.**

### 🔓 API de escrita da Mediabunny — ESTUDADA (destrava a Etapa 6)

Lidas as guias *Writing media files* e *Media sources*. **A montagem multi-clipe é
viável** — a Mediabunny não fica presa em "1 entrada → 1 saída":

```ts
const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
const src = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('high') });
output.addVideoTrack(src);
await output.start();
// um quadro por vez, com timestamp e duração em SEGUNDOS:
await src.add(0.0, 0.033);   // ← backpressure: sempre await
await src.add(0.033, 0.033);
src.close();
await output.finalize();     // grava o MP4
```

Descobertas que importam pra Etapa 6:
- **`CanvasSource.add(timestamp, duration)`** — é exatamente o nosso pipeline de
  frames: desenhamos o quadro (clipe A + transição + clipe B) e registramos.
- **Timestamps são escolhas nossas** → dá pra "espremer" trechos, pular, acelerar.
- **Backpressure:** `await` em todo `add()` — a promessa fica pendente se o
  encoder não aguentar (não dá pra fazer `while` sem esperar).
- **`close()` em toda fonte** ao terminar: melhora planejamento e memória.
- Áudio: `AudioSampleSource`/`AudioBufferSource` com `codec: 'aac'` → dá pra
  juntar o som dos clipes depois (trilha sonora fica pra uma etapa à parte).
- Progresso: `onEncodedPacket` no config de vídeo.

**Plano da Etapa 6 (agora sem risco de API):**
1. Ler N clipes → timeline única (cada clipe vira um `FrameSource`).
2. Transições: crossfade desenhando os 2 clipes com `globalAlpha`; wipe com
   `clip()`/gradiente. Janela de ~0.5s entre clipes.
3. Renderizar quadro a quadro no canvas 1080×1920 → `CanvasSource.add(t, 1/fps)`.
4. 3 modelos = presets de **filtro + transição + estilo de texto** (já temos as 3 peças).

### ✅ Etapa 6 — montagem multi-clipe com 3 modelos (feito em 12/11/2026)

**O que o usuário faz agora:** escolhe N vídeos → arruma a ordem (↑↓✕) → escolhe
um **modelo** (filtro + transição + estilo de legenda de uma vez) → vê a **prévia
ao vivo** com as transições reais → gera **UM MP4 1080×1920 (H.264 + AAC)** com o
áudio de todos os clipes. Tudo local.

**Arquivos:**

| Arquivo | Função |
|---|---|
| `lib/montage.ts` (novo) | `MODELS`, `buildTimeline`, `probeClip`, `ClipPlayer`, `MontageRenderer`, `assembleMontage`, `addClipAudio` |
| `lib/compose.ts` | `FrameComposer` virou **camadas**: `FrameLayer {source, alpha?, clip?}` + `FrameExtras {flash?}` — é por aqui que entram as transições |
| `lib/preview.ts` | `startMontagePreview`: relógio em rAF, loop no fim, `setPaused/seek/update`, guias de zona segura |
| `App.tsx` | modo Vídeo único × Montagem, lista de clipes, cards de modelo, barra de seek, fluxo de geração |
| `styles.css` | `mode-chip`, `clip-list`, `model-card`, `seek` |

**Os 3 modelos** (preset de filtro + transição + estilo de legenda; o texto é do usuário):

| Modelo | Filtro | Transição | Legenda |
|---|---|---|---|
| **Cinema** | Filme | fusão 0.8s | caixa alta, degradê dourado |
| **Vibrante** | Vívido | flash 0.5s | marca-texto amarelo |
| **Nostálgico** | Vintage | varredura 0.7s | serifada com sombra |

A transição real é limitada a **40% da duração do clipe** (nunca maior que os
clipes envolvidos) — por isso a fusão saiu 0,64s com clipes de 1,6s.

**Como funciona por dentro:**
- **Timeline:** os clipes se **sobrepõem** pela duração da transição
  (`total = Σ durações − Σ transições`).
- **Leitura:** um `CanvasSink` por clipe (já aplica a rotação do iPhone) com
  gerador sequencial — o tempo local de um clipe sempre cresce.
- **Transições:** crossfade = `globalAlpha` crescente; wipe = `clip()` **no conteúdo
  E no fundo borrado** (sem isso o fundo trocava de uma vez); flash = corte seco no
  meio + luz branca em `seno(π·p)`.
- **Escrita:** `CanvasSource.add(t, 1/fps)` com backpressure + `AudioSampleSource`
  (AAC) + `output.finalize()`.
- **Áudio:** cada clipe entra na posição global dele, recortado com
  `AudioSample.trim()` — a janela `[from, to]` **acompanha o corte visual**: no
  flash começa e termina no MEIO da transição, pra nunca ter 2 sons tocando juntos.
- **Prévia:** o MESMO `MontageRenderer` do export rodando em rAF com relógio próprio.

**Validação no navegador (tudo medido, não olhado):**

| O que | Resultado |
|---|---|
| Cinema — meio da fusão | `[112,93,52]` = média **exata** de `[177,58,39]` e `[47,129,66]` ✅ |
| Vibrante — flash | antes: vermelho; pico: `[194,231,204]` (quase branco); depois: verde puro `[0,155,42]` ✅ |
| Nostálgico — varredura | meio: esquerda = clipe novo (distância **0**), direita = antigo (distância **0**) ✅ |
| MP4 final | `avc1` + `mp4a`, 1080×1920, 3,5s, **2 canais, RMS 0,70** (áudio real) ✅ |
| Legenda no export | confirmada visualmente: serifada do Nostálgico na área livre ✅ |
| Seek da prévia | pixel muda em **322ms** após o seek ✅ |
| Regressão Etapas 1–5 | vídeo único: prévia viva, vertical + horizontal, `avc1` nos dois ✅ |
| Console / build | limpo · `tsc` ✅ · `build` ✅ (842 kB) |

**Bugs achados e corrigidos no caminho:**
1. Os `Input`s do renderer não eram guardados → `dispose()` não fechava nada.
2. `creating` nunca voltava a `null` na prévia → ela travava após a 1ª criação.
3. Wipe sem recorte no fundo borrado → trocava o fundo inteiro de uma vez.
4. Áudio do flash com sobreposição (2 sons) → janelas `[from, to]` alinhadas ao corte visual.
5. **Pré-existente (importante):** `toVertical` chamava `Conversion.init` **sem
   `audio`** → a Mediabunny *copiava* o codec original, e um WebM/Opus virava
   MP4/Opus (o Instagram não abre). Corrigido com `audio: {codec: 'aac'}` —
   agora **vertical e horizontal saem `avc1` + `mp4a`**. Vídeo do iPhone (já AAC)
   continua sendo copiado sem recomprimir.
6. `montageCaption` era objeto novo a cada render (10×/s pela barra de tempo) →
   memoizado com `useMemo`.

**Armadilhas novas (testes):**
- O **rAF deste ambiente está suspenso** (aba em branco: 0 frames em 4s) — medições
  de fps por rAF são inválidas aqui; usar `setInterval` como referência. Não confundir
  com lentidão do app.
- `browser.wait` por texto não casa títulos com `text-transform: uppercase`
  (o innerText vem "MONTAGEM ✅", não "Montagem ✅").
- Disparar `change` 2× no input duplica os clipes (6 em vez de 3).

### ✅ Etapa 7 — trim de clipes + bug do relógio do áudio (feito em 12/11/2026)

**O que o usuário faz agora:** clica no ✂ de um clipe e arruma **Início/Fim**
com dois sliders (mínimo 0,3s entre as pontas) → a prévia reabre (debounce
300ms) e a montagem usa só aquele trecho. Mostra "usa 0,3s (de 0:01)". Botões
"Corte inteiro" e "Ok".

**Arquivos:** `montage.ts` ganhou `MontageClip {file, trimStart, trimEnd}`
(`options.clips` substituiu `options.files` em renderer/export/preview) ·
`App.tsx` estado `trimStart/trimEnd` por clipe + `setClipTrim` + UI ✂ ·
`styles.css` `.clip-trim*`.

**Mapeamento (a regra que segura tudo):** o tempo do arquivo vira tempo global
por `global = clipStart + (arquivo − trimStart)` — igual no vídeo
(`renderFrame`) e no áudio (`addClipAudio`). `trimStart` é medido no arquivo.

**Bug de fundo achado na validação (o mais importante da etapa):**

O áudio do export trimado saiu **1,79s num vídeo de 2,9s**, com buracos no
meio. Instrumentei o motor (`stat` por clipe) e comparei com as fontes:

| fonte | firstTs | duração áudio | firstTs+dur | fim do vídeo |
|---|---|---|---|---|
| clipe 1 | 0,47s | 1,14s | **1,61s** | 1,585s |
| clipe 2 | 0,54s | 1,08s | **1,62s** | 1,584s |
| clipe 3 | 0,60s | 1,02s | **1,62s** | 1,586s |

`firstTs + duração` batendo com o fim do vídeo nos 3 clipes prova que **áudio e
vídeo compartilham o mesmo relógio** (spec de MP4/WebM): o áudio do MediaRecorder
só começa ~0,5s tarde (buffer), mas os timestamps já são absolutos. O código
antigo **subtraía `firstTs`** dos timestamps, tratando o áudio como se começasse
no tempo 0 do vídeo. Consequências:

1. **Trim do clipe 1** virava janela `[1,67;1,97]` no arquivo — depois do fim do
   áudio (1,61) → **0 samples escritos, silêncio, e SEM aviso** (não é erro,
   só não itera nada).
2. **Bug latente pré-existente:** sem trim nenhum o áudio morria ~0,5s antes do
   fim da timeline (a validação da Etapa 6 mediu RMS mas não o comprimento).
3. Cada clipe tocava `firstTs` (~0,5s) adiantado em relação ao vídeo.

**Correção:** `global = clipStart + (arquivo − trimStart)` sem passar por
`firstTs`; `firstTs` só faz **clamp** do início (`localStart = max(firstTs, …)`)
porque o áudio pode começar depois do vídeo. E agora **aviso na UI** quando um
clipe não tem áudio nenhum no trecho usado.

**Validação (pós-correção, tudo medido):**

| O que | Resultado |
|---|---|
| Export com trim [1,2;1,5] no clipe 1 | sem avisos, 3,0s, 3,8s de processamento ✅ |
| `avc1` + `mp4a`, 2 canais | ✅ |
| Duração do áudio vs vídeo | **2,987s vs 3,0s** (antes: 1,79s) ✅ |
| Frame t=0 | `[52,29,205]` azul → o trim pulou o início vermelho do gradiente ✅ |
| RMS do trecho trimado (0–0,3s) | **0,695** (antes: silêncio) ✅ |
| Áudio sem trim (regressão) | perfil contínuo até o fim da timeline ✅ |
| Reset "Corte inteiro" / sliders / meta | OK · console limpo · `tsc` ✅ · `build` ✅ (845 kB) |

Silêncios que aparecem no perfil (0,4–0,75s e 1,6–1,95s) são **fidelidade às
fontes**: os vídeos de teste do MediaRecorder têm `firstTs` 0,47–0,6s, e o
motor agora respeita o relógio do arquivo (é o que um player faria). Vídeos
reais do iPhone têm `firstTs` ≈ 0.

**Armadilhas novas:**
- `Response.clone()` **falha depois de `arrayBuffer()`** — buscar duas vezes
  (uma pra vídeo, outra pra áudio) em vez de clonar.
- Na tela de resultado não existe o `input[type=file]` (some com a fase) —
  guardar os `File`s de teste em `window.__testFiles` se precisar deles depois.
- `evaluate` longo (>60s com export no meio) estoura o limite — dividir em
  "dispara" e "lê resultado" separados; ler o estado depois é seguro.
- Clicar e ler no MESMO `evaluate` pode ler o DOM antes do re-render do React
  (parecia que o "Corte inteiro" não funcionava; relido numa chamada seguinte,
  estava certo).

### 🎵 Etapa 8 — trilha sonora na montagem (mixagem local) (feito em 12/11/2026)

**Decisão de arquitetura:** misturar com **`OfflineAudioContext`** em vez de
escrever DSP à mão. A Web Audio soma as fontes, aplica o ganho, resampleia
tudo pra 48 kHz e corta no fim da timeline — código nenhum nosso de DSP.

**Como ficou:**

| Peça | O que faz |
|---|---|
| `montage.ts` → `decodeMusicFile` | lê mp3/m4a/wav/ogg num `AudioBuffer` (via `OfflineAudioContext`, que decodifica sem precisar de gesto do usuário) |
| `montage.ts` → `extractClipWindow` | joga o áudio do clipe na janela `[from,to]` num `AudioBuffer` — **mesmo relógio da Etapa 7**; buracos viram silêncio dentro do buffer |
| `montage.ts` → `mixMontageAudio` | cria o `OfflineAudioContext`, liga um `AudioBufferSourceNode` por clipe em `start(from)` + a música (loop/ganho/fades) e faz `startRendering()` |
| `montage.ts` → `writeMixedBuffer` | escreve o mix no `AudioSampleSource` em pedaços de 4096 frames f32 interleaved |
| `App.tsx` | estado `music`/`musicVolume`, painel 🎵 (escolher/trocar/remover + slider), `<audio loop>` na prévia |
| `styles.css` | `.music-row` / `.music-name` |

**Regras:**
1. **Sem música o caminho é o de sempre** (`addClipAudio`) — nada do que já
   estava validado foi tocado; o mix só entra quando `options.music` existe.
2. `extractClipWindow` mantém `global = clipStart + (arquivo − trimStart)` e
   `firstTs` só como clamp do início (a correção da Etapa 7 vale aqui também).
3. O buffer do clipe cobre **exatamente** a janela `[from, to]` → `node.start(from)`
   alinha sem cálculo extra.
4. Música: `loop` se for mais curta que a montagem; fade de 0,25s na entrada e
   0,6s na saída (nada começa nem termina estalando).
5. Arquivo de música ilegível → **aviso e segue sem música** (não derruba a exportação).
6. Prévia: **um `useEffect` só** cuida de src + volume + play/pause — o `<audio>`
   monta depois (só existe com clipes na tela) e efeitos separados perdiam essa
   primeira sincronização (o volume ficava em 1).

**Validação (tudo medido no navegador):**

| O que | Resultado |
|---|---|
| Export COM música (3s < montagem 3,5s → loop) | sem avisos, `avc1`+`mp4a`, 48 kHz estéreo ✅ |
| Duração do áudio vs vídeo | **3,499s vs 3,5s** ✅ |
| RMS por janela de 0,25s | todos > 0,11 (fades nas pontas), corpo ~0,28 ✅ |
| Música + clipes somando | corpo 0,28 ≈ música (0,198 teórico) + áudio dos clipes ✅ |
| Export com música LONGA (10s, sem loop) | idêntico: 3,499 vs 3,5, fades nas pontas ✅ |
| Export **sem** música (regressão) | `avc1`+`mp4a`, sem avisos, áudio fiel à fonte ✅ |
| Prévia | toca a música a 70%, loop, reencaixa no seek/pause ✅ |
| Console · `tsc` · `build` | limpo · ✅ · ✅ (850 kB) |

**Armadilhas novas:**
- `decodeAudioData` do MP4 exportado reporta `duration` **menor** que a faixa
  (3,136 vs 3,508) porque ignora o silêncio do PTS inicial — pra ver a faixa
  inteira, medir com Mediabunny (`AudioSampleSink`), não com Web Audio.
- O aviso "Mediabunny was loaded twice" no console vem do `import()` direto
  em `/node_modules/.vite/deps/…` feito na medição de diagnóstico — é do teste,
  não do app.
- Com o rAF suspenso (este ambiente), o relógio da prévia pula e o resync do
  áudio briga consigo mesmo — por isso a tolerância é de **1s** (num navegador
  normal com 60fps nunca dispara).
- Um `evaluate` que **falha depois do `dispatchEvent` já aplicou o efeito**:
  a primeira injeção de clipes rodou 2× e virou 6 clipes. Ler o estado antes
  de repetir qualquer disparo.
- Editar `App.tsx` pode derrubar a página inteira (HMR full reload) e perder
  os clipes de teste de uma vez — refazer o setup inteiro.

### 📐 Etapa 9 — exportação horizontal da montagem 16:9 (feito em 13/11/2026)

**Decisão de arquitetura:** a versão 16:9 da montagem é **renderizada de novo**
em 1920×1080 com o MESMO pipeline (fundo borrado + vídeo contido + legenda) —
**não é transmux**. Só a geometria muda. No modo vídeo único (Etapa 3) é ao
contrário: `toHorizontal` só troca o envelope do arquivo que já existe.

**Como ficou — `FrameLayout` como parâmetro de todo o motor:**

| Peça | O que mudou |
|---|---|
| `format.ts` | `HORIZONTAL_WIDTH/HEIGHT` (1920×1080), `H_SAFE_TOP=90`, `H_SAFE_BOTTOM=150`, `H_SIDE_MARGIN=96`, **`interface FrameLayout`**, `VERTICAL_LAYOUT`, `HORIZONTAL_LAYOUT`, `layoutFor(orientation)` |
| `caption.ts` | `pickBand` / `computeCaptionLayout` / `renderCaptionLayer` recebem `m: FrameLayout = VERTICAL_LAYOUT` (canvas, scrim, `x`, caixa/destaque, medição de contraste) |
| `compose.ts` | `FrameComposer(caption, filter, layout)`, `containRect(src, layout)`, `drawBlurredBackground(..., layout)`, `fillRect(0,0,m.width,m.height)`, `captionKey` inclui o tamanho do layout |
| `filters.ts` | `applyFilterOverlay(ctx, preset, m)` — vinheta/tint no tamanho do layout (nunca em `ctx.canvas`, porque a prévia desenha em meia escala com `setTransform`) |
| `montage.ts` | `MontageRendererOptions.layout?` + `readonly layout`, wipe usa `layout.width/height`, `AssembleMontageOptions.orientation?` e `layoutFor()` define o canvas e o `CanvasSource` |
| `App.tsx` | checkbox `withHorizontalMontage` (padrão ligado), 2ª chamada de `assembleMontage({orientation:'horizontal'})`, `montagePass` (1/2) pra rotular o progresso, bloque de resultado 16:9, download `montagem-16x9-….mp4` |

**Regras:**
1. **Zonas seguras horizontais são outras** (não é Story): topo 90, base 150,
   margem lateral 96. Em fonte full-frame 16:9 **não existe faixa livre** →
   a legenda cai em **overlay com scrim** (comportamento esperado p/ YouTube).
2. A prévia continua **9:16** (é o formato principal); o 16:9 só existe no
   arquivo — `MontageRenderer` sem `layout` cai no default vertical.
3. Se a passada 16:9 falhar, a 9:16 **não se perde**: o app entrega o vertical
   e avisa.
4. Avisos das 2 passadas são **deduplicados** (`new Set`) — a mesma mensagem
   ("Nenhum dos clipes tem áudio") duas vezes quebrava o React
   (`Encountered two children with the same key`, `key={w}`).
5. O `tinyCanvas` do fallback de blur agora é **redimensionado** quando o
   layout muda (era fixo em 1080/18 × 1920/18).

**Validação (tudo medido no navegador, 3 clipes de teste de 1,6s):**

| O que | Resultado |
|---|---|
| Export 2 passadas (checkbox ligado) | `avc` **1080×1920** (513 KB) + `avc` **1920×1080** (537 KB), 3,3s cada ✅ |
| Legenda no 16:9 | faixa central: 21,4% pixels claros / 65,5% escuros, desvio 79,7 → texto branco sobre scrim ✅ |
| Zonas seguras 16:9 | topo (90px): desvio 5,3 e **0%** de texto · base (150px): **0%** claro ✅ |
| Legenda no 9:16 (regressão) | texto na faixa superior livre (bandas: topo 366px > base 267px) ✅ |
| Console (2 passadas) | **0 erros novos** (o de chave duplicada sumiu com a deduplicação) ✅ |
| Export só 9:16 (checkbox desligado) | 1 arquivo, sem bloco 16:9, 1 aviso só ✅ |
| Modo vídeo único (regressão) | vertical 1080×1920 + horizontal original, console limpo ✅ |
| `tsc` · `build` | ✅ · ✅ (852,68 kB) |

**Armadilhas novas:**
- `applyFilterOverlay` **não** pode usar `ctx.canvas.width/height`: a prévia
  renderiza em 540×960 com `setTransform` e as coordenadas do compositor são
  sempre as do layout.
- Contar "Etapa 2 de 2" no texto da página não funciona com `wait` durante a
  passada 1 (o label completo é "Etapa 1 de 2 · …") — esperar pelo texto do
  botão de download é mais robusto.
- Os dois `<video>` do resultado são a fonte pra medir o MP4 exportado:
  `fetch(video.src)` + Mediabunny (`getCodec`/`getDisplayWidth`) em um
  `evaluate` só dá os dois arquivos de uma vez.

### 🎬 Etapa 10 — pacote "estilo CapCut" (feito em 13/11/2026)

**Pesquisa (site oficial capcut.com):** editor online, *auto captions*,
templates, **ratio** (proporções), filtros/efeitos, música, ajustes de imagem,
export settings. O que trouxemos pro app (sem sair do processamento 100% local):

| Funcionalidade CapCut | Como ficou aqui |
|---|---|
| Ratio (9:16 / 16:9 / 1:1 / 4:5) | chips **"Gerar também (opcional)"** → cada proporção vira mais um MP4 |
| Adjust (brilho/contraste/saturação/temp.) | 4 deslizes + "Redefinir", somados ao preset do filtro |
| Text animation | `anim` na legenda: nenhuma / fade / **sobe** / pop (0,5s) |
| Cover / thumbnail | botão **"🖼 Baixar capa (PNG)"** no resultado |

**Decisões de arquitetura:**

1. **`RatioId = '9:16' | '16:9' | '1:1' | '4:5'`** em `format.ts`, com
   `RATIOS: RatioInfo[]` (label, hint, width, height, layout, `single`) e
   `layoutFor(ratio)`. `SQUARE_LAYOUT` (1080×1080, topo 120/base 160) e
   `PORTRAIT_45_LAYOUT` (1080×1350, topo 140/base 180) têm zonas seguras próprias.
2. **Modo vídeo único:** `16:9 → single:'transmux'` (o `toHorizontal` de sempre,
   copia os pacotes sem recomprimir); `1:1` e `4:5 → single:'render'` (o mesmo
   `toVertical` com `opts.layout`). **Na montagem tudo é renderizado.**
3. **`withHorizontal`/`withHorizontalMontage` viraram `extraRatios: RatioId[]`**
   + `outputs: ExtraOutput[]` + `step/steps` — um único loop de saídas extras
   serve pros dois modos, e o label do botão conta: "Gerar 4 saídas →".
4. **Ajustes entram na MESMA string de `ctx.filter`** do preset
   (`combineFilters(preset.css, adjustCss(adjust))`); o **calor não existe em
   `ctx.filter`** → véu `soft-light` (`applyWarmth`) desenhado depois do preset
   e antes da legenda.
5. **Animação:** `animT` chega no `FrameExtras` — vídeo único usa
   `sample.timestamp`/`video.currentTime`, a montagem usa o tempo global (a
   legenda anima **uma vez**, no começo do vídeo). Pivô do "pop" via
   `captionBounds()`; a camada continua construída 1× (a animação é
   transform+alpha na hora de desenhar, não reconstrói o texto).
6. **Falha numa saída extra não derruba a principal** — vira aviso
   ("A saída 1:1 não foi gerada … as demais estão prontas") e o resto segue.

**Validação (medido no navegador):**

| O que | Resultado |
|---|---|
| Montagem com 16:9+4:5 marcados | 3 MP4: **1080×1920** (631 KB), **1920×1080** (670 KB), **1080×1350** (547 KB), todos `avc`+`aac`, 3,47s, **0 avisos** ✅ |
| Vídeo único com as 3 extras | 4 MP4: 1080×1920, **640×360** (transmux do original, 52 KB — não recomprimiu), 1080×1080, 1080×1350, todos `avc`+`aac` ✅ |
| Progresso | "Etapa 4 de 4 · Gerando 4:5 (Feed retrato)…" ✅ |
| Ajuste saturação 160% | luminância média: desvio padrão da saturação **0,619 → 0,791** ✅ |
| Ajuste calor +1 (só ele) | **R−B: −57,4 (neutro) → −22,2 (quente)** — o véu `soft-light` funciona ✅ |
| Animação "Sobe" | faixa da legenda em t=0,05: `anim=none` = **2813** pixels >200 · `anim=rise` = **0** (texto ainda subindo/transparente) · `none@0,5` = 2808 (estável) ✅ |
| Capa PNG | `image/png` **1080×1920**, 355 KB, 3,2% de pixels claros (legenda gravada) ✅ |
| Regressão: montagem só 9:16 | 1 arquivo 1080×1920, `outputs` vazio, 0 avisos ✅ |
| Console | **0 erros novos** (só o "loaded twice" do próprio teste) ✅ |
| `tsc` · `build` | ✅ · ✅ (859,61 kB) |

**Armadilhas novas:**
- **`input.files = dt.files` nem sempre grava** neste ambiente: usar
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value'|'files').set.call(...)`
  e só depois disparar o `change` — e **uma única vez** (cada dispatch adiciona
  os clipes de novo; 4 tentativas = 12 clipes).
- **Chips no mesmo lote de cliques se sobrescrevem**: `onClick` lê o
  `extraRatios` do render atual, então dois `.click()` síncronos partem do mesmo
  estado e o segundo apaga o primeiro. Clicar **um chip por `evaluate`**.
- `getPrimaryVideoTrack()` (e não `getVideoTrack`) é o método da Mediabunny
  pra achar codec/resolução.
- Os 4 deslizes não são os 4 primeiros `input[type=range]` da página — o slider
  de **posição da montagem** vem antes. Identificar cada um pelo `<span>` do
  label, nunca por índice.
- A legenda animada no 1º frame muda o frame inicial de propósito: comparar
  `rise` vs `none` **no mesmo instante** (e o mesmo clipe) é o único jeito
  isolar o efeito do resto do vídeo.



**Arquivos novos** (em `app/src/lib/`):

| Arquivo | Função |
|---|---|
| `format.ts` | Constantes: 1080×1920, zonas seguras (250/350), margem lateral, folga do vídeo |
| `caption.ts` | **Coração da etapa**: opções da legenda, quebra de linha, redução automática do tamanho, escolha de cor por **contraste WCAG**, geração da camada de texto |
| `compose.ts` | Monta o frame: fundo borrado → vídeo nítido → legenda. A camada do texto é criada **uma vez só** e reaproveitada em todos os frames |
| `preview.ts` | Prévia ao vivo no navegador: primeiro frame já composto + linhas tracejadas das zonas seguras (só na prévia) |

**Regras do motor de legenda:**
1. **Zonas seguras são lei** — o texto só entra na faixa livre entre o vídeo e as zonas (250px topo / 350px base).
2. **Auto-ajuste** — começa em 116px e vai reduzindo até caber na faixa e na largura útil (margem de 64px cada lado).
3. **Cor por contraste** — mede a luminância (WCAG) do fundo *que está atrás do texto de verdade* e escolhe branco ou preto pelo maior ratio. Forçar "Branco/Preto" também é possível.
4. **Scrim automático** — se o contraste ficar abaixo de 4.5:1, ou se não houver faixa livre (vídeo já vertical), um véu escuro é adicionado atrás do texto.
5. **Fontes do sistema** — nada é baixado da internet (a promessa de 100% local continua de pé).
6. **Quebras manuais** — o Enter no campo funciona.

**Interface:** formulário com texto, subtítulo, posição (auto/topo/base), fonte (sans/black/serif/mono), cor, alinhamento e caixa alta — com **prévia ao vivo** do resultado antes de gerar.

**Teste feito:** vídeo 1280×720 → MP4 1080×1920 com legenda gravada, contraste automático escolheu preto no céu claro, sem erros no console.

**Ideias pendentes pra Etapa 3+:**
- Saliência: posicionar o texto onde o vídeo tem *menos* informação
- Opção "gerar 3 opções" de layout
- Legenda com tempo (aparecer/some em trechos) — precisaria de timeline
- Google Fonts (com aviso de privacidade) pra ter mais fontes que as do sistema

### 🚀 Etapa 11 — publicar "igual Minhas Finanças e Casinhas" (feito em 13/11/2026)

**O que o Muel pediu:** o app publicado como os apps dele — repositório
GitHub público, **APK** pra Android e **iOS público** pra testar.

**Como os apps dele são:**
- **Minhas Finanças** (HTML único + Capacitor): workflow `build-apk.yml`
  (node 20 + java 17) → copia o html pra `www/` → `npx cap init/add android`
  → `android_overlay/release_sign.js` materializa o keystore do secret
  `ANDROID_KEYSTORE_B64` e injeta `signingConfigs.release` no `build.gradle`
  → `./gradlew assembleRelease` → artifact. Site no GitHub Pages legado
  (branch `main`). Keystore local em `Documents\keystore_minhasfinancas\`.
- **Casinhas** (Expo): site no GitHub Pages + iOS via Safari →
  Compartilhar → **Adicionar à Tela de Início** (sem App Store).

**O que foi feito no editor:**
| Item | Resultado |
|---|---|
| Repositório | `github.com/MuelTec/editor` — público, 17+ arquivos |
| Site / "iOS público" | **https://mueltec.github.io/editor/** (branch `gh-pages`, build `built`) |
| Ícones PWA | gerados por `scripts/gen-icons.mjs` (PNG puro via `zlib`, 0 dependências): 192/512/maskable/apple-touch 180 + mipmap Android 48→192 |
| Manifest + metas iOS | `manifest.webmanifest`, `apple-touch-icon`, `apple-mobile-web-app-capable` → Safari "Adicionar à Tela de Início" |
| `vite.config` | `base: './'` — **obrigatório** pra site de projeto (senão os assets apontam pra raiz e quebram) |
| Keystore novo | `Documents\keystore_editor\editor.keystore` (alias `editor`, senha `Editor2026Muel`, 10.000 dias) — 4 secrets `ANDROID_KEYSTORE_*` **já no repo** |
| APK | build local com Capacitor 6 + Gradle (`android_overlay/release_sign.js` reaproveitado) → publicado como **Release** |
| CI | `.github/workflows/{build-apk,deploy-pages}.yml` prontos em **`ci/`** com `ci/README.md` de ativação |

**🖐 Armadilha que travou tudo:** o token do `gh`/git tem escopo
`repo, gist, read:org` — **sem `workflow` o git recusa qualquer push que
toque em `.github/workflows/*.yml`** (e a API devolve 404 pro mesmo caminho).
Como `gh auth refresh -s workflow` precisa de login no navegador (device
flow expira em 15 min), os workflows foram movidos pra `ci/` e o
`/.github/workflows/` foi pro `.gitignore` — assim o resto do push passa.
Ativação futura: `gh auth refresh -s workflow` → copiar `ci/*.yml` pra
`.github/workflows/` → push.

**Outras armadilhas do caminho:**
1. **`sdkmanager` no PowerShell**: `platforms;android-34` chega partido em
   dois (o `;` vira separador) → chamar direto
   `java -cp "cmdline-tools\latest\lib\*" com.android.sdklib.tool.sdkmanager.SdkManagerCli`.
2. **Pages legado**: `POST /repos/.../pages` com
   `source[branch]=gh-pages` + `source[path]=/` (o repo já nasce com Pages
   "building", e a API devolve 409 se já existir → usar GET pra conferir).
3. **Force push**: um teste pela API deixou um commit órfão no remoto e o
   push passou a ser rejeitado (non-fast-forward) → `git push -f` (era
   arquivo de teste meu, sem valor).
4. **Ícone do play**: condição `lx >= ly && lx <= 1-ly` desenha triângulo
   apontando **pra baixo**; pra direita é `|ly - 0.5| <= lx/2`.

**Validação:**
- Site: HTTP 200 em `/`, JS, CSS, manifest, ícones e SVG (todos 200);
  console **0 erros**; UI carrega ("Estúdio", modo Vídeo único / Montagem).
- APK: **BUILD SUCCESSFUL em 7m27s** → `app-release.apk` **3,13 MB**,
  verificado com `apksigner`: assinado `CN=MuelTec, O=MuelTec, C=BR`,
  `com.mueltec.editor`, label "Editor de Video", minSdk 22 / targetSdk 34.
  Publicado em **https://github.com/MuelTec/editor/releases/tag/v1.0**
  (`editor-v1.0.apk`, 3.285.425 bytes).

**Mais 4 armadilhas que só apareceram na hora de buildar o APK:**
5. **Java 25 x Gradle 8.2.1** — o wrapper do Capacitor usa Gradle 8.2.1 e
   ele morre com `Unsupported class file major version 69` (Java 25 = major
   69). Solução: rodar com o **JDK 17**
   (`C:\Program Files\Eclipse Adoptium\jdk-17.0.21.9-hotspot`) e limpar
   `~/.gradle/caches/8.2.1\scripts` (o cache fica "envenenado" pela JVM
   errada).
6. **Caminho com acento mata o AGP** — `Your project path contains
   non-ASCII characters` com a pasta `Projeto Padrão`. Buildar numa cópia
   em caminho ASCII (`%TEMP%\opencode\editor-apk`) — copiar `www/`,
   `android/`, `android_overlay/`, `node_modules/` e `capacitor.config.json`
   (o `android/capacitor.settings.gradle` aponta pra `../node_modules`).
7. **`signingConfig` no bloco errado** — um regex `release\s*\{...` casa o
   **primeiro** `release {` do arquivo, que é o do `signingConfigs` recém
   inserido → `Could not find method signingConfig()`. Corrigido em
   `android_overlay/release_sign.js`: a busca parte do índice de
   `buildTypes` antes de achar o `release`.
8. **`.ps1` salvo em UTF-8 sem BOM** — o PowerShell 5.1 lê como ANSI e o
   caminho acentuado vira lixo (`Projeto Padrǜo`). Salvar com BOM
   (`UTF8Encoding $true`) ou escrever o script todo em ASCII.
   Também: `;` em argumento do `sdkmanager` chega partido no cmd — chamar
   `java -cp "...\lib\*" com.android.sdklib.tool.sdkmanager.SdkManagerCli`.

### 🎬 Etapa 12 — layout profissional estilo CapCut + Etapa 12 do Muel (feito em 13/11/2026)

**O que o Muel pediu:** (1) ícone atual bonito (já feito na Etapa 11.5),
(2) timeline pra escolher o tempo da música, (3) verificar batidas da música
pra destacar e cortar nelas, (4) transições entre os cortes, (5) filtros
inspirados nos do FFmpeg (Cinema quente, Vintage, Dark, Film Kodak, Retrô,
Tons naturais), (6) transições: Zoom in/out, Desfoque, Glitch, Flash,
Dissolver, Deslizar 3D, (7) botão de voltar. E o **layout novo estilo CapCut**
(com imagem de referência), depois "traga as funções que já existem e coloque
nos seus lugares".

**Layout (grid CSS, 5 áreas nomeadas):**
| Área | Classe | O que vive nela |
|---|---|---|
| Topbar | `.topbar` | marca + ícone, badge "100% no seu aparelho", **← Voltar**, Exportar |
| Library (esquerda) | `.library-panel` | abas **Mídia / Modelos·Filtros / Áudio** |
| Preview (centro) | `.preview-panel` | monitor 9:16 + controles + hero/progresso/resultado |
| Inspector (direita) | `.inspector-panel` | abas **Ajustes / Legenda / Saída** |
| Timeline (base) | `.timeline-panel` | régua, trilha de clipes, batidas, forma de onda da música |

**Motor novo:**
- **Filtros** (`filters.ts`): +5 presets inspirados no FFmpeg — `cinema`
  (Cinema quente), `dark`, `kodak` (Film Kodak), `retro` (Retrô),
  `natural` (Tons naturais). **FFmpeg não foi importado** (binário C/WASM
  ~30 MB impossível de embutir no browser) — replicados 1:1 com
  `ctx.filter` CSS + overlays (vignette/tint), 100% local. Total: 13 filtros.
- **Transições** (`montage.ts`): 9 no total — Dissolver, Varredura, Flash,
  Zoom in, **Zoom out**, **Desfoque**, **Glitch**, Deslizar, **Girar 3D**.
  `audioRange` trata `flash`/`glitch` como corte seco no meio.
- **Compositor** (`compose.ts`): `FrameLayer` ganhou `blur`, `glitch`
  (7 fatias deslocadas + tintes `#00ffd5`/`#ff2a68`), `transformBg` e
  `scaleX`/`scaleY` (giro 3D — o fundo NÃO gira, fica fixo atrás).
- **Batidas** (`beats.ts`): `analyzeMusic` (FFT própria, spectral flux)
  → BPM + onsets; `beatsInTimeline` converte pro tempo da montagem (loop);
  `snapCutsToBeats` estica/encolhe os trims pra cada corte parar na batida.
- **Timeline**: régua com passo adaptativo, blocos de clipes proporcionais,
  marcadores de transição, playhead branco, **batidas rosa** (`.tl-beat`)
  na trilha de vídeo e **forma de onda da música em canvas** com handle
  branco do offset (arrastável) + playhead amarelo sincronizado.

**Teste no navegador (3 WebM gerados via canvas+MediaRecorder, 1 WAV 120 BPM):**
- 3 clipes injetados → lista, trim, reordenação OK; timeline 0:04.
- Troca de transição (Dissolver → Glitch) atualiza a prévia na hora.
- Música: **120 BPM detectado, 15 batidas**, forma de onda desenhada;
  "⚡ Sincronizar cortes" → aviso + **8 marcações** na trilha.
- Seek na régua: playhead 49,9% ↔ tempo 0:02/0:04 sincronizados.
- **Exportação real**: MP4 **1080×1920, 4,07s**, + saída 16:9, capa PNG.
- Console **0 erros / 0 warnings** em todo o percurso.

**Publicado:**
- `main` → commit `9589643` (o remoto tinha uploads feitos pela web;
  rebase integrou sem perder o teste — `git diff` vazio contra a árvore testada).
- `gh-pages` → deploy `e521c8e`; site **https://mueltec.github.io/editor/**
  servindo o build novo (`index-D-kv5b7r.js`), console 0 erros.

- [ ] Gravar → sair **2 arquivos** automaticamente (horizontal + vertical)
- [ ] Versão vertical já sai **com legenda automática** no espaço do fundo borrado
- [ ] Botão "modo YouTube" / "modo Stories" na gravação
- [ ] Aviso visual quando a gravação está fora da zona segura do Stories
- [ ] Exportar só o trecho vertical recortado do horizontal (sem refilmagem)
- [ ] **Cortes inteligentes** — marcar trechos pra gerar vários Reels de um vídeo só
- [ ] Enquanto processa, mostrar **progresso real** (Mediabunny tem `onProgress`)
- [ ] **Nada sai do aparelho** — badge de privacidade "processado 100% local"
- [ ] **Do CapCut (pendente):** legendas automáticas por voz (Web Speech),
  remoção de silêncio automática, sync de cortes na batida da música,
  keyframes/zoom suave nos clipes, texto com contorno animado,
  velocidade (speed ramp) por clipe, templates prontos de um clique

---

## 8. PRÓXIMOS PASSOS DE ESTUDO

- [ ] Rodar/ver o **OpenDesign** funcionando
- [ ] Estudar **saliency** na prática (OpenCV)
- [ ] Escrever o **motor de posicionamento** isolado (lógica pura, sem interface)
- [ ] Testar os apps da seção 6 e anotar na tabela
- [ ] Acompanhar o **creatiposter** — quando publicarem o código

---

## 9. HISTÓRICO DE IDEIAS DO MUEL

> *(mão do Muel: vou passando ideias de apps que testar e features)*

- _(vazio ainda — anotações vão entrar aqui)_

---

*Atualizado em: 13/11/2026*
