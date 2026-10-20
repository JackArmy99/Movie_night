import Link from "next/link";
import type { Movie } from "@prisma/client";
import { poster, IMG } from "@/lib/tmdb";
import { providersOf } from "@/lib/movies";
import { WatchButton } from "./WatchButton";

export function Scores({ m }: { m: Movie }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {m.imdbRating != null && <span className="rounded bg-yellow-400/15 px-1.5 py-0.5 text-yellow-300">IMDb {m.imdbRating.toFixed(1)}</span>}
      {m.rtScore != null && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-300">🍅 {m.rtScore}%</span>}
      {m.metascore != null && <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-green-300">Meta {m.metascore}</span>}
      {m.imdbRating == null && m.voteAverage > 0 && (
        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">TMDB {m.voteAverage.toFixed(1)}</span>
      )}
      {m.runtime ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-gray-300">{Math.floor(m.runtime / 60)}h {m.runtime % 60}m</span> : null}
    </div>
  );
}

export function StreamLogos({ m, mine }: { m: Movie; mine: number[] }) {
  const stream = providersOf(m)?.stream ?? [];
  if (!stream.length) return null;
  // Your own services first.
  const sorted = [...stream].sort((a, b) => Number(mine.includes(b.id)) - Number(mine.includes(a.id)));
  return (
    <div className="flex items-center gap-1">
      {sorted.slice(0, 5).map((p) =>
        p.logo ? (
          <img
            key={p.id}
            src={`${IMG}w92${p.logo}`}
            alt={p.name}
            title={p.name}
            className={`h-6 w-6 rounded ${mine.includes(p.id) ? "ring-2 ring-accent" : "opacity-60"}`}
          />
        ) : null,
      )}
    </div>
  );
}

export function MovieRow({
  m,
  mine,
  because,
  why,
  onWatchlist,
  note,
}: {
  m: Movie;
  mine: number[];
  because?: { id: number; title: string }[];
  why?: string | null;
  onWatchlist?: boolean;
  note?: string;
}) {
  const img = poster(m.posterPath, "w185");
  return (
    <div className="card flex gap-3 p-3">
      <Link href={`/movie/${m.id}`} className="shrink-0">
        {img ? (
          <img src={img} alt="" className="h-36 w-24 rounded-lg object-cover" />
        ) : (
          <div className="h-36 w-24 rounded-lg bg-line" />
        )}
      </Link>
      <div className="min-w-0 flex-1 space-y-1.5">
        <Link href={`/movie/${m.id}`} className="block font-semibold leading-tight">
          {m.title} <span className="font-normal text-gray-400">{m.year ?? ""}</span>
        </Link>
        <Scores m={m} />
        {why ? (
          <p className="text-sm text-gray-200">{why}</p>
        ) : because?.length ? (
          <p className="text-xs text-gray-400">Because of {because.map((b) => b.title).join(" & ")}</p>
        ) : note ? (
          <p className="text-xs text-gray-400">{note}</p>
        ) : (
          <p className="line-clamp-2 text-xs text-gray-400">{m.overview}</p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <StreamLogos m={m} mine={mine} />
          <WatchButton movieId={m.id} initial={Boolean(onWatchlist)} />
        </div>
      </div>
    </div>
  );
}
