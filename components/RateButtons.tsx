"use client";

import { useState, useTransition } from "react";
import { rate, watchedTogether } from "@/app/actions";

// 1–5 stars, plus "Not seen". together: "We watched it" — also clears it off
// both watchlists and marks it seen for your partner (they can still give
// their own stars later).
export function RateButtons({
  movieId,
  initialStars,
  initialUnseen = false,
  together = false,
}: {
  movieId: number;
  initialStars?: number | null;
  initialUnseen?: boolean;
  together?: boolean;
}) {
  const [stars, setStars] = useState<number | null>(initialStars ?? null);
  const [unseen, setUnseen] = useState(initialUnseen && !initialStars);
  const [pending, start] = useTransition();

  const pick = (n: number) =>
    start(async () => {
      setStars(n);
      setUnseen(false);
      await (together ? watchedTogether(movieId, n) : rate(movieId, n));
    });

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const full = stars != null && stars >= n;
        const half = stars != null && !full && stars >= n - 0.5;
        return (
          <button
            key={n}
            disabled={pending}
            onClick={() => pick(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className={`relative text-3xl leading-none transition active:scale-90 ${full ? "text-accent" : "text-gray-600"}`}
          >
            ★
            {/* Half star: the left half of a gold star over the grey one. */}
            {half && (
              <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden text-accent" aria-hidden>
                ★
              </span>
            )}
          </button>
        );
      })}
      {!together && (
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setStars(null);
              setUnseen(true);
              await rate(movieId, "unseen");
            })
          }
          className={`ml-auto rounded-xl px-3 py-2 text-xs font-semibold ${unseen ? "bg-sky-500 text-ink" : "border border-line bg-panel"}`}
        >
          Not seen
        </button>
      )}
    </div>
  );
}

export function StarsText({ stars }: { stars: number }) {
  const full = Math.floor(stars);
  return (
    <span className="text-accent">
      {"★".repeat(full)}
      {stars - full >= 0.5 ? "½" : ""}
    </span>
  );
}
