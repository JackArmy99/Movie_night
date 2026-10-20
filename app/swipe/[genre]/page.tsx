import { db } from "@/lib/db";
import { me } from "@/lib/session";
import { customLabel, genreName, nothingPicked } from "@/lib/genres";
import { parseLike } from "@/lib/similar";
import { Header, Nav } from "@/components/Nav";
import { SwipeDeck } from "@/components/SwipeDeck";
import { ControlBar } from "@/components/ControlBar";
import { GenreChoices } from "@/components/GenreChoices";
import { parseExcluded, SEEN } from "@/lib/score";
import { FilterBar } from "@/components/FilterBar";
import { SimilarPicker } from "@/components/SimilarPicker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SP = Record<string, string | string[] | undefined>;
const num = (v: string | string[] | undefined) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export default async function Deck({ params, searchParams }: { params: { genre: string }; searchParams: SP }) {
  const user = await me();
  const genre = Number(params.genre) || 0;
  const custom = searchParams.gx !== undefined;
  const exclude = parseExcluded(searchParams.gx);
  const filters = {
    imdb: num(searchParams.imdb),
    rt: num(searchParams.rt),
    from: num(searchParams.from),
    like: parseLike(searchParams.like),
    ...(custom ? { exclude } : {}),
  };
  const [liked, rtKnown, mySwipes] = await Promise.all([
    db.movie.findMany({ where: { id: { in: filters.like } }, select: { id: true, title: true } }),
    db.movie.count({ where: { rtScore: { not: null } } }),
    db.swipe.findMany({ where: { userId: user.id }, select: { verdict: true, movie: { select: { genreIds: true } } } }),
  ]);
  // How many films you've marked as seen, per genre (shown in the genre panel).
  const counts: Record<number, number> = {};
  for (const s of mySwipes) {
    if (!SEEN.has(s.verdict)) continue;
    counts[0] = (counts[0] ?? 0) + 1;
    for (const g of s.movie.genreIds) counts[g] = (counts[g] ?? 0) + 1;
  }
  const chosen = filters.like.map((id) => liked.find((m) => m.id === id)).filter((m) => m !== undefined);
  const summary = [
    ...chosen.map((c) => `Like ${c.title}`),
    ...(filters.imdb ? [`IMDb ${filters.imdb}+`] : []),
    ...(filters.rt ? [`🍅 ${filters.rt}%+`] : []),
    ...(filters.from ? [`from ${filters.from}`] : []),
  ];
  return (
    <main className="pb-tabs">
      <Header title="Swipe" />
      <ControlBar
        genreLabel={custom ? customLabel(exclude) : genre ? genreName(genre) : "🎞️ Any genre"}
        genreActive={custom || genre !== 0}
        genrePanel={<GenreChoices mode="deck" counts={counts} />}
        summary={summary}
        filtersPanel={
          <>
            <SimilarPicker chosen={chosen} />
            <FilterBar deck rtAvailable={rtKnown > 0} />
          </>
        }
      />
      {/* A new filter restarts the deck. */}
      {custom && nothingPicked(exclude) ? (
        <p className="card p-6 text-center text-sm text-gray-400">Pick at least one genre in ✏️ Custom.</p>
      ) : (
        <SwipeDeck key={JSON.stringify(filters) + genre} genre={genre} filters={filters} />
      )}
      <Nav active="/swipe/0" />
    </main>
  );
}
