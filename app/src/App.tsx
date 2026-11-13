import { useState } from 'react';

export default function App() {
  return (
    <div className="editor-container">
      {/* 1. TOPBAR */}
      <header className="topbar">
        <div className="brand">Estúdio Editor</div>
        <div className="top-actions">
          <button className="btn-export">Exportar</button>
        </div>
      </header>

      {/* 2. LIBRARY PANEL */}
      <aside className="library-panel">
        <div className="library-tabs">
          <div className="lib-tab active">Áudio</div>
          <div className="lib-tab">Texto</div>
          <div className="lib-tab">Efeitos</div>
          <div className="lib-tab">Transições</div>
        </div>
        <div className="library-content">
          <p className="label-small">Arraste os elementos para a timeline</p>
          {/* Aqui entrarão os vídeos/efeitos futuramente */}
        </div>
      </aside>

      {/* 3. PREVIEW PANEL */}
      <main className="preview-panel">
        <div className="preview-monitor">
          <span>Monitor de Vídeo</span>
        </div>
        <div className="preview-controls">
          <span>00:00 / 00:30</span>
        </div>
      </main>

      {/* 4. INSPECTOR PANEL */}
      <aside className="inspector-panel">
        <div className="inspector-tabs">
          <span className="active">Vídeo</span>
          <span>Animação</span>
          <span>Ajuste</span>
        </div>
        <div className="inspector-section">
          <h4>Position & Size</h4>
          <label className="label-small">Escala</label>
          <input type="range" disabled style={{ width: '100%' }} />
        </div>
      </aside>

      {/* 5. TIMELINE PANEL */}
      <footer className="timeline-panel">
        <div className="timeline-toolbar">
          <span>Barra de ferramentas</span>
        </div>
        <div className="timeline-scroll">
          <div className="timeline-track">Vídeo 1</div>
          <div className="timeline-track">Vídeo 2</div>
          <div className="timeline-track">Áudio</div>
        </div>
      </footer>
    </div>
  );
}
