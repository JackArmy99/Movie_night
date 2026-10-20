import { me } from "@/lib/session";
import { genreName } from "@/lib/genres";
import { Header, Nav } from "@/components/Nav";
import { SwipeDeck } from "@/components/SwipeDeck";

export const dynamic = "force-dynamic";

export default async function Deck({ params }: { params: { genre: string } }) {
  await me();
  const genre = Number(params.genre) || 0;
  return (
    <main className="pb-tabs">
      <Header title={genreName(genre)} back="/swipe" />
      <SwipeDeck genre={genre} />
      <Nav active="/swipe" />
    </main>
  );
}
