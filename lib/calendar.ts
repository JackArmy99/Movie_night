// Films opening in Dutch cinemas over the next four months, with their exact
// Dutch date. Rebuilt at most every 12 hours (about 100 TMDB lookups).
import type { Movie } from "@prisma/client";
import { db } from "./db";
import { ensureDetails, saveList } from "./movies";
import { getJson, setJson } from "./settings";
import { dutchCinema, hasTmdb } from "./tmdb";
import { scoreCandidates, SEEN, Seed, Verdict } from "./score";

const TTL = 12 * 60 * 60 * 1000;
const DAYS_AHEAD = 120;

export async function upcomingDutch(): Promise<Movie[]> {
  const today = new Date().toISOString().slice(0, 10);
  const cache = await getJson<{ at: number; ids: number[] } | null>("calendar_cache", null);
  let ids = cache?.ids ?? [];
  if (hasTmdb() && (!cache || Date.now() - cache.at > TTL)) {
    const to = new Date(Date.now() + DAYS_AHEAD * 864e5).toISOString().slice(0, 10);
    const found: number[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await dutchCinema(today, to, page);
      await saveList(res.results);
      found.push(...res.results.map((r) => r.id));
      if (page >= res.total_pages) break;
    }
    // Details carry the actual Dutch date (the list only has the world date).
    await ensureDetails(found);
    ids = found;
    await setJson("calendar_cache", { at: Date.now(), ids });
  }
  const movies = await db.movie.findMany({ where: { id: { in: ids }, nlRelease: { gte: today } } });
  return movies.sort((a, b) => (a.nlRelease ?? "").localeCompare(b.nlRelease ?? ""));
}

// Which of these look like your kind of film, from data already stored (no
// lookups). Used to badge the calendar and for the "picks only" feed.
export async function matchingIds(candidates: number[]): Promise<Set<number>> {
  const swipes = await db.swipe.findMany({ where: { verdict: { in: [...SEEN] } } });
  const users = [...new Set(swipes.map((s) => s.userId))];
  const seeds: Seed[] = swipes.map((s) => ({ userId: s.userId, movieId: s.movieId, verdict: s.verdict as Verdict, elo: s.elo }));
  const rows = await db.movie.findMany({
    where: { id: { in: seeds.map((s) => s.movieId) } },
    select: { id: true, recIds: true, genreIds: true },
  });
  const scored = scoreCandidates({
    seeds,
    recs: new Map(rows.map((r) => [r.id, r.recIds])),
    genresOf: new Map(rows.map((r) => [r.id, r.genreIds])),
    users,
    excluded: new Set(),
    genre: 0,
  });
  const want = new Set(candidates);
  return new Set(scored.filter((s) => want.has(s.movieId) && s.score >= 1).map((s) => s.movieId));
}
