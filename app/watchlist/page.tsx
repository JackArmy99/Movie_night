import Link from "next/link";
import { db } from "@/lib/db";
import { allUsers, me } from "@/lib/session";
import { getMyServices } from "@/lib/settings";
import { ensureDetails, ensureRatings } from "@/lib/movies";
import { Header, Nav } from "@/components/Nav";
import { MovieRow } from "@/components/MovieRow";
import { RateButtons } from "@/components/RateButtons";

export const dynamic = "force-dynamic";

// One shared list. Films you BOTH added float to the top.
export default async function Watchlist() {
  await me();
  const [items, users, mine] = await Promise.all([
    db.watchlistItem.findMany({ include: { movie: true }, orderBy: { addedAt: "desc" } }),
    allUsers(),
    getMyServices(),
  ]);
  const ids = [...new Set(items.map((i) => i.movieId))].slice(0, 40);
  await ensureDetails(ids);
  await ensureRatings(ids);
  const movies = new Map(
    (await db.movie.findMany({ where: { id: { in: items.map((i) => i.movieId) } } })).map((m) => [m.id, m]),
  );

  const byMovie = new Map<number, string[]>();
  for (const i of items) byMovie.set(i.movieId, [...(byMovie.get(i.movieId) ?? []), i.userId]);
  const rows = [...byMovie.entries()].sort((a, b) => b[1].length - a[1].length);
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "";

  return (
    <main className="pb-tabs space-y-3">
      <Header title="Watchlist" />
      {!rows.length && (
        <div className="card p-6 text-center text-gray-400">
          Empty. Tap <b>+ Watchlist</b> on any suggestion, or "📌 want to" while swiping.{" "}
          <Link href="/suggest" className="text-accent">Find films</Link>
        </div>
      )}
      {rows.map(([movieId, who]) => {
        const m = movies.get(movieId);
        if (!m) return null;
        const both = users.length > 1 && who.length >= users.length;
        return (
          <div key={movieId} className="space-y-1">
            <MovieRow
              m={m}
              mine={mine}
              onWatchlist
              note={both ? "💛 You both want to see this" : `Added by ${who.map(name).join(" & ")}`}
            />
            <details className="px-1">
              <summary className="cursor-pointer py-1 text-xs text-gray-400">✓ We watched it…</summary>
              <div className="mt-1">
                <RateButtons movieId={movieId} together />
              </div>
            </details>
          </div>
        );
      })}
      <Nav active="/watchlist" />
    </main>
  );
}
