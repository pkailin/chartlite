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
/**
 * Identifies this build, and only this build.
 *
 * App appends it to the tracks URL. That is not belt-and-braces on top of the
 * cache headers — it fixes a case the headers CANNOT reach: a browser that
 * already stored tracks.json under a bad `immutable, max-age=1y` directive
 * keeps honouring it for a year, and never asks the server again to discover
 * the rule has changed. A new URL has no such entry, so it is fetched.
 *
 * Per BUILD rather than per load: a reload inside one build still hits cache,
 * which matters when the file is megabytes of fixes.
 */
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
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
