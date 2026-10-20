// OMDb: IMDb rating, Rotten Tomatoes and Metacritic for a film by IMDb id.
// The free key allows 1,000 lookups a day, so usage is counted and stopped
// short of that; results are cached on the Movie row for a month.
import { getSetting, setSetting } from "./settings";

const BASE = process.env.OMDB_BASE ?? "https://www.omdbapi.com/";
const DAILY_LIMIT = Number(process.env.OMDB_DAILY_LIMIT ?? 950);

export type OmdbRatings = {
  imdbRating: number | null;
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

export async function omdbRatings(imdbId: string): Promise<OmdbRatings | null> {
  const key = process.env.OMDB_KEY?.trim();
  if (!key) return null;

  const counterKey = `omdb:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await getSetting(counterKey)) ?? 0);
  if (used >= DAILY_LIMIT) return null;
  await setSetting(counterKey, String(used + 1));

  const url = new URL(BASE);
  url.searchParams.set("i", imdbId);
  url.searchParams.set("apikey", key);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const d = (await res.json()) as {
    Response?: string;
    imdbRating?: string;
    Metascore?: string;
    Ratings?: { Source: string; Value: string }[];
  };
  if (d.Response === "False") return null;
  const rt = d.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value;
  return {
    imdbRating: num(d.imdbRating),
    rtScore: rt ? num(rt) : null,
    metascore: num(d.Metascore),
  };
}
