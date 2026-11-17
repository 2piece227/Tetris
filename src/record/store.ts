import type { GameRecord } from "./record";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabaseConfig";

/**
 * Where finished rounds go, and how the review finds them by code.
 *
 * At the booth the headset and the monitor PC are different machines, so codes
 * go through the booth's Supabase project (supabaseConfig.ts). Without one
 * configured, rounds stay in the browser that played them.
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

/** How long to wait on the network before calling a save or load failed. */
const TIMEOUT_MS = 8000;

/**
 * Keeps rounds in the booth's Supabase project, so a code shown in the headset
 * resolves on the monitor PC. Talks to the two RPC functions in
 * supabase/schema.sql over plain fetch — no client library to ship.
 *
 * save() throws when the network is down, so the headset can say so and try
 * again rather than show a code that leads nowhere. load() falls back to this
 * device's own storage, which still finds rounds played on it.
 */
class SupabaseStore implements RecordStore {
  private readonly local = new LocalStore();

  constructor(private readonly url: string, private readonly key: string) {}

  private async rpc<T>(fn: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: this.key,
        // Legacy anon keys are JWTs and go in Authorization too. The newer
        // publishable keys (sb_publishable_…) are not JWTs and must not: the
        // gateway maps the apikey header to the anon role on its own.
        ...(this.key.startsWith("eyJ") ? { Authorization: `Bearer ${this.key}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${fn}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async save(record: GameRecord): Promise<string> {
    return this.rpc<string>("save_round", { rec: record });
  }

  async load(code: string): Promise<GameRecord | null> {
    try {
      const record = await this.rpc<GameRecord | null>("get_round", { c: code });
      if (record) return record;
    } catch {
      // Offline: this device's own rounds may still have it.
    }
    return this.local.load(code);
  }
}

export const recordStore: RecordStore =
  SUPABASE_URL && SUPABASE_ANON_KEY ? new SupabaseStore(SUPABASE_URL, SUPABASE_ANON_KEY) : new LocalStore();
