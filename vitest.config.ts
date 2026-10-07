import { defineConfig } from 'vitest/config';

/**
 * Tests, configured apart from `vite.config.ts` on purpose.
 *
 * vitest 2 vendors its OWN copy of vite under `node_modules/vitest/node_modules`,
 * so a single config that imports `defineConfig` from `vitest/config` and hands
 * it a plugin built against the top-level vite fails to type-check: the two
 * `Plugin` types are structurally identical but nominally distinct, and
 * `exactOptionalPropertyTypes` makes the mismatch an error rather than a
 * warning. Splitting the files keeps each one talking to a single vite.
 *
 * Nothing is lost by it. These tests cover the two pure modules — the basemap
 * style and the opening view — which import no JSX and need no React plugin.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
