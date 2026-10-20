// The swipe deck's cards: most-watched first (the films you've most likely
// seen), skipping ones you've answered, optionally narrowed by IMDb / Rotten
// Tomatoes / earliest year and "Similar to…" films.
import { db } from "./db";
import { ensureDetails, ensureRatings, saveList } from "./movies";
import { MIN_VOTES, passes, passesCheap, excludedBy, hasExcluded, NO_EXCLUDED, type Excluded } from "./score";
import { similarPool } from "./similar";
import { aiCandidates } from "./ai";
import { getJson, setJson } from "./settings";
import * as tmdb from "./tmdb";

export type Card = {
  id: number;
  title: string;
  year: number | null;
  poster: string | null;
  overview: string;
  score: number;
};

export type DeckFilters = { imdb?: number; rt?: number; from?: number; like?: number[]; exclude?: Excluded };

const toCard = (m: { id: number; title: string; year: number | null; posterPath: string | null; overview: string; voteAverage: number }): Card => ({
  id: m.id,
  title: m.title,
  year: m.year,
  poster: tmdb.poster(m.posterPath, "w500"),
  overview: m.overview.slice(0, 220),
  score: m.voteAverage,
});

// Of these films, the ones that pass the deck's IMDb / Rotten Tomatoes / year
// filters and "Custom" genres. Ratings are looked up only when a rating
// filter is on (and cached).
async function passingDeckFilters(ids: number[], f: DeckFilters): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const ex = f.exclude ?? NO_EXCLUDED;
  // Superhero films only show themselves through keywords, which come with details.
  if (f.imdb || f.rt || ex.superhero) {
    await ensureDetails(ids);
    if (f.imdb || f.rt) await ensureRatings(ids);
  }
  const rows = await db.movie.findMany({ where: { id: { in: ids } } });
  const filters = { minImdb: f.imdb, minRt: f.rt, yearFrom: f.from };
  return new Set(rows.filter((m) => !excludedBy(m, ex) && passes({ ...m, streamIds: [] }, filters, [])).map((m) => m.id));
}

// The next films to swipe, most-watched first (the ones you've most likely
// seen), skipping ones you've already answered. Optional filters narrow the
// deck: IMDb / RT / earliest year, and "Similar to…" films.
export async function deckCards(
  userId: string,
  genre: number,
  skip: number[],
  f: DeckFilters = {},
): Promise<{ cards: Card[]; error?: string; done?: string }> {
  const user = { id: userId };
  if (!tmdb.hasTmdb()) return { cards: [], error: "TMDB isn't connected yet — add TMDB_TOKEN." };
  const skipSet = new Set(skip);
  const like = (f.like ?? []).slice(0, 5);

  if (like.length) {
    // "Similar to…": the pool of films like the chosen ones, minus anything
    // you've already answered, most-watched first.
    const answered = new Set(
      (await db.swipe.findMany({ where: { userId: user.id }, select: { movieId: true } })).map((s) => s.movieId),
    );
    // Claude's picks (when available) are the closest matches; TMDB's lists
    // follow. Tiers: Claude, then TMDB direct, then TMDB's wider second hop.
    const ai = (await aiCandidates({ mode: "similar", anchors: like, users: [user.id] })) ?? [];
    const aiIds = new Set(ai.map((p) => p.id).filter((id) => !answered.has(id) && !like.includes(id)));
    const pool = await similarPool(like, { minSize: 60, excluded: answered });
    const rows = await db.movie.findMany({ where: { id: { in: [...new Set([...aiIds, ...pool.keys()])] } } });
    const tier = (id: number) => (aiIds.has(id) ? 0 : pool.direct.has(id) ? 1 : 2);
    const ordered = rows
      .filter((m) => !skipSet.has(m.id) && (!genre || m.genreIds.includes(genre)) && passesCheap(m, { yearFrom: f.from }))
      // As in Tonight: a handful of votes makes any score meaningless (Claude's
      // picks only need enough to be sure the title matched the right film).
      .filter((m) => m.voteCount >= (aiIds.has(m.id) ? 20 : MIN_VOTES))
      // Most-watched first within each tier: those you're likeliest to have seen.
      .sort((a, b) => tier(a.id) - tier(b.id) || b.voteCount - a.voteCount);
    const cards: Card[] = [];
    for (let i = 0; i < ordered.length && cards.length < 10; i += 12) {
      const chunk = ordered.slice(i, i + 12);
      const ok = await passingDeckFilters(chunk.map((m) => m.id), f);
      for (const m of chunk) if (ok.has(m.id) && cards.length < 10) cards.push(toCard(m));
    }
    return { cards, done: cards.length ? undefined : "That's every film like these that fits the filters." };
  }

  // Everything else: TMDB's most-watched list, with the year and a rough
  // score floor applied by TMDB itself, then the exact IMDb/RT check. Each
  // filter combination keeps its own bookmark.
  const exSig = f.exclude && hasExcluded(f.exclude) ? [...f.exclude.genres, ...(f.exclude.superhero ? ["sh"] : [])].join(",") : "";
  const sig = [f.imdb, f.rt, f.from].map((v) => v ?? "").join("|") + (exSig ? `|x${exSig}` : "");
  const cursorKey = sig === "||" ? `deck:${user.id}:${genre}` : `deck:${user.id}:${genre}:${sig}`;
  const start = await getJson<number>(cursorKey, 1);
  let bookmark = start;
  let stillAtBookmark = true;
  const cards: Card[] = [];
  const pages = f.imdb || f.rt ? 3 : 6; // rating lookups cost a little; go easy

  for (let page = start; page < start + pages && cards.length < 10; page++) {
    const res = await tmdb.mostWatched(genre, page, {
      fromYear: f.from,
      minVote: f.imdb ? Math.max(0, f.imdb - 1) : undefined,
      exclude: f.exclude,
    });
    await saveList(res.results);
    const ids = res.results.map((r) => r.id);
    const answered = new Set(
      (await db.swipe.findMany({ where: { userId: user.id, movieId: { in: ids } }, select: { movieId: true } })).map(
        (s) => s.movieId,
      ),
    );
    const unanswered = ids.filter((id) => !answered.has(id));
    // TMDB has already left out superhero films here (without_keywords), so no
    // per-card lookup is needed for that.
    const ok = await passingDeckFilters(unanswered, { ...f, exclude: f.exclude && { ...f.exclude, superhero: false } });
    const open = unanswered.filter((id) => ok.has(id));
    // Only move the bookmark past pages with nothing left to answer, so
    // closing the app halfway down a page never skips anything.
    if (stillAtBookmark && open.length === 0) bookmark = page + 1;
    else stillAtBookmark = false;
    const rows = new Map((await db.movie.findMany({ where: { id: { in: open } } })).map((m) => [m.id, m]));
    for (const id of open) {
      const m = rows.get(id);
      if (!m || skipSet.has(id)) continue;
      skipSet.add(id);
      cards.push(toCard(m));
    }
    if (page >= Math.min(res.total_pages, 500)) break;
  }
  if (bookmark !== start) await setJson(cursorKey, bookmark);
  return { cards };
}
