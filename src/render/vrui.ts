import { Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import {
  AdvancedDynamicTexture,
  Button,
  Control,
  Rectangle,
  StackPanel,
  TextBlock,
} from "@babylonjs/gui";
import type { Game } from "../game/game";

// Every panel here exists because the DOM HUD in index.html is invisible once
// the headset enters an immersive session — the browser presents the WebXR
// framebuffer, not the page. Anything the player must read has to be geometry
// inside the scene.

const FONT = "system-ui, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";

// Babylon's CreatePlane has normal (0,0,-1), so a panel at rotation.y = 0 faces
// local -Z, and that is where the viewer stands: the desktop camera sits at -Z
// and placeForXR turns the tank so the player ends up there too. Everything the
// player reads therefore lives at NEGATIVE local z and yaws by these signs —
// a panel on the +x side needs a POSITIVE yaw to angle inward, and vice versa.
const YAW_IN = 0.42;

interface Panel {
  plane: Mesh;
  adt: AdvancedDynamicTexture;
}

function makePanel(
  scene: Scene,
  parent: TransformNode,
  name: string,
  worldW: number,
  worldH: number,
  pos: Vector3,
  rotY: number
): Panel {
  const plane = MeshBuilder.CreatePlane(name, { width: worldW, height: worldH }, scene);
  plane.parent = parent;
  plane.position = pos;
  plane.rotation.y = rotY;

  // ~2400 px per metre keeps text crisp at arm's length on a Quest 3 panel.
  const px = Math.round(worldW * 2400);
  const adt = AdvancedDynamicTexture.CreateForMesh(plane, px, Math.round(px * (worldH / worldW)), true);
  return { plane, adt };
}

function backdrop(adt: AdvancedDynamicTexture, alpha = 0.82): Rectangle {
  const bg = new Rectangle();
  bg.thickness = 3;
  bg.color = "#3d4a86";
  bg.cornerRadius = 28;
  bg.background = "#0a0e1c";
  bg.alpha = alpha;
  adt.addControl(bg);
  return bg;
}

function text(
  value: string,
  size: number,
  color: string,
  opts: { bold?: boolean; top?: number; align?: number } = {}
): TextBlock {
  const t = new TextBlock();
  t.text = value;
  t.color = color;
  t.fontSize = size;
  t.fontFamily = FONT;
  if (opts.bold) t.fontWeight = "700";
  if (opts.top !== undefined) t.top = `${opts.top}px`;
  if (opts.align !== undefined) t.textHorizontalAlignment = opts.align;
  t.resizeToFit = false;
  return t;
}

export class VrUi {
  private readonly clock: TextBlock;
  private readonly clockPanel: Panel;
  private readonly scoreValue: TextBlock;
  private readonly scoreSub: TextBlock;
  private readonly tierLabel: TextBlock;
  private readonly gameOver: Panel;
  private readonly gameOverScore: TextBlock;

  constructor(scene: Scene, parent: TransformNode, onRestart: () => void) {
    this.buildHelp(scene, parent);

    // ── Clock, mirroring the score across the tank ─────────────────────────
    // The round is decided by this far more often than by topping out, so it
    // is the largest thing on either panel and sits at eye level where a
    // glance up from the well lands.
    this.clockPanel = makePanel(
      scene,
      parent,
      "uiClock",
      0.24,
      0.12,
      new Vector3(-0.36, 1.2, -0.08),
      -YAW_IN
    );
    backdrop(this.clockPanel.adt);

    const clockStack = new StackPanel();
    clockStack.paddingTop = "14px";
    this.clockPanel.adt.addControl(clockStack);

    const clockLabel = text("남은 시간", 42, "#8d99c8");
    clockLabel.height = "56px";
    clockStack.addControl(clockLabel);

    this.clock = text("3:00", 150, "#eef2ff", { bold: true });
    this.clock.height = "170px";
    clockStack.addControl(this.clock);

    // ── Score, beside the tank at eye level ────────────────────────────────
    // It used to sit above the rim, which worked at 8 layers deep. At 18 the
    // rim is already near eye level and anything above it is a neck-craner.
    const score = makePanel(
      scene,
      parent,
      "uiScore",
      0.26,
      0.13,
      new Vector3(0.36, 1.02, -0.08),
      YAW_IN
    );
    backdrop(score.adt);

    const scoreStack = new StackPanel();
    scoreStack.paddingTop = "18px";
    score.adt.addControl(scoreStack);

    this.scoreValue = text("0", 130, "#eef2ff", { bold: true });
    this.scoreValue.height = "150px";
    scoreStack.addControl(this.scoreValue);

    this.scoreSub = text("레이어 0 · 레벨 1", 48, "#93a0d8");
    this.scoreSub.height = "70px";
    scoreStack.addControl(this.scoreSub);

    // Own line: without it the player has no way to tell the bag just changed
    // under them, and the new pieces read as the game glitching.
    this.tierLabel = text("입문", 44, "#f0b64a", { bold: true });
    this.tierLabel.height = "60px";
    scoreStack.addControl(this.tierLabel);

    // ── Game over, parked in front of the tank ─────────────────────────────
    this.gameOver = makePanel(
      scene,
      parent,
      "uiGameOver",
      0.44,
      0.3,
      // Near eye height and half a metre out. Lower or closer than this and the
      // player is reading a panel at a steep downward angle from 30cm away,
      // which is uncomfortable to focus on in a headset.
      new Vector3(0, 1.22, -0.2),
      0
    );
    backdrop(this.gameOver.adt, 0.94);

    const overStack = new StackPanel();
    this.gameOver.adt.addControl(overStack);

    const title = text("게임 오버", 120, "#ffffff", { bold: true });
    title.height = "170px";
    overStack.addControl(title);

    this.gameOverScore = text("점수 0", 62, "#aab4e0");
    this.gameOverScore.height = "100px";
    overStack.addControl(this.gameOverScore);

    const btn = Button.CreateSimpleButton("restart", "다시 시작");
    btn.width = "460px";
    btn.height = "130px";
    btn.color = "#0a0e1c";
    btn.background = "#7c8bff";
    btn.cornerRadius = 24;
    btn.thickness = 0;
    btn.fontSize = 62;
    btn.fontFamily = FONT;
    btn.fontWeight = "700";
    btn.paddingTop = "16px";
    btn.onPointerUpObservable.add(() => onRestart());
    overStack.addControl(btn);

    this.hideGameOver();
  }

  // Legend angled toward the player on the left. A festival player has nobody
  // to ask and about ten seconds of patience, so the bindings live in-world.
  private buildHelp(scene: Scene, parent: TransformNode): void {
    const help = makePanel(
      scene,
      parent,
      "uiHelp",
      0.33,
      0.4,
      new Vector3(-0.36, 0.88, -0.1),
      -YAW_IN
    );
    backdrop(help.adt);

    const stack = new StackPanel();
    stack.paddingTop = "26px";
    stack.paddingLeft = "30px";
    stack.paddingRight = "30px";
    help.adt.addControl(stack);

    const heading = text("조작", 62, "#dfe5ff", { bold: true });
    heading.height = "92px";
    stack.addControl(heading);

    const rows: [string, string][] = [
      ["왼쪽 스틱", "이동"],
      ["오른쪽 스틱", "눕히기·돌리기"],
      ["A / B", "굴리기"],
      ["오른쪽 방아쇠", "쾅 떨구기"],
      ["왼쪽 손잡이", "천천히"],
      ["왼쪽 X", "위치 맞춤"],
      ["왼쪽 Y", "다시 시작"],
    ];

    for (const [key, label] of rows) {
      const row = new Rectangle();
      row.height = "94px";
      row.thickness = 0;
      row.background = "transparent";

      const chip = new Rectangle();
      chip.width = "390px";
      chip.height = "72px";
      chip.cornerRadius = 14;
      chip.thickness = 2;
      chip.color = "#39447a";
      chip.background = "#18203c";
      chip.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
      const chipText = text(key, 44, "#cdd5ff");
      chip.addControl(chipText);
      row.addControl(chip);

      const desc = text(label, 46, "#9aa5d4");
      desc.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
      desc.paddingRight = "8px";
      row.addControl(desc);

      stack.addControl(row);
    }
  }

  update(game: Game): void {
    this.scoreValue.text = String(game.score);
    this.scoreSub.text = `레이어 ${game.layers} · 레벨 ${game.level}`;
    this.tierLabel.text = game.tierLabel;

    // Round up, so the clock only shows 0:00 when the round is actually over.
    const total = Math.ceil(game.timeLeftMs / 1000);
    const mins = Math.floor(total / 60);
    this.clock.text = `${mins}:${String(total % 60).padStart(2, "0")}`;
    this.clock.color = game.timeCritical ? "#ff5a5a" : "#eef2ff";
  }

  showGameOver(game: Game): void {
    this.gameOverScore.text =
      (game.endedBy === "timeout" ? "시간 종료 · " : "") + `점수 ${game.score}`;
    this.gameOver.plane.setEnabled(true);
  }

  hideGameOver(): void {
    this.gameOver.plane.setEnabled(false);
  }
}
