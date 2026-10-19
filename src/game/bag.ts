import { PieceDef, Tier, tierIndexFor } from "./pieces";
import { seeded } from "./random";

/**
 * A piece sequence, readable by position.
 *
 * Within a tier this is a standard bag: every piece is dealt once, in shuffled
 * order, before any repeats. Plain random sampling would let a booth player
 * draw four screws running and conclude the game is broken. Crossing a tier
 * threshold drops the rest of the current bag so the newly unlocked pieces
 * show up right away rather than up to a bag later.
 *
 * The sequence is addressed by index rather than dealt, so that one feed can be
 * shared: in versus both players hold their own cursor into the same feed and
 * see exactly the same pieces in the same order, each at their own pace.
 * Giving the two sides separate bags — even seeded identically — does not
 * achieve this, because the two players consume randomness at different rates
 * as soon as anything about their games differs. A single-player round simply
 * owns a feed that nobody else reads.
 *
 * Position `i` is generated once and cached, so whoever reaches it first fixes
 * it for everyone. In versus the player who is ahead therefore decides which
 * tier the deeper part of the sequence was built under.
 *
 * Note on the pentomino tier: a layer of the 4x4 well is 16 cells, and 16
 * cannot be made from fives and fours other than as four fours. Once
 * pentominoes are in the bag, clearing a layer generally means orienting pieces
 * so they straddle layers. That is intended to be hard, but it is a real cliff.
 */
export class PieceFeed {
  private seq: PieceDef[] = [];
  private queue: PieceDef[] = [];
  private tier = -1;

  /**
   * `difficultyScore` is the score the tier is read from. With one shared
   * sequence there can only be one, so a versus round escalates for both
   * players at once.
   */
  constructor(
    private readonly tiers: Tier[],
    private readonly difficultyScore: () => number,
    private rand: () => number = Math.random
  ) {}

  get tierIndex(): number {
    return Math.max(0, this.tier);
  }

  get tierLabel(): string {
    return this.tiers[this.tierIndex].label;
  }

  /** The piece at position `i` of the sequence, generating as needed. */
  at(i: number): PieceDef {
    while (this.seq.length <= i) this.extend();
    return this.seq[i];
  }

  /**
   * Start a fresh sequence. Shared feeds: once per round, not once per player.
   * With a seed the sequence is fixed by it — the same seed deals the same
   * pieces, as long as the score crosses the tiers at the same moments, which
   * it does when the same placements are replayed.
   */
  reset(seed?: number): void {
    if (seed !== undefined) this.rand = seeded(seed);
    this.seq.length = 0;
    this.queue.length = 0;
    this.tier = -1;
  }

  private extend(): void {
    const tier = tierIndexFor(this.tiers, this.difficultyScore());
    if (tier !== this.tier) {
      this.tier = tier;
      this.queue.length = 0;
    }
    if (this.queue.length === 0) this.refill();
    this.seq.push(this.queue.pop()!);
  }

  private refill(): void {
    this.queue = [...this.tiers[this.tier].pieces];
    // Fisher-Yates. Dealing with pop() consumes the shuffle from the end, which
    // is fine — every permutation is equally likely either way.
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }
}
