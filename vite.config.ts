import { defineConfig } from 'vite';

// Caminhos relativos: o build funciona em qualquer subpasta (ex.: GitHub Pages em /Phi_eldLab/).
export default defineConfig({
  base: './',
  server: {
    // Case/ é uma área de testes local: mudanças lá não recarregam o app
    watch: { ignored: ['**/Case/**'] },
  },
});
