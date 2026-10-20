import Link from "next/link";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { me } from "@/lib/session";
import { matchingIds, upcomingDutch } from "@/lib/calendar";
import { calendarKey } from "@/lib/token";
import { poster } from "@/lib/tmdb";
import { Header, Nav } from "@/components/Nav";
import { WatchButton } from "@/components/WatchButton";
import { CopyLink } from "@/components/CopyLink";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Calendar({ searchParams }: { searchParams: { f?: string } }) {
  const user = await me();
  const movies = await upcomingDutch();
  const ids = movies.map((m) => m.id);
  const [matches, watch] = await Promise.all([
    matchingIds(ids),
    db.watchlistItem.findMany({ where: { movieId: { in: ids }, userId: user.id }, select: { movieId: true } }),
  ]);
  const saved = new Set(watch.map((w) => w.movieId));
  const picksOnly = searchParams.f === "picks";
  const shown = movies.filter((m) => !picksOnly || matches.has(m.id) || saved.has(m.id));

  const host = headers().get("host") ?? "";
  const key = await calendarKey();
  const feed = (f?: string) => `https://${host}/api/calendar?key=${key}${f ? `&f=${f}` : ""}`;

  const months = new Map<string, typeof shown>();
  for (const m of shown) {
    const label = new Date(m.nlRelease!).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    months.set(label, [...(months.get(label) ?? []), m]);
  }

  return (
    <main className="pb-tabs space-y-4">
      <Header title="In Dutch cinemas" />
      <div className="flex gap-2">
        <Link href="/calendar" className={picksOnly ? "chip" : "chip-on"}>Everything</Link>
        <Link href="/calendar?f=picks" className={picksOnly ? "chip-on" : "chip"}>✨ Our kind of film</Link>
      </div>

      {!shown.length && <div className="card p-6 text-center text-gray-400">No releases found yet.</div>}
      {[...months.entries()].map(([month, list]) => (
        <section key={month} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{month}</h2>
          {list.map((m) => (
            <div key={m.id} className="card flex items-center gap-3 p-2">
              <div className="w-10 text-center">
                <div className="text-lg font-bold">{new Date(m.nlRelease!).getDate()}</div>
                <div className="text-[10px] uppercase text-gray-400">
                  {new Date(m.nlRelease!).toLocaleDateString("en-GB", { weekday: "short" })}
                </div>
              </div>
              {poster(m.posterPath, "w92") ? (
                <img src={poster(m.posterPath, "w92")!} alt="" className="h-16 w-11 rounded object-cover" />
              ) : (
                <div className="h-16 w-11 rounded bg-line" />
              )}
              <Link href={`/movie/${m.id}`} className="min-w-0 flex-1">
                <div className="truncate font-semibold">{m.title}</div>
                {matches.has(m.id) && <div className="text-xs text-accent">✨ Looks like your kind of film</div>}
              </Link>
              <WatchButton movieId={m.id} initial={saved.has(m.id)} />
            </div>
          ))}
        </section>
      ))}

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">📅 Put this in your phone's calendar</h2>
        <p className="text-sm text-gray-400">
          Subscribe once; new releases appear by themselves. On iPhone, tap a link below, then <b>Subscribe</b>. For Google
          Calendar, copy the link and add it on a computer at calendar.google.com → Other calendars → <b>From URL</b>.
        </p>
        <div className="space-y-2">
          <a href={feed("picks").replace("https://", "webcal://")} className="btn-primary w-full text-sm">
            Subscribe: our kind of film + watchlist
          </a>
          <a href={feed().replace("https://", "webcal://")} className="btn-ghost w-full text-sm">
            Subscribe: every Dutch release
          </a>
          <CopyLink url={feed("picks")} />
        </div>
      </section>
      <Nav active="/calendar" />
    </main>
  );
}
