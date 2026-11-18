import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// OpenPencil ビューアの単独ビルド（Vue）。出力は public/pen-viewer/ → Umi がそのまま dist にコピーする。
// pm-web 本体（React / mako）とは別バンドルにして、CanvasKit（WASM）と OpenPencil を必要な時だけ読む。
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [
    vue(),
    {
      // @open-pencil/core 0.16.0 の dist に `new URL("./export-worker.ts", import.meta.url)` が残っている（.js が正）
      name: 'open-pencil-dist-worker-ext',
      enforce: 'pre',
      transform(code, id) {
        if (!id.includes('/@open-pencil/') || !id.includes('/dist/')) return;
        if (!/new URL\("\.\/[^"]+\.ts"/.test(code)) return;
        return code.replace(/new URL\("(\.\/[^"]+)\.ts"/g, 'new URL("$1.js"');
      },
    },
  ],
  build: {
    outDir: fileURLToPath(new URL('../public/pen-viewer', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    reportCompressedSize: false,
  },
});
