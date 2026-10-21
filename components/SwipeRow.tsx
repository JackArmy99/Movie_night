"use client";

import { useEffect, useRef, useState } from "react";
import { tonightSwipe, undoTonightSwipe, type TonightUndo } from "@/app/actions";

const THRESHOLD = 90; // px of sideways drag that counts as a swipe

// One of Tonight's cards that can be swiped: left = "Not for me" (never
// suggested again, and the app learns from it), right = onto your watchlist.
// Only sideways drags are caught (touch-action: pan-y), so scrolling the list
// still works, and taps on the poster, title and buttons behave as before.
// After a swipe the card shrinks to a bar with Undo for five seconds.
export function SwipeRow({ movieId, title, children }: { movieId: number; title: string; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const [done, setDone] = useState<null | { dir: "bin" | "watch"; undo: TonightUndo | null }>(null);
  const [gone, setGone] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const sideways = useRef(false);
  const dragged = useRef(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), 5000);
    return () => clearTimeout(t);
  }, [done]);

  if (gone) return null;

  if (done) {
    return (
      <div className="card flex items-center justify-between gap-3 px-4 py-3 text-sm">
        <span className="min-w-0 truncate text-gray-300">
          {done.dir === "bin" ? "🗑 Not for me" : "📌 On your watchlist"} · {title}
        </span>
        <button
          className="shrink-0 font-semibold text-accent disabled:opacity-40"
          disabled={!done.undo}
          onClick={async () => {
            if (!done.undo) return;
            await undoTonightSwipe(movieId, done.undo);
            setDone(null);
            setDx(0);
          }}
        >
          Undo
        </button>
      </div>
    );
  }

  const finish = (dir: "bin" | "watch") => {
    setDx(dir === "bin" ? -600 : 600);
    // Shrink to the bar once the slide-out ends (unless the save already did).
    setTimeout(() => setDone((d) => d ?? { dir, undo: null }), 180);
    tonightSwipe(movieId, dir)
      .then((undo) => setDone({ dir, undo }))
      .catch(() => {
        setDone(null);
        setDx(0);
      });
  };

  const strip = dx < 0 ? "bg-red-600/80" : "bg-amber-500/80";
  const armed = Math.abs(dx) >= THRESHOLD;

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {dx !== 0 && (
        <div
          className={`absolute inset-0 flex items-center px-5 text-sm font-bold text-white ${strip} ${
            dx < 0 ? "justify-end" : "justify-start"
          } ${armed ? "opacity-100" : "opacity-60"}`}
        >
          {dx < 0 ? "🗑 Not for me" : "📌 Watchlist"}
        </div>
      )}
      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: start.current ? "none" : "transform 180ms ease-out",
          touchAction: "pan-y",
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
          sideways.current = false;
          dragged.current = false;
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          const mx = e.clientX - s.x;
          const my = e.clientY - s.y;
          if (!sideways.current) {
            if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) {
              start.current = null; // a scroll, not a swipe
              return;
            }
            if (Math.abs(mx) > 12) {
              sideways.current = true;
              dragged.current = true;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }
          }
          if (sideways.current) setDx(mx);
        }}
        onPointerUp={() => {
          const was = sideways.current;
          start.current = null;
          sideways.current = false;
          if (was && Math.abs(dx) >= THRESHOLD) finish(dx < 0 ? "bin" : "watch");
          else setDx(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          sideways.current = false;
          setDx(0);
        }}
        // A drag must not also open the film's page.
        onClickCapture={(e) => {
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
            dragged.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
