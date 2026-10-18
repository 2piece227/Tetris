import { AdvancedDynamicTexture, Control, Rectangle, TextBlock } from "@babylonjs/gui";
import type { Game } from "../game/game";
import { WELL, layerColor } from "./config";

const { h } = WELL;
const FONT = "system-ui, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";

/** One layer's slot in the stack gauge. */
const SEG_H = 26;
const BAR_W = 20;
/** Clearance from the centre divider to the inner edge of each bar. */
const GAP = 14;

const hex = (c: number): string => "#" + c.toString(16).padStart(6, "0");

/**
 * Scores, and a stack gauge for each player either side of the centre divider.
 *
 * The gauge is Blockout's pit meter: one slot per layer, filling from the floor
 * up as the well silts in. It is not a colour key — it is the only readout of
 * how close a player is to topping out, because from directly above the shaft
 * every layer projects onto the same place and depth is nearly unreadable.
 *
 * A slot carries its layer's colour, so the gauge and the blocks in the well
 * agree, and its opacity tracks how full that layer is: a faint slot is barely
 * started, a solid one is a layer about to clear.
 */
export class Hud {
  private readonly scores: TextBlock[] = [];
  /** [player][layerIndex] — layer 0 is the floor. */
  private readonly fills: Rectangle[][] = [[], []];
  private readonly flashes: TextBlock[] = [];
  private readonly flashTimers: (number | null)[] = [null, null];

  /** `labels` names the left and right player, e.g. ["나", "AI"]. */
  constructor(ui: AdvancedDynamicTexture, labels: [string, string]) {
    this.scores.push(this.buildScore(ui, labels[0], -25));
    this.scores.push(this.buildScore(ui, labels[1], 25));
    this.buildGauge(ui, 0, -1);
    this.buildGauge(ui, 1, 1);
    this.flashes.push(this.buildFlash(ui, "p1", -25));
    this.flashes.push(this.buildFlash(ui, "p2", 25));
  }

  /**
   * The banner that says an attack just landed.
   *
   * Without it a player watching their own well simply sees the stack jump, and
   * reads it as the game glitching rather than as the other player hitting
   * them. It sits on the attacker's half, because the reason to show it at all
   * is to make a good clear feel like it did something to someone.
   */
  private buildFlash(
    ui: AdvancedDynamicTexture,
    label: string,
    offsetPct: number
  ): TextBlock {
    const t = new TextBlock(`${label}_flash`, "");
    t.color = "#ffd166";
    t.fontSize = 34;
    t.fontFamily = FONT;
    t.fontWeight = "800";
    t.outlineColor = "#1a1207";
    t.outlineWidth = 5;
    t.height = "44px";
    t.left = `${offsetPct}%`;
    t.top = "-22%";
    t.alpha = 0;
    t.isVisible = true;
    ui.addControl(t);
    return t;
  }

  /** Show `공격 +n줄` on the attacker's half for a beat. */
  flashAttack(player: 0 | 1, lines: number): void {
    this.showFlash(player, `공격  +${lines}줄`, "#ffd166");
  }

  /** Show the hit on the receiving half, so both sides see the same event. */
  flashHit(player: 0 | 1, lines: number): void {
    this.showFlash(player, `피격  +${lines}줄`, "#ff7b7b");
  }

  private showFlash(player: 0 | 1, text: string, color: string): void {
    const t = this.flashes[player];
    t.text = text;
    t.color = color;
    t.alpha = 1;
    const prev = this.flashTimers[player];
    if (prev !== null) window.clearTimeout(prev);
    this.flashTimers[player] = window.setTimeout(() => {
      t.alpha = 0;
      this.flashTimers[player] = null;
    }, 1100);
  }

  /** Clear any banner still on screen, so a new round starts clean. */
  clearFlashes(): void {
    for (let i = 0; i < this.flashes.length; i++) {
      this.flashes[i].alpha = 0;
      const timer = this.flashTimers[i];
      if (timer !== null) window.clearTimeout(timer);
      this.flashTimers[i] = null;
    }
  }

  /** `offsetPct` is a shift from canvas centre, so -25 lands mid left-half. */
  private buildScore(
    ui: AdvancedDynamicTexture,
    label: string,
    offsetPct: number
  ): TextBlock {
    const name = new TextBlock(`${label}_name`, label);
    name.color = "#8fa0d8";
    name.fontSize = 22;
    name.fontFamily = FONT;
    name.fontWeight = "700";
    name.height = "28px";
    name.top = "30px";
    name.left = `${offsetPct}%`;
    name.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    ui.addControl(name);

    const score = new TextBlock(`${label}_score`, "0");
    score.color = "#eef2ff";
    score.fontSize = 42;
    score.fontFamily = FONT;
    score.fontWeight = "700";
    score.height = "52px";
    score.top = "60px";
    score.left = `${offsetPct}%`;
    score.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    ui.addControl(score);
    return score;
  }

  /** `dir` is -1 for the bar left of the divider, +1 for the one right of it. */
  private buildGauge(ui: AdvancedDynamicTexture, player: number, dir: number): void {
    const centreX = dir * (GAP + BAR_W / 2);

    for (let layer = 0; layer < h; layer++) {
      // Layer 0 is the floor, so it belongs at the bottom of the bar.
      const y = (h - 1 - layer - (h - 1) / 2) * SEG_H;

      const slot = new Rectangle(`gauge${player}_slot${layer}`);
      slot.width = `${BAR_W}px`;
      slot.height = `${SEG_H - 3}px`;
      slot.left = `${centreX}px`;
      slot.top = `${y}px`;
      slot.thickness = 1;
      slot.color = "#232c52";
      slot.background = "#0a0e1c";
      slot.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
      slot.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
      ui.addControl(slot);

      const fill = new Rectangle(`gauge${player}_fill${layer}`);
      fill.width = "100%";
      fill.height = "100%";
      fill.thickness = 0;
      // Through layerColor, not the anchor list: the list is a ramp with fewer
      // entries than the well has layers, so indexing it directly read
      // undefined past the last anchor and threw out of the constructor —
      // taking the whole HUD, and with it the round, down with it.
      fill.background = hex(layerColor(layer));
      fill.alpha = 0;
      slot.addControl(fill);
      this.fills[player].push(fill);
    }
  }

  private paint(game: Game, player: number): void {
    for (let layer = 0; layer < h; layer++) {
      const frac = game.grid.layerFill(layer) / game.grid.layerCells;
      // Any block at all has to be visible, so an occupied layer starts well
      // clear of transparent rather than fading in from nothing.
      this.fills[player][layer].alpha = frac === 0 ? 0 : 0.3 + 0.7 * frac;
    }
  }

  update(p1: Game, p2: Game): void {
    this.scores[0].text = String(p1.score);
    this.scores[1].text = String(p2.score);
    this.paint(p1, 0);
    this.paint(p2, 1);
  }
}
