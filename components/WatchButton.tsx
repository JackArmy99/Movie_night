"use client";

import { useState, useTransition } from "react";
import { toggleWatchlist } from "@/app/actions";

export function WatchButton({ movieId, initial }: { movieId: number; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(async () => setOn(await toggleWatchlist(movieId)))}
      disabled={pending}
      className={`ml-auto shrink-0 rounded-lg px-2.5 py-1 text-xs ${on ? "bg-accent text-ink" : "border border-line text-gray-300"}`}
    >
      {on ? "📌 Saved" : "+ Watchlist"}
    </button>
  );
}
