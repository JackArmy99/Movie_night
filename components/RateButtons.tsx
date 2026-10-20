"use client";

import { useState, useTransition } from "react";
import { rate, watchedTogether } from "@/app/actions";

const OPTIONS = [
  { v: "dislike", label: "✕ Didn't like", on: "bg-red-500 text-white" },
  { v: "like", label: "♥ Liked", on: "bg-green-500 text-ink" },
  { v: "superlike", label: "★ Loved", on: "bg-accent text-ink" },
  { v: "unseen", label: "Not seen", on: "bg-sky-500 text-ink" },
];

// together: also clears it off both watchlists and marks it seen for your
// partner (they can still give their own verdict later).
export function RateButtons({ movieId, initial, together = false }: { movieId: number; initial?: string | null; together?: boolean }) {
  const [current, setCurrent] = useState(initial ?? null);
  const [pending, start] = useTransition();
  const options = together ? OPTIONS.filter((o) => o.v !== "unseen") : OPTIONS;
  return (
    <div className={`grid gap-2 ${together ? "grid-cols-3" : "grid-cols-4"}`}>
      {options.map((o) => (
        <button
          key={o.v}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setCurrent(o.v);
              await (together ? watchedTogether(movieId, o.v) : rate(movieId, o.v));
            })
          }
          className={`rounded-xl px-2 py-2.5 text-xs font-semibold ${current === o.v ? o.on : "border border-line bg-panel"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
