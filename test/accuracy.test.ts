import { describe, expect, it } from 'vitest';
import {
  cameraAzimuth,
  cameraBearingLine,
  cameraFrom,
  radarFrom,
  radarToPixel,
  radarToPolar,
  rangeBearing,
  undistortPixel,
  distort,
  wrap180,
} from '../tools/accuracy.mjs';
import { parseYaml as parseYamlRaw } from '../tools/yaml-lite.mjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test reads arbitrary YAML trees
const parseYaml = (t: string) => parseYamlRaw(t) as Record<string, any>;
type Cam = NonNullable<ReturnType<typeof cameraFrom>>;

const RADAR_YAML = `
# radar params
image:
  width: 2048
  height: 2048
origin_px:            # own ship
  x: 1024
  y: 1024
range:
  scanner_range_m: 1000.0
  meters_per_pixel: 0.9765625    # 1000 / 1024
orientation:
  alignment: heading_up
  zero_bearing_offset_deg: 0.0
`;

const CAM_YAML = `
resolution:
  width: 3840
  height: 2160
camera_matrix:
  fx: 2146.96
  fy: 2156.19
  cx: 1890.34
  cy: 1047.55
distortion:
  model: rational_polynomial
  coefficients: [10.0915, 5.7468, 0.000285,
                 0.000198, 0.2691, 10.4667,
                 9.7925, 1.7015]
`;

describe('yaml-lite', () => {
  it('reads nested maps, comments, TBD and wrapped flow lists', () => {
    const y = parseYaml(`${CAM_YAML}\ncamera0:\n  yaw_deg: TBD   # candidate -30\n  roll_deg: 0.0\n`);
    expect(y.camera_matrix.fx).toBe(2146.96);
    expect(y.distortion.coefficients).toHaveLength(8);
    expect(y.distortion.coefficients[7]).toBe(1.7015);
    expect(y.camera0.yaw_deg).toBe('TBD');
    expect(y.camera0.roll_deg).toBe(0);
  });

  it('skips block lists', () => {
    const y = parseYaml('m:\n  matrix_3x3:\n  - - 1.0\n    - 0.0\n  fx: 5\n');
    expect(y.m.fx).toBe(5);
  });
});

describe('radar geometry', () => {
  const radar = radarFrom(parseYaml(RADAR_YAML)) as NonNullable<ReturnType<typeof radarFrom>>;

  it('reads radar_params.yaml', () => {
    expect(radar).toMatchObject({ originX: 1024, originY: 1024, metersPerPixel: 0.9765625, alignment: 'heading_up' });
  });

  it('puts dead ahead straight up and starboard to the right (heading-up)', () => {
    expect(radarToPolar(radar, 1024, 0, 123).bearing).toBeCloseTo(0);
    expect(radarToPolar(radar, 2048, 1024, 123).bearing).toBeCloseTo(90);
    expect(radarToPolar(radar, 1024, 0, 0).range).toBeCloseTo(1000);
  });

  it('round-trips pixel ↔ range/bearing, in both orientations', () => {
    for (const alignment of ['heading_up', 'north_up']) {
      const r = { ...radar, alignment };
      const p = radarToPixel(r, 640, -37, 227);
      const back = radarToPolar(r, p.x, p.y, 227);
      expect(back.range).toBeCloseTo(640, 6);
      expect(back.bearing).toBeCloseTo(-37, 6);
    }
  });
});

describe('camera geometry', () => {
  const cam = cameraFrom(parseYaml(CAM_YAML), { yaw_deg: 'TBD' }) as Cam;

  it('treats TBD extrinsics as unknown', () => {
    expect(cam.yawDeg).toBeNull();
    expect(cam.dist).toHaveLength(8);
  });

  it('undistorts back to the same pixel after distorting', () => {
    for (const [u, v] of [[0, 1047], [500, 300], [3840, 2160], [1890, 1047]] as [number, number][]) {
      const [x, y] = undistortPixel(cam, u, v);
      const [xd, yd] = distort(cam.dist, x, y);
      expect(cam.cx + cam.fx * xd).toBeCloseTo(u, 0);
      expect(cam.cy + cam.fy * yd).toBeCloseTo(v, 0);
    }
  });

  it('draws the bearing line through pixels at that bearing', () => {
    for (const pitch of [0, -15]) {
      const line = cameraBearingLine(cam, 20, pitch);
      expect(line.length).toBeGreaterThan(2);
      for (const [u, v] of line) expect(cameraAzimuth(cam, u, v, pitch)).toBeCloseTo(20, 0);
    }
  });

  it('has no line for a bearing behind the camera', () => {
    expect(cameraBearingLine(cam, 120)).toEqual([]);
  });

  it('is a pinhole when there is no distortion', () => {
    const pin = cameraFrom({ intrinsic_matrix: { fx: 1000, fy: 1000, cx: 500, cy: 500 }, distortion: null }, { rotation_deg: { yaw: 45, pitch: -15 } }) as Cam;
    expect(pin.dist).toBeNull();
    expect(pin.yawDeg).toBe(45);
    expect(cameraAzimuth(pin, 1500, 500, 0)).toBeCloseTo(45);
  });
});

describe('range and bearing', () => {
  it('matches the target files to within a metre', () => {
    // From RealDataset targets/gps: G7, range_m 629.2, true bearing = heading 227.64 + 1.2
    const g = rangeBearing(1.2903524, 103.90078707, 1.2866308, 103.8965233);
    expect(g.range).toBeCloseTo(629.2, 0);
    expect(wrap180(g.bearing - 227.64)).toBeCloseTo(1.2, 0);
  });
});
