import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { me, partnerOf } from "@/lib/session";
import { ensureMovie, providersOf } from "@/lib/movies";
import { poster, IMG, Provider } from "@/lib/tmdb";
import { genreName } from "@/lib/genres";
import { getMyServices } from "@/lib/settings";
import { Header, Nav } from "@/components/Nav";
import { Scores } from "@/components/MovieRow";
import { RateButtons } from "@/components/RateButtons";
import { WatchButton } from "@/components/WatchButton";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, string> = {
  superlike: "★ loved it",
  like: "♥ liked it",
  dislike: "✕ didn't like it",
  seen: "has seen it",
  unseen: "hasn't seen it",
};

export default async function MoviePage({ params }: { params: { id: string } }) {
  const user = await me();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  let m;
  try {
    m = await ensureMovie(id);
  } catch {
    m = await db.movie.findUnique({ where: { id } });
  }
  if (!m) notFound();
  const partner = await partnerOf(user);
  const [swipes, watch, mine] = await Promise.all([
    db.swipe.findMany({ where: { movieId: id } }),
    db.watchlistItem.findMany({ where: { movieId: id } }),
    getMyServices(),
  ]);
  const mySwipe = swipes.find((s) => s.userId === user.id);
  const theirSwipe = partner ? swipes.find((s) => s.userId === partner.id) : undefined;
  const p = providersOf(m);
  const img = poster(m.posterPath, "w500");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="pb-tabs space-y-4">
      <Header title={m.title} back="/suggest" />
      <div className="flex gap-4">
        {img && <img src={img} alt="" className="w-36 shrink-0 rounded-xl object-cover" />}
        <div className="space-y-2">
          <div className="text-gray-400">
            {m.year ?? ""} · {m.genreIds.map(genreName).filter((g) => g !== "All genres").slice(0, 3).join(", ")}
          </div>
          <Scores m={m} />
          {m.nlRelease && m.nlRelease >= today && (
            <div className="text-sm text-accent">In Dutch cinemas {new Date(m.nlRelease).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</div>
          )}
          <WatchButton movieId={m.id} initial={watch.some((w) => w.userId === user.id)} />
        </div>
      </div>

      {m.why && <p className="card p-3 text-sm">✨ {m.why}</p>}
      <p className="text-sm leading-relaxed text-gray-300">{m.overview}</p>

      <section className="space-y-2">
        <h2 className="font-semibold">Your verdict</h2>
        <RateButtons movieId={m.id} initial={mySwipe?.verdict} />
        {partner && (
          <p className="text-sm text-gray-400">
            {partner.name} {theirSwipe ? VERDICT[theirSwipe.verdict] : "hasn't said yet"}
            {watch.some((w) => w.userId === partner.id) ? " · on their watchlist" : ""}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Where to watch in the Netherlands</h2>
        {p && (p.stream.length || p.rent.length || p.buy.length) ? (
          <>
            <ProviderLine label="Stream" list={p.stream} mine={mine} />
            <ProviderLine label="Rent" list={p.rent} mine={mine} />
            <ProviderLine label="Buy" list={p.buy} mine={mine} />
            {p.link && (
              <a href={p.link} target="_blank" rel="noreferrer" className="inline-block text-sm text-accent">
                Open on JustWatch ↗
              </a>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-400">Not on any Dutch service right now.</p>
        )}
        <p className="text-xs text-gray-500">Data: JustWatch via TMDB</p>
      </section>
      <Nav />
    </main>
  );
}

function ProviderLine({ label, list, mine }: { label: string; list: Provider[]; mine: number[] }) {
  if (!list.length) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-sm text-gray-400">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {list.map((p) => (
          <span key={p.id} className={`flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs ${mine.includes(p.id) ? "bg-accent/20 ring-1 ring-accent" : "bg-white/5"}`}>
            {p.logo && <img src={`${IMG}w45${p.logo}`} alt="" className="h-5 w-5 rounded" />}
            {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}
