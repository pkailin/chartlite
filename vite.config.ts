import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The app build and the dev server. Tests are configured separately in
 * `vitest.config.ts` — see the note there for why the two are not one file.
 *
 * `base: './'` makes the built bundle path-relative, so serve.mjs can hand it
 * out from any mount point without the asset URLs having to agree with it in
 * advance.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 3300,
    // Fail rather than silently moving to 3301: a dev server on an unexpected
    // port is how two of them end up running and one of them gets edited.
    strictPort: true,
  },
});
