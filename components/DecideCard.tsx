"use client";

import { useState, useTransition } from "react";
import { decide } from "@/app/actions";
import { Trailer } from "./Trailer";

// One film in the "To decide" pile: watch the trailer, then keep or drop it.
export function DecideCard({
  movieId,
  title,
  year,
  trailerKey,
  scores,
}: {
  movieId: number;
  title: string;
  year: number | null;
  trailerKey: string | null;
  scores: React.ReactNode;
}) {
  const [done, setDone] = useState<"want" | "pass" | null>(null);
  const [pending, start] = useTransition();
  if (done) {
    return (
      <p className="card px-4 py-3 text-sm text-gray-400">
        {done === "want" ? "📌 " : "🚫 "}
        {title} — {done === "want" ? "added to your watchlist" : "won't be suggested"}
      </p>
    );
  }
  const answer = (want: boolean) =>
    start(async () => {
      await decide(movieId, want);
      setDone(want ? "want" : "pass");
    });
  return (
    <div className="card space-y-2 p-3">
      <a href={`/movie/${movieId}`} className="block font-semibold">
        {title} <span className="font-normal text-gray-400">{year ?? ""}</span>
      </a>
      {scores}
      <Trailer trailerKey={trailerKey} title={title} />
      <div className="grid grid-cols-2 gap-2">
        <button disabled={pending} onClick={() => answer(false)} className="btn-ghost py-2.5 text-sm">
          🚫 Not interested
        </button>
        <button disabled={pending} onClick={() => answer(true)} className="btn-primary py-2.5 text-sm">
          📌 Want to see
        </button>
      </div>
    </div>
  );
}
