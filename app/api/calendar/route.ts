import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { calendarKey } from "@/lib/token";
import { matchingIds, upcomingDutch } from "@/lib/calendar";
import { toIcs } from "@/lib/ics";
import { trailerUrl } from "@/lib/tmdb";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The calendar feed your phone subscribes to. It can't sign in, so the link
// carries its own key instead. ?f=picks keeps only your matches + watchlist.
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== (await calendarKey())) {
    return new Response("Not found", { status: 404 });
  }
  const picksOnly = req.nextUrl.searchParams.get("f") === "picks";
  const movies = await upcomingDutch();
  const ids = movies.map((m) => m.id);
  const [matches, watch] = await Promise.all([
    matchingIds(ids),
    db.watchlistItem.findMany({ where: { movieId: { in: ids } }, select: { movieId: true } }),
  ]);
  const saved = new Set(watch.map((w) => w.movieId));
  const origin = req.nextUrl.origin;

  const events = movies
    .filter((m) => !picksOnly || matches.has(m.id) || saved.has(m.id))
    .map((m) => ({
      uid: `nl-${m.id}@movie-night`,
      date: m.nlRelease!,
      title: `🎬 ${m.title}${saved.has(m.id) ? " 📌" : matches.has(m.id) ? " ✨" : ""}`,
      description:
        `${m.overview}\n\nIn Dutch cinemas from today.` +
        (m.trailerKey ? `\n\nTrailer: ${trailerUrl(m.trailerKey)}` : ""),
      url: `${origin}/movie/${m.id}`,
    }));

  return new Response(toIcs(picksOnly ? "Movie Night — our picks" : "Movie Night — NL cinema", events), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
