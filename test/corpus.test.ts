import { describe, expect, it } from 'vitest';
import {
  axisCoverage,
  headsToGeoJSON,
  isStationary,
  parseCorpus,
  routesToGeoJSON,
  type Axis,
  type Corpus,
  type Scenario,
} from '../src/data/corpus';

function scenario(id: string, sea: string | null, camera: number, radar = 0): Scenario {
  return {
    id: `Syn/${id}`, source: 'Syn', scenario: id, dir: id, date: null, startTime: null, durationS: 10,
    targets: [], odd: { sea_state_code: sea },
    route: [{ lon: 104, lat: 1.2333, t: 0, heading: null }, { lon: 104, lat: 1.2393, t: 10_000, heading: null }],
    fixes: 2, fixesDegraded: 0, fixesDropped: 0, streams: [], frames: { camera, radar },
  };
}

const SEA: Axis = { key: 'sea_state_code', label: 'Sea state', values: ['0', '1', '2', '3'] };

describe('axisCoverage', () => {
  const scns = [scenario('A', '1', 100), scenario('B', '1', 50, 7), scenario('C', '3', 20), scenario('D', null, 5)];

  it('counts frames and scenarios per value, keeping the empty values', () => {
    const c = axisCoverage(scns, 'camera', SEA);
    expect(c.frames).toEqual([0, 150, 0, 20]);
    expect(c.scenarios).toEqual([0, 2, 0, 1]);
    expect(c.unknownFrames).toBe(5);
    expect(c.unknownScenarios).toBe(1);
    expect(c.total).toBe(175);
  });

  it('counts only scenarios that have the selected sensor kind', () => {
    const c = axisCoverage(scns, 'radar', SEA);
    expect(c.frames).toEqual([0, 7, 0, 0]);
    expect(c.scenarios).toEqual([0, 1, 0, 0]);
    expect(c.total).toBe(7);
  });
});

describe('geometry', () => {
  it('tells a ~670 m transit from a stationary scenario', () => {
    expect(isStationary(scenario('A', '1', 1).route)).toBe(false);
    expect(isStationary([{ lon: 104, lat: 1.2333, t: 0, heading: null }])).toBe(true);
  });

  it('gives each scenario a route and a head with matching numeric ids', () => {
    const corpus: Corpus = { ...parseCorpus({ version: 4, scenarios: [] }), scenarios: [scenario('A', '1', 1)], sources: [{ name: 'Syn', path: '', scenarios: 1, error: null }] };
    const r = routesToGeoJSON(corpus).features[0];
    const h = headsToGeoJSON(corpus).features[0];
    expect(r?.id).toBe(0);
    expect(h?.id).toBe(0);
    expect(r?.properties?.['ink']).toBe('#C8102E');
  });
});

describe('parseCorpus', () => {
  it('rejects an unknown version', () => {
    expect(() => parseCorpus({ version: 3, scenarios: [] })).toThrow(/version/);
    expect(() => parseCorpus(null)).toThrow();
  });
});
