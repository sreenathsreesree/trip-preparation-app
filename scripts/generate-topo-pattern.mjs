// Generates assets/images/topo-pattern.svg: decorative topographic contour
// lines used behind hero cards. Contours are true iso-lines (marching squares
// over a smooth height field), so they never cross. Deterministic output.
// Usage: node scripts/generate-topo-pattern.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 800;
const HEIGHT = 480;
const CELL = 5;
const LEVELS = 16;

const hills = [
  { x: 620, y: 110, sx: 190, sy: 140, h: 1.0 },
  { x: 150, y: 400, sx: 170, sy: 150, h: 0.85 },
  { x: 390, y: 250, sx: 120, sy: 90, h: 0.45 },
  { x: 760, y: 430, sx: 140, sy: 120, h: 0.5 },
  { x: 60, y: 60, sx: 120, sy: 100, h: 0.35 },
];

function height(x, y) {
  let value = 0;
  for (const hill of hills) {
    const dx = (x - hill.x) / hill.sx;
    const dy = (y - hill.y) / hill.sy;
    value += hill.h * Math.exp(-(dx * dx + dy * dy));
  }
  // Gentle ridges so lines are organic rather than elliptical.
  value += 0.05 * Math.sin(x / 47 + y / 83) + 0.04 * Math.cos(y / 39 - x / 121);
  return value;
}

const cols = Math.ceil(WIDTH / CELL) + 1;
const rows = Math.ceil(HEIGHT / CELL) + 1;
const grid = [];
let min = Infinity;
let max = -Infinity;
for (let j = 0; j < rows; j += 1) {
  const row = [];
  for (let i = 0; i < cols; i += 1) {
    const v = height(i * CELL, j * CELL);
    row.push(v);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  grid.push(row);
}

function interp(p1, p2, v1, v2, level) {
  const t = (level - v1) / (v2 - v1);
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}

function segmentsFor(level) {
  const segments = [];
  for (let j = 0; j < rows - 1; j += 1) {
    for (let i = 0; i < cols - 1; i += 1) {
      const corners = [
        [i * CELL, j * CELL],
        [(i + 1) * CELL, j * CELL],
        [(i + 1) * CELL, (j + 1) * CELL],
        [i * CELL, (j + 1) * CELL],
      ];
      const values = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
      const crossings = [];
      for (let e = 0; e < 4; e += 1) {
        const a = e;
        const b = (e + 1) % 4;
        if ((values[a] < level) !== (values[b] < level)) {
          crossings.push(interp(corners[a], corners[b], values[a], values[b], level));
        }
      }
      if (crossings.length === 2) segments.push([crossings[0], crossings[1]]);
      if (crossings.length === 4) {
        segments.push([crossings[0], crossings[1]], [crossings[2], crossings[3]]);
      }
    }
  }
  return segments;
}

const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

function joinSegments(segments) {
  const byPoint = new Map();
  segments.forEach((segment, index) => {
    for (const point of segment) {
      const k = key(point);
      if (!byPoint.has(k)) byPoint.set(k, []);
      byPoint.get(k).push(index);
    }
  });
  const used = new Set();
  const lines = [];
  segments.forEach((segment, start) => {
    if (used.has(start)) return;
    used.add(start);
    const line = [segment[0], segment[1]];
    for (const direction of ['forward', 'backward']) {
      for (;;) {
        const tip = direction === 'forward' ? line[line.length - 1] : line[0];
        const next = (byPoint.get(key(tip)) ?? []).find((index) => !used.has(index));
        if (next === undefined) break;
        used.add(next);
        const [a, b] = segments[next];
        const other = key(a) === key(tip) ? b : a;
        if (direction === 'forward') line.push(other);
        else line.unshift(other);
      }
    }
    lines.push(line);
  });
  return lines;
}

function toPath(points) {
  const simplified = points.filter((_, index) => index % 3 === 0 || index === points.length - 1);
  if (simplified.length < 3) return null;
  const at = (i) => simplified[Math.max(0, Math.min(simplified.length - 1, i))];
  let d = `M${at(0)[0].toFixed(1)} ${at(0)[1].toFixed(1)}`;
  for (let i = 0; i < simplified.length - 1; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

const paths = [];
for (let l = 1; l <= LEVELS; l += 1) {
  const level = min + ((max - min) * l) / (LEVELS + 1);
  const major = l % 4 === 0;
  const d = joinSegments(segmentsFor(level))
    .filter((line) => line.length > 6)
    .map(toPath)
    .filter(Boolean)
    .join('');
  if (d) {
    paths.push(
      `<path d="${d}" stroke-opacity="${major ? 0.55 : 0.24}" stroke-width="${major ? 1.4 : 1}"/>`,
    );
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" fill="none" stroke="#9DCBE5" stroke-linecap="round">
${paths.join('\n')}
</svg>
`;

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images', 'topo-pattern.svg');
writeFileSync(out, svg);
console.log(`Wrote ${out} (${svg.length} bytes, ${paths.length} contour levels)`);
