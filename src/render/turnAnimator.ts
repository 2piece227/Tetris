import { Matrix, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import { Axis, IVec3, rotate } from "../game/vec";

/**
 * How long a quarter turn takes on screen.
 *
 * The logic rotates instantly; this is only the picture catching up. Without it
 * the piece teleports between orientations, and from a fixed viewpoint there is
 * no way to tell a turn about one axis from a turn about another — you are left
 * inferring what happened from the result. Long enough to read, short enough
 * that it never gates the next input.
 */
const TURN_MS = 130;

/**
 * Plays a piece's turns out on the node it hangs from — the live piece in VR
 * and in each versus well. The node sits at the piece's centre, so the picture
 * turns about the same point the logic does.
 */
export class TurnAnimator {
  private anim: { from: Quaternion; slide: Vector3; startedAt: number } | null = null;
  /** Where the node sits once any turn has finished playing out. */
  private readonly rest = new Vector3();

  /** `cell` is the size of one grid cell in the node's parent's units. */
  constructor(private readonly node: TransformNode, private readonly cell: number) {
    node.rotationQuaternion = Quaternion.Identity();
    node.getScene().onBeforeRenderObservable.add(() => this.step());
  }

  /** The piece's resting place. Takes effect at once unless a turn is playing. */
  setRest(p: Vector3): void {
    this.rest.copyFrom(p);
    if (!this.anim) this.node.position.copyFrom(p);
  }

  /**
   * Begin the picture catching up to a turn the logic has already applied,
   * and to the wall kick that came with it (`shift`, in cells).
   *
   * The quarter turn is derived from rotate() itself rather than written out
   * by hand, so the picture cannot disagree with the rule it is illustrating.
   */
  begin(axis: Axis, dir: 1 | -1, shift: IVec3 = { x: 0, y: 0, z: 0 }): void {
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
    const current = this.node.rotationQuaternion ?? Quaternion.Identity();
    // A wall kick moved the piece as well as turning it. Start the picture
    // back where it was and let it slide over, so a kick reads as being
    // pushed off the wall rather than as a jump. Called before the redraw that
    // moves the rest point, so `rest` is still the old one here.
    const fromSlide = this.anim ? this.node.position.subtract(this.rest) : Vector3.Zero();
    const c = this.cell;
    this.anim = {
      from: Quaternion.Inverse(applied).multiply(current),
      slide: fromSlide.subtract(new Vector3(shift.x * c, shift.y * c, shift.z * c)),
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
  private step(): void {
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, (performance.now() - a.startedAt) / TURN_MS);
    const eased = 1 - (1 - t) * (1 - t); // ease out; the turn settles rather than stops dead
    Quaternion.SlerpToRef(a.from, Quaternion.Identity(), eased, this.node.rotationQuaternion!);
    this.node.position.copyFrom(this.rest.add(a.slide.scale(1 - eased)));
    if (t >= 1) {
      this.node.rotationQuaternion!.copyFrom(Quaternion.Identity());
      this.node.position.copyFrom(this.rest);
      this.anim = null;
    }
  }
}
