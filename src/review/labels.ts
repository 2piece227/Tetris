/**
 * The five verdicts a move can get.
 *
 * Several placements are often equally sound — which one is right depends on
 * the build the player is going for — so the scale has a middle that is not a
 * mistake: 무난 is "a reasonable move, just not the best one".
 */
export type Label = "brilliant" | "good" | "fine" | "dubious" | "blunder";

export const LABELS: Record<Label, { name: string; mark: string; color: string; lead: string }> = {
  brilliant: { name: "탁월", mark: "!!", color: "#2fd6e6", lead: "정답이 거의 하나뿐인 자리를 찾아냈어요." },
  good: { name: "좋음", mark: "!", color: "#7cf0c0", lead: "최선과 거의 같은 수예요." },
  fine: { name: "무난", mark: "", color: "#9aa5d4", lead: "다른 길도 있었지만 해볼 만한 수예요." },
  dubious: { name: "의문", mark: "?!", color: "#f0b64a", lead: "당장 크게 불리하진 않지만, 굳이 여기에?" },
  blunder: { name: "블런더", mark: "??", color: "#ff5a5a", lead: "되돌리기 어려운 손해를 봤어요." },
};

export const LABEL_ORDER: Label[] = ["brilliant", "good", "fine", "dubious", "blunder"];

export interface Judged {
  /** Best score minus the played score. 0 when the best move was played. */
  loss: number;
  /** Best minus median over every option: how much this position punished choice. */
  spread: number;
  /** Options scoring close enough to the best to count as equally good. */
  nearBest: number;
  cleared: number;
  holesCreated: number;
  /** Stack height after the move, and the well's height. */
  top: number;
  wellH: number;
}

/**
 * A position has to punish wrong choices at least this much for 탁월 to mean
 * anything. Set against the two-move scores, where spreads run wider than they
 * did one move deep: 35 keeps 탁월 to about one move in twenty on the sample
 * rounds, as 12 did before the review looked ahead.
 */
const MIN_SPREAD_FOR_BRILLIANT = 35;

/**
 * PROVISIONAL cutoffs. Loss is measured against the spread of the options in
 * that position rather than in raw points, so a position where many spots are
 * equally good hands out 좋음 and 무난, and only a position with one narrow
 * answer separates the players. To be calibrated on real games.
 */
export function classify(j: Judged): Label {
  const spread = Math.max(1, j.spread);
  const EPS = 1;
  if (j.loss <= EPS) {
    // The best move, made where it mattered: a position that punished choice
    // (a real spread) with a single answer in it, or a multi-layer
    // clear. A lucky clear that was not the best move never reaches here.
    const onlyAnswer = j.nearBest <= 1 && j.spread >= MIN_SPREAD_FOR_BRILLIANT;
    return onlyAnswer || j.cleared >= 2 ? "brilliant" : "good";
  }
  if (j.loss <= 0.15 * spread) return "good";
  if (j.loss <= 0.6 * spread) return "fine";
  // Past that, the question is whether it can be recovered from. Burying holes
  // or climbing into the top few layers is what makes a loss stick.
  const stuck = j.holesCreated >= 2 || j.top >= j.wellH - 4;
  if (j.loss >= 1.2 * spread && stuck) return "blunder";
  return "dubious";
}

/** 0–100 for one move: 100 is the best move, falling off with relative loss. */
export function moveAccuracy(j: Judged): number {
  const spread = Math.max(1, j.spread);
  return Math.round(100 * Math.max(0, 1 - j.loss / (2 * spread)));
}
