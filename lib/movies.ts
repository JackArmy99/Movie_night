// Keeping Movie rows filled in. Everything here is lazy and cached: a film is
// only looked up when it is about to be shown, and only again when stale.
import type { Movie, Prisma } from "@prisma/client";
import { db } from "./db";
import { pmap } from "./pmap";
import * as tmdb from "./tmdb";
import { hasOmdb, omdbBatch } from "./omdb";

const DAY = 24 * 60 * 60 * 1000;
const PROVIDERS_TTL = 7 * DAY; // what's on Netflix changes weekly
const RATINGS_TTL = 30 * DAY;
const RECS_TTL = 60 * DAY;

const older = (d: Date | null, ttl: number) => !d || Date.now() - d.getTime() > ttl;

export function fromList(m: tmdb.TmdbListItem): Prisma.MovieCreateInput {
  const year = m.release_date ? Number(m.release_date.slice(0, 4)) : null;
  return {
    id: m.id,
    title: m.title,
    year: Number.isFinite(year) ? year : null,
    releaseDate: m.release_date || null,
    overview: m.overview ?? "",
    posterPath: m.poster_path ?? null,
    genreIds: m.genre_ids ?? [],
    popularity: m.popularity ?? 0,
    voteAverage: m.vote_average ?? 0,
    voteCount: m.vote_count ?? 0,
  };
}

// Store films seen in a TMDB list. Existing rows keep their richer data.
export async function saveList(items: tmdb.TmdbListItem[]): Promise<void> {
  if (!items.length) return;
  await db.movie.createMany({ data: items.map(fromList), skipDuplicates: true });
}

// Writes for a batch go to the database together: one round trip instead of
// one per film (each trip is slow when the server and database are far apart).
async function writeAll(updates: Prisma.PrismaPromise<unknown>[]) {
  if (updates.length) await db.$transaction(updates);
}

// Runtime, IMDb id, Dutch providers and Dutch cinema date.
export async function ensureDetails(ids: number[]): Promise<void> {
  if (!tmdb.hasTmdb() || !ids.length) return;
  const rows = await db.movie.findMany({
    where: { id: { in: ids } },
    select: { id: true, detailsAt: true, providersAt: true, trailerAt: true, keywordsAt: true },
  });
  // trailerAt / keywordsAt: films looked up before those existed get one more lookup.
  const stale = rows.filter(
    (r) => older(r.detailsAt, RATINGS_TTL) || older(r.providersAt, PROVIDERS_TTL) || !r.trailerAt || !r.keywordsAt,
  );
  const found = await pmap(stale, 8, ({ id }) => tmdb.details(id));
  const now = new Date();
  await writeAll(
    found.flatMap((d) => {
      if (!d) return [];
      const base = fromList(d);
      return [
        db.movie.update({
          where: { id: d.id },
          data: {
            title: base.title,
            year: base.year,
            releaseDate: base.releaseDate,
            overview: base.overview,
            posterPath: base.posterPath,
            genreIds: base.genreIds,
            runtime: d.runtime ?? null,
            imdbId: d.imdb_id ?? null,
            providers: d.providers as unknown as Prisma.InputJsonValue,
            nlRelease: d.nlRelease,
            trailerKey: d.trailerKey,
            trailerAt: now,
            keywordIds: d.keywordIds,
            keywordsAt: now,
            detailsAt: now,
            providersAt: now,
          },
        }),
      ];
    }),
  );
}

// IMDb / Rotten Tomatoes / Metacritic. Needs details first (for the IMDb id).
export async function ensureRatings(ids: number[]): Promise<void> {
  if (!hasOmdb() || !ids.length) return;
  const rows = await db.movie.findMany({
    where: { id: { in: ids }, imdbId: { not: null } },
    select: { id: true, imdbId: true, ratingsAt: true, imdbAt: true },
  });
  const stale = rows.filter((r) => older(r.ratingsAt, RATINGS_TTL));
  const results = await omdbBatch(stale.map((r) => r.imdbId!));
  const now = new Date();
  await writeAll(
    stale.flatMap(({ id, imdbId, imdbAt }) => {
      const r = results.get(imdbId!);
      if (!r) return []; // not looked up this time (no key / limit): try again later
      // OMDb has no entry: remember that, so it isn't asked again for a month.
      if (r === "missing") return [db.movie.update({ where: { id }, data: { ratingsAt: now } })];
      // IMDb's own daily file is the better IMDb source; OMDb only fills in
      // films it hasn't covered yet.
      const { imdbRating, imdbVotes, ...rest } = r;
      const fromFile = imdbAt && Date.now() - imdbAt.getTime() < 3 * DAY;
      return [
        db.movie.update({
          where: { id },
          data: { ...rest, ...(fromFile ? {} : { imdbRating, imdbVotes }), ratingsAt: now },
        }),
      ];
    }),
  );
}

// "People who liked X also liked…" lists for the films you rated.
export async function ensureRecs(ids: number[]): Promise<void> {
  if (!tmdb.hasTmdb() || !ids.length) return;
  const rows = await db.movie.findMany({
    where: { id: { in: ids } },
    select: { id: true, recsAt: true },
  });
  const stale = rows.filter((r) => older(r.recsAt, RECS_TTL));
  const lists = await pmap(stale, 8, async ({ id }) => ({ id, recs: await tmdb.recommendations(id) }));
  const done = lists.filter((l) => l !== undefined);
  await saveList(done.flatMap((l) => l.recs));
  const now = new Date();
  await writeAll(
    done.map((l) => db.movie.update({ where: { id: l.id }, data: { recIds: l.recs.map((r) => r.id), recsAt: now } })),
  );
}

export async function ensureMovie(id: number): Promise<Movie | null> {
  let movie = await db.movie.findUnique({ where: { id } });
  if (!movie && tmdb.hasTmdb()) {
    const d = await tmdb.details(id);
    await saveList([d]);
  }
  await ensureDetails([id]);
  await ensureRatings([id]);
  movie = await db.movie.findUnique({ where: { id } });
  return movie;
}

export function providersOf(m: Pick<Movie, "providers">): tmdb.Providers | null {
  return (m.providers as unknown as tmdb.Providers | null) ?? null;
}
