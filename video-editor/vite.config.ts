import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// 本番ビルドはリポジトリ直下の /editor/ に出力し、GitHub Pages で https://<user>.github.io/editor/ として公開する。
const outDir = '../editor';

function swManifest() {
  return {
    name: 'sw-precache-manifest',
    apply: 'build' as const,
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).replace(/\\/g, '/'));
        }
      };
      walk(outDir);
      const precache = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('fonts/'));
      const version = Date.now().toString(36);
      writeFileSync(join(outDir, 'precache.json'), JSON.stringify({ version, files: precache }));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), swManifest()],
  build: { outDir, emptyOutDir: true, target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
} as any);
