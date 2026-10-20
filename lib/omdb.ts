// OMDb: IMDb rating, Rotten Tomatoes and Metacritic for a film by IMDb id.
// The free key allows 1,000 lookups a day, so usage is counted and stopped
// short of that; results are cached on the Movie row for a month.
import { getJson, incrementSetting, setJson } from "./settings";
import { pmap } from "./pmap";

const base = () => process.env.OMDB_BASE ?? "https://www.omdbapi.com/";
const DAILY_LIMIT = Number(process.env.OMDB_DAILY_LIMIT ?? 950);

export type OmdbRatings = {
  imdbRating: number | null;
  imdbVotes: number | null;
  rtScore: number | null;
  metascore: number | null;
};

export function hasOmdb(): boolean {
  return Boolean(process.env.OMDB_KEY?.trim());
}

const num = (s: string | undefined): number | null => {
  const n = Number.parseFloat(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// What OMDb last said about the key, so Settings can show it plainly and a
// rejected key isn't asked again on every film. A different key (fingerprint)
// is always tried afresh.
export type OmdbStatus = { state: "ok" | "invalid_key"; at: number; key: string };
const RETRY_INVALID_MS = 30 * 60 * 1000;
const fingerprint = (key: string) => `${key.length}:${key.slice(-2)}`;

export async function omdbStatus(): Promise<OmdbStatus | null> {
  return getJson<OmdbStatus | null>("omdb_status", null);
}

// Look up several films at once. One status check, one atomic reservation of
// the day's quota for the whole batch, then the lookups (6 at a time).
// "missing" = OMDb has no entry for that film (remembered, so it isn't asked
// again every visit). Films left out of the result weren't looked up (no key,
// key refused, or the day's limit reached).
export async function omdbBatch(imdbIds: string[]): Promise<Map<string, OmdbRatings | "missing">> {
  const out = new Map<string, OmdbRatings | "missing">();
  const key = process.env.OMDB_KEY?.trim();
  if (!key || !imdbIds.length) return out;
  const status = await omdbStatus();
  if (status?.state === "invalid_key" && status.key === fingerprint(key) && Date.now() - status.at < RETRY_INVALID_MS) {
    return out;
  }

  const counterKey = `omdb:${new Date().toISOString().slice(0, 10)}`;
  const used = await incrementSetting(counterKey, imdbIds.length);
  const allowed = Math.max(0, imdbIds.length - Math.max(0, used - DAILY_LIMIT));
  const ids = imdbIds.slice(0, allowed);

  let refused = false;
  let answered = false;
  await pmap(ids, 6, async (imdbId) => {
    if (refused) return;
    const url = new URL(base());
    url.searchParams.set("i", imdbId);
    url.searchParams.set("apikey", key);
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 401) {
      refused = true;
      return;
    }
    if (!res.ok) return;
    answered = true;
    const d = (await res.json()) as {
      Response?: string;
      imdbRating?: string;
      imdbVotes?: string;
      Metascore?: string;
      Ratings?: { Source: string; Value: string }[];
    };
    if (d.Response === "False") {
      out.set(imdbId, "missing");
      return;
    }
    const rt = d.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value;
    out.set(imdbId, {
      imdbRating: num(d.imdbRating),
      imdbVotes: num(d.imdbVotes),
      rtScore: rt ? num(rt) : null,
      metascore: num(d.Metascore),
    });
  });
  if (refused) await setJson("omdb_status", { state: "invalid_key", at: Date.now(), key: fingerprint(key) });
  else if (answered && status?.state !== "ok") await setJson("omdb_status", { state: "ok", at: Date.now(), key: fingerprint(key) });
  return out;
}

// One film (kept for simple callers and tests).
export async function omdbRatings(imdbId: string): Promise<OmdbRatings | null> {
  const r = (await omdbBatch([imdbId])).get(imdbId);
  return r && r !== "missing" ? r : null;
}
