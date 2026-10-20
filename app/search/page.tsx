import Link from "next/link";
import { db } from "@/lib/db";
import { me } from "@/lib/session";
import { saveList } from "@/lib/movies";
import { hasTmdb, poster, searchMany } from "@/lib/tmdb";
import { Header, Nav } from "@/components/Nav";
import { RateButtons } from "@/components/RateButtons";
import { WatchButton } from "@/components/WatchButton";
import { RatedGrid } from "@/components/RatedGrid";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const PAGE = 36;

// The grid's filters: what you rated (by star level), seen without stars, or
// "not for me". Star levels round to the nearest whole star.
const SHOWS = [
  { key: "rated", label: "Rated", where: { stars: { not: null } } },
  { key: "5", label: "★5", where: { stars: { gte: 4.5 } } },
  { key: "4", label: "★4", where: { stars: { gte: 3.5, lt: 4.5 } } },
  { key: "3", label: "★3", where: { stars: { gte: 2.5, lt: 3.5 } } },
  { key: "2", label: "★2 or less", where: { stars: { lt: 2.5 } } },
  { key: "seen", label: "Seen, no stars", where: { verdict: "seen", stars: null } },
  { key: "pass", label: "🚫 Not for me", where: { verdict: "pass" } },
] satisfies { key: string; label: string; where: Prisma.SwipeWhereInput }[];

const SORTS = [
  { key: "recent", label: "Recent", orderBy: [{ updatedAt: "desc" }] },
  { key: "high", label: "Highest", orderBy: [{ stars: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }] },
  { key: "low", label: "Lowest", orderBy: [{ stars: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }] },
  { key: "az", label: "A–Z", orderBy: [{ movie: { title: "asc" } }] },
] satisfies { key: string; label: string; orderBy: Prisma.SwipeOrderByWithRelationInput[] }[];

type SP = { q?: string; show?: string; sort?: string; n?: string };

// Search to rate any film (say one you just saw at the cinema), and below it
// every film you've rated, as a poster grid you can filter, sort and re-rate.
export default async function Search({ searchParams }: { searchParams: SP }) {
  const user = await me();
  const q = (searchParams.q ?? "").trim().slice(0, 100);
  const show = SHOWS.find((x) => x.key === searchParams.show) ?? SHOWS[0];
  const sort = SORTS.find((x) => x.key === searchParams.sort) ?? SORTS[0];
  const n = Math.min(500, Math.max(PAGE, Number(searchParams.n) || PAGE));
  const link = (patch: Partial<SP>) => {
    const next = { q: q || undefined, show: show.key === "rated" ? undefined : show.key, sort: sort.key === "recent" ? undefined : sort.key, ...patch };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
    return `/search${qs ? `?${qs}` : ""}`;
  };

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
  const titleMatch: Prisma.SwipeWhereInput = q ? { movie: { title: { contains: q, mode: "insensitive" } } } : {};
  const [found, gridRows, all, mySwipes, myWatch] = await Promise.all([
    db.movie.findMany({ where: { id: { in: ids } } }),
    db.swipe.findMany({
      where: { userId: user.id, ...show.where, ...titleMatch },
      orderBy: sort.orderBy,
      take: n + 1,
      select: { movieId: true, stars: true, verdict: true, movie: { select: { title: true, year: true, posterPath: true } } },
    }),
    // For the counts on the chips.
    db.swipe.findMany({ where: { userId: user.id, ...titleMatch }, select: { stars: true, verdict: true } }),
    db.swipe.findMany({ where: { userId: user.id, movieId: { in: ids } } }),
    db.watchlistItem.findMany({ where: { userId: user.id, movieId: { in: ids } } }),
  ]);
  const count = (key: string) =>
    all.filter((r) => {
      const st = r.stars;
      switch (key) {
        case "rated": return st != null;
        case "5": return st != null && st >= 4.5;
        case "4": return st != null && st >= 3.5 && st < 4.5;
        case "3": return st != null && st >= 2.5 && st < 3.5;
        case "2": return st != null && st < 2.5;
        case "seen": return r.verdict === "seen" && st == null;
        case "pass": return r.verdict === "pass";
        default: return false;
      }
    }).length;
  const more = gridRows.length > n;
  const films = gridRows.slice(0, n).map((r) => ({
    id: r.movieId,
    title: r.movie.title,
    year: r.movie.year,
    poster: poster(r.movie.posterPath, "w185"),
    stars: r.stars,
    verdict: r.verdict,
  }));
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
          enterKeyHint="search"
          placeholder="Find a film to rate, e.g. Dune"
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

      <section className="space-y-3 pt-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{q ? `Your films matching “${q}”` : "Your films"}</h2>
          <span className="text-xs text-gray-500">hold a poster to change its stars</span>
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {SHOWS.map((x) => (
            <Link key={x.key} href={link({ show: x.key === "rated" ? undefined : x.key })} className={`${x.key === show.key ? "chip-on" : "chip"} shrink-0 whitespace-nowrap`}>
              {x.label} <span className="opacity-60">{count(x.key)}</span>
            </Link>
          ))}
        </div>
        <div className="flex gap-3 text-xs">
          {SORTS.map((x) => (
            <Link key={x.key} href={link({ sort: x.key === "recent" ? undefined : x.key })} className={x.key === sort.key ? "font-semibold text-accent" : "text-gray-400"}>
              {x.label}
            </Link>
          ))}
        </div>
        <RatedGrid films={films} />
        {more && (
          <Link href={link({ n: String(n + PAGE) })} scroll={false} className="btn-ghost w-full text-sm">
            Show more
          </Link>
        )}
      </section>
      <Nav active="/search" />
    </main>
  );
}
