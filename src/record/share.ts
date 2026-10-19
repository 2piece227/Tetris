import type { GameRecord } from "./record";

/**
 * A round packed into a URL, so a review can travel to another device with no
 * server: deflate the JSON, then base64url it into the hash.
 *
 * The hash never leaves the browser, so the record is not sent anywhere by
 * opening the link — it is read straight back out on the page.
 */

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeRecord(record: GameRecord): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(record));
  return toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeRecord(packed: string): Promise<GameRecord | null> {
  try {
    const json = await pipe(fromBase64Url(packed), new DecompressionStream("deflate-raw"));
    const record = JSON.parse(new TextDecoder().decode(json)) as GameRecord;
    return record && record.v === 1 && Array.isArray(record.moves) ? record : null;
  } catch {
    return null;
  }
}

/** The review page's address for a round, relative to the current page. */
export async function reviewLink(record: GameRecord, base = new URL("./review.html", location.href)): Promise<string> {
  const url = new URL(base);
  url.hash = "r=" + (await encodeRecord(record));
  return url.toString();
}
