// OMDb: IMDb rating, Rotten Tomatoes and Metacritic for a film by IMDb id.
// The free key allows 1,000 lookups a day, so usage is counted and stopped
// short of that; results are cached on the Movie row for a month.
import { getJson, getSetting, setJson, setSetting } from "./settings";

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

export async function omdbRatings(imdbId: string): Promise<OmdbRatings | null> {
  const key = process.env.OMDB_KEY?.trim();
  if (!key) return null;
  const status = await omdbStatus();
  if (status?.state === "invalid_key" && status.key === fingerprint(key) && Date.now() - status.at < RETRY_INVALID_MS) {
    return null;
  }

  const counterKey = `omdb:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await getSetting(counterKey)) ?? 0);
  if (used >= DAILY_LIMIT) return null;
  await setSetting(counterKey, String(used + 1));

  const url = new URL(base());
  url.searchParams.set("i", imdbId);
  url.searchParams.set("apikey", key);
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 401) {
    await setJson("omdb_status", { state: "invalid_key", at: Date.now(), key: fingerprint(key) });
    return null;
  }
  if (!res.ok) return null;
  const d = (await res.json()) as {
    Response?: string;
    imdbRating?: string;
    imdbVotes?: string;
    Metascore?: string;
    Ratings?: { Source: string; Value: string }[];
  };
  if (status?.state !== "ok") await setJson("omdb_status", { state: "ok", at: Date.now(), key: fingerprint(key) });
  if (d.Response === "False") return null;
  const rt = d.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value;
  return {
    imdbRating: num(d.imdbRating),
    imdbVotes: num(d.imdbVotes),
    rtScore: rt ? num(rt) : null,
    metascore: num(d.Metascore),
  };
}
