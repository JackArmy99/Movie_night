"use client";

import { useState } from "react";

const embed = (key: string) =>
  `https://www.youtube-nocookie.com/embed/${key}?autoplay=1&playsinline=1&rel=0`;

function Player({ trailerKey, title }: { trailerKey: string; title: string }) {
  return (
    <iframe
      src={embed(trailerKey)}
      title={`${title} trailer`}
      className="aspect-video w-full rounded-xl"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
    />
  );
}

// A trailer that only loads YouTube once tapped (pages stay fast, and nothing
// is sent to YouTube for trailers you never play).
export function Trailer({ trailerKey, title }: { trailerKey: string | null; title: string }) {
  const [playing, setPlaying] = useState(false);
  if (!trailerKey) return <p className="text-xs text-gray-500">No trailer on TMDB yet.</p>;
  if (playing) return <Player trailerKey={trailerKey} title={title} />;
  return (
    <button
      onClick={() => setPlaying(true)}
      className="relative block aspect-video w-full overflow-hidden rounded-xl bg-black"
      aria-label={`Play the ${title} trailer`}
    >
      <img
        src={`https://i.ytimg.com/vi/${trailerKey}/hqdefault.jpg`}
        alt=""
        className="h-full w-full object-cover opacity-80"
        onError={(e) => (e.currentTarget.style.display = "none")}
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-2xl text-white">▶</span>
      </span>
    </button>
  );
}

// A row (e.g. in the cinema calendar) with a "▶ Trailer" button that opens
// the player underneath it.
export function TrailerRow({
  trailerKey,
  title,
  children,
  aside,
}: {
  trailerKey: string | null;
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode; // stacked above the trailer button, e.g. + Watchlist
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card p-2">
      <div className="flex items-center gap-3">
        {children}
        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          {aside}
          {trailerKey && (
            <button
              onClick={() => setOpen((o) => !o)}
              className={`rounded-lg px-2.5 py-1 text-xs ${open ? "bg-white text-ink" : "border border-line text-gray-300"}`}
            >
              {open ? "✕ Close" : "▶ Trailer"}
            </button>
          )}
        </div>
      </div>
      {open && trailerKey && (
        <div className="mt-2">
          <Player trailerKey={trailerKey} title={title} />
        </div>
      )}
    </div>
  );
}
