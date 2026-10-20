import { Renderer, type DrawState } from "../vr/renderer";
import { LABELS, LABEL_ORDER } from "./labels";
import type { Review, Turn } from "./analysis";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const hex = (c: number): string => "#" + c.toString(16).padStart(6, "0");

/** How far above its resting place a piece starts when a step brings it in. */
const DROP_FROM = 0.28;
const DROP_MS = 220;

/** Plain-language lines under the verdict, from what the move actually did. */
function facts(t: Turn): string[] {
  const out: string[] = [];
  const p = t.played.features;
  const b = t.best.features;

  if (p.cleared > 0) out.push(`${p.cleared}층을 지웠어요.`);
  if (t.judged.holesCreated > 0) out.push(`구멍 ${t.judged.holesCreated}개를 만들었어요.`);
  if (p.top >= t.judged.wellH - 6) out.push(`가장 높은 곳이 ${p.top}층까지 올라왔어요.`);

  if (t.rank > 1) {
    if (b.cleared > p.cleared) out.push(`추천 자리에서는 ${b.cleared}층을 지울 수 있었어요.`);
    else if (b.holes < p.holes) out.push(b.holes === 0 ? "추천 자리는 구멍 없이 놓여요." : `추천 자리는 구멍이 ${p.holes - b.holes}개 적어요.`);
    else if (b.top < p.top) out.push(`추천 자리가 ${p.top - b.top}층 더 낮아요.`);
    else out.push("추천 자리가 바닥을 더 평평하게 만들어요.");
  }
  return out;
}

export function openReport(review: Review): void {
  // The canvas has to be on screen before the engine sizes itself to it.
  document.body.classList.add("reporting");

  const renderer = new Renderer($<HTMLCanvasElement>("stage"));
  renderer.engine.resize();
  const cam = renderer.camera;
  cam.radius = 1.75;
  // Free to drag round, but never under the floor or straight down the shaft:
  // either way the stack disappears and a visitor does not know how to get back.
  cam.lowerBetaLimit = 0.25;
  cam.upperBetaLimit = 1.45;

  const { turns } = review;
  let at = 0;
  let showBest = true;
  let drop: { startedAt: number; restY: number } | null = null;

  // ── Side panel ────────────────────────────────────────────────────────
  $("sampleBadge").style.display = review.sample ? "" : "none";
  $("sScore").textContent = review.score.toLocaleString("ko-KR");
  $("sLayers").textContent = String(review.layers);
  $("sAcc").textContent = `${review.accuracy}%`;

  $("counts").innerHTML = LABEL_ORDER.map((l) => {
    const n = turns.filter((t) => t.label === l).length;
    return `<span class="count"><i style="background:${LABELS[l].color}"></i>${LABELS[l].name} <b>${n}</b></span>`;
  }).join("");

  $("meters").innerHTML = review.indicators
    .map(
      (m) => `<div class="meter">
        <div class="row1"><span>${m.name}${m.sample ? "<em>샘플</em>" : ""}</span><b>${m.display}</b></div>
        <div class="bar"><div style="width:${m.value}%"></div></div>
        <p>${m.note}</p>
      </div>`
    )
    .join("");

  // Worst verdict first, then the bigger loss: a 블런더 outranks a 의문 that
  // happened to cost more points, because the verdict is what the player reads.
  const severity = (t: Turn): number => LABEL_ORDER.indexOf(t.label);
  const byLoss = [...turns].sort(
    (a, b) => severity(b) - severity(a) || b.judged.loss - a.judged.loss
  )[0];
  const bestClear = [...turns]
    .filter((t) => t.played.features.cleared > 0)
    .sort((a, b) => b.played.features.cleared - a.played.features.cleared || a.rank - b.rank)[0];
  const brilliant = turns.find((t) => t.label === "brilliant");
  const moments: [string, Turn | undefined][] = [
    ["가장 좋은 수", bestClear],
    ["가장 큰 실수", byLoss && severity(byLoss) >= LABEL_ORDER.indexOf("dubious") ? byLoss : undefined],
    ["탁월한 수", brilliant],
  ];
  const momentsEl = $("moments");
  for (const [name, t] of moments) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.disabled = !t;
    btn.innerHTML = t
      ? `<span class="count"><i style="background:${LABELS[t.label].color}"></i></span>${name}<small>${t.n}수</small>`
      : `${name}<small>없음</small>`;
    if (t) btn.addEventListener("click", () => go(t.n - 1));
    momentsEl.appendChild(btn);
  }

  // ── Timeline ──────────────────────────────────────────────────────────
  const dotsEl = $("dots");
  const dots = turns.map((t, i) => {
    const d = document.createElement("div");
    d.className = "dot";
    d.style.background = LABELS[t.label].color;
    d.title = `${t.n}수 · ${LABELS[t.label].name}`;
    d.addEventListener("click", () => go(i));
    dotsEl.appendChild(d);
    return d;
  });

  // ── One turn on screen ────────────────────────────────────────────────
  // A turn is shown at two moments: "placed", the piece just down on the
  // board it was played against (which is what the hologram is compared
  // with), and "cleared", once any layers it completed have gone. Arriving on
  // a turn that clears plays one into the other, so a clear happens on the
  // move that made it rather than appearing a turn late.
  type Phase = "placed" | "cleared";
  let phase: Phase = "placed";
  let timers: number[] = [];
  const cancel = (): void => {
    timers.forEach((id) => window.clearTimeout(id));
    timers = [];
    renderer.flashLayers([]);
  };

  /** Beat after landing before the full layers light up, and how long they stay lit. */
  const CLEAR_HOLD_MS = 450;
  const CLEAR_FLASH_MS = 320;

  function render(animate: boolean): void {
    const t = turns[at];
    const placed = phase === "placed";
    const state: DrawState = {
      grid: placed ? t.before : t.after,
      // Once cleared the piece is part of the stack, so no live piece is drawn.
      gameOver: !placed,
      pos: t.played.pos,
      cells: t.played.cells,
      current: t.piece,
      next: turns[at + 1]?.piece ?? t.piece,
      // Already resting, so the landing preview has nothing to show.
      ghostPos: () => t.played.pos,
    };
    renderer.redraw(state);

    const hint = placed && showBest && t.rank > 1;
    renderer.showHint(hint ? t.best.cells : null, t.best.pos);

    if (animate && placed) {
      const restY = renderer.pieceRoot.position.y;
      renderer.pieceRoot.position.y = restY + DROP_FROM;
      drop = { startedAt: performance.now(), restY };
    } else drop = null;

    const L = LABELS[t.label];
    $("cTurn").textContent = `${t.n}수`;
    const badge = $("cBadge");
    badge.textContent = L.name + (L.mark ? ` ${L.mark}` : "");
    badge.style.background = L.color;
    $("cPiece").textContent = `조각 ${t.piece.name}`;
    $("cLead").textContent = L.lead;
    $("cFacts").innerHTML = facts(t).map((f) => `<li>${f}</li>`).join("");
    $("cRank").textContent = `가능한 ${t.options}곳 중 ${t.rank}번째`;
    $("cHint").textContent = t.fullLayers.length
      ? placed ? "Space: 지운 뒤 보기" : "Space: 놓는 순간 다시 보기"
      : t.rank === 1 ? "AI 추천과 같은 자리" : showBest ? "Space: 추천 숨기기" : "Space: 추천 보기";

    const legend = $("cLegend");
    const [mine, ai] = [...legend.children] as HTMLElement[];
    (mine.firstElementChild as HTMLElement).style.background = hex(t.piece.color);
    ai.style.display = hint ? "" : "none";

    dots.forEach((d, i) => d.classList.toggle("on", i === at));
    dots[at].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** Show the current turn from the moment it was placed, then let it clear. */
  function arrive(animate: boolean): void {
    cancel();
    phase = "placed";
    render(animate);
    const t = turns[at];
    if (!t.fullLayers.length) return;
    const lit = (animate ? DROP_MS : 0) + CLEAR_HOLD_MS;
    timers.push(window.setTimeout(() => renderer.flashLayers(t.fullLayers), lit));
    timers.push(
      window.setTimeout(() => {
        renderer.flashLayers([]);
        phase = "cleared";
        render(false);
      }, lit + CLEAR_FLASH_MS)
    );
  }

  function go(i: number): void {
    const next = Math.max(0, Math.min(turns.length - 1, i));
    const forwardOne = next === at + 1;
    at = next;
    arrive(forwardOne);
  }

  /** Space: the hologram on an ordinary turn; before/after on one that clears. */
  function toggle(): void {
    const t = turns[at];
    cancel();
    if (t.fullLayers.length) {
      phase = phase === "placed" ? "cleared" : "placed";
      if (phase === "placed") showBest = true;
    } else showBest = !showBest;
    render(false);
  }

  // The piece settles into place when stepping forward, so a step reads as a
  // move being made rather than the board swapping under you.
  renderer.scene.onBeforeRenderObservable.add(() => {
    if (!drop) return;
    const t = Math.min(1, (performance.now() - drop.startedAt) / DROP_MS);
    const eased = 1 - (1 - t) * (1 - t);
    renderer.pieceRoot.position.y = drop.restY + DROP_FROM * (1 - eased);
    if (t >= 1) drop = null;
  });

  $("prev").addEventListener("click", () => go(at - 1));
  $("next").addEventListener("click", () => go(at + 1));

  window.addEventListener("keydown", (e) => {
    let used = true;
    switch (e.key) {
      case "ArrowLeft": go(at - 1); break;
      case "ArrowRight": go(at + 1); break;
      case "Home": go(0); break;
      case "End": go(turns.length - 1); break;
      case " ": toggle(); break;
      default: used = false;
    }
    if (used) e.preventDefault();
  });

  arrive(false);
}
