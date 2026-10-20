// Free test gate: no network, no API keys, no cost. Pure logic first, then
// the suggestion engine end to end against a fake TMDB and a throwaway
// Postgres database. Run with `npm test` (needs DATABASE_URL pointing at a
// database it may wipe — it refuses anything not named like a test DB).
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { parseCsv } from "../lib/csv";
import { mergeExport, verdictFor, eloFor } from "../lib/letterboxd";
import { eloUpdate, nextPair } from "../lib/elo";
import { passes, parseFilters, qualityFactor, scoreCandidates, seedWeight } from "../lib/score";
import { toIcs } from "../lib/ics";
import { startFake, FILMS, recsFor } from "./fake-tmdb";

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
