import Link from "next/link";
import { me } from "@/lib/session";
import { GENRES } from "@/lib/genres";
import { Header, Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function SuggestGenres() {
  await me();
  return (
    <main className="pb-tabs">
      <Header title="Suggestions" />
      <p className="mb-4 text-sm text-gray-400">
        Pick a genre. Everything either of you has seen is left out, and films you'd both like rank highest.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[{ id: 0, name: "Anything" }, ...GENRES].map((g) => (
          <Link key={g.id} href={`/suggest/${g.id}`} className="card p-4 font-semibold">
            {g.name}
          </Link>
        ))}
      </div>
      <Nav active="/suggest" />
    </main>
  );
}
