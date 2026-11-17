import { Vector3 } from "@babylonjs/core";
import { CELL } from "../vr/config";
import { Renderer, type DrawState } from "../vr/renderer";
import { LABELS, LABEL_ORDER } from "./labels";
import { rankPlacements, type Scored } from "../engine/placements";
import { key, orientations } from "../game/orientations";
import type { Label } from "./labels";
import type { Indicator, Review, Turn } from "./analysis";

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

/**
 * What to practise next, keyed to the weakest indicator. Each names something
 * to try in the next round — the review is meant to end in a next attempt,
 * not in a grade.
 */
const TIPS: Record<Indicator["id"], string> = {
  accuracy: "놓기 전에 '이 자리에 놓으면 아래에 빈칸이 덮이나?'부터 확인해 보세요. 구멍을 안 만드는 것만으로 정확도가 크게 올라요.",
  rotation: "버튼을 누르기 전에 원하는 모양을 머릿속으로 먼저 돌려보세요. 한 번에 맞는 방향을 찾는 연습이 심적 회전을 길러줘요.",
  solid: "가지·나사 조각은 바닥에 닿을 면을 먼저 정하고, 그 면이 아래로 가도록 돌려보세요.",
  speed: "조각이 떨어지는 동안 '다음 조각' 칸을 보고 다음 자리를 미리 정해두면 판단이 빨라져요.",
};

/** A small radar of the four indicators. An axis with no data is drawn hollow. */
function radar(inds: Indicator[]): string {
  const cx = 110, cy = 100, r = 70;
  const at = (i: number, v: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / inds.length;
    return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v];
  };
  const ring = (v: number): string => inds.map((_, i) => at(i, v).join(",")).join(" ");
  const pts = inds.map((m, i) => at(i, (m.value ?? 0) / 100).join(",")).join(" ");
  const labels = inds
    .map((m, i) => {
      const [x, y] = at(i, 1.28);
      const anchor = Math.abs(x - cx) < 4 ? "middle" : x > cx ? "start" : "end";
      const val = m.value === null ? "—" : m.display;
      return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" class="rl">${m.name}</text>` +
        `<text x="${x.toFixed(1)}" y="${(y + 18).toFixed(1)}" text-anchor="${anchor}" class="rv">${val}</text>`;
    })
    .join("");
  return `<svg viewBox="-40 -14 300 236" role="img" aria-label="공간지각 리포트">` +
    [0.25, 0.5, 0.75, 1].map((v) => `<polygon points="${ring(v)}" class="rg"/>`).join("") +
    inds.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${at(i, 1)[0]}" y2="${at(i, 1)[1]}" class="ra"/>`).join("") +
    `<polygon points="${pts}" class="rp"/>` +
    inds.map((m, i) => (m.value === null ? "" : `<circle cx="${at(i, m.value / 100)[0]}" cy="${at(i, m.value / 100)[1]}" r="3.5" class="rd"/>`)).join("") +
    labels + `</svg>`;
}

/** How this piece was turned against the fewest turns its final shape needs. */
function turning(t: Turn): string {
  if (!t.move) return "";
  const needed = orientations(t.piece.cells).get(key(t.move.cells))?.path.length ?? 0;
  let made = 0;
  let blocked = 0;
  for (const i of t.move.inputs) if (i.k === "turn") i.ok ? made++ : blocked++;
  const extra = blocked ? ` · 막힌 회전 ${blocked}번` : "";
  if (needed === 0 && made === 0) return `회전 없이 그대로 놓았어요${extra}`;
  const ok = made <= needed;
  return `<b class="${ok ? "good" : "warn"}">${made}번</b> 돌림 · 최소 ${needed}번이면 되는 모양${extra}`;
}

/** Quiz option colours: warm and distinct from the engine's cyan hologram. */
const QUIZ_COLORS = ["#ff5a3c", "#ffd21f", "#9d6bff", "#3fdc6b"];
const LETTERS = ["A", "B", "C", "D"];
/** The engine's choice, as the review's hologram shows it. */
const AI_COLOR = "#2fd6e6";

interface QuizOption {
  place: Scored;
  /** best = the engine's choice; mine = where the player actually put it. */
  tag: "best" | "mine" | "other";
  color: string;
  letter: string;
}

const cellsKey = (p: { cells: { x: number; y: number; z: number }[]; pos: { x: number; y: number; z: number } }): string[] =>
  p.cells.map((c) => `${c.x + p.pos.x},${c.y + p.pos.y},${c.z + p.pos.z}`);

/**
 * Three or four places the piece could have gone: the engine's choice, the
 * player's own move when it differs, and clearly worse spots from the middle
 * of the ranking. Spots that do not overlap are preferred, so each colour can
 * be told apart in the tank. Order is shuffled, fixed per turn.
 */
function quizOptions(t: Turn): QuizOption[] {
  const ranked = rankPlacements(t.before, t.piece.cells);
  const chosen: { place: Scored; tag: QuizOption["tag"] }[] = [{ place: ranked[0], tag: "best" }];
  const used = new Set(cellsKey(ranked[0]));
  const same = (a: Scored, b: Scored): boolean => cellsKey(a).sort().join("|") === cellsKey(b).sort().join("|");
  if (t.rank > 1 && !same(t.played, ranked[0])) {
    chosen.push({ place: t.played, tag: "mine" });
    cellsKey(t.played).forEach((k) => used.add(k));
  }
  const lo = Math.floor(ranked.length * 0.25);
  const hi = Math.max(lo + 1, Math.floor(ranked.length * 0.8));
  const pool = ranked.slice(lo, hi).filter((p) => p.score < ranked[0].score - 1 && !chosen.some((c) => same(c.place, p)));
  // Walk the pool from a turn-dependent start, so neighbouring turns differ.
  for (let pass = 0; pass < 2 && chosen.length < 4; pass++)
    for (let k = 0; k < pool.length && chosen.length < 4; k++) {
      const p = pool[(k * 7 + t.n * 3) % pool.length];
      if (chosen.some((c) => same(c.place, p))) continue;
      const keys = cellsKey(p);
      if (pass === 0 && keys.some((x) => used.has(x))) continue;
      chosen.push({ place: p, tag: "other" });
      keys.forEach((x) => used.add(x));
    }
  const order = chosen
    .map((c, i) => ({ c, h: (t.n * 31 + i * 17) % 97 }))
    .sort((a, b) => a.h - b.h)
    .map((o) => o.c);
  return order.map((c, i) => ({ ...c, color: QUIZ_COLORS[i], letter: LETTERS[i] }));
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

  $("radar").innerHTML = radar(review.indicators);
  $("meters").innerHTML = review.indicators
    .map(
      (m) => `<div class="meter${m.value === null ? " empty" : ""}">
        <div class="row1"><span>${m.name}<i class="skill">${m.skill}</i>${m.sample ? "<em>샘플</em>" : ""}</span><b>${m.display}</b></div>
        <div class="bar"><div style="width:${m.value ?? 0}%"></div></div>
        <p>${m.note}</p>
      </div>`
    )
    .join("");

  // Strength and the thing to practise: the best and worst measured indicator.
  const measured = review.indicators.filter((m) => m.value !== null && !m.sample);
  const sorted = [...measured].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const strong = sorted[0];
  const weak = sorted[sorted.length - 1];
  $("insight").innerHTML =
    strong && weak && strong !== weak
      ? `강점 <b>${strong.name}</b> · 연습할 점 <b>${weak.name}</b>`
      : "지표가 더 쌓이면 강점과 연습할 점을 알려드려요";
  const focus = weak ?? review.indicators[0];
  $("tipFocus").textContent = focus ? `${focus.name} (${focus.skill})` : "";
  $("tip").textContent = focus ? TIPS[focus.id] : "";

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

  // ── Move list ─────────────────────────────────────────────────────────
  // Every move as a row, like a match history: number, verdict, what it did,
  // accuracy. Filters by verdict make the mistakes easy to find.
  let filter: Label | "all" = "all";
  const short = (t: Turn): string => {
    const p = t.played.features;
    if (p.cleared > 0) return `${p.cleared}층 지움 · 조각 ${t.piece.name}`;
    if (t.judged.holesCreated > 0) return `구멍 +${t.judged.holesCreated} · 조각 ${t.piece.name}`;
    return `조각 ${t.piece.name}`;
  };
  const listEl = $("mlist");
  const rows = turns.map((t, i) => {
    const L = LABELS[t.label];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mv";
    b.innerHTML =
      `<span class="stripe" style="background:${L.color}"></span>` +
      `<span class="n">${t.n}수</span>` +
      `<span class="lb" style="color:${L.color}">${L.name}${L.mark ? " " + L.mark : ""}</span>` +
      `<span class="note">${short(t)}</span>` +
      `<span class="acc">${t.accuracy}%</span>`;
    b.addEventListener("click", () => {
      if (quiz) exitQuiz(false);
      go(i);
    });
    listEl.appendChild(b);
    return b;
  });
  const filtersEl = $("filters");
  const filterButtons = (["all", ...LABEL_ORDER] as const).map((f) => {
    const n = f === "all" ? turns.length : turns.filter((t) => t.label === f).length;
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `${f === "all" ? "전체" : LABELS[f].name}<b>${n}</b>`;
    b.disabled = n === 0;
    b.addEventListener("click", () => {
      filter = f;
      filterButtons.forEach(([g, el]) => el.classList.toggle("on", g === f));
      rows.forEach((r, i) => (r.style.display = f === "all" || turns[i].label === f ? "" : "none"));
      // Jump to the first move the filter shows, so the tank follows the list.
      const first = turns.findIndex((t) => f === "all" || t.label === f);
      if (first >= 0 && f !== "all") go(first);
    });
    filtersEl.appendChild(b);
    return [f, b] as const;
  });
  filterButtons[0][1].classList.add("on");
  /** Step to the previous or next move the filter shows. */
  const step = (dir: 1 | -1): void => {
    for (let i = at + dir; i >= 0 && i < turns.length; i += dir)
      if (filter === "all" || turns[i].label === filter) return go(i);
  };

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
    $("cTurning").innerHTML = turning(t);
    $("cTurning").style.display = t.move ? "" : "none";
    // Mine against the engine's choice, on the three things that decided it.
    const p = t.played.features;
    const b = t.best.features;
    const cmp = $("cCompare");
    cmp.style.display = t.rank > 1 ? "" : "none";
    if (t.rank > 1) {
      const row = (name: string, mine: number, ai: number, lowerIsBetter: boolean): string => {
        const better = lowerIsBetter ? ai < mine : ai > mine;
        return `<tr><th>${name}</th><td>${mine}</td><td class="${better ? "ai" : ""}">${ai}</td></tr>`;
      };
      cmp.innerHTML =
        `<tr><th></th><td>내 수</td><td>AI 추천</td></tr>` +
        row("구멍", p.holes, b.holes, true) +
        row("최고 높이", p.top, b.top, true) +
        row("지운 층", p.cleared, b.cleared, false);
    }
    $("cHint").textContent = t.fullLayers.length
      ? placed ? "Space: 지운 뒤 보기" : "Space: 놓는 순간 다시 보기"
      : t.rank === 1 ? "AI 추천과 같은 자리" : showBest ? "Space: 추천 숨기기" : "Space: 추천 보기";

    const legend = $("cLegend");
    const [mine, ai] = [...legend.children] as HTMLElement[];
    (mine.firstElementChild as HTMLElement).style.background = hex(t.piece.color);
    ai.style.display = hint ? "" : "none";

    rows.forEach((r, i) => r.classList.toggle("on", i === at));
    rows[at].scrollIntoView({ block: "nearest" });
    $("cQuiz").style.display = t.rank > 1 ? "" : "none";
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

  // ── Quiz: "think like the AI" ────────────────────────────────────────
  // The moves worth a question: the 의문 and 블런더 ones, in order; if a round
  // has none, the moves that lost the most. Up to eight.
  const severe = turns.map((t, i) => ({ t, i })).filter(({ t }) => t.label === "dubious" || t.label === "blunder");
  const queue = (severe.length
    ? severe
    : turns.map((t, i) => ({ t, i })).filter(({ t }) => t.rank > 1).sort((a, b) => b.t.judged.loss - a.t.judged.loss)
  ).slice(0, 8).map(({ i }) => i);
  $("practiceQuiz").textContent = queue.length ? `실수 장면으로 퀴즈 풀기 (${queue.length}문제)` : "퀴즈로 풀 장면이 없어요";
  ($("practiceQuiz") as HTMLButtonElement).disabled = queue.length === 0;

  let quiz: { list: number[]; pos: number; right: number; opts: QuizOption[]; picked: number | null } | null = null;

  function startQuiz(list: number[]): void {
    if (!list.length) return;
    cancel();
    quiz = { list, pos: 0, right: 0, opts: [], picked: null };
    $("card").classList.add("quizzing");
    // The stack goes ghostly so the four coloured options are the only solid
    // things in the tank: the stack's own colours would otherwise pass for one.
    renderer.setDemoLook(true);
    ask();
  }

  function ask(): void {
    if (!quiz) return;
    const i = quiz.list[quiz.pos];
    at = i;
    const t = turns[i];
    quiz.opts = quizOptions(t);
    quiz.picked = null;
    // The board the player faced, the piece to place on the plinth, no answer.
    renderer.redraw({
      grid: t.before,
      gameOver: true,
      pos: t.played.pos,
      cells: t.played.cells,
      current: t.piece,
      next: t.piece,
      ghostPos: () => t.played.pos,
    });
    renderer.showHint(null);
    renderer.showOptions(quiz.opts.map((o) => ({ cells: o.place.cells, pos: o.place.pos, color: o.color })));
    // Aim at the height the options sit at: in an 18-deep tank they are often
    // down at the floor, small under the default view. Dragging still works.
    const ys = quiz.opts.flatMap((o) => o.place.cells.map((c) => o.place.pos.y + c.y));
    const mid = (Math.min(...ys) + Math.max(...ys) + 1) / 2;
    cam.setTarget(new Vector3(renderer.wellRoot.position.x, renderer.wellRoot.position.y + mid * CELL, renderer.wellRoot.position.z));
    cam.radius = 1.15;
    rows.forEach((r, k) => r.classList.toggle("on", k === i));
    rows[i].scrollIntoView({ block: "nearest" });

    $("qProg").textContent = `${quiz.pos + 1} / ${quiz.list.length}문제 · 맞힘 ${quiz.right}`;
    $("qAsk").textContent = `${t.n}수의 조각 ${t.piece.name}, AI라면 어디에 놓았을까요?`;
    $("qOpts").innerHTML = quiz.opts
      .map((o, k) => `<button type="button" data-k="${k}" style="background:${o.color}">${o.letter}</button>`)
      .join("");
    $("qOpts").querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => answer(Number((b as HTMLElement).dataset.k)))
    );
    $("qRes").innerHTML = "";
    $("qNext").style.visibility = "hidden";
  }

  function answer(k: number): void {
    if (!quiz || quiz.picked !== null || !quiz.opts[k]) return;
    quiz.picked = k;
    const best = quiz.opts.find((o) => o.tag === "best")!;
    const picked = quiz.opts[k];
    const right = picked === best;
    if (right) quiz.right++;
    // Leave the answer in the tank: the engine's spot in its cyan, and the
    // pick beside it when it was wrong.
    renderer.showOptions([
      { cells: best.place.cells, pos: best.place.pos, color: AI_COLOR },
      ...(right ? [] : [{ cells: picked.place.cells, pos: picked.place.pos, color: picked.color }]),
    ]);
    $("qOpts").querySelectorAll("button").forEach((b, idx) => {
      (b as HTMLButtonElement).disabled = true;
      b.classList.toggle("is-answer", quiz!.opts[idx] === best);
      b.classList.toggle("is-picked", idx === k);
    });
    const tagName = (o: QuizOption): string => (o.tag === "best" ? "AI 최선" : o.tag === "mine" ? "내가 둔 자리" : "");
    const why = (() => {
      const a = best.place.features;
      const b = picked.place.features;
      if (right) return a.holes === 0 ? "구멍을 만들지 않고 낮게 쌓는 자리예요." : "다른 후보보다 구멍과 높이를 가장 적게 늘리는 자리예요.";
      if (a.cleared > b.cleared) return `AI 자리는 ${a.cleared}층을 지울 수 있었어요.`;
      if (a.holes < b.holes) return `고른 자리는 구멍이 ${b.holes - a.holes}개 더 생겨요.`;
      if (a.top < b.top) return `고른 자리는 ${b.top - a.top}층 더 높이 쌓여요.`;
      return "고른 자리는 바닥이 더 울퉁불퉁해져요.";
    })();
    $("qRes").innerHTML =
      `<div class="${right ? "ok" : "no"}">${right ? "정답이에요!" : `아쉬워요. 정답은 ${best.letter}예요.`}</div>` +
      `<div>${why}</div>` +
      `<table><tr><th></th><th>구멍</th><th>최고 높이</th><th>지운 층</th><th></th></tr>` +
      quiz.opts
        .map(
          (o) =>
            `<tr class="${o === best ? "best" : ""}"><td class="l" style="color:${o === best ? AI_COLOR : o.color}">${o.letter}</td>` +
            `<td>${o.place.features.holes}</td><td>${o.place.features.top}</td><td>${o.place.features.cleared}</td><td>${tagName(o)}</td></tr>`
        )
        .join("") +
      `</table>`;
    $("qProg").textContent = `${quiz.pos + 1} / ${quiz.list.length}문제 · 맞힘 ${quiz.right}`;
    const last = quiz.pos === quiz.list.length - 1;
    $("qNext").textContent = last ? "결과 보기" : "다음 문제";
    $("qNext").style.visibility = "visible";
  }

  function nextQuestion(): void {
    if (!quiz || quiz.picked === null) return;
    if (quiz.pos < quiz.list.length - 1) {
      quiz.pos++;
      ask();
      return;
    }
    // Done: the score, then back to the review where it left off.
    $("qAsk").textContent = `퀴즈 끝! ${quiz.list.length}문제 중 ${quiz.right}개를 맞혔어요.`;
    $("qOpts").innerHTML = "";
    $("qRes").innerHTML =
      quiz.right === quiz.list.length
        ? "모든 장면에서 AI와 같은 자리를 찾았어요. 다음엔 AI와 대결해 보세요."
        : "틀린 장면은 수 목록에서 다시 볼 수 있어요. 머릿속으로 조각을 돌려보는 연습이 도움이 돼요.";
    $("qNext").style.visibility = "hidden";
    quiz.picked = null;
    renderer.showOptions([]);
  }

  function exitQuiz(redraw = true): void {
    quiz = null;
    renderer.showOptions([]);
    renderer.setDemoLook(false);
    $("card").classList.remove("quizzing");
    if (redraw) arrive(false);
  }

  $("cQuiz").addEventListener("click", () => startQuiz([at]));
  $("practiceQuiz").addEventListener("click", () => startQuiz(queue));
  $("qNext").addEventListener("click", nextQuestion);
  $("qExit").addEventListener("click", () => exitQuiz());
  $("prev").addEventListener("click", () => {
    if (quiz) exitQuiz(false);
    step(-1);
  });
  $("next").addEventListener("click", () => {
    if (quiz) exitQuiz(false);
    step(1);
  });

  window.addEventListener("keydown", (e) => {
    if (quiz) {
      const k = "1234".indexOf(e.key) >= 0 ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase());
      if (k >= 0 && e.key.length === 1) answer(k);
      else if (e.key === "Enter" || e.key === "ArrowRight" || e.key === "ArrowDown") nextQuestion();
      else if (e.key === "Escape") exitQuiz();
      else return;
      e.preventDefault();
      return;
    }
    let used = true;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowUp": step(-1); break;
      case "ArrowRight":
      case "ArrowDown": step(1); break;
      case "Home": go(0); break;
      case "End": go(turns.length - 1); break;
      case " ": toggle(); break;
      default: used = false;
    }
    if (used) e.preventDefault();
  });

  arrive(false);
}
