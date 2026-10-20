// Turns your swipes into a list of films to watch, applying the sliders.
import type { Movie } from "@prisma/client";
import { db } from "./db";
import { ensureDetails, ensureRatings, ensureRecs, providersOf, saveList } from "./movies";
import { getMyServices } from "./settings";
import { hasTmdb, topRated } from "./tmdb";
import { similarPool } from "./similar";
import { aiCandidates } from "./ai";
import { Filters, MIN_VOTES, PASS, positionFactor, passes, passesCheap, reputationFactor, scoreCandidates, excludedBy, NO_EXCLUDED, type Excluded, SEEN, Seed, Verdict } from "./score";

// Fresh TMDB lookups allowed per page load. Each one is two quick calls; the
// rest arrive on the next visit (lists are cached for two months).
const RECS_PER_LOAD = 25;
const CHECK_LIMIT = 80;
// Claude's picks only need this many TMDB votes (to be sure of the match).
const AI_MIN_VOTES = 20;
// How many of the best taste matches get IMDb/RT lookups before ranking.
const RERANK = 40;

export type Suggestion = {
  movie: Movie;
  score: number;
  because: { id: number; title: string }[];
  fallback: boolean; // came from "top rated", not from your taste
  onWatchlist: boolean;
  reason?: string; // Claude's one-liner, when Claude proposed it
};

export async function suggest(opts: {
  users: string[]; // whose taste counts (one or both of you)
  genre: number; // 0 = all
  filters: Filters;
  limit?: number;
  extraGenres?: number[]; // Tonight mode: any of these
  like?: number[]; // "Similar to…": only films like these, taste breaks ties
  exclude?: Excluded; // "Custom" genres: unticked genres / superhero never shown
  mood?: string; // Tonight's mood key, passed on to Claude as a hint
  fresh?: boolean; // ask Claude for new picks instead of today's cached ones
  ai?: boolean; // false = taste engine only (default: use Claude when available)
}): Promise<Suggestion[]> {
  const limit = opts.limit ?? 20;
  const genres = opts.extraGenres?.length ? opts.extraGenres : opts.genre ? [opts.genre] : [];
  const inGenre = (ids: number[]) => !genres.length || ids.some((g) => genres.includes(g));
  const ex = opts.exclude ?? NO_EXCLUDED;

  const swipes = await db.swipe.findMany({
    where: { userId: { in: opts.users } },
    include: { movie: { select: { genreIds: true, recsAt: true, title: true } } },
  });
  // Seen by either of you, or "not interested" for either of you: never shown.
  const counts = (v: string) => SEEN.has(v) || v === PASS;
  const excluded = new Set(swipes.filter((s) => counts(s.verdict)).map((s) => s.movieId));
  const seeds: Seed[] = swipes.filter((s) => counts(s.verdict)).map((s) => ({
    userId: s.userId,
    movieId: s.movieId,
    verdict: s.verdict as Verdict,
    elo: s.elo,
    stars: s.stars,
  }));

  // Fetch missing "also liked" lists, best seeds first: super likes, then
  // likes, then dislikes, "not interested" last; preferring the genre being
  // browsed.
  const order: Record<string, number> = { superlike: 0, like: 2, dislike: 4, [PASS]: 6 };
  const rank = (s: (typeof swipes)[number]) => (order[s.verdict] ?? 6) + (inGenre(s.movie.genreIds) ? 0 : 1);
  const missing = swipes
    .filter((s) => counts(s.verdict) && s.verdict !== "seen" && !s.movie.recsAt)
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

  // What to rank. Claude proposes films (when available: key set, under the
  // monthly cap); TMDB's lists add more. Without "Similar to…", Claude's picks
  // and your taste are blended; with it, closeness to the chosen films leads
  // and your taste only breaks ties. Anything seen or passed is dropped here,
  // whatever Claude said.
  const like = opts.like ?? [];
  const ai =
    opts.ai === false
      ? null
      : await aiCandidates(
          like.length
            ? { mode: "similar", anchors: like, users: opts.users, fresh: opts.fresh }
            : { mode: "tonight", users: opts.users, mood: opts.mood, genres, exclude: opts.exclude, fresh: opts.fresh },
        );
  const aiPicks = (ai ?? []).filter((p) => !excluded.has(p.id) && !like.includes(p.id));
  const aiRank = new Map(aiPicks.map((p, i) => [p.id, positionFactor(i)]));
  const aiWhy = new Map(aiPicks.map((p) => [p.id, p.why]));
  const tasteOf = new Map(scored.map((s) => [s.movieId, s.score]));
  const maxTaste = Math.max(1e-9, ...scored.map((s) => s.score));
  const tasteNorm = (id: number) => Math.min(1, Math.max(0, (tasteOf.get(id) ?? 0) / maxTaste));

  type Base = { id: number; taste: number; because: number[]; ai: boolean };
  let base: Base[];
  if (like.length) {
    let closeness = await similarPool(like, { minSize: limit * 4, excluded });
    const anchors = await db.movie.findMany({ where: { id: { in: like } }, select: { id: true, title: true, genreIds: true } });
    for (const r of anchors) titles.set(r.id, r.title);
    if (!ai) {
      // Without Claude, a TMDB "also watched" film must at least share a genre
      // with one of the chosen films (no Bourne Ultimatum for Arrival).
      const anchorGenres = new Set(anchors.flatMap((a) => a.genreIds));
      const rows = await db.movie.findMany({ where: { id: { in: [...closeness.keys()] } }, select: { id: true, genreIds: true } });
      const ok = new Set(rows.filter((r) => r.genreIds.some((g) => anchorGenres.has(g))).map((r) => r.id));
      closeness = Object.assign(new Map([...closeness].filter(([id]) => ok.has(id))), { direct: closeness.direct });
    }
    const maxClose = Math.max(1e-9, ...closeness.values());
    const ids = new Set([...aiRank.keys(), ...closeness.keys()]);
    base = [...ids].map((id) => ({
      id,
      taste: (0.75 * (aiRank.get(id) ?? 0) + 0.25 * ((closeness.get(id) ?? 0) / maxClose)) * (1 + 0.5 * tasteNorm(id)),
      because: like,
      ai: aiRank.has(id),
    }));
  } else if (aiPicks.length) {
    const ids = new Set([...aiRank.keys(), ...tasteOf.keys()]);
    const becauseOf = new Map(scored.map((s) => [s.movieId, s.because]));
    base = [...ids].map((id) => ({
      id,
      taste: 0.6 * (aiRank.get(id) ?? 0) + 0.4 * tasteNorm(id),
      because: becauseOf.get(id) ?? [],
      ai: aiRank.has(id),
    }));
  } else {
    base = scored.map((s) => ({ id: s.movieId, taste: s.score, because: s.because, ai: false }));
  }

  const candidateRows = await db.movie.findMany({ where: { id: { in: base.map((b) => b.id) } } });
  const byId = new Map(candidateRows.map((m) => [m.id, m]));

  type Cand = { movie: Movie; score: number; taste: number; because: number[]; fallback: boolean; ai?: boolean };
  let pool: Cand[] = base
    .map((b) => ({ ...b, movie: byId.get(b.id)! }))
    .filter((c) => c.movie && inGenre(c.movie.genreIds) && !excludedBy(c.movie, ex) && passesCheap(c.movie, opts.filters))
    // Obscure films with a handful of votes are mostly noise in TMDB's lists.
    // Claude's picks are deliberate, so they only need enough votes to be sure
    // the title was matched to the right film.
    .filter((c) => c.movie.voteCount >= (c.ai ? AI_MIN_VOTES : MIN_VOTES))
    .map((c) => ({
      movie: c.movie,
      taste: c.taste,
      score: c.taste * reputationFactor(c.movie),
      because: c.because,
      fallback: false,
      ai: c.ai,
    }))
    .sort((a, b) => b.score - a.score);

  // Taste decides what's eligible; IMDb and Rotten Tomatoes decide the order
  // among good matches. Look up scores for the front of the list (cached, so
  // only a film's first appearance costs a lookup) and re-rank with them.
  const front = pool.slice(0, RERANK).map((c) => c.movie.id);
  await ensureDetails(front);
  await ensureRatings(front);
  const rated = new Map((await db.movie.findMany({ where: { id: { in: front } } })).map((m) => [m.id, m]));
  pool = pool
    .map((c) => {
      const m = rated.get(c.movie.id);
      return m ? { ...c, movie: m, score: c.taste * reputationFactor(m) } : c;
    })
    .sort((a, b) => b.score - a.score);

  // Not enough taste data yet (or a niche genre): pad with acclaimed films.
  // (Not with "Similar to…": acclaimed films that aren't like X don't belong.)
  if (!like.length && pool.length < limit * 2 && hasTmdb()) {
    const seenIds = new Set(pool.map((c) => c.movie.id));
    for (const page of [1, 2, 3]) {
      const res = await topRated(genres[0] ?? 0, page, ex);
      await saveList(res.results);
      const rows = await db.movie.findMany({ where: { id: { in: res.results.map((r) => r.id) } } });
      for (const m of rows.sort((a, b) => b.voteAverage - a.voteAverage)) {
        if (excluded.has(m.id) || seenIds.has(m.id)) continue;
        if (!inGenre(m.genreIds) || excludedBy(m, ex) || !passesCheap(m, opts.filters)) continue;
        seenIds.add(m.id);
        pool.push({ movie: m, score: 0, taste: 0, because: [], fallback: true });
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
      // Checked again with fresh details: that's when a superhero film shows itself.
      if (ok && inGenre(m.genreIds) && !excludedBy(m, ex)) picked.push({ ...c, movie: m });
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
    reason: aiWhy.get(c.movie.id),
  }));
}
