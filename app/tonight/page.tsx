import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { me, partnerOf } from "@/lib/session";
import { suggest } from "@/lib/recommend";
import { getMyServices } from "@/lib/settings";
import { serviceList } from "@/lib/services";
import { ensureDetails, ensureRatings, providersOf } from "@/lib/movies";
import { excludedBy, parseExcluded, parseFilters, passes } from "@/lib/score";
import { hasClaude } from "@/lib/claude";
import { Header, Nav } from "@/components/Nav";
import { MovieRow } from "@/components/MovieRow";
import { FilterBar } from "@/components/FilterBar";
import { ControlBar } from "@/components/ControlBar";
import { GenreChoices } from "@/components/GenreChoices";
import { MOODS } from "@/lib/moods";
import { customLabel, genreName, nothingPicked } from "@/lib/genres";
import { ServicePicker } from "@/components/ServicePicker";
import { SimilarPicker } from "@/components/SimilarPicker";
import { parseLike } from "@/lib/similar";
import { WhyButton } from "@/components/WhyButton";
import { DropParam } from "@/components/DropParam";

const ANY_GENRE = "🎞️ Any genre";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const like = parseLike(sp.like);
  const [services, mine, rtKnown, liked] = await Promise.all([
    serviceList(),
    getMyServices(),
    // Only offer the Rotten Tomatoes filter once some RT scores exist —
    // otherwise it would hide every film.
    db.movie.count({ where: { rtScore: { not: null } } }),
    db.movie.findMany({ where: { id: { in: like } }, select: { id: true, title: true } }),
  ]);
  const chosen = like.map((id) => liked.find((m) => m.id === id)).filter((m) => m !== undefined);
  const mood = MOODS.find((m) => m.key === sp.mood);
  const custom = sp.gx !== undefined;
  const genreLabel = custom
    ? customLabel(parseExcluded(sp.gx))
    : (mood?.label ?? (Number(sp.g) ? genreName(Number(sp.g)) : ANY_GENRE));
  // One line saying what's switched on, shown while the Filters panel is shut.
  const myServices = services.filter((p) => mine.includes(p.id)).map((p) => p.name);
  const summary = [
    ...chosen.map((c) => `Like ${c.title}`),
    ...(sp.for === "me" ? ["Just me"] : []),
    ...(sp.mine === "1" ? [myServices.length ? `On ${myServices.slice(0, 2).join(", ")}${myServices.length > 2 ? "…" : ""}` : "On our services"] : []),
    ...(sp.imdb ? [`IMDb ${sp.imdb}+`] : []),
    ...(sp.rt ? [`🍅 ${sp.rt}%+`] : []),
    ...(sp.from ? [`from ${sp.from}`] : []),
    ...(sp.len ? [`under ${Math.floor(Number(sp.len) / 60)}h${Number(sp.len) % 60 ? String(Number(sp.len) % 60).padStart(2, "0") : ""}`] : []),
  ];
  return (
    <main className="pb-tabs space-y-3">
      <Header title="Tonight" />
      <ControlBar
        genreLabel={genreLabel}
        genreActive={genreLabel !== ANY_GENRE}
        genrePanel={<GenreChoices mode="tonight" />}
        summary={summary}
        filtersPanel={
          <>
            <SimilarPicker chosen={chosen} />
            <ServicePicker services={services} initial={mine} />
            <FilterBar rtAvailable={rtKnown > 0} />
          </>
        }
      />
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
  const exclude = parseExcluded(sp.gx);
  if (sp.gx !== undefined && nothingPicked(exclude)) {
    return <p className="card p-4 text-sm text-gray-400">Pick at least one genre in ✏️ Custom.</p>;
  }

  const like = parseLike(sp.like);
  // Your picks, and your watchlist with the same filters (films one of you
  // already wanted to see) — looked up side by side, not one after the other.
  const watchlistFilms = async () => {
    const saved = await db.watchlistItem.findMany({ select: { movieId: true }, orderBy: { addedAt: "desc" } });
    const ids = [...new Set(saved.map((s) => s.movieId))].slice(0, 30);
    await ensureDetails(ids);
    await ensureRatings(ids);
    return db.movie.findMany({ where: { id: { in: ids } } });
  };
  const [picks, saved] = await Promise.all([
    suggest({ users, genre: 0, extraGenres: genres, filters, limit, like, exclude, mood: sp.mood, fresh: sp.fresh === "1" }),
    watchlistFilms(),
  ]);
  const picked = new Set(picks.map((p) => p.movie.id));
  const fromWatchlist = saved
    .filter((m) => !picked.has(m.id))
    .filter((m) => !genres.length || m.genreIds.some((g) => genres.includes(g)))
    .filter((m) => !excludedBy(m, exclude))
    .filter((m) => passes({ ...m, streamIds: (providersOf(m)?.stream ?? []).map((p) => p.id) }, filters, mine))
    .slice(0, 3);

  const unexplained = picks.filter((s) => !s.movie.why && !s.reason && !s.fallback).slice(0, 10);
  const fromClaude = picks.some((s) => s.reason);
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">
            {like.length ? "Films like these" : users.length > 1 ? "Top picks for the two of you" : "Top picks for you"}
          </h2>
          {fromClaude && (
            <Link href={href(sp, { fresh: "1", n: undefined })} scroll={false} className="shrink-0 text-xs text-accent">
              ↻ Fresh picks
            </Link>
          )}
        </div>
        {sp.fresh === "1" && <DropParam name="fresh" />}
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
              why={s.movie.why ?? s.reason}
              onWatchlist={s.onWatchlist}
              becausePrefix={like.length ? "Like" : "Because of"}
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
