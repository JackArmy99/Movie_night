"use server";

import { db } from "@/lib/db";
import { me } from "@/lib/session";
import { saveList } from "@/lib/movies";
import * as tmdb from "@/lib/tmdb";
import { LbFilm, eloFor, verdictFor } from "@/lib/letterboxd";

// ---------- Letterboxd import ----------

export type ImportResult = { matched: number; missed: string[] };

// Called by the import screen in batches of ~20 films, so no single request
// runs long.
export async function importBatch(films: LbFilm[]): Promise<ImportResult> {
  const user = await me();
  const result: ImportResult = { matched: 0, missed: [] };
  if (!tmdb.hasTmdb()) return { matched: 0, missed: films.map((f) => f.name) };

  await Promise.all(
    films.slice(0, 40).map(async (f) => {
      try {
        const hit = await tmdb.search(f.name, f.year ?? undefined);
        if (!hit) {
          result.missed.push(`${f.name}${f.year ? ` (${f.year})` : ""}`);
          return;
        }
        await saveList([hit]);
        if (f.watched) {
          const verdict = verdictFor(f.rating, f.hearted);
          const existing = await db.swipe.findUnique({
            where: { userId_movieId: { userId: user.id, movieId: hit.id } },
          });
          // A swipe made in the app is newer and more deliberate; keep it.
          if (!existing || existing.source !== "swipe" || existing.verdict === "unseen" || existing.verdict === "pass") {
            await db.swipe.upsert({
              where: { userId_movieId: { userId: user.id, movieId: hit.id } },
              create: { userId: user.id, movieId: hit.id, verdict, stars: f.rating, elo: eloFor(f.rating, f.hearted), source: "letterboxd" },
              update: { verdict, stars: f.rating, elo: eloFor(f.rating, f.hearted), source: "letterboxd" },
            });
          }
        } else if (f.watchlist) {
          await db.watchlistItem.upsert({
            where: { userId_movieId: { userId: user.id, movieId: hit.id } },
            create: { userId: user.id, movieId: hit.id },
            update: {},
          });
        }
        result.matched++;
      } catch {
        result.missed.push(f.name);
      }
    }),
  );
  return result;
}

// "Similar to…" picker: find films by title.
export async function searchFilms(q: string): Promise<{ id: number; title: string; year: number | null; poster: string | null }[]> {
  await me();
  const query = q.trim().slice(0, 100);
  if (!query || !tmdb.hasTmdb()) return [];
  const hits = await tmdb.searchMany(query);
  await saveList(hits);
  return hits.slice(0, 6).map((h) => ({
    id: h.id,
    title: h.title,
    year: h.release_date ? Number(h.release_date.slice(0, 4)) : null,
    poster: tmdb.poster(h.poster_path, "w92"),
  }));
}
