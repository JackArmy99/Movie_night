// Free test gate: no network, no API keys, no cost. Pure logic first, then
// the suggestion engine end to end against a fake TMDB and a throwaway
// Postgres database. Run with `npm test` (needs DATABASE_URL pointing at a
// database it may wipe — it refuses anything not named like a test DB).
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { parseCsv } from "../lib/csv";
import { mergeExport, verdictFor, eloFor } from "../lib/letterboxd";
import { eloUpdate, nextPair } from "../lib/elo";
import {
  passes,
  parseFilters,
  qualityFactor,
  reputationFactor,
  scoreCandidates,
  seedWeight,
  trustedRating,
  verdictForStars,
  blendCloseness,
  excludedBy,
  parseExcluded,
} from "../lib/score";
import { customLabel } from "../lib/genres";
import { directionFor, starsFromX } from "../lib/swipe";
import { pickTrailer } from "../lib/tmdb";
import { parseRatingLine } from "../lib/imdb";
import { toIcs } from "../lib/ics";
import { affinity, avoidedKinds, buildProfile, factorOf, featuresOf, signalOf } from "../lib/profile";
import { vibeOverlap } from "../lib/vibes";
import { startFake, FILMS, recsFor, imdbOf, keywordsOf, lastClaudeRequest, directorOf, isAnime } from "./fake-tmdb";

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n    ${String((err as Error)?.stack ?? err).split("\n").slice(0, 4).join("\n    ")}`);
  }
}

async function main() {
  console.log("Pure logic");

  await test("CSV: quotes, commas and newlines inside fields", () => {
    const rows = parseCsv('﻿Name,Year,Note\r\n"Crouching Tiger, Hidden Dragon",2000,"said ""wow""\nthen left"\nAlien,1979,\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].Name, "Crouching Tiger, Hidden Dragon");
    assert.equal(rows[0].Note, 'said "wow"\nthen left');
    assert.equal(rows[1].Year, "1979");
  });

  await test("Letterboxd: merges files, stars → verdicts, watchlist only if unwatched", () => {
    const films = mergeExport([
      { name: "watched.csv", text: "Date,Name,Year,Letterboxd URI\n2024-01-01,Alien,1979,https://boxd.it/a\n2024-01-02,Heat,1995,https://boxd.it/b\n" },
      { name: "ratings.csv", text: "Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,Alien,1979,https://boxd.it/a,5\n2024-01-03,Cats,2019,https://boxd.it/c,1\n" },
      { name: "watchlist.csv", text: "Date,Name,Year,Letterboxd URI\n2024-01-01,Dune,2021,https://boxd.it/d\n2024-01-01,Heat,1995,https://boxd.it/b\n" },
      { name: "diary.csv", text: "Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,Alien,1979,https://boxd.it/x1,3\n" },
      { name: "likes/films.csv", text: "Date,Name,Year,Letterboxd URI\n2024-01-01,Heat,1995,https://boxd.it/b\n2024-01-01,Cats,2019,https://boxd.it/c\n" },
      { name: "likes/reviews.csv", text: "Date,Name,Year,Letterboxd URI\n2024-01-01,Some Review,2001,https://boxd.it/r\n" },
    ]);
    const get = (n: string) => films.find((f) => f.name === n)!;
    assert.equal(films.length, 4);
    assert.equal(get("Alien").rating, 5, "diary rating must not override ratings.csv");
    assert.equal(verdictFor(get("Alien").rating), "superlike");
    assert.equal(verdictFor(get("Heat").rating, get("Heat").hearted), "superlike", "unrated heart = favourite");
    assert.equal(verdictFor(get("Cats").rating, get("Cats").hearted), "dislike", "a heart doesn't rescue 1 star");
    assert.equal(verdictFor(null), "seen");
    assert.ok(!films.some((f) => f.name === "Some Review"), "liked reviews are not films");
    assert.equal(get("Heat").watchlist, false, "watched films are not watchlist films");
    assert.equal(get("Dune").watchlist, true);
    assert.equal(get("Dune").watched, false);

    assert.equal(verdictFor(3), "like");
    assert.equal(verdictFor(2.5), "dislike");
    assert.ok(eloFor(5) > eloFor(4.5));
  });

  await test("Elo: winner goes up, loser down, total conserved; pairs never repeat a film", () => {
    const [w, l] = eloUpdate(1000, 1000);
    assert.ok(w > 1000 && l < 1000);
    assert.equal(Math.round(w + l), 2000);
    const items = [1, 2, 3].map((i) => ({ movieId: i, elo: 1000, comparisons: i }));
    const pair = nextPair(items)!;
    assert.notEqual(pair[0].movieId, pair[1].movieId);
    assert.equal(pair[0].movieId, 1, "least-compared film goes first");
    assert.equal(nextPair([items[0]]), null);
  });

  await test("Scoring: seen films never suggested; dislikes push down; agreement wins", () => {
    const recs = new Map<number, number[]>([
      [1, [10, 11, 12]],
      [2, [10, 13]],
      [3, [12]],
    ]);
    const scored = scoreCandidates({
      seeds: [
        { userId: "a", movieId: 1, verdict: "superlike", elo: 1000 },
        { userId: "b", movieId: 2, verdict: "like", elo: 1000 },
        { userId: "b", movieId: 3, verdict: "dislike", elo: 1000 },
        { userId: "a", movieId: 11, verdict: "seen", elo: 1000 },
      ],
      recs,
      users: ["a", "b"],
      excluded: new Set([1, 2, 3, 11]),
      genresOf: new Map(),
      genre: 0,
    });
    const ids = scored.map((s) => s.movieId);
    assert.ok(!ids.includes(11), "seen film suggested");
    assert.equal(ids[0], 10, "film both would like should rank first");
    assert.ok(!ids.includes(12), "film from a disliked seed should drop out");
    assert.deepEqual(scored[0].because.sort(), [1, 2]);
  });

  await test("Scoring: a partner with no swipes doesn't zero everything", () => {
    const scored = scoreCandidates({
      seeds: [{ userId: "a", movieId: 1, verdict: "like", elo: 1000 }],
      recs: new Map([[1, [5]]]),
      users: ["a", "b"],
      excluded: new Set([1]),
      genresOf: new Map(),
      genre: 0,
    });
    assert.equal(scored.length, 1);
  });

  await test("Seed weights: top-ranked super like > super like > like > seen > 0 > dislike", () => {
    assert.ok(seedWeight("superlike", 1400) > seedWeight("superlike", 1000));
    assert.ok(seedWeight("superlike") > seedWeight("like"));
    assert.ok(seedWeight("like") > seedWeight("seen"));
    assert.equal(seedWeight("unseen"), 0);
    assert.ok(seedWeight("dislike") < 0);
  });

  await test("Quality: acclaimed beats middling; few votes can't fake acclaim", () => {
    assert.ok(qualityFactor(8.2, 20000) > 2 * qualityFactor(6.8, 20000));
    assert.ok(qualityFactor(6.0, 5000) < 0.5);
    assert.ok(qualityFactor(8.4, 30000) > qualityFactor(9.5, 40), "40 votes outranked 30,000");
    assert.ok(qualityFactor(2, 5000) > 0, "never zero — a film can still surface");
  });

  await test("Filters: sliders, unknown scores, services", () => {
    const f = parseFilters({ imdb: "7", rt: "80", len: "120", from: "2000", mine: "1" });
    assert.deepEqual(f, { minImdb: 7, minRt: 80, yearFrom: 2000, yearTo: undefined, maxRuntime: 120, servicesOnly: true });
    const base = { year: 2010, runtime: 110, imdbRating: 7.5, rtScore: 90, voteAverage: 7, streamIds: [8] };
    assert.ok(passes(base, f, [8]));
    assert.ok(!passes({ ...base, streamIds: [119] }, f, [8]), "not on our services");
    assert.ok(!passes({ ...base, rtScore: null }, f, [8]), "RT slider set but no RT score");
    assert.ok(!passes({ ...base, runtime: 150 }, f, [8]));
    assert.ok(passes({ ...base, imdbRating: null, voteAverage: 7.2 }, { minImdb: 7 }, []), "falls back to TMDB score");
    assert.ok(!passes({ ...base, year: 1999 }, f, [8]));
    assert.ok(!passes({ ...base, releaseDate: "2999-01-01" }, {}, []), "unreleased film suggested");
    assert.ok(passes({ ...base, releaseDate: "2010-05-01" }, {}, []));
  });

  await test("Swipe directions: left 1★ … up 3★ … right 5★, down = not seen", () => {
    const stars = (dx: number, dy: number) => {
      const a = directionFor(dx, dy);
      return a?.kind === "stars" ? a.stars : a?.kind;
    };
    assert.equal(stars(-120, 0), 1);
    assert.equal(stars(-100, -100), 2);
    assert.equal(stars(0, -120), 3);
    assert.equal(stars(100, -100), 4);
    assert.equal(stars(120, 0), 5);
    assert.equal(stars(0, 120), "unseen");
    assert.equal(stars(80, 80), "unseen", "down-right (135°) is 'haven't seen'");
    assert.equal(stars(-80, 80), "pass", "down-left (225°) is 'not for me'");
    assert.equal(stars(-10, 120), "pass", "just left of straight down is 'not for me'");
    assert.equal(stars(120, 35), 5, "slightly below horizontal still 5★");
    assert.equal(stars(-120, 35), 1);
    assert.equal(directionFor(40, -40), null, "a short drag springs back");
  });

  await test("Grid re-rating: finger position → half stars; far left cancels", () => {
    assert.equal(starsFromX(100, 100), 5);
    assert.equal(starsFromX(200, 100), 5, "past the right edge stays 5★");
    assert.equal(starsFromX(50, 100), 2.5);
    assert.equal(starsFromX(51, 100), 3);
    assert.equal(starsFromX(8, 100), 0.5);
    assert.equal(starsFromX(2, 100), null, "far left = cancel");
    assert.equal(starsFromX(-30, 100), null);
  });

  await test("Stars → verdict and weights: graded, 'not interested' mildly negative", () => {
    assert.equal(verdictForStars(5), "superlike");
    assert.equal(verdictForStars(4.5), "superlike");
    assert.equal(verdictForStars(4), "like");
    assert.equal(verdictForStars(3), "like");
    assert.equal(verdictForStars(2.5), "dislike");
    assert.equal(verdictForStars(3, true), "superlike", "a heart lifts 3★+");
    const w = (n: number) => seedWeight(verdictForStars(n), 1000, n);
    assert.ok(w(5) > w(4.5) && w(4.5) > w(4) && w(4) > w(3.5) && w(3.5) > w(3) && w(3) > 0);
    assert.ok(0 > w(2.5) && w(2.5) > w(2) && w(2) > w(1));
    assert.ok(seedWeight("pass") < 0 && seedWeight("pass") > w(2.5));
  });

  await test("Trailers: official English trailer beats teasers and non-YouTube", () => {
    assert.equal(
      pickTrailer([
        { key: "vimeo", site: "Vimeo", type: "Trailer", official: true, iso_639_1: "en" },
        { key: "teaser", site: "YouTube", type: "Teaser", official: true, iso_639_1: "en" },
        { key: "fan", site: "YouTube", type: "Trailer", official: false, iso_639_1: "en" },
        { key: "nl", site: "YouTube", type: "Trailer", official: true, iso_639_1: "nl" },
        { key: "old", site: "YouTube", type: "Trailer", official: true, iso_639_1: "en", published_at: "2010-01-01" },
        { key: "new", site: "YouTube", type: "Trailer", official: true, iso_639_1: "en", published_at: "2020-01-01" },
      ]),
      "new",
    );
    assert.equal(pickTrailer([{ key: "t", site: "YouTube", type: "Teaser" }]), "t", "teaser if nothing better");
    assert.equal(pickTrailer([{ key: "c", site: "YouTube", type: "Clip" }]), null);
  });

  await test("IMDb/RT: trusted over TMDB, and they decide the order", () => {
    const tmdbOnly = { voteAverage: 7.9, voteCount: 20000 };
    assert.equal(trustedRating(tmdbOnly).rating, 7.9);
    assert.equal(trustedRating({ ...tmdbOnly, imdbRating: 6.1, imdbVotes: 300000 }).rating, 6.1, "IMDb wins over TMDB");
    assert.ok(Math.abs(trustedRating({ ...tmdbOnly, imdbRating: 8, rtScore: 90 }).rating - 8.3) < 1e-9, "70/30 with RT");
    const acclaimed = reputationFactor({ voteAverage: 7, voteCount: 5000, imdbRating: 8.3, imdbVotes: 400000, rtScore: 96 });
    const middling = reputationFactor({ voteAverage: 7, voteCount: 5000, imdbRating: 6.4, imdbVotes: 400000, rtScore: 41 });
    assert.ok(acclaimed > 3 * middling, `${acclaimed} vs ${middling}`);
    assert.deepEqual(parseRatingLine("tt0113277\t8.3\t712345"), { imdbId: "tt0113277", rating: 8.3, votes: 712345 });
    assert.equal(parseRatingLine("tconst\taverageRating\tnumVotes"), null);
  });

  await test("Similar to: films close to several anchors come first", () => {
    const c = blendCloseness([
      [10, 11, 12],
      [13, 12, 14],
    ]);
    const order = [...c.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    assert.equal(order[0], 12, "the film both anchors list should lead");
    assert.ok(c.get(10)! > c.get(11)!, "higher on a list = closer");
    assert.ok(blendCloseness([[1]], 0.5).get(1)! < blendCloseness([[1]]).get(1)!, "second hop counts half");
  });

  await test("Custom genres: any unticked genre hides a film; superhero by keyword", () => {
    const ex = parseExcluded("27,sh");
    assert.deepEqual(ex, { genres: [27], superhero: true });
    assert.ok(excludedBy({ genreIds: [35, 27], keywordIds: [] }, ex), "horror-comedy should be hidden");
    assert.ok(!excludedBy({ genreIds: [35], keywordIds: [] }, ex));
    assert.ok(excludedBy({ genreIds: [28], keywordIds: [9715] }, ex), "superhero film should be hidden");
    assert.ok(!excludedBy({ genreIds: [28], keywordIds: [9715] }, parseExcluded("27")), "superhero ticked = shown");
    assert.equal(customLabel(parseExcluded("27,sh")), "✏️ No Horror, Superhero");
    assert.equal(customLabel(parseExcluded("")), "✏️ All genres");
    const allBut = [28, 12, 16, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 878, 53, 10752, 37].join(",") + ",sh";
    assert.equal(customLabel(parseExcluded(allBut)), "✏️ Comedy, Romance");
  });

  await test("Calendar feed: valid iCalendar, all-day, escaped, folded", () => {
    const ics = toIcs("Test", [
      { uid: "nl-1@x", date: "2026-12-31", title: "Film; with, specials", description: "x".repeat(200) },
    ]);
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
    assert.ok(ics.includes("DTSTART;VALUE=DATE:20261231"));
    assert.ok(ics.includes("DTEND;VALUE=DATE:20270101"), "year rollover");
    assert.ok(ics.includes("SUMMARY:Film\\; with\\, specials"));
    for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line.length}`);
  });

  await test("Taste profile: a pattern of 'Not for me' sinks a kind, one rejection barely moves it", () => {
    const film = (genreIds: number[], kw: number[] = [], lang = "en") => ({ genreIds, keywordIds: kw, originalLanguage: lang, people: null, vibes: [] as string[] });
    const superhero = film([28, 878], [9715]);
    const action = film([28, 53]);
    const loved = Array.from({ length: 6 }, () => ({ verdict: "superlike", stars: 5, movie: film([28, 53]) }));
    const passes8 = Array.from({ length: 8 }, () => ({ verdict: "pass", stars: null, movie: film([28, 878], [9715]) }));
    const p = buildProfile([...loved, ...passes8]);
    const fSuper = factorOf(affinity(p, superhero));
    const fAction = factorOf(affinity(p, action));
    assert.ok(fSuper < 0.15, `superhero factor ${fSuper.toFixed(3)} should be near the floor`);
    assert.ok(fSuper >= 0.03, "never zero");
    assert.ok(fAction > 1.5, `loved kind factor ${fAction.toFixed(2)}`);
    const one = buildProfile([...loved, passes8[0]]);
    assert.ok(factorOf(affinity(one, superhero)) > 0.6, "a single rejection should barely move it");
    assert.ok(featuresOf(film([16], [], "ja")).top.includes("kind:anime"));
    assert.ok(!featuresOf(film([16], [], "en")).top.includes("kind:anime"), "Pixar isn't anime");
    assert.ok(avoidedKinds(p, (id) => String(id)).includes("superhero films"));
    assert.ok(signalOf("superlike", 5) > signalOf("like", 4) && signalOf("pass", null) < 0 && signalOf("unseen", null) === 0);
  });

  await test("Vibes: overlap with the chosen films' vibes", () => {
    assert.equal(vibeOverlap(["twisty", "tense"], [["twisty", "tense"]]), 1);
    assert.equal(vibeOverlap(["cosy"], [["twisty", "tense"]]), 0);
    assert.equal(vibeOverlap([], [["twisty"]]), 0);
    assert.equal(vibeOverlap(["twisty"], [["twisty", "tense"], ["twisty"]]), 0.75);
  });

  // ---------- end to end against a fake TMDB ----------
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!/test/i.test(new URL(dbUrl.replace(/^postgres(ql)?:/, "http:")).pathname)) {
    console.log("\nSkipping database tests: DATABASE_URL must point at a database with 'test' in its name.");
    return;
  }
  console.log("\nEngine, against a fake TMDB and a throwaway database");
  const fake = await startFake();
  process.env.TMDB_BASE = `${fake.url}/3`;
  process.env.TMDB_TOKEN = "fake-short-key";
  process.env.OMDB_BASE = `${fake.url}/omdb`;
  process.env.OMDB_KEY = "fake";
  process.env.IMDB_RATINGS_URL = `${fake.url}/imdb/title.ratings.tsv.gz`;
  process.env.ANTHROPIC_API_KEY = "";
  process.env.DATABASE_URL_UNPOOLED = dbUrl;
  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", { stdio: "ignore", env: process.env, shell: true as unknown as string });

  const { db } = await import("../lib/db");
  const { suggest } = await import("../lib/recommend");
  const { saveList } = await import("../lib/movies");
  const { upcomingDutch, matchingIds } = await import("../lib/calendar");
  const { setJson } = await import("../lib/settings");

  const a = await db.user.create({ data: { name: "J" } });
  const b = await db.user.create({ data: { name: "S" } });
  await saveList(FILMS.slice(0, 200));

  // J loves 1000 and 1018 (both genre 28 first), S likes 1018; S has seen 1036.
  const swipes = [
    { userId: a.id, movieId: 1000, verdict: "superlike" },
    { userId: a.id, movieId: 1018, verdict: "superlike" },
    { userId: b.id, movieId: 1018, verdict: "like" },
    { userId: b.id, movieId: 1036, verdict: "seen" },
    { userId: b.id, movieId: 1001, verdict: "dislike" },
    { userId: a.id, movieId: 1054, verdict: "unseen" },
  ];
  for (const s of swipes) await db.swipe.create({ data: s });

  await test("suggest(): nothing either of us has seen; real ratings and providers filled in", async () => {
    const list = await suggest({ users: [a.id, b.id], genre: 28, filters: {} });
    assert.ok(list.length >= 10, `only ${list.length} suggestions`);
    const ids = list.map((s) => s.movie.id);
    for (const seen of [1000, 1018, 1036, 1001]) assert.ok(!ids.includes(seen), `suggested seen film ${seen}`);
    assert.ok(list.every((s) => s.movie.genreIds.includes(28)), "wrong genre");
    const first = list[0];
    assert.ok(first.because.length > 0, "top pick should say why");
    assert.ok(first.movie.runtime && first.movie.imdbRating != null && first.movie.rtScore != null, "details/ratings not filled");
    assert.ok(Array.isArray((first.movie.providers as { stream: unknown[] }).stream));
  });

  await test("suggest(): 'unseen' films stay eligible", async () => {
    const recs = recsFor(1000).map((f) => f.id);
    const list = await suggest({ users: [a.id], genre: 0, filters: {}, limit: 60 });
    if (recs.includes(1054)) assert.ok(list.some((s) => s.movie.id === 1054));
  });

  await test("suggest(): sliders and 'on our services' are honoured", async () => {
    await setJson("services", [8]);
    const filters = { minImdb: 6, minRt: 50, maxRuntime: 150, servicesOnly: true };
    const list = await suggest({ users: [a.id, b.id], genre: 0, filters });
    assert.ok(list.length > 0, "filters removed everything");
    for (const s of list) {
      const m = s.movie;
      const stream = (m.providers as { stream: { id: number }[] }).stream.map((p) => p.id);
      assert.ok((m.imdbRating ?? 0) >= 6 && (m.rtScore ?? 0) >= 50 && (m.runtime ?? 0) <= 150, `slider ignored for ${m.title}`);
      assert.ok(stream.includes(8), `${m.title} isn't on our services`);
    }
  });

  await test("suggest(): with no taste data, falls back to top-rated films", async () => {
    const c = await db.user.create({ data: { name: "New" } });
    const list = await suggest({ users: [c.id], genre: 35, filters: {} });
    assert.ok(list.length > 0 && list.every((s) => s.fallback));
    await db.user.delete({ where: { id: c.id } });
  });

  await test("Lookups are cached: a second identical request makes no TMDB calls", async () => {
    await suggest({ users: [a.id, b.id], genre: 28, filters: {} });
    const before = fake.calls.length;
    await suggest({ users: [a.id, b.id], genre: 28, filters: {} });
    const extra = fake.calls.slice(before).filter((c) => !c.includes("discover"));
    assert.equal(extra.length, 0, `extra calls: ${extra.slice(0, 5).join(", ")}`);
  });

  await test("Calendar: upcoming Dutch releases in date order, cached", async () => {
    const list = await upcomingDutch();
    assert.equal(list.length, 10);
    const dates = list.map((m) => m.nlRelease!);
    assert.deepEqual(dates, [...dates].sort());
    const before = fake.calls.length;
    await upcomingDutch();
    assert.equal(fake.calls.length, before, "calendar should be served from cache");
    const matches = await matchingIds(list.map((m) => m.id));
    assert.ok(matches instanceof Set);
  });

  await test("Trailers are stored with a film's details", async () => {
    const m = await db.movie.findFirst({ where: { trailerAt: { not: null } } });
    assert.ok(m, "no film got a trailer lookup");
    assert.equal(m!.trailerKey, `trailer${m!.id}`);
  });

  await test("'Not interested' is never suggested, but doesn't count as seen", async () => {
    const before = await suggest({ users: [a.id, b.id], genre: 0, filters: {} });
    const top = before[0].movie.id;
    await db.swipe.create({ data: { userId: b.id, movieId: top, verdict: "pass" } });
    const after = await suggest({ users: [a.id, b.id], genre: 0, filters: {} });
    assert.ok(!after.some((s) => s.movie.id === top), "passed film still suggested in 'both' mode");
    const { SEEN } = await import("../lib/score");
    assert.ok(!SEEN.has("pass"));
  });

  await test("IMDb daily file: updates only films we hold, with votes", async () => {
    const { syncImdbRatings } = await import("../lib/imdb");
    const held = await db.movie.count({ where: { imdbId: { not: null } } });
    const res = await syncImdbRatings();
    assert.equal(res.held, held);
    assert.equal(res.matched, held, "every held film is in the file");
    const m = await db.movie.findFirst({ where: { imdbAt: { not: null } } });
    assert.ok(m);
    assert.equal(m!.imdbRating, Number(imdbOf(m!.id)));
    assert.equal(m!.imdbVotes, 50000 + m!.id);
    assert.equal(await db.movie.count({ where: { imdbId: { startsWith: "tt9" } } }), 0, "no rows invented");
  });

  await test("OMDb never overwrites a fresh IMDb-file rating", async () => {
    const { ensureRatings } = await import("../lib/movies");
    const m = await db.movie.findFirst({ where: { imdbAt: { not: null } } });
    await db.movie.update({ where: { id: m!.id }, data: { ratingsAt: null } });
    await ensureRatings([m!.id]);
    const after = await db.movie.findUnique({ where: { id: m!.id } });
    assert.equal(after!.imdbRating, Number(imdbOf(m!.id)), "OMDb replaced the IMDb file's rating");
    assert.ok(after!.rtScore != null, "RT still filled in from OMDb");
  });

  await test("OMDb refusing the key is recorded and not retried on every film", async () => {
    const { omdbRatings, omdbStatus } = await import("../lib/omdb");
    const good = process.env.OMDB_KEY;
    process.env.OMDB_KEY = "not-activated";
    try {
      assert.equal(await omdbRatings("tt0001000"), null);
      assert.equal((await omdbStatus())?.state, "invalid_key");
      const before = fake.calls.filter((c) => c.startsWith("/omdb")).length;
      await omdbRatings("tt0001001");
      assert.equal(fake.calls.filter((c) => c.startsWith("/omdb")).length, before, "asked OMDb again");
    } finally {
      process.env.OMDB_KEY = good;
    }
    assert.ok(await omdbRatings("tt0001002"), "a different (working) key is tried straight away");
    assert.equal((await omdbStatus())?.state, "ok");
  });

  await test("similarPool: no anchors, nothing seen; a second hop when too small", async () => {
    const { similarPool } = await import("../lib/similar");
    const anchors = [1000, 1018];
    const seen = new Set(recsFor(1000).slice(0, 3).map((f) => f.id));
    const pool = await similarPool(anchors, { excluded: seen });
    assert.ok(pool.size > 0);
    for (const id of anchors) assert.ok(!pool.has(id), "anchor in its own pool");
    for (const id of seen) assert.ok(!pool.has(id), "excluded film in the pool");
    const big = await similarPool(anchors, { minSize: pool.size + 50, excluded: seen });
    assert.ok(big.size > pool.size, "second hop didn't widen the pool");
  });

  await test("suggest({like}): only films like the chosen ones, never seen", async () => {
    const { similarPool } = await import("../lib/similar");
    const like = [1003];
    const pool = await similarPool(like, { minSize: 80 });
    const list = await suggest({ users: [a.id, b.id], genre: 0, filters: {}, like, limit: 10 });
    assert.ok(list.length > 0, "no similar suggestions");
    const seenIds = new Set((await db.swipe.findMany({ where: { verdict: { in: ["superlike", "like", "dislike", "seen", "pass"] } } })).map((s) => s.movieId));
    for (const s of list) {
      assert.ok(pool.has(s.movie.id), `${s.movie.title} isn't like the anchor`);
      assert.ok(!seenIds.has(s.movie.id), `${s.movie.title} was seen or passed`);
      assert.ok(!s.fallback, "no top-rated padding in like-mode");
      assert.deepEqual(s.because.map((x) => x.id), like);
    }
  });

  await test("Swipe deck filters: year/IMDb honoured, own bookmark per filter, Similar to", async () => {
    const { deckCards } = await import("../lib/deck");
    const plain = await deckCards(a.id, 0, []);
    assert.ok(plain.cards.length >= 10, `only ${plain.cards.length} cards`);
    const f = { from: 2010, imdb: 7 };
    const filtered = await deckCards(a.id, 0, [], f);
    assert.ok(filtered.cards.length > 0, "filters left nothing");
    const rows = await db.movie.findMany({ where: { id: { in: filtered.cards.map((c) => c.id) } } });
    for (const m of rows) {
      assert.ok((m.year ?? 0) >= 2010, `${m.title} is from ${m.year}`);
      assert.ok((m.imdbRating ?? m.voteAverage) >= 7, `${m.title} IMDb ${m.imdbRating}`);
    }
    // Answer the filtered page entirely: only that filter's bookmark moves.
    const before = await db.setting.findMany({ where: { key: { startsWith: `deck:${a.id}:0` } } });
    assert.ok(!before.some((k) => k.key.endsWith("|")), "filtered deck shouldn't share the plain bookmark");
    const like = await deckCards(a.id, 0, [], { like: [1005] });
    const pool = await (await import("../lib/similar")).similarPool([1005], { minSize: 60 });
    assert.ok(like.cards.length > 0);
    for (const c of like.cards) assert.ok(pool.has(c.id), `${c.title} isn't like the anchor`);
    const votes = (await db.movie.findMany({ where: { id: { in: like.cards.map((c) => c.id) } } }))
      .sort((x, y) => like.cards.findIndex((c) => c.id === x.id) - like.cards.findIndex((c) => c.id === y.id))
      .map((m) => m.voteCount);
    const direct = like.cards.filter((c) => pool.direct.has(c.id)).length;
    assert.ok(like.cards.slice(0, direct).every((c) => pool.direct.has(c.id)), "direct matches should come first");
    const dv = votes.slice(0, direct);
    assert.deepEqual(dv, [...dv].sort((x, y) => y - x), "most-watched first among direct matches");
  });

  await test("Custom genres in Tonight and the swipe deck: nothing unticked gets through", async () => {
    const { deckCards } = await import("../lib/deck");
    const exclude = parseExcluded("18,sh"); // no Drama, no Superhero
    const list = await suggest({ users: [a.id, b.id], genre: 0, filters: {}, limit: 15, exclude });
    assert.ok(list.length > 0, "nothing suggested");
    for (const s of list) {
      assert.ok(!s.movie.genreIds.includes(18), `${s.movie.title} is a drama`);
      assert.ok(!keywordsOf(s.movie.id).includes(9715), `${s.movie.title} is a superhero film`);
      assert.ok(s.movie.keywordsAt, "keywords should be known by the time a film is shown");
    }
    const deck = await deckCards(a.id, 0, [], { exclude });
    assert.ok(deck.cards.length > 0);
    for (const c of deck.cards) {
      const f = FILMS.find((x) => x.id === c.id)!;
      assert.ok(!f.genre_ids.includes(18) && !keywordsOf(f.id).includes(9715), `deck card ${c.title} should be excluded`);
    }
    const like = await deckCards(a.id, 0, [], { exclude, like: [1007] });
    for (const c of like.cards) {
      const f = FILMS.find((x) => x.id === c.id)!;
      assert.ok(!f.genre_ids.includes(18) && !keywordsOf(f.id).includes(9715), `similar-to card ${c.title} should be excluded`);
    }
    // Answer a few batches, so the "have you seen?" stream finishes its first
    // TMDB page and saves its place.
    let batch = deck.cards;
    let keys: string[] = [];
    for (let round = 0; round < 15 && !keys.some((k) => k.includes("x18,sh")); round++) {
      for (const c of batch) await db.swipe.upsert({ where: { userId_movieId: { userId: a.id, movieId: c.id } }, create: { userId: a.id, movieId: c.id, verdict: "unseen" }, update: {} });
      batch = (await deckCards(a.id, 0, [], { exclude })).cards;
      keys = (await db.setting.findMany({ where: { key: { startsWith: `deck:${a.id}:0` } } })).map((k) => k.key);
    }
    assert.ok(keys.some((k) => k.includes("x18,sh")), "Custom deck should keep its own bookmark");
  });

  await test("Counters stay exact under parallel use; OMDb stops at the daily limit", async () => {
    const { incrementSetting, getSetting } = await import("../lib/settings");
    await Promise.all(Array.from({ length: 20 }, () => incrementSetting("count:test", 1)));
    assert.equal(await getSetting("count:test"), "20", "lost increments");
    const { omdbBatch } = await import("../lib/omdb");
    const day = `omdb:${new Date().toISOString().slice(0, 10)}`;
    const limit = Number(process.env.OMDB_DAILY_LIMIT ?? 950);
    await db.setting.upsert({ where: { key: day }, create: { key: day, value: String(limit - 3) }, update: { value: String(limit - 3) } });
    const ids = Array.from({ length: 10 }, (_, i) => `tt${String(1100 + i).padStart(7, "0")}`);
    const res = await omdbBatch(ids);
    assert.equal(res.size, 3, `looked up ${res.size} films with 3 left today`);
    await db.setting.delete({ where: { key: day } });
  });

  await test("OMDb 'no such film' is remembered, not asked again every visit", async () => {
    const { ensureRatings } = await import("../lib/movies");
    const m = await db.movie.create({ data: { id: 999001, title: "Unknown to OMDb", imdbId: "tt9999999" } });
    const before = fake.calls.filter((c) => c.startsWith("/omdb")).length;
    await ensureRatings([m.id]);
    await ensureRatings([m.id]);
    assert.equal(fake.calls.filter((c) => c.startsWith("/omdb")).length - before, 1, "asked OMDb twice");
    assert.ok((await db.movie.findUnique({ where: { id: m.id } }))!.ratingsAt, "miss not recorded");
  });

  await test("Daily job: needs the secret; refreshes IMDb ratings and the calendar", async () => {
    const { GET } = await import("../app/api/cron/daily/route");
    const { NextRequest } = await import("next/server");
    process.env.CRON_SECRET = "s3cret";
    const denied = await GET(new NextRequest("http://x/api/cron/daily"));
    assert.equal(denied.status, 404);
    const ok = await GET(new NextRequest("http://x/api/cron/daily", { headers: { authorization: "Bearer s3cret" } }));
    const body = (await ok.json()) as { imdb: { matched: number }; calendar: number };
    assert.ok(body.imdb.matched > 0, JSON.stringify(body));
    assert.equal(body.calendar, 10);
  });

  await test("Similar to without Claude: TMDB films must share a genre with the chosen film", async () => {
    const anchor = FILMS.find((f) => f.id === 1003)!;
    const list = await suggest({ users: [a.id, b.id], genre: 0, filters: {}, like: [1003], limit: 15 });
    assert.ok(list.length > 0);
    for (const s of list) assert.ok(s.movie.genreIds.some((g) => anchor.genre_ids.includes(g)), `${s.movie.title} shares no genre`);
    assert.ok(list.every((s) => !s.reason), "no Claude reasons without a key");
  });

  await test("Claude picks: titles matched, cached, cost counted; seen films never shown", async () => {
    Object.assign(process.env, { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: fake.url, CLAUDE_MONTHLY_CAP_USD: "1" });
    const { aiCandidates } = await import("../lib/ai");
    const { spentThisMonth } = await import("../lib/claude");
    const claudeCalls = () => fake.calls.filter((c) => c === "/v1/messages").length;
    const spendBefore = await spentThisMonth();
    const picks = (await aiCandidates({ mode: "similar", anchors: [1003], users: [a.id, b.id] }))!;
    assert.ok(picks, "no picks");
    const ids = picks.map((p) => p.id);
    assert.ok(ids.includes(1400) && ids.includes(1439), "titles not matched to TMDB");
    assert.equal(picks.length, 41, "the unknown title should be dropped, the rest kept");
    assert.ok(lastClaudeRequest.body.includes("Already seen") && lastClaudeRequest.body.includes("Film 1000"), "seen list not sent");
    assert.equal(claudeCalls(), 1);
    await aiCandidates({ mode: "similar", anchors: [1003], users: [a.id, b.id] });
    assert.equal(claudeCalls(), 1, "second identical request should come from the cache");
    const cost = (await spentThisMonth()) - spendBefore;
    assert.ok(cost > 0.0015 && cost < 0.002, `cost recorded ${cost}`);

    const similar = await suggest({ users: [a.id, b.id], genre: 0, filters: {}, like: [1003], limit: 10 });
    assert.ok(similar.length > 0);
    assert.ok(similar[0].reason?.startsWith("fake reason"), "Claude's picks should lead in Similar to");
    assert.ok(!similar.some((s) => s.movie.id === 1000), "a seen film got through from Claude");

    const tonight = await suggest({ users: [a.id, b.id], genre: 0, filters: {}, limit: 10 });
    assert.ok(tonight.some((s) => s.reason), "Tonight should include Claude's picks");
    assert.ok(!tonight.some((s) => s.movie.id === 1000), "a seen film got through in Tonight");
    const seen = new Set((await db.swipe.findMany({ where: { verdict: { in: ["superlike", "like", "dislike", "seen", "pass"] } } })).map((x) => x.movieId));
    for (const s of [...similar, ...tonight]) assert.ok(!seen.has(s.movie.id), `${s.movie.title} was seen or passed`);
  });

  await test("Claude past the monthly cap (or with no key): no call, old engine answers", async () => {
    const { aiCandidates } = await import("../lib/ai");
    const before = fake.calls.filter((c) => c === "/v1/messages").length;
    process.env.CLAUDE_MONTHLY_CAP_USD = "0.000001";
    assert.equal(await aiCandidates({ mode: "similar", anchors: [1011], users: [a.id] }), null);
    const list = await suggest({ users: [a.id, b.id], genre: 0, filters: {}, like: [1011], limit: 5 });
    assert.ok(list.length > 0 && list.every((s) => !s.reason), "should fall back to the TMDB engine");
    process.env.CLAUDE_MONTHLY_CAP_USD = "1";
    process.env.ANTHROPIC_API_KEY = "";
    assert.equal(await aiCandidates({ mode: "similar", anchors: [1012], users: [a.id] }), null);
    assert.equal(fake.calls.filter((c) => c === "/v1/messages").length, before, "Claude was called anyway");
  });

  // ---------- learning what you like and avoid ----------
  const c = await db.user.create({ data: { name: "L" } });
  const sh = (id: number) => keywordsOf(id).includes(9715);
  {
    // L loves a handful of films, and has said "Not for me" to 12 superhero
    // films and 6 anime.
    await saveList(FILMS);
    // Every other one, so some of each kind are still unanswered near the
    // top of the most-watched list (for the explore slot to find).
    const superheroes = FILMS.filter((f) => sh(f.id)).filter((_, i) => i % 2).slice(0, 12).map((f) => f.id);
    const anime = FILMS.filter((f) => isAnime(f.id) && !sh(f.id)).filter((_, i) => i % 2).slice(0, 6).map((f) => f.id);
    const loved = [1003, 1021, 1039, 1057, 1075, 1093];
    for (const id of superheroes) await db.swipe.create({ data: { userId: c.id, movieId: id, verdict: "pass" } });
    for (const id of anime) await db.swipe.create({ data: { userId: c.id, movieId: id, verdict: "pass" } });
    for (const id of loved) await db.swipe.create({ data: { userId: c.id, movieId: id, verdict: "superlike", stars: 5 } });
  }

  await test("Learning: after many 'Not for me' superhero/anime films, Tonight barely shows them", async () => {
    const list = await suggest({ users: [c.id], genre: 0, filters: {}, limit: 15 });
    assert.ok(list.length >= 10, `only ${list.length}`);
    const bad = list.filter((s) => sh(s.movie.id) || isAnime(s.movie.id));
    assert.ok(bad.length <= 1, `${bad.length} superhero/anime films in the top 15: ${bad.map((s) => s.movie.title)}`);
    // Never "never": sunk far down, but not removed.
    const { loadTaste, combinedFactor } = await import("../lib/profile");
    const t = await loadTaste(c.id);
    const m = (await db.movie.findUnique({ where: { id: 1100 } }))!;
    const f = combinedFactor([t], m);
    assert.ok(f > 0 && f < 0.2, `superhero film factor ${f}`);
  });

  await test("Deck: about 3 'for you' cards to 1 'have you seen?', nothing answered comes back, explore 1 in 25", async () => {
    const { deckCards } = await import("../lib/deck");
    const kinds: Record<string, number> = {};
    const shown: number[] = [];
    const sunkShown: number[] = [];
    for (let round = 0; round < 5; round++) {
      const { cards } = await deckCards(c.id, 0, shown);
      assert.ok(cards.length > 0, `round ${round}: no cards`);
      for (const card of cards) {
        assert.ok(!shown.includes(card.id), `${card.title} came back`);
        kinds[card.kind ?? "?"] = (kinds[card.kind ?? "?"] ?? 0) + 1;
        shown.push(card.id);
        if (card.kind !== "explore" && (sh(card.id) || isAnime(card.id))) sunkShown.push(card.id);
      }
      // Answer them: unseen, so they're out of the deck.
      for (const card of cards) await db.swipe.create({ data: { userId: c.id, movieId: card.id, verdict: "unseen" } });
    }
    const total = shown.length;
    assert.ok((kinds.foryou ?? 0) >= total * 0.6, `for you ${kinds.foryou} of ${total} (${JSON.stringify(kinds)})`);
    assert.ok((kinds.seen ?? 0) >= total * 0.15, `have you seen ${kinds.seen} of ${total}`);
    assert.ok((kinds.explore ?? 0) >= 1 && (kinds.explore ?? 0) <= 3, `explore ${kinds.explore} in ${total}`);
    assert.ok(sunkShown.length <= 2, `${sunkShown.length} superhero/anime cards outside explore slots`);
  });

  await test("People you love: a director behind 3 of your 5★ films brings their other films", async () => {
    const d = await db.user.create({ data: { name: "P" } });
    const director = directorOf(1005);
    const theirs = FILMS.filter((f) => directorOf(f.id) === director).map((f) => f.id);
    for (const id of theirs.slice(0, 3)) await db.swipe.create({ data: { userId: d.id, movieId: id, verdict: "superlike", stars: 5 } });
    const { loadTaste } = await import("../lib/profile");
    const t = await loadTaste(d.id);
    assert.equal(t.lovedPeople[0]?.id, director, JSON.stringify(t.lovedPeople));
    assert.equal(t.lovedPeople[0]?.count, 3);
    const list = await suggest({ users: [d.id], genre: 0, filters: {}, limit: 20 });
    const fromThem = list.filter((s) => theirs.includes(s.movie.id));
    assert.ok(fromThem.length >= 2, `only ${fromThem.length} films by the loved director`);
    assert.ok(fromThem.some((s) => s.reason?.startsWith(`From Director ${director}, who made 3`)), fromThem.map((s) => s.reason).join(" | "));
  });

  await test("Vibe tags: Claude tags in batches, unknown tags dropped, never twice; no key → nothing", async () => {
    const { tagVibes, tagPending } = await import("../lib/vibes");
    assert.equal(await tagVibes([1301, 1302]), 0, "no key: should do nothing");
    Object.assign(process.env, { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: fake.url, CLAUDE_MONTHLY_CAP_USD: "1" });
    const calls = () => fake.calls.filter((x) => x === "/v1/messages").length;
    const before = calls();
    assert.equal(await tagVibes([1301, 1302]), 2);
    const rows = await db.movie.findMany({ where: { id: { in: [1301, 1302] } }, orderBy: { id: "asc" } });
    assert.deepEqual(rows[0].vibes, ["twisty", "tense"]);
    assert.deepEqual(rows[1].vibes, ["feel-good"]);
    await tagVibes([1301, 1302]);
    assert.equal(calls() - before, 1, "already-tagged films were sent again");
    const n = await tagPending(120);
    assert.ok(n > 50, `nightly job tagged ${n}`);
    assert.equal(calls() - before, 1 + Math.ceil(n / 50), "should send batches of 50");
    // Moods match on vibes: a "twisty" film counts as Mind-bending whatever its genres.
    const mind = await suggest({ users: [c.id], genre: 0, extraGenres: [878, 9648], mood: "mind", filters: {}, limit: 30, ai: false });
    assert.ok(mind.some((s) => !s.movie.genreIds.some((g) => [878, 9648].includes(g)) && s.movie.vibes.includes("twisty")), "no film came in through its vibes");
    process.env.ANTHROPIC_API_KEY = "";
  });

  fake.close();
  await db.$disconnect();
}

main()
  .catch((err) => {
    failures++;
    console.error(err);
  })
  .finally(() => {
    console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
    process.exit(failures ? 1 : 0);
  });
