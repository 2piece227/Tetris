import { VERSUS_RULES } from "../game/rules";

// Gameplay tuning for versus lives in VERSUS_RULES in src/game/rules.ts. What
// is here is how the split screen is staged and coloured.

export const WELL = VERSUS_RULES.well;

// One cell in Babylon world units. Arbitrary here — unlike VR these are not
// metres, they only have to be consistent with the camera framing.
export const CELL = 0.075;

// ─── Split-screen staging ───────────────────────────────────────────────────
// Both players share one canvas; each gets half of it and its own camera.
// Player wells live at the same world position but on separate rendering
// layers, so neither camera can see the other player's well.
export const LAYER_1P = 0x1;
export const LAYER_2P = 0x2;

const params = new URLSearchParams(window.location.search);
const pick = <T extends Record<string, unknown>>(name: string, options: T, fallback: keyof T): T[keyof T] => {
  const v = params.get(name);
  return options[(v && v in options ? v : fallback) as keyof T];
};

/**
 * Top-down camera, Blockout style: the eye looks straight down the shaft, so
 * depth reads as perspective foreshortening and the stack recedes below you.
 *
 * b is the default; ?cam=a|b|c switches, to compare framings on the same board.
 *   a — the eye well above the mouth: the whole pit floats in the frame
 *   b — the mouth fills the frame edge to edge, as in Blockout
 *   c — b with a wider lens: the walls rake in harder and the floor recedes
 *
 * `fill` frames by the mouth's width rather than by a fixed height, so the
 * mouth meets the edges of its half of the screen whatever its proportions.
 */
export const TOPDOWN = pick(
  "cam",
  {
    a: { fov: 0.9, eyeCells: 6.5, fill: false },
    b: { fov: 0.9, eyeCells: 0, fill: true },
    c: { fov: 1.25, eyeCells: 0, fill: true },
  },
  // b picked (2026-10-20): the original's framing.
  "b"
);

/**
 * Darken the stack with depth, so a lower layer is a deeper shade as well as a
 * different colour. TEMPORARY: ?fog=1 to compare.
 */
export const DEPTH_FOG = params.get("fog") === "1";

// ─── Layer colours ──────────────────────────────────────────────────────────
// A settled block is coloured by the layer it sits in, not by the piece it came
// from. Looking straight down the shaft everything overlaps, so a fixed colour
// per depth is what lets a player tell at a glance how high the stack has got.

/**
 * Layer colours. b is the default; ?palette=a|b switches.
 *
 *   a — a rainbow ramp from the floor to the mouth (hue climbs with height),
 *       alternating saturation and lightness so neighbours differ
 *   b — twelve fixed colours chosen to be as unlike each other as possible,
 *       ordered so that neighbouring layers jump between warm and cool
 *
 * A ramp says "higher" at a glance but runs out of distinguishable hues over
 * twelve layers — three or four greens in a row. A fixed palette gives up the
 * gradient for every layer having a colour of its own, which the gauge then
 * names.
 */
/** b picked (2026-10-20); ?palette=a brings the ramp back for comparison. */
const PALETTE = params.get("palette") === "a" ? "a" : "b";

const DISTINCT = [
  0xff3b3b, // 1 red
  0x2fd3ff, // 2 sky
  0xffd21f, // 3 yellow
  0x8a5cff, // 4 violet
  0x35e07a, // 5 green
  0xff7a1a, // 6 orange
  0x3a6bff, // 7 blue
  0xff5cc8, // 8 pink
  0xb7f23a, // 9 lime
  0x17b8a6, // 10 teal
  0xf2f4ff, // 11 white
  0xc23bff, // 12 magenta
];

/** Hue travelled from the floor to the mouth: red, round past violet to pink. */
const HUE_SPAN = 330;
/** Saturation and lightness alternate layer to layer — see layerColor. */
const SAT_EVEN = 1.0;
const SAT_ODD = 0.85;
const LIGHT_EVEN = 0.58;
const LIGHT_ODD = 0.4;

function hslToRgb(hDeg: number, s: number, l: number): number {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    const u = (t + 1) % 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  const to8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return (to8(channel(h + 1 / 3)) << 16) | (to8(channel(h)) << 8) | to8(channel(h - 1 / 3));
}

/**
 * Colour for a settled cell at grid height y.
 *
 * Ramp (a): hue climbs steadily from the floor to the mouth. Hue alone is not
 * enough — spread over a dozen layers, neighbours land close together, worst
 * of all through the blues — so saturation and lightness alternate too, which
 * puts neighbours apart along three axes instead of one.
 */
export function layerColor(y: number): number {
  if (PALETTE === "b") return DISTINCT[((y % DISTINCT.length) + DISTINCT.length) % DISTINCT.length];
  const top = WELL.h - 1;
  const t = top <= 0 ? 0 : Math.min(Math.max(y, 0), top) / top;
  const odd = y % 2 !== 0;
  return hslToRgb(
    t * HUE_SPAN,
    odd ? SAT_ODD : SAT_EVEN,
    odd ? LIGHT_ODD : LIGHT_EVEN
  );
}
