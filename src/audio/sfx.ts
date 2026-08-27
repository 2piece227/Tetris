/**
 * Audio: recorded music and stingers, plus a small synth for the tactile blips.
 *
 * The files live in public/audio and are addressed through BASE_URL rather than
 * an absolute path, because the build is served from a project subpath on
 * Pages ("/<repo>/") and a leading slash would resolve to the domain root.
 *
 * Each repository ships its own bgm.mp3 — the two games have different themes —
 * while the stingers are shared.
 */

/** "적당히 크게": present, but the stingers have to cut through it. */
const BGM_VOLUME = 0.45;
/** "매우 크게": these are the feedback that matters, so they run flat out. */
const SFX_VOLUME = 1;

const audioUrl = (name: string): string =>
  `${import.meta.env.BASE_URL}audio/${name}`;

const CLIPS = {
  bgm: audioUrl("bgm.mp3"),
  clear1: audioUrl("clear1.mp3"),
  clear3: audioUrl("clear3.mp3"),
  gameover: audioUrl("gameover.mp3"),
  babyover: audioUrl("babyover.mp3"),
} as const;

export class Sfx {
  private readonly bgm: HTMLAudioElement;
  /** Kept only so the browser has the clips cached before they are first needed. */
  private readonly warmed: HTMLAudioElement[] = [];
  private bgmStarted = false;
  private ctx: AudioContext | null = null;
  muted = false;

  constructor() {
    this.bgm = new Audio(CLIPS.bgm);
    this.bgm.loop = true; // 무한루프
    this.bgm.volume = BGM_VOLUME;
    this.bgm.preload = "auto";

    for (const url of [CLIPS.clear1, CLIPS.clear3, CLIPS.gameover, CLIPS.babyover]) {
      const el = new Audio(url);
      el.preload = "auto";
      this.warmed.push(el);
    }
  }

  /**
   * Call from a real user gesture. Browsers refuse to start audio before one,
   * so this is where the loop begins rather than at construction.
   */
  unlock(): void {
    if (this.muted) return;
    this.ensureCtx();
    if (this.bgmStarted) return;
    this.bgmStarted = true;
    void this.bgm.play().catch(() => {
      // Gesture was not accepted after all; let the next one try again.
      this.bgmStarted = false;
    });
  }

  /** Stop the music. Not used during play — the loop is meant to run forever. */
  stopBgm(): void {
    this.bgm.pause();
    this.bgm.currentTime = 0;
    this.bgmStarted = false;
  }

  /** One clip per clear: the small one up to two layers, the big one from three. */
  clear(n: number): void {
    this.shoot(n >= 3 ? CLIPS.clear3 : CLIPS.clear1);
  }

  /** gameover, then babyover once it finishes. */
  gameOver(): void {
    const first = this.shoot(CLIPS.gameover);
    if (!first) return;
    first.addEventListener("ended", () => this.shoot(CLIPS.babyover), { once: true });
  }

  /**
   * A fresh element per play, so a clip landing while the last one is still
   * ringing overlaps it instead of cutting it off. The file is already in the
   * cache, so this costs nothing to fetch.
   */
  private shoot(url: string): HTMLAudioElement | null {
    if (this.muted) return null;
    const el = new Audio(url);
    el.volume = SFX_VOLUME;
    void el.play().catch(() => {});
    return el;
  }

  // ── Synthesised blips ─────────────────────────────────────────────────────
  // Move, rotate and lock have no recorded clip. They stay synthesised rather
  // than silent: they fire many times a second and are what makes the controls
  // feel connected, which a soundtrack does not replace.

  private ensureCtx(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(
    freq: number,
    durMs: number,
    opts: { type?: OscillatorType; gain?: number; slideTo?: number } = {}
  ): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const { type = "sine", gain = 0.3, slideTo } = opts;
    const t0 = ctx.currentTime;
    const dur = durMs / 1000;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(env).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  move(): void {
    this.tone(320, 45, { type: "square", gain: 0.16 });
  }

  rotate(): void {
    this.tone(480, 60, { type: "square", gain: 0.18, slideTo: 620 });
  }

  lock(): void {
    this.tone(150, 130, { type: "triangle", gain: 0.4, slideTo: 90 });
  }
}
