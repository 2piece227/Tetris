import type { Game } from "../game/game";
import { WELL, layerColor } from "./config";
import { pieceIcon } from "./pieceIcon";

const hex = (c: number): string => "#" + c.toString(16).padStart(6, "0");
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

/** The top few layers: a stack reaching any of them is about to lose. */
const DANGER_LAYERS = 3;

/** What the HUD shows that the games do not keep themselves. */
export interface Tally {
  sent: [number, number];
  received: [number, number];
}

/**
 * Everything printed over the two wells: names and scores, the next piece, a
 * stack gauge and an incoming-attack gauge per side, and the attack banners.
 *
 * The stack gauge is Blockout's pit meter, and it is not decoration: looking
 * straight down the shaft, a full layer and an empty one three below it are
 * the same few pixels, so the gauge is the one readout of how close a player
 * is to topping out. A slot carries its layer's colour, so the gauge and the
 * blocks agree, and its opacity tracks how full that layer is.
 *
 * The attack gauge is what the attacked player most needs and most often
 * missed: layers already on their way, which will rise under the stack the
 * moment the piece in hand lands.
 */
export class Hud {
  private readonly fills: HTMLElement[][] = [[], []];
  private readonly incoming: HTMLElement[][] = [[], []];
  private readonly flashTimers: (number | null)[] = [null, null];
  private readonly lastNext: (string | null)[] = [null, null];

  constructor() {
    for (const side of [0, 1] as const) {
      const gauge = $(`gauge${side}`);
      const attack = $(`attack${side}`);
      // Top layer first in the DOM, so the column reads floor-at-the-bottom.
      for (let layer = WELL.h - 1; layer >= 0; layer--) {
        const slot = document.createElement("div");
        slot.className = "slot" + (layer >= WELL.h - DANGER_LAYERS ? " brink" : "");
        const fill = document.createElement("div");
        fill.className = "fill";
        fill.style.background = hex(layerColor(layer));
        slot.appendChild(fill);
        // Numbered from the floor, so a colour in the well can be matched to
        // a layer by reading the gauge rather than by guessing at depth.
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = String(layer + 1);
        slot.appendChild(num);
        gauge.appendChild(slot);
        this.fills[side][layer] = fill;

        const a = document.createElement("div");
        a.className = "slot";
        attack.appendChild(a);
        this.incoming[side][layer] = a;
      }
    }
  }

  setNames(left: string, right: string): void {
    $("name0").textContent = left;
    $("name1").textContent = right;
  }

  update(games: [Game, Game], tally: Tally): void {
    games.forEach((g, side) => {
      $(`score${side}`).textContent = g.score.toLocaleString("ko-KR");
      $(`meta${side}`).textContent = `Lv ${g.level} · ${g.layers}층`;
      $(`sent${side}`).textContent = String(tally.sent[side]);
      $(`recv${side}`).textContent = String(tally.received[side]);

      // The next piece only changes once a piece lands; rebuilding the SVG on
      // every move would churn the DOM for nothing.
      const key = g.next.name;
      if (this.lastNext[side] !== key) {
        $(`next${side}`).innerHTML = pieceIcon(g.next.cells, g.next.color);
        this.lastNext[side] = key;
      }

      // The layers the piece in hand will come to rest in. From straight
      // above, "which layer is this" is the hardest question on screen; the
      // gauge answers it for the one piece that matters.
      let landLo = Infinity;
      let landHi = -Infinity;
      if (!g.gameOver) {
        const gp = g.ghostPos();
        for (const c of g.cells) {
          landLo = Math.min(landLo, gp.y + c.y);
          landHi = Math.max(landHi, gp.y + c.y);
        }
      }

      let danger = false;
      for (let layer = 0; layer < WELL.h; layer++) {
        const frac = g.grid.layerFill(layer) / g.grid.layerCells;
        // Any block at all has to be visible, so an occupied layer starts well
        // clear of transparent rather than fading in from nothing.
        const fill = this.fills[side][layer];
        fill.style.opacity = frac === 0 ? "0" : String(0.35 + 0.65 * frac);
        fill.parentElement!.classList.toggle("land", layer >= landLo && layer <= landHi);
        if (frac > 0 && layer >= WELL.h - DANGER_LAYERS) danger = true;
      }
      $(`half${side}`).classList.toggle("danger", danger);

      const pending = Math.min(WELL.h, g.incomingGarbage);
      this.incoming[side].forEach((slot, layer) => slot.classList.toggle("on", layer < pending));
      $(`attack${side}`).classList.toggle("armed", pending > 0);
    });
  }

  /** Clear any banner still up, so a new round starts clean. */
  clearFlashes(): void {
    for (const side of [0, 1] as const) {
      const t = this.flashTimers[side];
      if (t !== null) window.clearTimeout(t);
      this.flashTimers[side] = null;
      $(`flash${side}`).className = "flash";
    }
  }

  /** On the attacker's half: the clear did something to someone. */
  flashAttack(side: 0 | 1, lines: number): void {
    this.flash(side, `공격 +${lines}`, "attack");
  }

  /** On the receiver's half, when the layers actually rise under them. */
  flashHit(side: 0 | 1, lines: number): void {
    this.flash(side, `+${lines}층 올라옴`, "hit");
  }

  private flash(side: 0 | 1, text: string, kind: string): void {
    const el = $(`flash${side}`);
    el.textContent = text;
    // Restart the animation even if the same banner is already playing.
    el.className = "flash";
    void el.offsetWidth;
    el.className = `flash ${kind} show`;
    const prev = this.flashTimers[side];
    if (prev !== null) window.clearTimeout(prev);
    this.flashTimers[side] = window.setTimeout(() => {
      el.className = "flash";
      this.flashTimers[side] = null;
    }, 1200);
  }
}
