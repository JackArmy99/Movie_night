import Link from "next/link";
import { db } from "@/lib/db";
import { me } from "@/lib/session";
import { GENRES } from "@/lib/genres";
import { SEEN } from "@/lib/score";
import { Header, Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function SwipeGenres() {
  const user = await me();
  const swipes = await db.swipe.findMany({
    where: { userId: user.id },
    select: { verdict: true, movie: { select: { genreIds: true } } },
  });
  const seenIn = (g: number) => swipes.filter((s) => SEEN.has(s.verdict) && (!g || s.movie.genreIds.includes(g))).length;

  return (
    <main className="pb-tabs">
      <Header title="Swipe" />
      <p className="mb-4 text-sm text-gray-400">
        The most-watched films come first: the ones you've most likely seen. Swipe <b>right</b> liked, <b>left</b>{" "}
        didn't, <b>up</b> loved it, <b>down</b> haven't seen.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[{ id: 0, name: "All genres" }, ...GENRES].map((g) => (
          <Link key={g.id} href={`/swipe/${g.id}`} className="card flex items-center justify-between p-4">
            <span className="font-semibold">{g.name}</span>
            <span className="text-xs text-gray-400">{seenIn(g.id)} seen</span>
          </Link>
        ))}
      </div>
      <Nav active="/swipe" />
    </main>
  );
}
