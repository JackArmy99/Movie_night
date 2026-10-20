"use client";

import { createContext, useContext, useState } from "react";

const Ctx = createContext<{ open: boolean; toggle: () => void } | null>(null);

// A card that can open a trailer underneath itself; the "▶ Trailer" button
// (TrailerToggle) can sit anywhere inside it.
export function TrailerCard({
  trailerKey,
  title,
  className,
  children,
}: {
  trailerKey: string | null;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Ctx.Provider value={{ open, toggle: () => setOpen((o) => !o) }}>
      <div className={className}>
        {children}
        {open && trailerKey && (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&playsinline=1&rel=0`}
            title={`${title} trailer`}
            className="mt-3 aspect-video w-full rounded-xl"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        )}
      </div>
    </Ctx.Provider>
  );
}

export function TrailerToggle() {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    <button
      onClick={ctx.toggle}
      className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs ${ctx.open ? "bg-white text-ink" : "border border-line text-gray-300"}`}
    >
      {ctx.open ? "✕ Close" : "▶ Trailer"}
    </button>
  );
}
