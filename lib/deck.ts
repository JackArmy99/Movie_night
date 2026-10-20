// The swipe deck's cards: most-watched first (the films you've most likely
// seen), skipping ones you've answered, optionally narrowed by IMDb / Rotten
// Tomatoes / earliest year and "Similar to…" films.
import { db } from "./db";
import { ensureDetails, ensureRatings, saveList } from "./movies";
import { MIN_VOTES, passes, passesCheap } from "./score";
import { similarPool } from "./similar";
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

export type DeckFilters = { imdb?: number; rt?: number; from?: number; like?: number[] };

const toCard = (m: { id: number; title: string; year: number | null; posterPath: string | null; overview: string; voteAverage: number }): Card => ({
  id: m.id,
  title: m.title,
  year: m.year,
  poster: tmdb.poster(m.posterPath, "w500"),
  overview: m.overview.slice(0, 220),
  score: m.voteAverage,
});

// Of these films, the ones that pass the deck's IMDb / Rotten Tomatoes / year
// filters. Ratings are looked up only when a rating filter is on (and cached).
async function passingDeckFilters(ids: number[], f: DeckFilters): Promise<Set<number>> {
  if (!ids.length) return new Set();
  if (f.imdb || f.rt) {
    await ensureDetails(ids);
    await ensureRatings(ids);
  }
  const rows = await db.movie.findMany({ where: { id: { in: ids } } });
  const filters = { minImdb: f.imdb, minRt: f.rt, yearFrom: f.from };
  return new Set(rows.filter((m) => passes({ ...m, streamIds: [] }, filters, [])).map((m) => m.id));
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
    const pool = await similarPool(like, { minSize: 60, excluded: answered });
    const rows = await db.movie.findMany({ where: { id: { in: [...pool.keys()] } } });
    const ordered = rows
      .filter((m) => !skipSet.has(m.id) && (!genre || m.genreIds.includes(genre)) && passesCheap(m, { yearFrom: f.from }))
      // As in Tonight: a handful of votes makes any score meaningless.
      .filter((m) => m.voteCount >= MIN_VOTES)
      // Films the anchors list directly first, then the wider second hop;
      // most-watched first within each.
      .sort((a, b) => Number(pool.direct.has(b.id)) - Number(pool.direct.has(a.id)) || b.voteCount - a.voteCount);
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
  const sig = [f.imdb, f.rt, f.from].map((v) => v ?? "").join("|");
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
    });
    await saveList(res.results);
    const ids = res.results.map((r) => r.id);
    const answered = new Set(
      (await db.swipe.findMany({ where: { userId: user.id, movieId: { in: ids } }, select: { movieId: true } })).map(
        (s) => s.movieId,
      ),
    );
    const unanswered = ids.filter((id) => !answered.has(id));
    const ok = await passingDeckFilters(unanswered, f);
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
