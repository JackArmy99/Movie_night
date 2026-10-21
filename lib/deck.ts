// The swipe deck's cards. Two streams, about 3 to 1: "for you" (Tonight's
// engine for this person: Claude's picks, your 5★ films, what you avoid) and
// "have you seen?" (TMDB's most-watched, the films you've most likely seen,
// with kinds you keep rejecting sunk to the end). One card in 25 is an
// "explore" card from that sunk end, so nothing is ever gone for good.
// Optionally narrowed by IMDb / Rotten Tomatoes / earliest year, Custom
// genres and "Similar to…" films.
import type { Movie } from "@prisma/client";
import { db } from "./db";
import { ensureDetails, ensureRatings, saveList } from "./movies";
import { MIN_VOTES, passes, passesCheap, excludedBy, hasExcluded, NO_EXCLUDED, type Excluded } from "./score";
import { similarPool } from "./similar";
import { aiCandidates } from "./ai";
import { getJson, getSetting, incrementSetting, setJson } from "./settings";
import { combinedFactor, loadTaste } from "./profile";
import { suggest } from "./recommend";
import * as tmdb from "./tmdb";

export type Card = {
  id: number;
  title: string;
  year: number | null;
  poster: string | null;
  overview: string;
  score: number;
  kind?: "foryou" | "seen" | "explore";
  why?: string; // one line on why it's here (Claude's or "From <director>…")
};

export type DeckFilters = { imdb?: number; rt?: number; from?: number; like?: number[]; exclude?: Excluded };

// Below this fit a film counts as "sunk": shown only in explore slots.
const SUNK = 0.15;
const EXPLORE_EVERY = 25;
const PER_CALL = 10;

const toCard = (
  m: { id: number; title: string; year: number | null; posterPath: string | null; overview: string; voteAverage: number },
  kind?: Card["kind"],
  why?: string,
): Card => ({
  id: m.id,
  title: m.title,
  year: m.year,
  poster: tmdb.poster(m.posterPath, "w500"),
  overview: m.overview.slice(0, 220),
  score: m.voteAverage,
  ...(kind ? { kind } : {}),
  ...(why ? { why } : {}),
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
  const taste = await loadTaste(user.id);
  const fit = (m: Movie) => combinedFactor([taste], m);

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
      // Most-watched first within each tier (those you're likeliest to have
      // seen), with kinds you keep rejecting pulled down.
      .sort((a, b) => tier(a.id) - tier(b.id) || b.voteCount * fit(b) - a.voteCount * fit(a));
    const cards: Card[] = [];
    for (let i = 0; i < ordered.length && cards.length < 10; i += 12) {
      const chunk = ordered.slice(i, i + 12);
      const ok = await passingDeckFilters(chunk.map((m) => m.id), f);
      for (const m of chunk) if (ok.has(m.id) && cards.length < 10) cards.push(toCard(m));
    }
    return { cards, done: cards.length ? undefined : "That's every film like these that fits the filters." };
  }

  // "For you": Tonight's engine for this person, with the deck's filters,
  // minus everything you've answered (including "haven't seen") or queued.
  const answered = (await db.swipe.findMany({ where: { userId: user.id }, select: { movieId: true } })).map((s) => s.movieId);
  let forYou: Card[] = [];
  try {
    const picks = await suggest({
      users: [user.id],
      genre,
      filters: { minImdb: f.imdb, minRt: f.rt, yearFrom: f.from },
      exclude: f.exclude,
      limit: 8,
      skip: [...answered, ...skipSet],
    });
    forYou = picks.filter((p) => !p.fallback || fit(p.movie) >= SUNK).map((p) => toCard(p.movie, "foryou", p.reason));
  } catch {
    // The for-you stream is a bonus; the deck still works from TMDB's list.
  }
  for (const c of forYou) skipSet.add(c.id);

  // "Have you seen?": TMDB's most-watched list, with the year and a rough
  // score floor applied by TMDB itself, then the exact IMDb/RT check. Each
  // filter combination keeps its own bookmark.
  const exSig = f.exclude && hasExcluded(f.exclude) ? [...f.exclude.genres, ...(f.exclude.superhero ? ["sh"] : [])].join(",") : "";
  const sig = [f.imdb, f.rt, f.from].map((v) => v ?? "").join("|") + (exSig ? `|x${exSig}` : "");
  const cursorKey = sig === "||" ? `deck:${user.id}:${genre}` : `deck:${user.id}:${genre}:${sig}`;
  const start = await getJson<number>(cursorKey, 1);
  let bookmark = start;
  let stillAtBookmark = true;
  // The interleave takes 2 of 10 when "for you" is full; more when it runs short.
  const wantSeen = Math.max(2, PER_CALL - forYou.length);
  const seen: Movie[] = [];
  const sunk: Movie[] = [];
  const pages = f.imdb || f.rt ? 3 : 6; // rating lookups cost a little; go easy
  // Is an explore card due in this batch? Then look a little further for one.
  const served = Number((await getSetting(`deckserved:${user.id}`)) ?? 0);
  const exploreDue = Math.floor((served + PER_CALL) / EXPLORE_EVERY) > Math.floor(served / EXPLORE_EVERY);

  for (let page = start; page < start + pages && (seen.length < wantSeen || (exploreDue && !sunk.length)); page++) {
    const res = await tmdb.mostWatched(genre, page, {
      fromYear: f.from,
      minVote: f.imdb ? Math.max(0, f.imdb - 1) : undefined,
      exclude: f.exclude,
    });
    await saveList(res.results);
    const ids = res.results.map((r) => r.id);
    const answeredHere = new Set(answered.filter((id) => ids.includes(id)));
    const unanswered = ids.filter((id) => !answeredHere.has(id));
    // TMDB has already left out superhero films here (without_keywords), so no
    // per-card lookup is needed for that.
    const ok = await passingDeckFilters(unanswered, { ...f, exclude: f.exclude && { ...f.exclude, superhero: false } });
    const open = unanswered.filter((id) => ok.has(id));
    // Keywords and people come with details (free, cached a month): needed to
    // recognise a superhero film or a director you love.
    await ensureDetails(open);
    const rows = new Map((await db.movie.findMany({ where: { id: { in: open } } })).map((m) => [m.id, m]));
    // Films of kinds you keep rejecting wait for an explore slot instead.
    const live = open.filter((id) => fit(rows.get(id)!) >= SUNK);
    // Only move the bookmark past pages with nothing left to answer (sunk
    // films aside), so closing the app halfway down a page never skips anything.
    if (stillAtBookmark && live.length === 0) bookmark = page + 1;
    else stillAtBookmark = false;
    // Within a page: most-watched first, pulled down by what you avoid.
    const ordered = open.map((id) => rows.get(id)!).filter(Boolean).sort((a, b) => b.voteCount * fit(b) - a.voteCount * fit(a));
    for (const m of ordered) {
      if (skipSet.has(m.id)) continue;
      if (fit(m) < SUNK) sunk.push(m);
      else if (seen.length < wantSeen) {
        skipSet.add(m.id);
        seen.push(m);
      }
    }
    if (page >= Math.min(res.total_pages, 500)) break;
  }
  if (bookmark !== start) await setJson(cursorKey, bookmark);

  // Interleave: three "for you", one "have you seen?", and so on.
  const cards: Card[] = [];
  const seenCards = seen.map((m) => toCard(m, "seen"));
  while (cards.length < PER_CALL && (forYou.length || seenCards.length)) {
    const takeSeen = (cards.length % 4 === 3 && seenCards.length) || !forYou.length;
    cards.push(takeSeen ? seenCards.shift()! : forYou.shift()!);
  }

  // Nothing else left: the sunk films are all that remains.
  if (!cards.length) for (const m of sunk.slice(0, PER_CALL)) cards.push(toCard(m, "explore"));
  // One card in 25 comes from the sunk end: never "never".
  else {
    const now = await incrementSetting(`deckserved:${user.id}`, cards.length);
    const crossed = Math.floor(now / EXPLORE_EVERY) > Math.floor((now - cards.length) / EXPLORE_EVERY);
    const pick = sunk.find((m) => !cards.some((c) => c.id === m.id));
    if (crossed && pick) cards.splice(Math.min(cards.length - 1, 5), 1, toCard(pick, "explore"));
  }
  return { cards };
}
