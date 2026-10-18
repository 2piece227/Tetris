import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { CELL, WELL, WELL_ANCHOR } from "./config";

const { w, d, h } = WELL;
const TANK_W = w * CELL;
const TANK_D = d * CELL;
export const TANK_H = h * CELL;

// ─── Room ───────────────────────────────────────────────────────────────────
// Without this the headset shows blocks floating in a black void, which reads
// as "nothing is there" rather than "a dark room". A floor you can see your own
// feet against is what makes the tank feel like an object in a place.
export function buildRoom(scene: Scene): void {
  const ROOM = 14; // metres across

  const floor = MeshBuilder.CreateGround("floor", { width: ROOM, height: ROOM }, scene);
  const fm = new StandardMaterial("floorMat", scene);
  fm.diffuseColor = new Color3(0.035, 0.045, 0.075);
  fm.specularColor = new Color3(0.05, 0.06, 0.1);
  fm.emissiveColor = new Color3(0.012, 0.016, 0.03);
  floor.material = fm;
  floor.isPickable = false;

  // Grid lines fading out with distance — gives parallax when you move your
  // head, which is most of what sells "I am standing somewhere" in VR.
  const STEP = 0.5;
  const half = ROOM / 2;
  const lines: Vector3[][] = [];
  const colors: Color4[][] = [];
  const fade = (a: Vector3, b: Vector3): Color4[] =>
    [a, b].map((p) => {
      const t = Math.min(1, Math.hypot(p.x, p.z) / half);
      const alpha = 0.5 * (1 - t) ** 2;
      return new Color4(0.3, 0.42, 0.85, alpha);
    });

  for (let i = -half; i <= half + 1e-6; i += STEP) {
    const ax = new Vector3(i, 0, -half);
    const bx = new Vector3(i, 0, half);
    lines.push([ax, bx]);
    colors.push(fade(ax, bx));
    const az = new Vector3(-half, 0, i);
    const bz = new Vector3(half, 0, i);
    lines.push([az, bz]);
    colors.push(fade(az, bz));
  }

  const grid = MeshBuilder.CreateLineSystem("grid", { lines, colors }, scene);
  grid.position.y = 0.003; // lift off the floor to dodge z-fighting
  grid.isPickable = false;
  grid.alphaIndex = 0;
}

// ─── Pedestal ───────────────────────────────────────────────────────────────
// Holds the tank up to chest height. Parented to wellRoot so it travels with
// the tank when a VR recenter moves it.
export function buildPedestal(scene: Scene, parent: TransformNode): void {
  const topR = Math.max(TANK_W, TANK_D) * 0.62;
  // Stop the column just short of wellRoot's origin so its cap does not land on
  // exactly the same plane as the tank base above it. Two coincident faces
  // z-fight, and in a headset that shimmer reads as a disc spinning under the
  // tank — each eye resolves the tie differently and head motion animates it.
  const INSET = 0.005;
  // Bury the base below the floor for the same reason: the column's bottom cap
  // would otherwise sit exactly on the room floor's plane — a second coincident
  // circle, and the one actually down at floor level.
  const SINK = 0.02;
  const height = WELL_ANCHOR.y + SINK - INSET;

  const column = MeshBuilder.CreateCylinder(
    "pedestal",
    { height, diameterTop: topR * 2, diameterBottom: topR * 2.5, tessellation: 32 },
    scene
  );
  column.parent = parent;
  column.position.y = -INSET - height / 2; // wellRoot sits at the tank's BOTTOM
  column.isPickable = false;

  const pm = new StandardMaterial("pedestalMat", scene);
  pm.diffuseColor = new Color3(0.07, 0.085, 0.14);
  pm.specularColor = new Color3(0.15, 0.17, 0.25);
  pm.emissiveColor = new Color3(0.02, 0.025, 0.05);
  column.material = pm;

}

// ─── Tank ───────────────────────────────────────────────────────────────────
// Glass walls instead of a bare wireframe. Seeing the stack through the SIDE is
// what makes the depth readable — you are no longer forced to judge everything
// by looking straight down the shaft.
export function buildTank(scene: Scene, parent: TransformNode): void {
  const hx = TANK_W / 2;
  const hz = TANK_D / 2;

  const glass = new StandardMaterial("glassMat", scene);
  glass.diffuseColor = new Color3(0.35, 0.5, 0.85);
  glass.emissiveColor = new Color3(0.05, 0.08, 0.16);
  glass.specularColor = new Color3(0.4, 0.45, 0.6);
  glass.alpha = 0.08;
  glass.backFaceCulling = false;
  // Glass must never hide the blocks behind it, so skip depth writes.
  glass.disableDepthWrite = true;

  const wall = (name: string, width: number, pos: Vector3, rotY: number): void => {
    const m = MeshBuilder.CreatePlane(name, { width, height: TANK_H }, scene);
    m.parent = parent;
    m.position = pos;
    m.rotation.y = rotY;
    m.material = glass;
    m.isPickable = false;
    m.alphaIndex = 100;
  };

  wall("wallN", TANK_W, new Vector3(0, TANK_H / 2, -hz), 0);
  wall("wallS", TANK_W, new Vector3(0, TANK_H / 2, hz), Math.PI);
  wall("wallW", TANK_D, new Vector3(-hx, TANK_H / 2, 0), -Math.PI / 2);
  wall("wallE", TANK_D, new Vector3(hx, TANK_H / 2, 0), Math.PI / 2);

  // Solid base so pieces land on something rather than on nothing.
  const base = MeshBuilder.CreateBox("tankBase", { width: TANK_W, height: 0.01, depth: TANK_D }, scene);
  base.parent = parent;
  base.position.y = -0.005;
  base.isPickable = false;
  const bm = new StandardMaterial("tankBaseMat", scene);
  bm.diffuseColor = new Color3(0.05, 0.07, 0.13);
  bm.emissiveColor = new Color3(0.03, 0.045, 0.09);
  base.material = bm;

  // Floor grid inside the tank — the reference the landing footprint lights up
  // against, so you can count cells instead of guessing.
  const lines: Vector3[][] = [];
  for (let x = 0; x <= w; x++)
    lines.push([new Vector3(-hx + x * CELL, 0, -hz), new Vector3(-hx + x * CELL, 0, hz)]);
  for (let z = 0; z <= d; z++)
    lines.push([new Vector3(-hx, 0, -hz + z * CELL), new Vector3(hx, 0, -hz + z * CELL)]);
  const floorGrid = MeshBuilder.CreateLineSystem("tankGrid", { lines }, scene);
  floorGrid.color = new Color3(0.3, 0.4, 0.7);
  floorGrid.parent = parent;
  floorGrid.position.y = 0.002;
  floorGrid.isPickable = false;

  buildEdges(scene, parent, hx, hz);
}

// Corner posts and rim as real geometry. GL lines are one pixel wide and alias
// into near-invisibility on a headset, so the tank's silhouette gets actual bars.
function buildEdges(scene: Scene, parent: TransformNode, hx: number, hz: number): void {
  const T = 0.008;

  const postMat = new StandardMaterial("postMat", scene);
  postMat.diffuseColor = new Color3(0.25, 0.35, 0.7);
  postMat.emissiveColor = new Color3(0.18, 0.28, 0.62);
  postMat.specularColor = new Color3(0.3, 0.3, 0.4);

  const rimMat = new StandardMaterial("rimMat", scene);
  rimMat.diffuseColor = new Color3(0.45, 0.62, 1);
  rimMat.emissiveColor = new Color3(0.4, 0.58, 1);

  const bar = (
    name: string,
    dims: { width: number; height: number; depth: number },
    pos: Vector3,
    mat: StandardMaterial
  ): Mesh => {
    const m = MeshBuilder.CreateBox(name, dims, scene);
    m.parent = parent;
    m.position = pos;
    m.material = mat;
    m.isPickable = false;
    return m;
  };

  const corners: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
  // Sunk slightly into the tank base so the post caps do not sit on its top plane.
  corners.forEach(([cx, cz], i) => {
    bar(
      `post${i}`,
      { width: T, height: TANK_H + T, depth: T },
      new Vector3(cx, TANK_H / 2 - T / 2, cz),
      postMat
    );
  });

  // Bright top rim — the single most useful landmark for judging how much room
  // is left before the stack tops out. The east/west bars are cut short by one
  // bar width so they butt against the north/south pair instead of crossing it:
  // overlapping bars share a top face at the corners and z-fight there.
  bar("rimN", { width: hx * 2 + T, height: T, depth: T }, new Vector3(0, TANK_H, -hz), rimMat);
  bar("rimS", { width: hx * 2 + T, height: T, depth: T }, new Vector3(0, TANK_H, hz), rimMat);
  bar("rimW", { width: T, height: T, depth: hz * 2 - T }, new Vector3(-hx, TANK_H, 0), rimMat);
  bar("rimE", { width: T, height: T, depth: hz * 2 - T }, new Vector3(hx, TANK_H, 0), rimMat);
}
