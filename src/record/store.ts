import type { GameRecord } from "./record";

/**
 * Where finished rounds go, and how the review finds them by code.
 *
 * At the booth the headset and the monitor PC are different machines, so this
 * has to end up being a server both can reach. How that server is reached is
 * not settled yet (it depends on the venue's network), so everything talks to
 * this interface and the implementation is picked once, below.
 */
export interface RecordStore {
  /** Keep a round and hand back the 4-digit code the player types to see it. */
  save(record: GameRecord): Promise<string>;
  /** The round saved under `code`, or null if there is none. */
  load(code: string): Promise<GameRecord | null>;
}

const PREFIX = "record:";
/** Old rounds are dropped past this, so a booth day cannot fill the quota. */
const KEEP = 60;

/**
 * Keeps rounds in this browser's own storage.
 *
 * Only finds a code on the device that saved it — enough to play VR on a
 * desktop with the keyboard and open its review on the same machine, which is
 * how the review is tested until the booth server exists.
 */
class LocalStore implements RecordStore {
  async save(record: GameRecord): Promise<string> {
    const codes = this.codes();
    let code: string;
    do code = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
    while (codes.includes(code));
    try {
      localStorage.setItem(PREFIX + code, JSON.stringify(record));
      codes.push(code);
      while (codes.length > KEEP) localStorage.removeItem(PREFIX + codes.shift()!);
      localStorage.setItem(PREFIX + "index", JSON.stringify(codes));
    } catch {
      // Storage blocked or full: the code is still shown, it just will not
      // resolve. Losing a review must never interrupt the game.
    }
    return code;
  }

  async load(code: string): Promise<GameRecord | null> {
    try {
      const raw = localStorage.getItem(PREFIX + code);
      return raw ? (JSON.parse(raw) as GameRecord) : null;
    } catch {
      return null;
    }
  }

  private codes(): string[] {
    try {
      return JSON.parse(localStorage.getItem(PREFIX + "index") ?? "[]") as string[];
    } catch {
      return [];
    }
  }
}

export const recordStore: RecordStore = new LocalStore();
