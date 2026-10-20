import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Everything you've told the app, as one JSON file. Behind the passcode like
// every other page (the middleware covers /api/export).
export async function GET() {
  const [users, swipes, watchlist] = await Promise.all([
    db.user.findMany(),
    db.swipe.findMany({ include: { movie: { select: { title: true, year: true, imdbId: true } } } }),
    db.watchlistItem.findMany({ include: { movie: { select: { title: true, year: true } } } }),
  ]);
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const body = {
    exportedAt: new Date().toISOString(),
    people: users.map((u) => u.name),
    swipes: swipes.map((s) => ({
      person: name(s.userId),
      tmdbId: s.movieId,
      imdbId: s.movie.imdbId,
      title: s.movie.title,
      year: s.movie.year,
      verdict: s.verdict,
      stars: s.stars,
      rankScore: Math.round(s.elo),
      source: s.source,
      at: s.updatedAt,
    })),
    watchlist: watchlist.map((w) => ({ person: name(w.userId), tmdbId: w.movieId, title: w.movie.title, year: w.movie.year })),
  };
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="movie-night-backup-${date}.json"`,
    },
  });
}
