import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createApi } from './server/api.mjs';

/**
 * The app build and the dev server. Tests are configured separately in
 * `vitest.config.ts` — see the note there for why the two are not one file.
 *
 * `base: './'` makes the built bundle path-relative, so serve.mjs can hand it
 * out from any mount point without the asset URLs having to agree with it in
 * advance.
 */

/**
 * The same /api and /data routes serve.mjs mounts, so `npm run dev` reads the
 * configured sources exactly as production does.
 */
function chartliteApi(): Plugin {
  return {
    name: 'chartlite-api',
    configureServer(server) {
      const api = createApi();
      server.middlewares.use((req, res, next) => {
        api(req, res).then((handled: boolean) => { if (!handled) next(); }, next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), chartliteApi()],
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
