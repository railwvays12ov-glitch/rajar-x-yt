import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:8080';

/** In dev, fill the runtime placeholder the production server normally replaces. */
const devBaseUrl = (): Plugin => ({
  name: 'rajar-dev-base-url',
  apply: 'serve',
  transformIndexHtml: (html) => html.replaceAll('__PUBLIC_BASE_URL__', process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'),
});

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  plugins: [react(), tailwindcss(), devBaseUrl()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/robots.txt': { target: API, changeOrigin: false },
      '/sitemap.xml': { target: API, changeOrigin: false },
    },
  },
  preview: { port: 4173 },
});
