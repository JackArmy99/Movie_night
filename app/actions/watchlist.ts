"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { me, partnerOf } from "@/lib/session";
import { saveList } from "@/lib/movies";
import * as tmdb from "@/lib/tmdb";
import { rateStars, swipe } from "./swipe";

// ---------- watchlist ----------

export async function toggleWatchlist(movieId: number): Promise<boolean> {
  const user = await me();
  const key = { userId_movieId: { userId: user.id, movieId } };
  const existing = await db.watchlistItem.findUnique({ where: key });
  if (existing) await db.watchlistItem.delete({ where: key });
  else {
    if (!(await db.movie.findUnique({ where: { id: movieId } })) && tmdb.hasTmdb()) {
      await saveList([await tmdb.details(movieId)]);
    }
    await db.watchlistItem.create({ data: { userId: user.id, movieId } });
  }
  revalidatePath("/watchlist");
  return !existing;
}

// "We watched it": my verdict, off both watchlists, and counted as seen for
// my partner until they rate it themselves.
// "We watched it": my stars, off both watchlists, and counted as seen for
// my partner until they rate it themselves.
export async function watchedTogether(movieId: number, stars: number) {
  const user = await me();
  await rateStars(movieId, stars);
  const partner = await partnerOf(user);
  if (partner) {
    await db.swipe.upsert({
      where: { userId_movieId: { userId: partner.id, movieId } },
      create: { userId: partner.id, movieId, verdict: "seen", source: "watchlist" },
      // Only overwrite "hadn't seen it" — never a rating they already gave.
      update: {},
    });
    await db.swipe.updateMany({
      where: { userId: partner.id, movieId, verdict: { in: ["unseen", "pass"] } },
      data: { verdict: "seen", source: "watchlist" },
    });
  }
  await db.watchlistItem.deleteMany({ where: { movieId } });
  revalidatePath("/watchlist");
}
