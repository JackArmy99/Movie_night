import Link from "next/link";
import { db } from "@/lib/db";
import { me } from "@/lib/session";
import { nextPair } from "@/lib/elo";
import { poster } from "@/lib/tmdb";
import { pickWinner } from "../actions";
import { Header, Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

// "This or that" between two of your super likes. Each tap sharpens which
// favourites count most when picking suggestions.
export default async function Rank() {
  const user = await me();
  const loved = await db.swipe.findMany({
    where: { userId: user.id, verdict: "superlike" },
    include: { movie: true },
  });
  const pair = nextPair(loved);
  const top = [...loved].sort((a, b) => b.elo - a.elo).slice(0, 10);
  const total = loved.reduce((n, l) => n + l.comparisons, 0) / 2;

  return (
    <main className="pb-tabs space-y-5">
      <Header title="This or that" back="/" />
      {!pair ? (
        <div className="card p-6 text-center text-gray-400">
          Super like at least two films (swipe up) and they'll appear here to rank.{" "}
          <Link href="/swipe" className="text-accent">
            Go swipe
          </Link>
        </div>
      ) : (
        <>
          <p className="text-center text-gray-400">Which do you love more?</p>
          <div className="grid grid-cols-2 gap-3">
            {[pair, [pair[1], pair[0]] as const].map(([a, b]) => (
              <form key={a.movieId} action={pickWinner.bind(null, a.movieId, b.movieId)}>
                <button className="card w-full overflow-hidden text-left active:scale-[0.98] transition">
                  {poster(a.movie.posterPath) ? (
                    <img src={poster(a.movie.posterPath)!} alt="" className="aspect-[2/3] w-full object-cover" />
                  ) : (
                    <div className="aspect-[2/3] w-full bg-line" />
                  )}
                  <div className="p-2 text-sm font-semibold">{a.movie.title}</div>
                </button>
              </form>
            ))}
          </div>
          <p className="text-center text-xs text-gray-500">{Math.round(total)} picks so far · 20–30 is plenty to start</p>
        </>
      )}
      {top.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Your top {top.length}</h2>
          <ol className="card divide-y divide-line">
            {top.map((t, i) => (
              <li key={t.movieId} className="flex gap-3 px-4 py-2 text-sm">
                <span className="w-5 text-gray-500">{i + 1}</span>
                <Link href={`/movie/${t.movieId}`}>{t.movie.title}</Link>
              </li>
            ))}
          </ol>
        </section>
      )}
      <Nav />
    </main>
  );
}
