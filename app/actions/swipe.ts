"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { me } from "@/lib/session";
import { deckCards, type Card, type DeckFilters } from "@/lib/deck";
import { eloUpdate } from "@/lib/elo";
import { eloFor } from "@/lib/letterboxd";
import { verdictForStars } from "@/lib/score";

// ---------- the swipe deck ----------


export async function nextCards(
  genre: number,
  skip: number[],
  f: DeckFilters = {},
): Promise<{ cards: Card[]; error?: string; done?: string }> {
  const user = await me();
  return deckCards(user.id, genre, skip, f);
}

// An answer without stars: "unseen" (haven't seen it), "pass" (not
// interested) or "seen" (seen it, no opinion).
export async function swipe(movieId: number, verdict: string) {
  if (!["unseen", "pass", "seen"].includes(verdict)) return;
  const user = await me();
  await db.swipe.upsert({
    where: { userId_movieId: { userId: user.id, movieId } },
    create: { userId: user.id, movieId, verdict, source: "swipe" },
    update: { verdict, stars: null, source: "swipe" },
  });
  // Not interested any more, or seen it: no longer belongs on your watchlist.
  if (verdict !== "unseen") await db.watchlistItem.deleteMany({ where: { userId: user.id, movieId } });
}

// Seen it, with 1–5 stars (half stars allowed).
export async function rateStars(movieId: number, stars: number) {
  if (!(stars >= 0.5 && stars <= 5)) return;
  const user = await me();
  const verdict = verdictForStars(stars);
  const key = { userId_movieId: { userId: user.id, movieId } };
  const existing = await db.swipe.findUnique({ where: key });
  // Keep a film's "this or that" ranking if it was already a super like.
  const elo = existing?.verdict === "superlike" && verdict === "superlike" ? existing.elo : eloFor(stars);
  await db.swipe.upsert({
    where: key,
    create: { userId: user.id, movieId, verdict, stars, elo, source: "swipe" },
    update: { verdict, stars, elo, source: "swipe" },
  });
  await db.watchlistItem.deleteMany({ where: { userId: user.id, movieId } });
}

export async function undoSwipe(movieId: number) {
  const user = await me();
  await db.swipe.deleteMany({ where: { userId: user.id, movieId } });
}

// Rate a film from its own page: stars, or "unseen".
export async function rate(movieId: number, answer: number | "unseen") {
  if (answer === "unseen") await swipe(movieId, "unseen");
  else await rateStars(movieId, answer);
  revalidatePath(`/movie/${movieId}`);
}

// The "To decide" pile: want to see it (→ watchlist) or not interested.
export async function decide(movieId: number, want: boolean) {
  const user = await me();
  if (want) {
    await db.watchlistItem.upsert({
      where: { userId_movieId: { userId: user.id, movieId } },
      create: { userId: user.id, movieId },
      update: {},
    });
  } else {
    await swipe(movieId, "pass");
  }
  revalidatePath("/watchlist");
}

// ---------- "this or that" ----------

export async function pickWinner(winner: number, loser: number) {
  const user = await me();
  const rows = await db.swipe.findMany({
    where: { userId: user.id, movieId: { in: [winner, loser] }, verdict: "superlike" },
  });
  const w = rows.find((r) => r.movieId === winner);
  const l = rows.find((r) => r.movieId === loser);
  if (!w || !l) return;
  const [we, le] = eloUpdate(w.elo, l.elo);
  await db.$transaction([
    db.swipe.update({
      where: { userId_movieId: { userId: user.id, movieId: winner } },
      data: { elo: we, comparisons: { increment: 1 } },
    }),
    db.swipe.update({
      where: { userId_movieId: { userId: user.id, movieId: loser } },
      data: { elo: le, comparisons: { increment: 1 } },
    }),
  ]);
  revalidatePath("/rank");
}

// ---------- Tonight's cards: swipe left = not for me, right = watchlist ----------

// No revalidatePath here: refreshing Tonight would remove the card before
// its Undo bar could show (the watchlist page is always rendered fresh).
export type TonightUndo = { verdict: string | null; stars: number | null; elo: number | null; listed: boolean };

export async function tonightSwipe(movieId: number, dir: "bin" | "watch"): Promise<TonightUndo> {
  const user = await me();
  const key = { userId_movieId: { userId: user.id, movieId } };
  const [prev, listed] = await Promise.all([db.swipe.findUnique({ where: key }), db.watchlistItem.findUnique({ where: key })]);
  const undo: TonightUndo = { verdict: prev?.verdict ?? null, stars: prev?.stars ?? null, elo: prev?.elo ?? null, listed: Boolean(listed) };
  if (dir === "bin") await swipe(movieId, "pass");
  else if (!listed) await db.watchlistItem.create({ data: { userId: user.id, movieId } });
  return undo;
}

// Put things back exactly as they were before the swipe.
export async function undoTonightSwipe(movieId: number, undo: TonightUndo) {
  const user = await me();
  const key = { userId_movieId: { userId: user.id, movieId } };
  if (undo.verdict) {
    const data = { verdict: undo.verdict, stars: undo.stars, ...(undo.elo != null ? { elo: undo.elo } : {}) };
    await db.swipe.upsert({ where: key, create: { userId: user.id, movieId, source: "swipe", ...data }, update: data });
  } else await db.swipe.deleteMany({ where: { userId: user.id, movieId } });
  if (undo.listed) await db.watchlistItem.upsert({ where: key, create: { userId: user.id, movieId }, update: {} });
  else await db.watchlistItem.deleteMany({ where: { userId: user.id, movieId } });
}
