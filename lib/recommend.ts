// Turns your swipes into a list of films to watch, applying the sliders.
import type { Movie } from "@prisma/client";
import { db } from "./db";
import { ensureDetails, ensureRatings, ensureRecs, providersOf, saveList } from "./movies";
import { getMyServices } from "./settings";
import { hasTmdb, topRated } from "./tmdb";
import { Filters, passes, passesCheap, scoreCandidates, SEEN, Seed, Verdict } from "./score";

// Fresh TMDB lookups allowed per page load. Each one is two quick calls; the
// rest arrive on the next visit (lists are cached for two months).
const RECS_PER_LOAD = 25;
const CHECK_LIMIT = 80;

export type Suggestion = {
  movie: Movie;
  score: number;
  because: { id: number; title: string }[];
  fallback: boolean; // came from "top rated", not from your taste
  onWatchlist: boolean;
};

export async function suggest(opts: {
  users: string[]; // whose taste counts (one or both of you)
  genre: number; // 0 = all
  filters: Filters;
  limit?: number;
  extraGenres?: number[]; // Tonight mode: any of these
}): Promise<Suggestion[]> {
  const limit = opts.limit ?? 20;
  const genres = opts.extraGenres?.length ? opts.extraGenres : opts.genre ? [opts.genre] : [];
  const inGenre = (ids: number[]) => !genres.length || ids.some((g) => genres.includes(g));

  const swipes = await db.swipe.findMany({
    where: { userId: { in: opts.users } },
    include: { movie: { select: { genreIds: true, recsAt: true, title: true } } },
  });
  const excluded = new Set(swipes.filter((s) => SEEN.has(s.verdict)).map((s) => s.movieId));
  const seeds: Seed[] = swipes
    .filter((s) => SEEN.has(s.verdict))
    .map((s) => ({ userId: s.userId, movieId: s.movieId, verdict: s.verdict as Verdict, elo: s.elo }));

  // Fetch missing "also liked" lists, best seeds first: super likes, then
  // likes, preferring the genre being browsed.
  const rank = (s: (typeof swipes)[number]) =>
    (s.verdict === "superlike" ? 0 : s.verdict === "like" ? 2 : 4) + (inGenre(s.movie.genreIds) ? 0 : 1);
  const missing = swipes
    .filter((s) => SEEN.has(s.verdict) && s.verdict !== "seen" && !s.movie.recsAt)
    .sort((a, b) => rank(a) - rank(b) || b.elo - a.elo);
  const toFetch = [...new Set(missing.map((s) => s.movieId))].slice(0, RECS_PER_LOAD);
  if (hasTmdb()) await ensureRecs(toFetch);

  const seedIds = [...new Set(seeds.map((s) => s.movieId))];
  const seedRows = await db.movie.findMany({
    where: { id: { in: seedIds } },
    select: { id: true, recIds: true, genreIds: true, title: true },
  });
  const recs = new Map(seedRows.map((r) => [r.id, r.recIds]));
  const genresOf = new Map(seedRows.map((r) => [r.id, r.genreIds]));
  const titles = new Map(seedRows.map((r) => [r.id, r.title]));

  const scored = scoreCandidates({
    seeds,
    recs,
    users: opts.users,
    excluded,
    genresOf,
    genre: genres.length === 1 ? genres[0] : 0,
  });

  const candidateRows = await db.movie.findMany({
    where: { id: { in: scored.map((s) => s.movieId) } },
  });
  const byId = new Map(candidateRows.map((m) => [m.id, m]));

  type Cand = { movie: Movie; score: number; because: number[]; fallback: boolean };
  let pool: Cand[] = scored
    .map((s) => ({ ...s, movie: byId.get(s.movieId)! }))
    .filter((c) => c.movie && inGenre(c.movie.genreIds) && passesCheap(c.movie, opts.filters))
    // A little credit for being well regarded, so ties go to the better film.
    .map((c) => ({ movie: c.movie, score: c.score * (0.5 + c.movie.voteAverage / 20), because: c.because, fallback: false }))
    .sort((a, b) => b.score - a.score);

  // Not enough taste data yet (or a niche genre): pad with acclaimed films.
  if (pool.length < limit * 2 && hasTmdb()) {
    const seenIds = new Set(pool.map((c) => c.movie.id));
    for (const page of [1, 2, 3]) {
      const res = await topRated(genres[0] ?? 0, page);
      await saveList(res.results);
      const rows = await db.movie.findMany({ where: { id: { in: res.results.map((r) => r.id) } } });
      for (const m of rows.sort((a, b) => b.voteAverage - a.voteAverage)) {
        if (excluded.has(m.id) || seenIds.has(m.id)) continue;
        if (!inGenre(m.genreIds) || !passesCheap(m, opts.filters)) continue;
        seenIds.add(m.id);
        pool.push({ movie: m, score: 0, because: [], fallback: true });
      }
      if (pool.length >= limit * 2) break;
    }
  }

  // Walk down the list, looking up runtime/ratings/providers only for films
  // about to be shown, until enough pass the sliders.
  const services = await getMyServices();
  // "On our services" with no services picked yet would hide every film.
  const filters = { ...opts.filters, servicesOnly: opts.filters.servicesOnly && services.length > 0 };
  const picked: Cand[] = [];
  for (let i = 0; i < Math.min(pool.length, CHECK_LIMIT) && picked.length < limit; i += 12) {
    const chunk = pool.slice(i, i + 12);
    const ids = chunk.map((c) => c.movie.id);
    await ensureDetails(ids);
    await ensureRatings(ids);
    const fresh = new Map((await db.movie.findMany({ where: { id: { in: ids } } })).map((m) => [m.id, m]));
    for (const c of chunk) {
      const m = fresh.get(c.movie.id) ?? c.movie;
      const stream = providersOf(m)?.stream ?? [];
      const ok = passes(
        { ...m, streamIds: stream.map((p) => p.id) },
        filters,
        services,
      );
      if (ok && inGenre(m.genreIds)) picked.push({ ...c, movie: m });
      if (picked.length >= limit) break;
    }
  }

  const watch = new Set(
    (await db.watchlistItem.findMany({ where: { movieId: { in: picked.map((p) => p.movie.id) } } })).map(
      (w) => w.movieId,
    ),
  );
  return picked.map((c) => ({
    movie: c.movie,
    score: c.score,
    fallback: c.fallback,
    onWatchlist: watch.has(c.movie.id),
    because: c.because.slice(0, 2).map((id) => ({ id, title: titles.get(id) ?? "" })),
  }));
}
