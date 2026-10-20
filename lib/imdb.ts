// IMDb ratings straight from IMDb's own daily file (free, no key, no limit;
// personal non-commercial use: https://developer.imdb.com/non-commercial-datasets/).
// ~1.5 million lines, streamed and unzipped on the fly; only the films this
// app already holds are kept.
import { Prisma } from "@prisma/client";
import { db } from "./db";

const ratingsUrl = () => process.env.IMDB_RATINGS_URL ?? "https://datasets.imdbws.com/title.ratings.tsv.gz";
const BATCH = 500;

export type SyncResult = { held: number; matched: number; seconds: number };

// Parse one line of title.ratings.tsv: tconst \t averageRating \t numVotes.
export function parseRatingLine(line: string): { imdbId: string; rating: number; votes: number } | null {
  const [id, r, v] = line.split("\t");
  if (!id?.startsWith("tt")) return null; // header or junk
  const rating = Number(r);
  const votes = Number(v);
  if (!Number.isFinite(rating) || !Number.isFinite(votes)) return null;
  return { imdbId: id, rating, votes };
}

export async function syncImdbRatings(): Promise<SyncResult> {
  const started = Date.now();
  const held = new Map(
    (await db.movie.findMany({ where: { imdbId: { not: null } }, select: { id: true, imdbId: true } })).map((m) => [
      m.imdbId!,
      m.id,
    ]),
  );
  if (!held.size) return { held: 0, matched: 0, seconds: 0 };

  const res = await fetch(ratingsUrl(), { cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`IMDb ratings file → ${res.status}`);
  const text = res.body.pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream());

  const found: { id: number; rating: number; votes: number }[] = [];
  let rest = "";
  for await (const chunk of text as unknown as AsyncIterable<string>) {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      // Cheap pre-check before splitting: most of 1.5M lines aren't ours.
      const tab = line.indexOf("\t");
      if (tab < 0 || !held.has(line.slice(0, tab))) continue;
      const row = parseRatingLine(line);
      if (row) found.push({ id: held.get(row.imdbId)!, rating: row.rating, votes: row.votes });
    }
  }
  const last = parseRatingLine(rest);
  if (last && held.has(last.imdbId)) found.push({ id: held.get(last.imdbId)!, rating: last.rating, votes: last.votes });

  for (let i = 0; i < found.length; i += BATCH) {
    const rows = found.slice(i, i + BATCH).map((f) => Prisma.sql`(${f.id}::int, ${f.rating}::float8, ${f.votes}::int)`);
    await db.$executeRaw`
      UPDATE "Movie" AS m
      SET "imdbRating" = v.rating, "imdbVotes" = v.votes, "imdbAt" = NOW()
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, rating, votes)
      WHERE m.id = v.id`;
  }
  return { held: held.size, matched: found.length, seconds: Math.round((Date.now() - started) / 100) / 10 };
}
