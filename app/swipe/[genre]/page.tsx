import { db } from "@/lib/db";
import { me } from "@/lib/session";
import { genreName } from "@/lib/genres";
import { parseLike } from "@/lib/similar";
import { Header, Nav } from "@/components/Nav";
import { SwipeDeck } from "@/components/SwipeDeck";
import { DeckFilters } from "@/components/DeckFilters";
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
  await me();
  const genre = Number(params.genre) || 0;
  const filters = { imdb: num(searchParams.imdb), rt: num(searchParams.rt), from: num(searchParams.from), like: parseLike(searchParams.like) };
  const [liked, rtKnown] = await Promise.all([
    db.movie.findMany({ where: { id: { in: filters.like } }, select: { id: true, title: true } }),
    db.movie.count({ where: { rtScore: { not: null } } }),
  ]);
  const chosen = filters.like.map((id) => liked.find((m) => m.id === id)).filter((m) => m !== undefined);
  const summary = [
    ...chosen.map((c) => `Like ${c.title}`),
    ...(filters.imdb ? [`IMDb ${filters.imdb}+`] : []),
    ...(filters.rt ? [`🍅 ${filters.rt}%+`] : []),
    ...(filters.from ? [`from ${filters.from}`] : []),
  ];
  return (
    <main className="pb-tabs">
      <Header title={genreName(genre)} back="/swipe" />
      <DeckFilters summary={summary}>
        <SimilarPicker chosen={chosen} />
        <FilterBar deck rtAvailable={rtKnown > 0} />
      </DeckFilters>
      {/* A new filter restarts the deck. */}
      <SwipeDeck key={JSON.stringify(filters)} genre={genre} filters={filters} />
      <Nav active="/swipe" />
    </main>
  );
}
