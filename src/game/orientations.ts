import { Axis, IVec3, rotate } from "./vec";

/** A quarter turn, as found by the orientation search. */
export type Step = { kind: "rotate"; axis: Axis; dir: 1 | -1 };

export const key = (cells: IVec3[]): string => {
  const mx = Math.min(...cells.map((c) => c.x));
  const my = Math.min(...cells.map((c) => c.y));
  const mz = Math.min(...cells.map((c) => c.z));
  return cells
    .map((c) => `${c.x - mx},${c.y - my},${c.z - mz}`)
    .sort()
    .join("|");
};

/**
 * Every orientation the piece can be turned into, with the shortest sequence of
 * quarter turns that gets there.
 *
 * Breadth-first so the demo takes the short way round rather than spinning the
 * piece four times to arrive where two turns would have done — which is what it
 * looks like when a plan is executed without one.
 */
export function orientations(from: IVec3[]): Map<string, { cells: IVec3[]; path: Step[] }> {
  const seen = new Map<string, { cells: IVec3[]; path: Step[] }>();
  const start = from.map((c) => ({ ...c }));
  seen.set(key(start), { cells: start, path: [] });

  const queue = [key(start)];
  const axes: Axis[] = ["x", "y", "z"];
  const dirs: (1 | -1)[] = [1, -1];

  while (queue.length) {
    const at = seen.get(queue.shift()!)!;
    for (const axis of axes)
      for (const dir of dirs) {
        const next = at.cells.map((c) => rotate(c, axis, dir));
        const k = key(next);
        if (seen.has(k)) continue;
        seen.set(k, { cells: next, path: [...at.path, { kind: "rotate", axis, dir }] });
        queue.push(k);
      }
  }
  return seen;
}
