import {
  Color3,
  Color4,
  FreeCamera,
  LinesMesh,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  Viewport,
} from "@babylonjs/core";
import { CELL, TOPDOWN, WELL, layerColor } from "./config";
import { boxCentre, type Game } from "../game/game";
import { TurnAnimator } from "../render/turnAnimator";
import type { Axis, IVec3 } from "../game/vec";

const { w, d, h } = WELL;
const WELL_H = h * CELL;

/**
 * How settled blocks are drawn. b is the default; ?blocks=a|b|c|d switches, so
 * the candidates can still be compared on the same board.
 *
 *   a — current: dark solid cubes in their layer's colour
 *   b — crisp: brighter, with a dark outline round every cube
 *   c — capped: dark sides with a bright tile on top, so from above the stack
 *       reads as a grid of tiles and height shows as light against shade
 *   d — glass: see-through bodies with glowing edges in the layer colour, so
 *       the holes in the layers below show through
 */
const BLOCK_STYLES = {
  a: { diffuse: 0.62, emissive: 0.1, alpha: 1, outline: "none", cap: false },
  b: { diffuse: 0.9, emissive: 0.28, alpha: 1, outline: "dark", cap: false },
  c: { diffuse: 0.42, emissive: 0.06, alpha: 1, outline: "none", cap: true },
  d: { diffuse: 0.5, emissive: 0.35, alpha: 0.3, outline: "color", cap: false },
} as const;
const blocksParam = new URLSearchParams(window.location.search).get("blocks");
/** b was picked (2026-10-20); the others stay reachable by ?blocks= until the choice is final. */
const BLOCK = BLOCK_STYLES[(blocksParam && blocksParam in BLOCK_STYLES ? blocksParam : "b") as keyof typeof BLOCK_STYLES];

/** grid cell -> position inside this player's wellRoot */
function cellToLocal(x: number, y: number, z: number): Vector3 {
  return new Vector3(
    (x - (w - 1) / 2) * CELL,
    y * CELL + CELL / 2,
    (z - (d - 1) / 2) * CELL
  );
}

/**
 * One player's well, camera and meshes.
 *
 * Both players share a single scene, so every mesh here is stamped with this
 * view's layer mask and the camera is set to match. Without that each camera
 * would draw both wells on top of each other — they sit at the same world
 * position deliberately, so the two halves of the screen frame identically and
 * neither player gets the better angle.
 */
export class PlayerView {
  readonly root: TransformNode;
  readonly camera: FreeCamera;

  /** The live piece hangs off this, at its centre, so a turn can be played out. */
  private readonly pieceRoot: TransformNode;
  private readonly turns: TurnAnimator;

  private readonly solidPool: Mesh[] = [];
  private readonly piecePool: Mesh[] = [];
  private readonly ghostPool: Mesh[] = [];
  private readonly guidePool: Mesh[] = [];
  private readonly blockedPool: Mesh[] = [];
  private blockedMaster: Mesh | null = null;
  private blockedTimer: number | null = null;
  private readonly solidMaster: Mesh;
  private readonly pieceMaster: LinesMesh;
  private readonly ghostMaster: Mesh;
  private readonly guideMaster: Mesh;
  private readonly matByColor = new Map<number, StandardMaterial>();

  constructor(
    private readonly scene: Scene,
    private readonly mask: number,
    viewport: Viewport
  ) {
    this.root = new TransformNode("wellRoot", scene);
    this.pieceRoot = new TransformNode("pieceRoot", scene);
    this.pieceRoot.parent = this.root;
    this.turns = new TurnAnimator(this.pieceRoot, CELL);

    // The Blockout shot: straight down the shaft from above its mouth. Pitching
    // a FreeCamera by rotation sidesteps the gimbal case setTarget hits when the
    // view direction is parallel to the up axis.
    this.camera = new FreeCamera(
      "cam",
      new Vector3(0, WELL_H + TOPDOWN.eyeCells * CELL, 0),
      scene
    );
    this.camera.rotation = new Vector3(Math.PI / 2, 0, 0);
    this.camera.fov = TOPDOWN.fov;
    this.camera.minZ = 0.01;
    this.camera.viewport = viewport;
    this.camera.layerMask = mask;
    this.camera.inputs.clear(); // fixed shot: not being able to look round is the point

    // Settled blocks: solid, and coloured by depth rather than by piece.
    this.solidMaster = this.master(
      MeshBuilder.CreateBox("solid", { size: CELL * 0.9 }, scene)
    );

    // The live piece is real line geometry, not a solid box with edge rendering
    // switched on. Seen from directly above a filled piece covers the very part
    // of the well the player is aiming at; and edge rendering takes its width in
    // world units, which at this cell size turned the outline into a solid slab.
    // Lines rasterise a pixel wide at any scale, which is the Blockout look and
    // needs no tuning.
    this.pieceMaster = this.cubeOutline("piece", CELL * 0.47, scene);

    this.ghostMaster = this.master(
      MeshBuilder.CreateBox("ghost", { size: CELL * 0.88 }, scene)
    );
    const gm = new StandardMaterial("ghostMat", scene);
    gm.diffuseColor = new Color3(0.65, 0.75, 1);
    gm.emissiveColor = new Color3(0.3, 0.4, 0.75);
    gm.alpha = 0.22;
    gm.disableDepthWrite = true;
    this.ghostMaster.material = gm;

    // Looking down the shaft a piece and its landing spot occupy the same
    // screen pixel, so the guide pillar is the only thing saying how far apart
    // they are. It matters more here than it did in VR, not less.
    this.guideMaster = this.master(
      MeshBuilder.CreateBox(
        "guide",
        { width: CELL * 0.13, height: 1, depth: CELL * 0.13 },
        scene
      )
    );
    const gdm = new StandardMaterial("guideMat", scene);
    gdm.diffuseColor = new Color3(0.55, 0.7, 1);
    gdm.emissiveColor = new Color3(0.4, 0.55, 0.95);
    gdm.alpha = 0.4;
    gdm.disableDepthWrite = true;
    this.guideMaster.material = gdm;

    this.buildShaft();
  }

  private master(mesh: Mesh): Mesh {
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.layerMask = this.mask;
    mesh.parent = this.root;
    return mesh;
  }

  /** The twelve edges of a cube, as line geometry. */
  private cubeOutline(name: string, s: number, scene: Scene): LinesMesh {
    const p = (x: number, y: number, z: number) => new Vector3(x * s, y * s, z * s);
    const loop = (y: number) => [
      p(-1, y, -1), p(1, y, -1), p(1, y, 1), p(-1, y, 1), p(-1, y, -1),
    ];
    const lines: Vector3[][] = [loop(-1), loop(1)];
    const posts: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [x, z] of posts) lines.push([p(x, -1, z), p(x, 1, z)]);

    const mesh = MeshBuilder.CreateLineSystem(name, { lines }, scene);
    mesh.color = new Color3(1, 1, 1);
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.layerMask = this.mask;
    mesh.parent = this.root;
    return mesh;
  }

  /**
   * Wireframe shaft: a rectangle at every layer boundary plus the four corner
   * edges. Seen from directly above these nest inside one another, and the rate
   * at which they shrink is what makes depth legible from a top-down view.
   */
  private buildShaft(): void {
    const hx = (w * CELL) / 2;
    const hz = (d * CELL) / 2;
    const lines: Vector3[][] = [];
    const colors: Color4[][] = [];

    const ring = (y: number, shade: number): void => {
      const pts = [
        new Vector3(-hx, y, -hz),
        new Vector3(hx, y, -hz),
        new Vector3(hx, y, hz),
        new Vector3(-hx, y, hz),
        new Vector3(-hx, y, -hz),
      ];
      lines.push(pts);
      colors.push(
        pts.map(() => new Color4(0.3 * shade, 0.45 * shade, 0.85 * shade, 1))
      );
    };

    for (let layer = 0; layer <= h; layer++) {
      ring(layer * CELL, 0.35 + 0.65 * (layer / h));
    }

    // Blockout's pit: every wall is ruled into cells, so the rings above are
    // crossed by a post at every cell boundary, not only at the corners. Seen
    // from above the posts fan out from the floor to the mouth, and a piece's
    // column can be read straight off the wall it is nearest.
    const post = (x: number, z: number, corner: boolean): void => {
      lines.push([new Vector3(x, 0, z), new Vector3(x, WELL_H, z)]);
      colors.push(
        corner
          ? [new Color4(0.2, 0.3, 0.6, 1), new Color4(0.45, 0.6, 1, 1)]
          : [new Color4(0.1, 0.16, 0.34, 1), new Color4(0.26, 0.38, 0.72, 1)]
      );
    };
    for (let i = 0; i <= w; i++) {
      const x = -hx + i * CELL;
      const corner = i === 0 || i === w;
      post(x, -hz, corner);
      post(x, hz, corner);
    }
    for (let i = 1; i < d; i++) {
      const z = -hz + i * CELL;
      post(-hx, z, false);
      post(hx, z, false);
    }

    const floor = new Color4(0.22, 0.3, 0.55, 1);
    for (let x = 0; x <= w; x++) {
      lines.push([
        new Vector3(-hx + x * CELL, 0, -hz),
        new Vector3(-hx + x * CELL, 0, hz),
      ]);
      colors.push([floor, floor]);
    }
    for (let z = 0; z <= d; z++) {
      lines.push([
        new Vector3(-hx, 0, -hz + z * CELL),
        new Vector3(hx, 0, -hz + z * CELL),
      ]);
      colors.push([floor, floor]);
    }

    const frame = MeshBuilder.CreateLineSystem(
      "shaft",
      { lines, colors },
      this.scene
    );
    frame.parent = this.root;
    frame.layerMask = this.mask;
    frame.isPickable = false;
  }

  private solidMat(color: number): StandardMaterial {
    let m = this.matByColor.get(color);
    if (!m) {
      m = new StandardMaterial("m" + color, this.scene);
      const c = Color3.FromHexString("#" + color.toString(16).padStart(6, "0"));
      // Kept dark on purpose. These cubes are stacked several deep under a
      // white wireframe piece, and at full brightness the near layers glare
      // enough to wash out the hue differences between them.
      m.diffuseColor = c.scale(BLOCK.diffuse);
      m.emissiveColor = c.scale(BLOCK.emissive);
      m.specularColor = new Color3(0.08, 0.08, 0.1);
      if (BLOCK.alpha < 1) {
        m.alpha = BLOCK.alpha;
        m.disableDepthWrite = true;
      }
      this.matByColor.set(color, m);
    }
    return m;
  }

  private borrow(pool: Mesh[], master: Mesh, i: number, parent?: TransformNode): Mesh {
    let mesh = pool[i];
    if (!mesh) {
      mesh = master.clone(master.name + "_" + pool.length, parent ?? this.root)!;
      mesh.isVisible = true;
      mesh.layerMask = this.mask;
      pool.push(mesh);
    }
    mesh.setEnabled(true);
    return mesh;
  }

  private hideFrom(pool: Mesh[], used: number): void {
    for (let i = used; i < pool.length; i++) pool[i].setEnabled(false);
  }

  private capMats = new Map<number, StandardMaterial>();

  /** Outline and top tile for a settled block, per the chosen block style. */
  private decorate(mesh: Mesh, color: number): void {
    const meta = (mesh.metadata ??= {}) as { outline?: LinesMesh; cap?: Mesh };
    if (BLOCK.outline !== "none") {
      if (!meta.outline) {
        meta.outline = this.cubeOutline("blockEdge", CELL * 0.452, this.scene);
        meta.outline.parent = mesh;
        meta.outline.position.set(0, 0, 0);
        meta.outline.isVisible = true;
      }
      const c = Color3.FromHexString("#" + color.toString(16).padStart(6, "0"));
      meta.outline.color = BLOCK.outline === "dark" ? new Color3(0.02, 0.03, 0.06) : c.scale(1.25);
      meta.outline.alpha = BLOCK.outline === "dark" ? 0.9 : 1;
    }
    if (BLOCK.cap) {
      if (!meta.cap) {
        meta.cap = MeshBuilder.CreateBox("cap", { width: CELL * 0.8, height: CELL * 0.04, depth: CELL * 0.8 }, this.scene);
        meta.cap.parent = mesh;
        meta.cap.position.set(0, CELL * 0.45, 0);
        meta.cap.layerMask = this.mask;
        meta.cap.isPickable = false;
      }
      let m = this.capMats.get(color);
      if (!m) {
        m = new StandardMaterial("cap" + color, this.scene);
        const c = Color3.FromHexString("#" + color.toString(16).padStart(6, "0"));
        const light = Color3.Lerp(c, Color3.White(), 0.3);
        m.diffuseColor = light;
        m.emissiveColor = light.scale(0.55);
        m.specularColor = new Color3(0.1, 0.1, 0.1);
        this.capMats.set(color, m);
      }
      meta.cap.material = m;
    }
  }

  /** Begin the picture catching up to a turn the logic has already applied. */
  beginRotation(axis: Axis, dir: 1 | -1, shift?: IVec3): void {
    this.turns.begin(axis, dir, shift);
  }

  /**
   * Show, briefly and in red, the shape a turn would have taken and where.
   * From straight above, a turn that cannot fit otherwise looks exactly like a
   * key that did nothing — this is the only way to see what it hit.
   */
  showBlocked(cells: IVec3[], pos: IVec3): void {
    if (!this.blockedMaster) {
      this.blockedMaster = this.master(
        MeshBuilder.CreateBox("blocked", { size: CELL * 0.86 }, this.scene)
      );
      const bm = new StandardMaterial("blockedMat", this.scene);
      bm.diffuseColor = new Color3(1, 0.2, 0.2);
      bm.emissiveColor = new Color3(0.9, 0.12, 0.12);
      bm.alpha = 0.5;
      bm.disableDepthWrite = true;
      this.blockedMaster.material = bm;
    }
    cells.forEach((c, i) => {
      const mesh = this.borrow(this.blockedPool, this.blockedMaster!, i);
      mesh.position.copyFrom(cellToLocal(pos.x + c.x, pos.y + c.y, pos.z + c.z));
    });
    this.hideFrom(this.blockedPool, cells.length);
    if (this.blockedTimer !== null) window.clearTimeout(this.blockedTimer);
    this.blockedTimer = window.setTimeout(() => {
      this.hideFrom(this.blockedPool, 0);
      this.blockedTimer = null;
    }, 320);
  }

  redraw(game: Game): void {
    // Settled stack, coloured by depth.
    let s = 0;
    game.grid.forEachFilled((x, y, z) => {
      const mesh = this.borrow(this.solidPool, this.solidMaster, s++);
      mesh.position.copyFrom(cellToLocal(x, y, z));
      const color = layerColor(y);
      mesh.material = this.solidMat(color);
      this.decorate(mesh, color);
    });
    this.hideFrom(this.solidPool, s);

    let p = 0;
    let g = 0;
    let guides = 0;

    if (!game.gameOver) {
      // Drawn as offsets from the piece's centre — the point the logic turns
      // it about — so a turn can be played out by spinning pieceRoot.
      const mid = boxCentre(game.cells);
      this.turns.setRest(cellToLocal(game.pos.x + mid.x, game.pos.y + mid.y, game.pos.z + mid.z));
      for (const c of game.cells) {
        const cage = this.borrow(this.piecePool, this.pieceMaster, p++, this.pieceRoot);
        cage.position.set((c.x - mid.x) * CELL, (c.y - mid.y) * CELL, (c.z - mid.z) * CELL);
      }

      const gp = game.ghostPos();
      if (game.pos.y - gp.y > 0) {
        for (const c of game.cells) {
          const cx = game.pos.x + c.x;
          const cz = game.pos.z + c.z;

          const ghost = this.borrow(this.ghostPool, this.ghostMaster, g++);
          ghost.position.copyFrom(cellToLocal(gp.x + c.x, gp.y + c.y, gp.z + c.z));

          const top = cellToLocal(cx, game.pos.y + c.y, cz).y;
          const bottom = cellToLocal(cx, gp.y + c.y, cz).y;
          const pillar = this.borrow(this.guidePool, this.guideMaster, guides++);
          const at = cellToLocal(cx, 0, cz);
          pillar.position.set(at.x, (top + bottom) / 2, at.z);
          pillar.scaling.y = Math.max(0.001, top - bottom);
        }
      }
    }

    this.hideFrom(this.piecePool, p);
    this.hideFrom(this.ghostPool, g);
    this.hideFrom(this.guidePool, guides);
  }
}
