// Keeping Movie rows filled in. Everything here is lazy and cached: a film is
// only looked up when it is about to be shown, and only again when stale.
import type { Movie, Prisma } from "@prisma/client";
import { db } from "./db";
import { pmap } from "./pmap";
import * as tmdb from "./tmdb";
import { hasOmdb, omdbRatings } from "./omdb";

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

// Runtime, IMDb id, Dutch providers and Dutch cinema date.
export async function ensureDetails(ids: number[]): Promise<void> {
  if (!tmdb.hasTmdb() || !ids.length) return;
  const rows = await db.movie.findMany({
    where: { id: { in: ids } },
    select: { id: true, detailsAt: true, providersAt: true },
  });
  const stale = rows.filter((r) => older(r.detailsAt, RATINGS_TTL) || older(r.providersAt, PROVIDERS_TTL));
  await pmap(stale, 8, async ({ id }) => {
    const d = await tmdb.details(id);
    const base = fromList(d);
    await db.movie.update({
      where: { id },
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
        detailsAt: new Date(),
        providersAt: new Date(),
      },
    });
  });
}

// IMDb / Rotten Tomatoes / Metacritic. Needs details first (for the IMDb id).
export async function ensureRatings(ids: number[]): Promise<void> {
  if (!hasOmdb() || !ids.length) return;
  const rows = await db.movie.findMany({
    where: { id: { in: ids }, imdbId: { not: null } },
    select: { id: true, imdbId: true, ratingsAt: true },
  });
  const stale = rows.filter((r) => older(r.ratingsAt, RATINGS_TTL));
  await pmap(stale, 6, async ({ id, imdbId }) => {
    const r = await omdbRatings(imdbId!);
    if (!r) return;
    await db.movie.update({ where: { id }, data: { ...r, ratingsAt: new Date() } });
  });
}

// "People who liked X also liked…" lists for the films you rated.
export async function ensureRecs(ids: number[]): Promise<void> {
  if (!tmdb.hasTmdb() || !ids.length) return;
  const rows = await db.movie.findMany({
    where: { id: { in: ids } },
    select: { id: true, recsAt: true },
  });
  const stale = rows.filter((r) => older(r.recsAt, RECS_TTL));
  await pmap(stale, 8, async ({ id }) => {
    const recs = await tmdb.recommendations(id);
    await saveList(recs);
    await db.movie.update({
      where: { id },
      data: { recIds: recs.map((r) => r.id), recsAt: new Date() },
    });
  });
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
