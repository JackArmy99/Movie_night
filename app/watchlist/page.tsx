import Link from "next/link";
import { db } from "@/lib/db";
import { allUsers, me } from "@/lib/session";
import { getMyServices } from "@/lib/settings";
import { ensureDetails, ensureRatings } from "@/lib/movies";
import { Header, Nav } from "@/components/Nav";
import { MovieRow, Scores } from "@/components/MovieRow";
import { DecideCard } from "@/components/DecideCard";
import { pileCount, pileWhere } from "@/lib/pile";
import { RateButtons } from "@/components/RateButtons";

export const dynamic = "force-dynamic";

const PAGE = 10;

// "To decide" pile first (mine), then one shared watchlist. Films you BOTH
// added float to the top.
export default async function Watchlist({ searchParams }: { searchParams: { pile?: string } }) {
  const user = await me();
  const pileSize = Math.min(200, Math.max(PAGE, Number(searchParams.pile) || PAGE));
  const [pile, pileTotal] = await Promise.all([
    db.swipe.findMany({ where: pileWhere(user.id), orderBy: { updatedAt: "desc" }, take: pileSize, select: { movieId: true } }),
    pileCount(user.id),
  ]);
  const pileIds = pile.map((p) => p.movieId);
  await ensureDetails(pileIds);
  await ensureRatings(pileIds);
  const pileMovies = new Map((await db.movie.findMany({ where: { id: { in: pileIds } } })).map((m) => [m.id, m]));

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
      {pileTotal > 0 && (
        <section className="space-y-3 pb-3">
          <div>
            <h2 className="text-lg font-semibold">To decide ({pileTotal})</h2>
            <p className="text-sm text-gray-400">Films you haven't seen. Watch the trailer, then keep or drop it.</p>
          </div>
          {pileIds.map((id) => {
            const m = pileMovies.get(id);
            return m ? (
              <DecideCard key={id} movieId={id} title={m.title} year={m.year} trailerKey={m.trailerKey} scores={<Scores m={m} />} />
            ) : null;
          })}
          {pileTotal > pileIds.length && (
            <Link href={`/watchlist?pile=${pileSize + PAGE}`} scroll={false} className="btn-ghost w-full text-sm">
              Show {Math.min(PAGE, pileTotal - pileIds.length)} more
            </Link>
          )}
          <h2 className="pt-3 text-lg font-semibold">Watchlist</h2>
        </section>
      )}
      {!rows.length && (
        <div className="card p-6 text-center text-gray-400">
          Empty. Tap <b>+ Watchlist</b> on any suggestion, or swipe down on films you haven't seen and pick them here.{" "}
          <Link href="/tonight" className="text-accent">Find films</Link>
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
