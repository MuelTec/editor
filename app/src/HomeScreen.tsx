/**
 * Tela inicial (estilo CapCut): ocupa a tela toda enquanto não existe projeto.
 * O editor só é montado depois que o usuário escolhe um modo ou uma ferramenta.
 */

export type HomeToolId = 'musica' | 'filtros' | 'legendas' | 'ajustes';

interface Props {
  onNewProject: () => void;
  onNewMontage: () => void;
  onTool: (id: HomeToolId) => void;
}

const TOOLS: { id: HomeToolId; icon: string; label: string; hint: string }[] = [
  { id: 'musica', icon: '🎵', label: 'Música', hint: 'Trilha na batida' },
  { id: 'filtros', icon: '🎞️', label: 'Filtros', hint: 'Estilo e transição' },
  { id: 'legendas', icon: '💬', label: 'Legendas', hint: 'Texto automático' },
  { id: 'ajustes', icon: '🎚️', label: 'Ajustes', hint: 'Cor e enquadramento' },
];

const STEPS = [
  'Escolha os arquivos',
  'Ajuste legenda e trilha',
  'Exporte o MP4',
];

export default function HomeScreen({ onNewProject, onNewMontage, onTool }: Props) {
  return (
    <div className="home">
      <div className="home-bg" aria-hidden="true" />

      <header className="home-top">
        <div className="home-brand">
          <img className="home-brand-icon" src="./icon.svg" alt="" width={30} height={30} />
          <span className="home-brand-name">Estúdio</span>
        </div>
        <span className="badge-local" title="Seu vídeo nunca sai deste dispositivo">
          100% no seu aparelho
        </span>
      </header>

      <main className="home-body">
        <section className="home-hero">
          <p className="home-hero-kicker">Editor de vídeo vertical</p>
          <h1>
            Faça seu próximo <span className="home-grad">vídeo 9:16</span>
          </h1>
          <p className="home-hero-sub">
            Legenda automática, trilha na batida, filtros e transições — tudo
            processado aqui no seu dispositivo.
          </p>
        </section>

        <section className="home-actions" aria-label="Começar">
          <button className="home-card home-card--primary" onClick={onNewProject}>
            <span className="home-card-icon" aria-hidden="true">
              +
            </span>
            <span className="home-card-text">
              <strong>Novo projeto</strong>
              <small>Um vídeo · 9:16</small>
            </span>
          </button>

          <button className="home-card home-card--ghost" onClick={onNewMontage}>
            <span className="home-card-icon" aria-hidden="true">
              ⧉
            </span>
            <span className="home-card-text">
              <strong>Montagem</strong>
              <small>Vários clipes juntos</small>
            </span>
          </button>
        </section>

        <section className="home-section">
          <h2 className="home-section-title">Ferramentas</h2>
          <div className="home-tools">
            {TOOLS.map((t) => (
              <button key={t.id} className="home-tool" onClick={() => onTool(t.id)}>
                <span className="home-tool-icon" aria-hidden="true">
                  {t.icon}
                </span>
                <span className="home-tool-label">{t.label}</span>
                <span className="home-tool-hint">{t.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="home-section">
          <h2 className="home-section-title">Como funciona</h2>
          <ol className="home-steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <span className="home-step-num">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="home-foot">
        Seus arquivos nunca saem do aparelho · nada é enviado para a internet
      </footer>
    </div>
  );
}
