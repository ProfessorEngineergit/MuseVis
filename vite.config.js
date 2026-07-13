import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets work for both <user>.github.io and <user>.github.io/<repo>/.
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
