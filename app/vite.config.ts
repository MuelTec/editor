import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // base relativo: necessário para publicar em GitHub Pages (site de projeto)
  base: './',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
