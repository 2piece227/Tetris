import type { IVec3 } from "../game/vec";

const hex = (c: number): string => "#" + c.toString(16).padStart(6, "0");

/** Scale each RGB channel toward white (k > 0) or black (k < 0). */
function shade(color: number, k: number): string {
  const ch = (shift: number): number => {
    const v = (color >> shift) & 0xff;
    return Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  };
  return hex((ch(16) << 16) | (ch(8) << 8) | ch(0));
}

/**
 * A piece as a small isometric drawing, for the next-piece slot.
 *
 * SVG rather than a third 3D view: it is one shape that changes a few times a
 * minute, and drawing it in the page keeps it crisp at any size and costs the
 * scene nothing.
 */
export function pieceIcon(cells: IVec3[], color: number): string {
  const min = (sel: (c: IVec3) => number): number => Math.min(...cells.map(sel));
  const [mx, my, mz] = [min((c) => c.x), min((c) => c.y), min((c) => c.z)];
  const cubes = cells
    .map((c) => ({ x: c.x - mx, y: c.y - my, z: c.z - mz }))
    // Painter's order: furthest first. The view looks down from +x,+y,+z.
    .sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z));

  const S = 20;
  const pt = (x: number, y: number, z: number): [number, number] => [
    (x - z) * S * 0.866,
    (x + z) * S * 0.5 - y * S,
  ];
  const all: [number, number][] = [];
  const faces: string[] = [];
  const top = shade(color, 0.3);
  const front = hex(color);
  const side = shade(color, -0.3);

  for (const { x, y, z } of cubes) {
    const quad = (pts: [number, number, number][], fill: string): void => {
      const p = pts.map(([a, b, c]) => pt(a, b, c));
      all.push(...p);
      faces.push(
        `<polygon points="${p.map(([u, v]) => `${u.toFixed(1)},${v.toFixed(1)}`).join(" ")}" fill="${fill}" stroke="#05060a" stroke-width="1.2" stroke-linejoin="round"/>`
      );
    };
    quad([[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], top);
    quad([[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]], front);
    quad([[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]], side);
  }

  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const pad = 4;
  const vx = Math.min(...xs) - pad;
  const vy = Math.min(...ys) - pad;
  const vw = Math.max(...xs) - vx + pad;
  const vh = Math.max(...ys) - vy + pad;
  return `<svg viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" role="img">${faces.join("")}</svg>`;
}
