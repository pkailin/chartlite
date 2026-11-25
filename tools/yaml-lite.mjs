/**
 * Just enough YAML for the dataset's calibration files, so the server stays
 * dependency-free.
 *
 * Handles: nested maps by indentation, scalars (numbers, booleans, null,
 * quoted or bare strings), `#` comments, and flow lists `[a, b, …]` that may
 * wrap across lines. Block lists (`- item`) are skipped: no field read from
 * these files uses one. `TBD` stays the string "TBD", and callers treat any
 * non-number as unknown.
 */

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) return line.slice(0, i);
  }
  return line;
}

export function scalar(text) {
  const t = text.trim();
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((x) => scalar(x));
  }
  return t;
}

export function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = stripComment(lines[i] ?? '');
    if (line.trim() === '' || line.trim().startsWith('- ') || line.trim() === '-') continue;
    const indent = line.length - line.trimStart().length;
    const m = /^\s*([^:]+?)\s*:(?:\s+(.*)|\s*)$/.exec(line);
    if (!m) continue;
    const key = m[1].replace(/^["']|["']$/g, '');
    let rest = (m[2] ?? '').trim();
    // A flow list that wraps: keep reading lines until it closes.
    if (rest.startsWith('[') && !rest.includes(']')) {
      while (i + 1 < lines.length && !rest.includes(']')) rest += ` ${stripComment(lines[++i] ?? '').trim()}`;
    }
    while (stack.length > 1 && (stack[stack.length - 1]?.indent ?? -1) >= indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (rest === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = scalar(rest);
    }
  }
  return root;
}
