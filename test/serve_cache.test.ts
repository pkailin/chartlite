import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs server, deliberately stdlib-only and
// build-free so it runs on a host that has only checked out the repo.
import { cacheControl } from '../serve.mjs';

/*
 * These exist because the rule was wrong once, in a way the server could not
 * see. `tracks.json` was served `immutable, max-age=31536000`, so re-running
 * the adapter changed nothing on screen: the browser had been told it could
 * keep the file for a year and never asked again. No error, no second request
 * in the log, no way to tell from the server that anything was stale.
 */
describe('cacheControl', () => {
  it('lets Vite’s content-hashed assets be cached hard', () => {
    expect(cacheControl('/app/dist/assets/index-BZ9WDxNF.js')).toMatch(/immutable/);
    expect(cacheControl('/app/dist/assets/index-BArp1IEh.css')).toMatch(/immutable/);
  });

  /* The regression. A fixed filename may never be immutable. */
  it('makes ingested data revalidate', () => {
    expect(cacheControl('/app/dist/tracks.json')).toBe('no-cache');
  });

  it('makes index.html revalidate, since it names the hashed assets', () => {
    expect(cacheControl('/app/dist/index.html')).toBe('no-cache');
  });

  /*
   * The point of testing by SHAPE rather than by name: a data file added
   * later is covered without anyone remembering to add it here.
   */
  it('defaults any future fixed-name file to revalidate', () => {
    for (const f of ['/d/weather.json', '/d/sessions.csv', '/d/public/notes.md', '/d/favicon.ico']) {
      expect(cacheControl(f)).toBe('no-cache');
    }
  });

  it('is not fooled by a hyphen in a fixed name outside assets/', () => {
    expect(cacheControl('/app/dist/my-tracks-latest.json')).toBe('no-cache');
  });
});
