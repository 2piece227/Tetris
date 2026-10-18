import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  FreeCamera,
  HemisphericLight,
  Scene,
  Vector3,
  Viewport,
} from "@babylonjs/core";
import { AdvancedDynamicTexture, Control, Rectangle } from "@babylonjs/gui";
import { LAYER_1P, LAYER_2P } from "./config";
import type { Game } from "../game/game";
import { Hud } from "./hud";
import { PlayerView } from "./playerView";

/** UI gets its own layer and its own full-canvas camera — see the note below. */
const LAYER_UI = 0x4;

export class Renderer {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly p1: PlayerView;
  readonly p2: PlayerView;
  readonly hud: Hud;

  constructor(canvas: HTMLCanvasElement, labels: [string, string]) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.015, 0.02, 0.038, 1);

    // Viewports are normalised with the origin at the bottom-left.
    this.p1 = new PlayerView(this.scene, LAYER_1P, new Viewport(0, 0, 0.5, 1));
    this.p2 = new PlayerView(this.scene, LAYER_2P, new Viewport(0.5, 0, 0.5, 1));

    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.08, 0.1, 0.18);
    const dir = new DirectionalLight("dir", new Vector3(-0.3, -1, -0.45), this.scene);
    dir.intensity = 0.7;

    // A full-screen GUI renders once per active camera, clipped to that
    // camera's viewport — with the two player cameras alone the HUD would be
    // drawn twice, squashed into each half. Giving the UI its own layer and a
    // third camera that owns the whole canvas puts it back on top, once.
    const uiCamera = new FreeCamera("uiCam", Vector3.Zero(), this.scene);
    uiCamera.layerMask = LAYER_UI;
    uiCamera.viewport = new Viewport(0, 0, 1, 1);
    uiCamera.inputs.clear();

    this.scene.activeCameras = [this.p1.camera, this.p2.camera, uiCamera];

    const ui = AdvancedDynamicTexture.CreateFullscreenUI("ui", true, this.scene);
    ui.layer!.layerMask = LAYER_UI;

    this.hud = new Hud(ui, labels);
    this.buildDivider(ui);

    window.addEventListener("resize", () => this.engine.resize());
    this.engine.runRenderLoop(() => this.scene.render());
  }

  private buildDivider(ui: AdvancedDynamicTexture): void {
    const line = new Rectangle("divider");
    line.width = "2px";
    line.height = "78%";
    line.thickness = 0;
    line.background = "#243056";
    line.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    ui.addControl(line);
  }

  redraw(g1: Game, g2: Game): void {
    this.p1.redraw(g1);
    this.p2.redraw(g2);
    this.hud.update(g1, g2);
  }
}
