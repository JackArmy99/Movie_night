import { Suspense } from "react";
import { me, partnerOf } from "@/lib/session";
import { genreName } from "@/lib/genres";
import { parseFilters } from "@/lib/score";
import { suggest } from "@/lib/recommend";
import { getMyServices } from "@/lib/settings";
import { hasOmdb } from "@/lib/omdb";
import { hasClaude } from "@/lib/claude";
import { Header, Nav } from "@/components/Nav";
import { FilterBar } from "@/components/FilterBar";
import { MovieRow } from "@/components/MovieRow";
import { WhyButton } from "@/components/WhyButton";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Props = { params: { genre: string }; searchParams: Record<string, string | string[] | undefined> };

export default async function SuggestList({ params, searchParams }: Props) {
  const genre = Number(params.genre) || 0;
  return (
    <main className="pb-tabs">
      <Header title={genre ? genreName(genre) : "Anything"} back="/suggest" />
      <FilterBar rtAvailable={hasOmdb()} />
      <Suspense key={JSON.stringify(searchParams)} fallback={<Loading />}>
        <Results genre={genre} searchParams={searchParams} />
      </Suspense>
      <Nav active="/suggest" />
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

async function Results({ genre, searchParams }: { genre: number; searchParams: Props["searchParams"] }) {
  const user = await me();
  const partner = await partnerOf(user);
  const solo = searchParams.for === "me";
  const users = solo || !partner ? [user.id] : [user.id, partner.id];
  const [list, mine] = await Promise.all([
    suggest({ users, genre, filters: parseFilters(searchParams) }),
    getMyServices(),
  ]);

  if (!list.length) {
    return (
      <div className="card p-6 text-center text-gray-400">
        Nothing matches. Try loosening the filters, or swipe more films so there's more to go on.
      </div>
    );
  }
  const unexplained = list.filter((s) => !s.movie.why && !s.fallback).slice(0, 10);
  return (
    <div className="space-y-3">
      {hasClaude() && unexplained.length > 0 && (
        <WhyButton
          ids={unexplained.map((s) => s.movie.id)}
          because={Object.fromEntries(unexplained.map((s) => [s.movie.id, s.because.map((b) => b.title)]))}
        />
      )}
      {list.map((s) => (
        <MovieRow
          key={s.movie.id}
          m={s.movie}
          mine={mine}
          because={s.because}
          why={s.movie.why}
          onWatchlist={s.onWatchlist}
          note={s.fallback ? "Highly rated — swipe more for personal picks" : undefined}
        />
      ))}
      <p className="pt-2 text-center text-xs text-gray-500">Streaming info: JustWatch via TMDB</p>
    </div>
  );
}
