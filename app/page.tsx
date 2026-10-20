import Link from "next/link";
import { db } from "@/lib/db";
import { me, partnerOf } from "@/lib/session";
import { hasTmdb } from "@/lib/tmdb";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

async function counts(userId: string) {
  const rows = await db.swipe.groupBy({ by: ["verdict"], where: { userId }, _count: true });
  const n = (v: string) => rows.find((r) => r.verdict === v)?._count ?? 0;
  return { seen: n("superlike") + n("like") + n("dislike") + n("seen"), loved: n("superlike"), unseen: n("unseen") };
}

export default async function Home() {
  const user = await me();
  const partner = await partnerOf(user);
  const [mine, theirs, watchlist] = await Promise.all([
    counts(user.id),
    partner ? counts(partner.id) : null,
    db.watchlistItem.findMany({ distinct: ["movieId"], select: { movieId: true } }),
  ]);

  return (
    <main className="pb-tabs space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          Hi {user.name} <span className="text-accent">★</span>
        </h1>
        <Link href="/settings" className="text-2xl" aria-label="Settings">
          ⚙️
        </Link>
      </header>

      {!hasTmdb() && (
        <div className="card border-red-500/50 p-4 text-sm">
          TMDB isn't connected yet, so there are no films to show. Add <code>TMDB_TOKEN</code> in the hosting settings.
        </div>
      )}

      <section className="grid grid-cols-2 gap-3">
        {[{ name: user.name, c: mine }, ...(partner && theirs ? [{ name: partner.name, c: theirs }] : [])].map((p) => (
          <div key={p.name} className="card p-4">
            <div className="text-sm text-gray-400">{p.name}</div>
            <div className="text-3xl font-bold">{p.c.seen}</div>
            <div className="text-xs text-gray-400">films seen · {p.c.loved} at 4½–5★</div>
          </div>
        ))}
      </section>

      {mine.seen < 50 && (
        <Link href="/swipe" className="card block border-accent/60 p-4">
          <div className="font-semibold">Start here: swipe through films 🃏</div>
          <p className="mt-1 text-sm text-gray-400">
            The more you've marked, the fewer suggestions you've already seen. A few hundred swipes takes about 20
            minutes. Or import Letterboxd in ⚙️ Settings.
          </p>
        </Link>
      )}

      <section className="grid grid-cols-2 gap-3">
        <Tile href="/tonight" icon="🍿" title="Tonight" sub="Suggestions, moods & filters" />
        <Tile href="/search" icon="🔍" title="Search & rate" sub="Seen one at the cinema?" />
        <Tile href="/rank" icon="⚖️" title="This or that" sub={`Rank your ${mine.loved} favourites`} />
        <Tile href="/watchlist" icon="📌" title="Watchlist" sub={`${watchlist.length} films`} />
        <Tile href="/calendar" icon="📅" title="In cinemas" sub="Dutch release dates" />
        <Tile href="/swipe" icon="🃏" title="Swipe" sub="Mark what you've seen" />
      </section>
      <Nav />
    </main>
  );
}

function Tile({ href, icon, title, sub }: { href: string; icon: string; title: string; sub: string }) {
  return (
    <Link href={href} className="card p-4 active:scale-[0.98] transition">
      <div className="text-2xl">{icon}</div>
      <div className="mt-1 font-semibold">{title}</div>
      <div className="text-xs text-gray-400">{sub}</div>
    </Link>
  );
}
