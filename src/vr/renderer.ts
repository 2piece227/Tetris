import {
  ArcRotateCamera,
  Matrix,
  Quaternion,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { CELL, WELL, WELL_ANCHOR, XR_DISTANCE } from "./config";
import type { Game } from "../game/game";
import { Axis, rotate } from "../game/vec";
import { TANK_H, buildPedestal, buildRoom, buildTank } from "./environment";

const { w, d } = WELL;

/**
 * How long a quarter turn takes on screen.
 *
 * The logic rotates instantly; this is only the picture catching up. Without it
 * the piece teleports between orientations, and from a fixed viewpoint there is
 * no way to tell a turn about one axis from a turn about another — you are left
 * inferring what happened from the result. Long enough to read, short enough
 * that it never gates the next input.
 */
const ROTATE_ANIM_MS = 130;

// Where the next-piece preview perches, in wellRoot-local space. Beside the
// tank rather than above it: at 18 layers deep the rim is already near eye
// level and anything stacked on top would be out of comfortable view.
// Negative z is the player's side of the tank (Babylon planes face -Z, and the
// desktop camera and the XR recenter both put the viewer there).
const NEXT_AT = { x: 0.34, y: 0.72, z: -0.06 };

// grid cell (integer) -> local position inside wellRoot (which sits at the
// tank's bottom, centred on the tank footprint)
function cellToLocal(x: number, y: number, z: number): Vector3 {
  return new Vector3(
    (x - (w - 1) / 2) * CELL,
    y * CELL + CELL / 2,
    (z - (d - 1) / 2) * CELL
  );
}

export class Renderer {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly wellRoot: TransformNode;

  /** The live piece hangs off this so a rotation can actually turn it. */
  readonly pieceRoot: TransformNode;
  private rotAnim: { from: Quaternion; startedAt: number } | null = null;

  private readonly solidPool: Mesh[] = [];
  private readonly piecePool: Mesh[] = [];
  private readonly ghostPool: Mesh[] = [];
  private readonly guidePool: Mesh[] = [];
  private readonly nextPool: Mesh[] = [];

  private readonly solidMaster: Mesh;
  private readonly ghostMaster: Mesh;
  private readonly guideMaster: Mesh;
  private readonly nextMaster: Mesh;

  private readonly matByColor = new Map<number, StandardMaterial>();
  private demo = false;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.015, 0.02, 0.038, 1);

    this.wellRoot = new TransformNode("wellRoot", this.scene);
    this.pieceRoot = new TransformNode("pieceRoot", this.scene);
    this.pieceRoot.parent = this.wellRoot;
    this.pieceRoot.rotationQuaternion = Quaternion.Identity();

    this.camera = new ArcRotateCamera(
      "cam",
      -Math.PI / 2,
      1.15,
      1.9,
      new Vector3(0, WELL_ANCHOR.y + TANK_H * 0.5, 0),
      this.scene
    );
    this.camera.attachControl(canvas, true);
    // Arrow keys must control the piece, not orbit the camera — drop the
    // camera's built-in keyboard input. Mouse drag still orbits (desktop only).
    this.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
    this.camera.lowerRadiusLimit = 0.9;
    this.camera.upperRadiusLimit = 5;
    this.camera.wheelPrecision = 60;

    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.7;
    hemi.groundColor = new Color3(0.08, 0.1, 0.18);
    const dir = new DirectionalLight("dir", new Vector3(-0.4, -1, -0.6), this.scene);
    dir.intensity = 0.8;

    buildRoom(this.scene);
    buildPedestal(this.scene, this.wellRoot);
    buildTank(this.scene, this.wellRoot);

    this.solidMaster = this.makeMaster("solid", MeshBuilder.CreateBox("solid", { size: CELL * 0.9 }, this.scene));

    // Ghost: the landing preview. Brighter than a typical ghost because in VR
    // it is doing most of the work of answering "where will this actually go".
    this.ghostMaster = this.makeMaster("ghost", MeshBuilder.CreateBox("ghost", { size: CELL * 0.88 }, this.scene));
    const gm = new StandardMaterial("ghostMat", this.scene);
    gm.diffuseColor = new Color3(0.65, 0.75, 1);
    gm.emissiveColor = new Color3(0.3, 0.4, 0.75);
    gm.alpha = 0.38;
    gm.disableDepthWrite = true;
    this.ghostMaster.material = gm;

    // Vertical guides from the live piece down to the ghost. This is the single
    // biggest depth cue — it ties "the thing up there" to "the spot down there"
    // so the player is not judging distance from perspective alone.
    this.guideMaster = this.makeMaster(
      "guide",
      MeshBuilder.CreateBox("guide", { width: CELL * 0.13, height: 1, depth: CELL * 0.13 }, this.scene)
    );
    const gdm = new StandardMaterial("guideMat", this.scene);
    gdm.diffuseColor = new Color3(0.55, 0.7, 1);
    gdm.emissiveColor = new Color3(0.4, 0.55, 0.95);
    gdm.alpha = 0.5;
    gdm.disableDepthWrite = true;
    this.guideMaster.material = gdm;

    this.nextMaster = this.makeMaster(
      "next",
      MeshBuilder.CreateBox("next", { size: CELL * 0.55 }, this.scene)
    );

    this.buildNextPlinth();
    this.placeForDesktop();

    this.scene.onBeforeRenderObservable.add(() => this.stepRotation());

    window.addEventListener("resize", () => this.engine.resize());
    this.engine.runRenderLoop(() => this.scene.render());
  }

  private makeMaster(_name: string, mesh: Mesh): Mesh {
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.parent = this.wellRoot;
    return mesh;
  }

  // Label + perch for the "next piece" cubes.
  private buildNextPlinth(): void {
    const plate = MeshBuilder.CreateBox(
      "nextPlate",
      { width: 0.11, height: 0.006, depth: 0.11 },
      this.scene
    );
    plate.parent = this.wellRoot;
    plate.position.set(NEXT_AT.x, NEXT_AT.y - 0.05, NEXT_AT.z);
    plate.isPickable = false;
    const m = new StandardMaterial("nextPlateMat", this.scene);
    m.diffuseColor = new Color3(0.1, 0.13, 0.22);
    m.emissiveColor = new Color3(0.05, 0.07, 0.14);
    plate.material = m;
  }

  private solidMat(color: number): StandardMaterial {
    let m = this.matByColor.get(color);
    if (!m) {
      m = new StandardMaterial("m" + color, this.scene);
      const c = Color3.FromHexString("#" + color.toString(16).padStart(6, "0"));
      m.diffuseColor = c;
      m.emissiveColor = c.scale(0.35);
      m.specularColor = new Color3(0.25, 0.25, 0.3);
      this.applyDemoLook(m);
      this.matByColor.set(color, m);
    }
    return m;
  }

  private applyDemoLook(m: StandardMaterial): void {
    // Ghosted while the machine is playing itself, so anyone glancing at the
    // mirror can see at once that this is a demo and not somebody's round.
    m.alpha = this.demo ? 0.42 : 1;
    m.disableDepthWrite = this.demo;
  }

  /** Switch the blocks between a live round and the attract demo. */
  setDemoLook(on: boolean): void {
    if (this.demo === on) return;
    this.demo = on;
    for (const m of this.matByColor.values()) this.applyDemoLook(m);
  }

  private borrow(pool: Mesh[], master: Mesh, i: number, parent?: TransformNode): Mesh {
    let mesh = pool[i];
    if (!mesh) {
      mesh = master.clone(master.name + "_" + pool.length, parent ?? this.wellRoot)!;
      mesh.isVisible = true;
      pool.push(mesh);
    }
    mesh.setEnabled(true);
    return mesh;
  }

  private hideFrom(pool: Mesh[], used: number): void {
    for (let i = used; i < pool.length; i++) pool[i].setEnabled(false);
  }

  redraw(game: Game): void {
    let s = 0;
    const put = (x: number, y: number, z: number, color: number): void => {
      const mesh = this.borrow(this.solidPool, this.solidMaster, s++);
      mesh.position.copyFrom(cellToLocal(x, y, z));
      mesh.material = this.solidMat(color);
    };

    game.grid.forEachFilled(put);
    this.hideFrom(this.solidPool, s);

    // The live piece is drawn separately, as offsets from its own pivot, so
    // pieceRoot can spin it in place without disturbing the settled stack.
    let live = 0;
    if (!game.gameOver) {
      this.pieceRoot.position.copyFrom(
        cellToLocal(game.pos.x, game.pos.y, game.pos.z)
      );
      for (const c of game.cells) {
        const mesh = this.borrow(this.piecePool, this.solidMaster, live++, this.pieceRoot);
        mesh.position.set(c.x * CELL, c.y * CELL, c.z * CELL);
        mesh.material = this.solidMat(game.current.color);
      }
    }
    this.hideFrom(this.piecePool, live);

    let g = 0;
    let guides = 0;

    if (!game.gameOver) {
      const gp = game.ghostPos();
      const drop = game.pos.y - gp.y;

      for (const c of game.cells) {
        const cx = game.pos.x + c.x;
        const cz = game.pos.z + c.z;

        // Ghost blocks at the landing height.
        if (drop > 0) {
          const mesh = this.borrow(this.ghostPool, this.ghostMaster, g++);
          mesh.position.copyFrom(cellToLocal(gp.x + c.x, gp.y + c.y, gp.z + c.z));
        }

        // Guide pillar spanning the gap the piece still has to fall.
        if (drop > 0) {
          const top = cellToLocal(cx, game.pos.y + c.y, cz).y;
          const bottom = cellToLocal(cx, gp.y + c.y, cz).y;
          const mesh = this.borrow(this.guidePool, this.guideMaster, guides++);
          mesh.position.set(cellToLocal(cx, 0, cz).x, (top + bottom) / 2, cellToLocal(cx, 0, cz).z);
          mesh.scaling.y = Math.max(0.001, top - bottom);
        }
      }
    }

    this.hideFrom(this.ghostPool, g);
    this.hideFrom(this.guidePool, guides);

    this.drawNext(game);
  }

  private drawNext(game: Game): void {
    const cells = game.next.cells;
    const mid = (sel: (c: { x: number; y: number; z: number }) => number): number => {
      const vals = cells.map(sel);
      return (Math.min(...vals) + Math.max(...vals)) / 2;
    };
    const cx = mid((c) => c.x);
    const cy = mid((c) => c.y);
    const cz = mid((c) => c.z);
    const S = CELL * 0.6;
    const mat = this.solidMat(game.next.color);

    let n = 0;
    for (const c of cells) {
      const mesh = this.borrow(this.nextPool, this.nextMaster, n++);
      mesh.position.set(
        NEXT_AT.x + (c.x - cx) * S,
        NEXT_AT.y + (c.y - cy) * S,
        NEXT_AT.z + (c.z - cz) * S
      );
      mesh.material = mat;
    }
    this.hideFrom(this.nextPool, n);
  }

  /**
   * Begin the visual catching up to a rotation the logic has already applied.
   *
   * The quarter turn is derived from rotate() itself rather than written out by
   * hand, so the picture cannot disagree with the rule it is illustrating.
   */
  beginRotation(axis: Axis, dir: 1 | -1): void {
    const img = (x: number, y: number, z: number) => rotate({ x, y, z }, axis, dir);
    const rx = img(1, 0, 0);
    const ry = img(0, 1, 0);
    const rz = img(0, 0, 1);
    const applied = Quaternion.FromRotationMatrix(
      Matrix.FromValues(
        rx.x, rx.y, rx.z, 0,
        ry.x, ry.y, ry.z, 0,
        rz.x, rz.y, rz.z, 0,
        0, 0, 0, 1
      )
    );
    // Start the picture where the piece *was* and let it turn into where the
    // logic has already put it. Composed against whatever is on screen right
    // now, so a turn arriving mid-animation continues from there instead of
    // snapping back to square one.
    const current = this.pieceRoot.rotationQuaternion ?? Quaternion.Identity();
    this.rotAnim = {
      from: Quaternion.Inverse(applied).multiply(current),
      startedAt: performance.now(),
    };
  }

  /**
   * Driven off the wall clock rather than the engine delta. getDeltaTime
   * reports zero whenever the render loop is not genuinely running — a
   * backgrounded tab, a stalled frame — and an animation measured that way
   * never advances, leaving the piece drawn in the orientation it has already
   * left. The clock cannot stall.
   */
  private stepRotation(): void {
    const a = this.rotAnim;
    if (!a) return;
    const t = Math.min(1, (performance.now() - a.startedAt) / ROTATE_ANIM_MS);
    const eased = 1 - (1 - t) * (1 - t); // ease out; the turn settles rather than stops dead
    Quaternion.SlerpToRef(
      a.from,
      Quaternion.Identity(),
      eased,
      this.pieceRoot.rotationQuaternion!
    );
    if (t >= 1) {
      this.pieceRoot.rotationQuaternion!.copyFrom(Quaternion.Identity());
      this.rotAnim = null;
    }
  }

  /**
   * Where the viewer is standing, as a yaw relative to the well's own facing.
   * Reads the active camera, so it answers for the headset in VR and for the
   * orbit camera on the desktop without either caller knowing the difference.
   */
  viewRelativeYaw(): number {
    const cam = this.scene.activeCamera;
    if (!cam) return 0;
    const f = cam.getForwardRay().direction;
    return Math.atan2(f.x, f.z) - this.wellRoot.rotation.y;
  }

  /**
   * Push the room toward red once the clock is nearly out.
   *
   * `critical` is passed in rather than inferred from `pressure`, because
   * pressure is legitimately 0 on the very frame the warning begins — reading
   * that as "not warning yet" left the room blue while the readout was already
   * red. The blend starts part-way up so crossing the mark is an event rather
   * than a fade nobody notices, then deepens to the end.
   */
  setUrgency(critical: boolean, pressure: number): void {
    const u = Math.max(0, Math.min(1, pressure));
    const calm = { r: 0.015, g: 0.02, b: 0.038 };
    const alarm = { r: 0.20, g: 0.012, b: 0.02 };
    const k = critical ? 0.45 + 0.55 * u : 0;
    this.scene.clearColor.set(
      calm.r + (alarm.r - calm.r) * k,
      calm.g + (alarm.g - calm.g) * k,
      calm.b + (alarm.b - calm.b) * k,
      1
    );
  }

  placeForDesktop(): void {
    this.wellRoot.position.set(0, WELL_ANCHOR.y, 0);
    this.wellRoot.rotation.y = 0;
    this.camera.setTarget(new Vector3(0, WELL_ANCHOR.y + TANK_H * 0.5, 0));
  }

  /**
   * Plant the tank an arm's length in front of wherever the player is actually
   * standing and turn it to face them. Without this the tank lands wherever the
   * headset's guardian origin happens to be, which is why it can end up behind
   * you or halfway inside a wall.
   */
  placeForXR(headPos?: Vector3, forward?: Vector3): void {
    if (!headPos || !forward) {
      this.wellRoot.position.set(WELL_ANCHOR.x, WELL_ANCHOR.y, WELL_ANCHOR.z);
      this.wellRoot.rotation.y = 0;
      return;
    }

    const f = new Vector3(forward.x, 0, forward.z);
    if (f.lengthSquared() < 1e-6) f.set(0, 0, -1);
    f.normalize();

    this.wellRoot.position.set(
      headPos.x + f.x * XR_DISTANCE,
      WELL_ANCHOR.y,
      headPos.z + f.z * XR_DISTANCE
    );
    // Turn the tank's front face (where the panels live) back toward the player.
    // Babylon's CreatePlane has normal (0,0,-1), so the panels face local -Z and
    // the player must end up on the tank's -Z side: local +Z maps to world +f,
    // which is atan2(f.x, f.z). Negating both arguments lands 180° out — the
    // panels then render their unculled back face (mirrored text) and, far
    // worse, every horizontal control comes out reversed because the grid is
    // parented to this same node.
    this.wellRoot.rotation.y = Math.atan2(f.x, f.z);
  }
}
