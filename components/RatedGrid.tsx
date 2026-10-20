"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { rateStars } from "@/app/actions";
import { starsFromX } from "@/lib/swipe";

export type GridFilm = {
  id: number;
  title: string;
  year: number | null;
  poster: string | null;
  stars: number | null;
  verdict: string;
};

const HOLD_MS = 400;
const MOVE_TOLERANCE = 8; // px; more than this before the hold fires = scrolling

export function starText(stars: number) {
  return "★".repeat(Math.floor(stars)) + (stars % 1 ? "½" : "");
}

// Your films as a poster grid. Tap = open the film. Hold a poster, then slide
// left/right to set its stars (half steps); let go to save. Slide off the left
// edge to cancel.
export function RatedGrid({ films }: { films: GridFilm[] }) {
  const router = useRouter();
  const [items, setItems] = useState(films);
  const [active, setActive] = useState<{ id: number; value: number | null } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: number; x: number; y: number; rect: DOMRect; timer: number } | null>(null);
  const activeRef = useRef(false);
  // The live choice, readable from the release handler without waiting for a re-render.
  const valueRef = useRef<number | null>(null);
  const justRated = useRef(false);

  useEffect(() => setItems(films), [films]);

  // While re-rating, the page must not scroll under your finger. This needs a
  // non-passive listener (React's touch handlers can't cancel scrolling).
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (activeRef.current) e.preventDefault();
    };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const end = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    activeRef.current = false;
  };

  const down = (e: React.PointerEvent<HTMLElement>, id: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const timer = window.setTimeout(() => {
      activeRef.current = true;
      navigator.vibrate?.(15);
      const current = items.find((f) => f.id === id)?.stars ?? null;
      valueRef.current = current;
      setActive({ id, value: current });
    }, HOLD_MS);
    press.current = { id, x: e.clientX, y: e.clientY, rect, timer };
  };

  const move = (e: React.PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    if (!activeRef.current) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) end(); // it's a scroll
      return;
    }
    valueRef.current = starsFromX(e.clientX - p.rect.left, p.rect.width);
    setActive({ id: p.id, value: valueRef.current });
  };

  const up = async () => {
    const wasActive = activeRef.current;
    const id = press.current?.id;
    const stars = valueRef.current;
    end();
    setActive(null);
    if (!wasActive || id == null) return;
    justRated.current = true; // the click that follows a hold isn't a tap
    if (stars == null) return; // slid off the left: cancelled
    setItems((list) => list.map((f) => (f.id === id ? { ...f, stars, verdict: "rated" } : f)));
    await rateStars(id, stars);
    router.refresh(); // counts on the chips
  };

  if (!items.length) return <p className="card p-6 text-center text-sm text-gray-400">No films here yet.</p>;

  return (
    <div ref={grid} className="grid grid-cols-3 gap-x-2 gap-y-3">
      {items.map((f) => {
        const isActive = active?.id === f.id;
        const shown = isActive ? active.value : f.stars;
        return (
          <Link
            key={f.id}
            href={`/movie/${f.id}`}
            draggable={false}
            onClick={(e) => {
              if (justRated.current) {
                e.preventDefault();
                justRated.current = false;
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => down(e, f.id)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => {
              end();
              setActive(null);
            }}
            className="block select-none [-webkit-touch-callout:none]"
          >
            <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-line">
              {f.poster && (
                <img
                  src={f.poster}
                  alt=""
                  draggable={false}
                  className={`h-full w-full object-cover ${f.verdict === "pass" ? "opacity-40 grayscale" : ""}`}
                />
              )}
              {f.verdict === "pass" && !isActive && <span className="absolute right-1 top-1 text-sm">🚫</span>}
              {isActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/75">
                  <div className="relative text-xl leading-none tracking-tight">
                    <span className="text-gray-600">★★★★★</span>
                    <span
                      className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-accent"
                      style={{ width: `${((shown ?? 0) / 5) * 100}%` }}
                    >
                      ★★★★★
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-white">
                    {shown == null ? "✕ cancel" : `${String(shown).replace(".5", "½")}★`}
                  </span>
                  <span className="text-[10px] text-gray-400">slide · let go to save</span>
                </div>
              )}
            </div>
            <div className="mt-1 truncate text-xs font-semibold leading-tight">{f.title}</div>
            <div className="flex items-center justify-between text-[11px] text-gray-400">
              <span>{f.year ?? ""}</span>
              {shown != null ? (
                <span className="text-accent">{starText(shown)}</span>
              ) : f.verdict === "seen" ? (
                <span>seen</span>
              ) : null}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
