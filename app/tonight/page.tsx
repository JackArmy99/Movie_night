import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { me, partnerOf } from "@/lib/session";
import { suggest } from "@/lib/recommend";
import { getMyServices } from "@/lib/settings";
import { ensureDetails, ensureRatings, providersOf } from "@/lib/movies";
import { Header, Nav } from "@/components/Nav";
import { MovieRow } from "@/components/MovieRow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MOODS = [
  { key: "laugh", label: "😂 Laugh", genres: [35] },
  { key: "tense", label: "😬 Edge of seat", genres: [53, 28, 80] },
  { key: "cosy", label: "🛋️ Cosy", genres: [10749, 10751, 16] },
  { key: "mind", label: "🌀 Mind-bending", genres: [878, 9648] },
  { key: "scary", label: "👻 Scary", genres: [27] },
  { key: "cry", label: "😢 A good cry", genres: [18] },
  { key: "epic", label: "🗺️ Epic", genres: [12, 14, 10752] },
];
const LENGTHS = [
  { v: "100", label: "Under 1h40" },
  { v: "120", label: "Under 2h" },
  { v: "150", label: "Under 2h30" },
  { v: "", label: "Any length" },
];

type SP = { mood?: string; len?: string; mine?: string };

function href(sp: SP, patch: Partial<SP>) {
  const next = { ...sp, ...patch };
  const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
  return `/tonight?${q.toString()}`;
}

export default async function Tonight({ searchParams }: { searchParams: SP }) {
  await me();
  const sp: SP = { mine: "1", len: "120", ...searchParams };
  return (
    <main className="pb-tabs space-y-4">
      <Header title="Tonight" />
      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {MOODS.map((m) => (
            <Link key={m.key} href={href(sp, { mood: sp.mood === m.key ? "" : m.key })} className={sp.mood === m.key ? "chip-on" : "chip"}>
              {m.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {LENGTHS.map((l) => (
            <Link key={l.label} href={href(sp, { len: l.v })} className={(sp.len ?? "") === l.v ? "chip-on" : "chip"}>
              {l.label}
            </Link>
          ))}
          <Link href={href(sp, { mine: sp.mine === "1" ? "0" : "1" })} className={sp.mine === "1" ? "chip-on" : "chip"}>
            On our services
          </Link>
        </div>
      </section>
      <Suspense key={JSON.stringify(sp)} fallback={<div className="card h-40 animate-pulse" />}>
        <Picks sp={sp} />
      </Suspense>
      <Nav active="/tonight" />
    </main>
  );
}

async function Picks({ sp }: { sp: SP }) {
  const user = await me();
  const partner = await partnerOf(user);
  const users = partner ? [user.id, partner.id] : [user.id];
  const genres = MOODS.find((m) => m.key === sp.mood)?.genres ?? [];
  const mine = await getMyServices();
  const filters = { maxRuntime: Number(sp.len) || undefined, servicesOnly: sp.mine === "1" && mine.length > 0 };

  const picks = await suggest({ users, genre: 0, extraGenres: genres, filters, limit: 3 });
  const picked = new Set(picks.map((p) => p.movie.id));

  // Your watchlist too: films one of you already wanted to see.
  const saved = await db.watchlistItem.findMany({ include: { movie: true }, orderBy: { addedAt: "desc" } });
  const savedMovies = [...new Map(saved.map((s) => [s.movieId, s.movie])).values()];
  await ensureDetails(savedMovies.map((m) => m.id).slice(0, 30));
  await ensureRatings(savedMovies.map((m) => m.id).slice(0, 30));
  const fresh = await db.movie.findMany({ where: { id: { in: savedMovies.map((m) => m.id) } } });
  const fromWatchlist = fresh
    .filter((m) => !picked.has(m.id))
    .filter((m) => !genres.length || m.genreIds.some((g) => genres.includes(g)))
    .filter((m) => !filters.maxRuntime || !m.runtime || m.runtime <= filters.maxRuntime)
    .filter((m) => !filters.servicesOnly || (providersOf(m)?.stream ?? []).some((p) => mine.includes(p.id)))
    .slice(0, 3);


  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="font-semibold">Our top 3 for tonight</h2>
        {picks.length ? (
          picks.map((s) => <MovieRow key={s.movie.id} m={s.movie} mine={mine} because={s.because} why={s.movie.why} onWatchlist={s.onWatchlist} />)
        ) : (
          <p className="card p-4 text-sm text-gray-400">Nothing fits. Try another mood, a longer film or switch off "On our services".</p>
        )}
      </section>
      {fromWatchlist.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">From your watchlist</h2>
          {fromWatchlist.map((m) => (
            <MovieRow key={m.id} m={m} mine={mine} onWatchlist />
          ))}
        </section>
      )}
      {sp.mine === "1" && !mine.length && (
        <p className="text-center text-xs text-gray-400">
          Pick your services in <Link href="/settings" className="text-accent">Settings</Link> for "On our services" to work.
        </p>
      )}
    </div>
  );
}
