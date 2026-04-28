import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  server: { port: 5180, host: '127.0.0.1' },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: { runner: resolve(__dirname, 'runner.html') },
    },
    target: 'esnext',
  },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
