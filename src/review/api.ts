/** Client for the review routes in server/api.mjs. */

export interface FrameList {
  source: string;
  scenario: string;
  sensor: string;
  kind: string;
  /** URL prefixes. Append `encodeURIComponent(file)` or `encodeURIComponent(stem) + '.json'`. */
  imageBase: string;
  bboxBase: string;
  /** Image file names in time order. */
  frames: string[];
}

/** One 2D box, as written in groundtruth/<SCN>/<sensor>/2dbbox/<stem>.json. Pixel coordinates. */
export interface Box {
  id: number | string;
  xmin: number;
  ymin: number;
  width: number;
  height: number;
  class: string;
  subclass?: string | null;
  pattern?: string | null;
  encounter_geometry?: string | null;
  occluded?: boolean;
}

/** sensor → frame stem → ISO time it was accepted. */
export type ScenarioReviews = Record<string, Record<string, string>>;

/** source → scenario dir → sensor → accepted count. */
export type ReviewSummary = Record<string, Record<string, Record<string, number>>>;

/** Prefix for every API URL: the page may be mounted below the site root. */
const BASE = new URL('.', window.location.href).pathname.replace(/\/$/, '');

export function url(path: string): string {
  return `${BASE}${path}`;
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${String(r.status)}`;
    try { msg = ((await r.json()) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

export async function fetchFrames(source: string, scenario: string, sensor: string): Promise<FrameList> {
  const q = new URLSearchParams({ source, scenario, sensor });
  return json<FrameList>(await fetch(url(`/api/frames?${q.toString()}`)));
}

export async function fetchReviews(source: string, scenario: string): Promise<ScenarioReviews> {
  const q = new URLSearchParams({ source, scenario });
  return json<ScenarioReviews>(await fetch(url(`/api/reviews?${q.toString()}`)));
}

export async function fetchSummary(): Promise<ReviewSummary> {
  return json<ReviewSummary>(await fetch(url('/api/reviews/summary')));
}

export async function postReview(body: {
  source: string; scenario: string; sensor: string; frames: string[]; accepted: boolean;
}): Promise<ScenarioReviews> {
  return json<ScenarioReviews>(await fetch(url('/api/reviews'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

/** Boxes for one frame, or null when the frame has no annotation file. */
export async function fetchBoxes(bboxUrl: string): Promise<Box[] | null> {
  const r = await fetch(bboxUrl);
  if (r.status === 404) return null;
  const raw = await json<{ objects?: unknown }>(r);
  return Array.isArray(raw.objects) ? (raw.objects as Box[]) : [];
}

export function stemOf(file: string): string {
  return file.replace(/\.[^.]+$/, '');
}
