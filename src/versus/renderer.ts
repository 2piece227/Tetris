import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
  Vector3,
  Viewport,
} from "@babylonjs/core";
import { CELL, DEPTH_FOG, LAYER_1P, LAYER_2P, WELL } from "./config";
import type { Game } from "../game/game";
import { PlayerView } from "./playerView";

/**
 * The two wells. Everything printed on top of them — scores, gauges, the next
 * piece, the cards — is HTML laid over the canvas (see hud.ts): versus only
 * ever runs on a flat screen, so there is no need to draw text in the scene.
 */
export class Renderer {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly p1: PlayerView;
  readonly p2: PlayerView;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.015, 0.02, 0.038, 1);

    // Viewports are normalised with the origin at the bottom-left.
    this.p1 = new PlayerView(this.scene, LAYER_1P, new Viewport(0, 0, 0.5, 1));
    this.p2 = new PlayerView(this.scene, LAYER_2P, new Viewport(0.5, 0, 0.5, 1));
    this.scene.activeCameras = [this.p1.camera, this.p2.camera];

    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.08, 0.1, 0.18);
    const dir = new DirectionalLight("dir", new Vector3(-0.3, -1, -0.45), this.scene);
    dir.intensity = 0.7;

    if (DEPTH_FOG) {
      // Fog from the mouth down, so the deeper a layer the darker it reads:
      // depth as shade, on top of each layer's own colour. Starts at the mouth
      // and leaves the floor at about 40% — fading into the background colour
      // rather than to black, so nothing deep vanishes outright.
      const eye = this.p1.camera.position.y;
      const mouth = eye - WELL.h * CELL;
      const keep = 0.4;
      this.scene.fogMode = Scene.FOGMODE_LINEAR;
      this.scene.fogColor = new Color3(0.015, 0.02, 0.038);
      this.scene.fogStart = mouth;
      this.scene.fogEnd = (eye - keep * mouth) / (1 - keep);
    }

    window.addEventListener("resize", () => this.engine.resize());
    this.engine.runRenderLoop(() => this.scene.render());
  }

  redraw(g1: Game, g2: Game): void {
    this.p1.redraw(g1);
    this.p2.redraw(g2);
  }
}
