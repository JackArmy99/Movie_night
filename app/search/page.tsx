import Link from "next/link";
import { db } from "@/lib/db";
import { me } from "@/lib/session";
import { saveList } from "@/lib/movies";
import { hasTmdb, poster, searchMany } from "@/lib/tmdb";
import { Header, Nav } from "@/components/Nav";
import { RateButtons } from "@/components/RateButtons";
import { WatchButton } from "@/components/WatchButton";

export const dynamic = "force-dynamic";

// Look up any film — say one you just saw at the cinema — and give it stars,
// so it counts towards your suggestions straight away.
export default async function Search({ searchParams }: { searchParams: { q?: string } }) {
  const user = await me();
  const q = (searchParams.q ?? "").trim().slice(0, 100);

  let ids: number[] = [];
  let failed = false;
  if (q && hasTmdb()) {
    try {
      const hits = await searchMany(q);
      await saveList(hits);
      ids = hits.slice(0, 15).map((h) => h.id);
    } catch {
      failed = true;
    }
  }
  const [found, recent, mySwipes, myWatch] = await Promise.all([
    db.movie.findMany({ where: { id: { in: ids } } }),
    q
      ? Promise.resolve([])
      : db.swipe.findMany({
          where: { userId: user.id, stars: { not: null } },
          orderBy: { updatedAt: "desc" },
          take: 10,
          include: { movie: true },
        }),
    db.swipe.findMany({ where: { userId: user.id, movieId: { in: ids } } }),
    db.watchlistItem.findMany({ where: { userId: user.id, movieId: { in: ids } } }),
  ]);
  // Keep TMDB's order (best match first).
  const results = ids.map((id) => found.find((m) => m.id === id)).filter((m) => m !== undefined);
  const swipeOf = new Map(mySwipes.map((s) => [s.movieId, s]));
  const listed = new Set(myWatch.map((w) => w.movieId));

  return (
    <main className="pb-tabs space-y-4">
      <Header title="Search" />
      <form action="/search" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          autoFocus={!q}
          enterKeyHint="search"
          placeholder="Film title, e.g. Dune"
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-3 text-base"
        />
        <button className="btn-primary px-4">Search</button>
      </form>

      {failed && <p className="text-sm text-red-400">TMDB didn't answer. Try again in a moment.</p>}
      {q && !failed && !results.length && <p className="text-sm text-gray-400">Nothing found for “{q}”.</p>}

      {results.map((m) => {
        const s = swipeOf.get(m.id);
        return (
          <div key={m.id} className="card flex gap-3 p-3">
            <Link href={`/movie/${m.id}`} className="shrink-0">
              {poster(m.posterPath, "w185") ? (
                <img src={poster(m.posterPath, "w185")!} alt="" className="h-28 w-[4.7rem] rounded-lg object-cover" />
              ) : (
                <div className="h-28 w-[4.7rem] rounded-lg bg-line" />
              )}
            </Link>
            <div className="min-w-0 flex-1 space-y-2">
              <Link href={`/movie/${m.id}`} className="block font-semibold leading-tight">
                {m.title} <span className="font-normal text-gray-400">{m.year ?? ""}</span>
              </Link>
              <RateButtons movieId={m.id} initialStars={s?.stars} initialUnseen={s?.verdict === "unseen"} />
              <WatchButton movieId={m.id} initial={listed.has(m.id)} />
            </div>
          </div>
        );
      })}

      {!q && (
        <section className="space-y-2">
          <p className="text-sm text-gray-400">
            Seen something at the cinema or at a friend's? Search it and give it stars; it counts towards your
            suggestions right away.
          </p>
          {recent.length > 0 && (
            <>
              <h2 className="pt-2 font-semibold">Your latest ratings</h2>
              <ul className="card divide-y divide-line">
                {recent.map((r) => (
                  <li key={r.movieId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <Link href={`/movie/${r.movieId}`} className="truncate">
                      {r.movie.title}
                    </Link>
                    <span className="shrink-0 text-accent">
                      {"★".repeat(Math.floor(r.stars ?? 0))}
                      {(r.stars ?? 0) % 1 ? "½" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <Nav active="/search" />
    </main>
  );
}
