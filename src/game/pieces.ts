import { IVec3 } from "./vec";

export interface PieceDef {
  name: string;
  color: number; // hex RGB
  cells: IVec3[]; // offsets around the piece pivot (0,0,0)
}

const c = (x: number, y: number, z: number): IVec3 => ({ x, y, z });

/**
 * Build a flat (single-layer) piece from an ASCII map. Columns run along +x,
 * rows along +z, and `X` marks a filled cell.
 *
 * The variant pentominoes below have no standard names or shapes, so these
 * literals *are* the specification — edit the map to change the piece.
 */
function flat(name: string, color: number, rows: string[]): PieceDef {
  const cells: IVec3[] = [];
  rows.forEach((row, z) => {
    [...row].forEach((ch, x) => {
      if (ch === "X") cells.push(c(x, 0, z));
    });
  });
  return { name, color, cells };
}

// ─── Tetracubes ─────────────────────────────────────────────────────────────
// J and Z are deliberately absent. A flat chiral tetromino can be turned onto
// its own mirror image by rotating it through the third axis, so in 3D J is
// just L and Z is just S — they would be duplicate entries in the bag.
export const I = flat("I", 0x27d3ee, ["XXXX"]);
export const O = flat("O", 0xf5d020, ["XX", "XX"]);
export const T = flat("T", 0xb46cff, ["XXX", ".X."]);
export const L = flat("L", 0xff8a3d, ["XXX", "X.."]);
export const S = flat("S", 0x4fd06a, [".XX", "XX."]);

/** Three cells. The gentlest piece in the game, and only in the opening bag. */
export const CORNER = flat("ㄱ", 0x9aa7b8, ["XX", "X."]);

// ─── Non-planar tetracubes ──────────────────────────────────────────────────
/** Branch: one cell with neighbours on all three axes. */
export const B: PieceDef = {
  name: "B",
  color: 0xff5d5d,
  cells: [c(0, 0, 0), c(1, 0, 0), c(0, 0, 1), c(0, 1, 0)],
};

/** Right screw: a path that turns +x, then +z, then +y. */
export const D: PieceDef = {
  name: "D",
  color: 0x5b7dff,
  cells: [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(1, 1, 1)],
};

/** Left screw: the mirror image of D, and not reachable from it by rotation. */
export const F: PieceDef = {
  name: "F",
  color: 0x00c2a8,
  cells: [c(0, 0, 0), c(1, 0, 0), c(0, 0, 1), c(0, 1, 1)],
};

// ─── Pentominoes ────────────────────────────────────────────────────────────
// Five cells each, so they cannot tile a 16-cell layer on their own — see the
// note in bag.ts about what that does to clearing at the top tier.
export const PENTOMINOES: PieceDef[] = [
  flat("+", 0xff4fa3, [".X.", "XXX", ".X."]),
  flat("V", 0xd4a017, ["X..", "X..", "XXX"]),
  flat("H", 0x8e6cff, [".XX", "XX.", ".X."]),
  flat("U", 0x3fb6ff, ["X.X", "XXX"]),
  flat("T5", 0xff7043, ["XXX", ".X.", ".X."]),
  flat("Q", 0x66bb6a, [".X.", ".X.", "XX.", ".X."]),
  flat("P", 0xec407a, ["XX", "XX", "X."]),
  flat("Z5", 0xab47bc, ["XX.", ".X.", ".XX"]),
];

// ─── Difficulty tiers ───────────────────────────────────────────────────────
export interface Tier {
  /** Lowest score at which this bag composition applies. */
  minScore: number;
  /** Shown in the HUD so the player can see the game escalate. */
  label: string;
  pieces: PieceDef[];
}

const CORE = [I, O, T, L, S];

export const VR_TIERS: Tier[] = [
  { minScore: 0, label: "입문", pieces: [...CORE, CORNER] },
  { minScore: 100, label: "가지", pieces: [...CORE, B] },
  { minScore: 500, label: "나사", pieces: [...CORE, B, D, F] },
  { minScore: 1000, label: "펜토미노", pieces: [...CORE, B, D, F, ...PENTOMINOES] },
];

// Versus starts where VR's second tier does: no three-cell corner to ease anyone
// in, and the branch already in the bag. A versus round is short and both sides
// are racing, so the gentle opening had nothing to do. The pentomino tier is
// gone entirely — five-cell pieces cannot tile a 16-cell layer alongside fours,
// and handing that to a player who is already losing just ends the round
// without a contest.
export const VERSUS_TIERS: Tier[] = [
  { minScore: 0, label: "기본", pieces: [...CORE, B] },
  { minScore: 500, label: "나사", pieces: [...CORE, B, D, F] },
];

/** Index into `tiers` for a given score. */
export function tierIndexFor(tiers: Tier[], score: number): number {
  let idx = 0;
  for (let i = 0; i < tiers.length; i++) if (score >= tiers[i].minScore) idx = i;
  return idx;
}
