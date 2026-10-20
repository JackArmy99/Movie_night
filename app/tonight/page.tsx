import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { me, partnerOf } from "@/lib/session";
import { suggest } from "@/lib/recommend";
import { getMyServices } from "@/lib/settings";
import { serviceList } from "@/lib/services";
import { ensureDetails, ensureRatings, providersOf } from "@/lib/movies";
import { parseFilters, passes } from "@/lib/score";
import { hasOmdb } from "@/lib/omdb";
import { hasClaude } from "@/lib/claude";
import { Header, Nav } from "@/components/Nav";
import { MovieRow } from "@/components/MovieRow";
import { FilterBar } from "@/components/FilterBar";
import { GenrePicker } from "@/components/GenrePicker";
import { ServicePicker } from "@/components/ServicePicker";
import { WhyButton } from "@/components/WhyButton";

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
const STEP = 5;

type SP = Record<string, string | undefined>;

function href(sp: SP, patch: SP) {
  const next = { ...sp, ...patch };
  const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
  return `/tonight?${q.toString()}`;
}

// Everything suggestion-shaped lives here: a mood or genre, who it's for, the
// sliders, and the services you have.
export default async function Tonight({ searchParams }: { searchParams: SP }) {
  await me();
  const sp = searchParams;
  const [services, mine] = await Promise.all([serviceList(), getMyServices()]);
  return (
    <main className="pb-tabs space-y-4">
      <Header title="Tonight" />
      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {MOODS.map((m) => (
            <Link
              key={m.key}
              href={href(sp, { mood: sp.mood === m.key ? undefined : m.key, g: undefined, n: undefined })}
              className={sp.mood === m.key ? "chip-on" : "chip"}
            >
              {m.label}
            </Link>
          ))}
          <GenrePicker />
        </div>
        <ServicePicker services={services} initial={mine} />
        <FilterBar rtAvailable={hasOmdb()} />
      </section>
      <Suspense key={JSON.stringify(sp)} fallback={<Loading />}>
        <Picks sp={sp} />
      </Suspense>
      <Nav active="/tonight" />
    </main>
  );
}

function Loading() {
  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-gray-400">Finding films you haven't seen…</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card h-40 animate-pulse" />
      ))}
    </div>
  );
}

async function Picks({ sp }: { sp: SP }) {
  const user = await me();
  const partner = await partnerOf(user);
  const users = sp.for === "me" || !partner ? [user.id] : [user.id, partner.id];
  const genres = MOODS.find((m) => m.key === sp.mood)?.genres ?? (Number(sp.g) ? [Number(sp.g)] : []);
  const mine = await getMyServices();
  const filters = parseFilters(sp);
  if (!mine.length) filters.servicesOnly = false;
  const limit = Math.min(30, Math.max(STEP, Number(sp.n) || STEP));

  const picks = await suggest({ users, genre: 0, extraGenres: genres, filters, limit });
  const picked = new Set(picks.map((p) => p.movie.id));

  // Your watchlist too, with the same filters: films one of you already
  // wanted to see.
  const saved = await db.watchlistItem.findMany({ select: { movieId: true }, orderBy: { addedAt: "desc" } });
  const savedIds = [...new Set(saved.map((s) => s.movieId))].filter((id) => !picked.has(id)).slice(0, 30);
  await ensureDetails(savedIds);
  await ensureRatings(savedIds);
  const fromWatchlist = (await db.movie.findMany({ where: { id: { in: savedIds } } }))
    .filter((m) => !genres.length || m.genreIds.some((g) => genres.includes(g)))
    .filter((m) => passes({ ...m, streamIds: (providersOf(m)?.stream ?? []).map((p) => p.id) }, filters, mine))
    .slice(0, 3);

  const unexplained = picks.filter((s) => !s.movie.why && !s.fallback).slice(0, 10);
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="font-semibold">{users.length > 1 ? "Top picks for the two of you" : "Top picks for you"}</h2>
        {hasClaude() && unexplained.length > 0 && (
          <WhyButton
            ids={unexplained.map((s) => s.movie.id)}
            because={Object.fromEntries(unexplained.map((s) => [s.movie.id, s.because.map((b) => b.title)]))}
          />
        )}
        {picks.length ? (
          picks.map((s) => (
            <MovieRow
              key={s.movie.id}
              m={s.movie}
              mine={mine}
              because={s.because}
              why={s.movie.why}
              onWatchlist={s.onWatchlist}
              note={s.fallback ? "Highly rated — rate more films for personal picks" : undefined}
            />
          ))
        ) : (
          <p className="card p-4 text-sm text-gray-400">
            Nothing fits. Try another mood, loosen the filters or switch off &quot;On our services&quot;.
          </p>
        )}
        {picks.length >= limit && limit < 30 && (
          <Link href={href(sp, { n: String(limit + STEP) })} scroll={false} className="btn-ghost w-full text-sm">
            Show {STEP} more
          </Link>
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
        <p className="text-center text-xs text-gray-400">Tick your services above for &quot;On our services&quot; to work.</p>
      )}
      <p className="text-center text-xs text-gray-500">Streaming info: JustWatch via TMDB</p>
    </div>
  );
}
