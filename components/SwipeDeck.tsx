"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nextCards, rateStars, swipe, undoSwipe } from "@/app/actions";
import type { Card, DeckFilters } from "@/lib/deck";
import { directionFor, MIN_DISTANCE, STAR_BEARINGS, SwipeAnswer, vectorFor } from "@/lib/swipe";

type Stars = 1 | 2 | 3 | 4 | 5;
const STARS: Stars[] = [1, 2, 3, 4, 5];
const FLY = 700; // px the card travels when it leaves

// Where each star target sits around the card (the fan across the top half).
const TARGET_POS: Record<Stars, React.CSSProperties> = {
  1: { left: 0, top: "42%" },
  2: { left: "6%", top: 4 },
  3: { left: "50%", top: -6, transform: "translateX(-50%)" },
  4: { right: "6%", top: 4 },
  5: { right: 0, top: "42%" },
};

function StarStamp({ stars }: { stars: number }) {
  return (
    <span>
      {"★".repeat(stars)}
      <span className="opacity-30">{"★".repeat(5 - stars)}</span>
    </span>
  );
}

export function SwipeDeck({ genre, filters = {} }: { genre: number; filters?: DeckFilters }) {
  const [queue, setQueue] = useState<Card[]>([]);
  const [history, setHistory] = useState<{ card: Card; answer: SwipeAnswer }[]>([]);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const [flying, setFlying] = useState<{ answer: SwipeAnswer; x: number; y: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fetching = useRef(false);
  const known = useRef(new Set<number>());

  const refill = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const res = await nextCards(genre, [...known.current], filters);
      if (res.error) setError(res.error);
      if (res.done) setEmpty(res.done);
      res.cards.forEach((c) => known.current.add(c.id));
      setQueue((q) => [...q, ...res.cards.filter((c) => !q.some((x) => x.id === c.id))]);
    } catch {
      setError("Couldn't load films. Check your connection and try again.");
    } finally {
      fetching.current = false;
      setLoading(false);
    }
    // filters only change with a new deck (the page remounts it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genre]);

  useEffect(() => {
    refill();
  }, [refill]);

  useEffect(() => {
    if (!loading && queue.length < 5) refill();
  }, [queue.length, loading, refill]);

  // `from` is the drag vector when swiped; buttons fly the card towards the
  // target they stand for.
  const answer = useCallback(
    (a: SwipeAnswer, from?: { dx: number; dy: number }) => {
      const card = queue[0];
      if (!card || flying) return;
      let v: { x: number; y: number };
      if (from && Math.hypot(from.dx, from.dy) > 0) {
        const len = Math.hypot(from.dx, from.dy);
        v = { x: from.dx / len, y: from.dy / len };
      } else {
        v = a.kind === "unseen" ? { x: 0, y: 1 } : vectorFor(STAR_BEARINGS[a.stars]);
      }
      setFlying({ answer: a, x: v.x * FLY, y: v.y * FLY });
      setTimeout(() => {
        setQueue((q) => q.slice(1));
        setHistory((h) => [{ card, answer: a }, ...h].slice(0, 30));
        setFlying(null);
        setDrag({ dx: 0, dy: 0, active: false });
        setDone((d) => d + 1);
      }, 240);
      const save = a.kind === "unseen" ? swipe(card.id, "unseen") : rateStars(card.id, a.stars);
      save.catch(() => setError("That answer didn't save — check your connection."));
    },
    [queue, flying],
  );

  const undo = () => {
    const [last, ...rest] = history;
    if (!last) return;
    setHistory(rest);
    setQueue((q) => [last.card, ...q]);
    setDone((d) => Math.max(0, d - 1));
    undoSwipe(last.card.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 5) answer({ kind: "stars", stars: n as Stars });
      if (e.key === "ArrowDown") answer({ kind: "unseen" });
      if (e.key === "Backspace") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const card = queue[0];
  const dist = Math.hypot(drag.dx, drag.dy);
  // While dragging, point at a target early (from 30 px) so you can see where
  // you're heading; it only counts once past MIN_DISTANCE.
  const aiming =
    flying?.answer ??
    (drag.active && dist >= 30
      ? directionFor((drag.dx / dist) * MIN_DISTANCE, (drag.dy / dist) * MIN_DISTANCE)
      : null);
  const armed = !!flying || (drag.active && dist >= MIN_DISTANCE);
  const pos = flying ?? { x: drag.dx, y: drag.dy };

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between text-sm text-gray-400">
        <span>{done} answered this session</span>
        <button onClick={undo} disabled={!history.length} className="disabled:opacity-30">
          ↶ Undo
        </button>
      </div>

      {/* The stage: star targets fanned across the top, "haven't seen" below.
          The targets sit above the card so the one you're dragging towards
          stays visible. */}
      <div className="relative mx-auto px-10 pb-9 pt-10" style={{ width: "min(100%, 26rem)" }}>
        {STARS.map((n) => {
          const on = aiming?.kind === "stars" && aiming.stars === n;
          return (
            <div
              key={n}
              style={TARGET_POS[n]}
              className={`pointer-events-none absolute z-20 flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold transition ${
                on ? `scale-125 border-accent ${armed ? "bg-accent text-ink" : "bg-accent/30 text-accent"}` : "border-line bg-panel text-gray-400"
              }`}
            >
              {n}★
            </div>
          );
        })}
        <div
          className={`pointer-events-none absolute bottom-0 left-1/2 z-20 -translate-x-1/2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
            aiming?.kind === "unseen" ? `scale-110 border-sky-400 ${armed ? "bg-sky-400 text-ink" : "bg-sky-400/30 text-sky-300"}` : "border-line bg-panel text-gray-400"
          }`}
        >
          ↓ Haven&apos;t seen
        </div>

        <div
          className="relative z-10 mx-auto aspect-[2/3] touch-none"
          style={{ width: "min(100%, calc((100dvh - 360px) * 0.6667))" }}
        >
          {queue.slice(1, 3).reverse().map((c, i) => (
            <div
              key={c.id}
              className="absolute inset-0 overflow-hidden rounded-3xl border border-line bg-panel"
              style={{ transform: `scale(${0.94 + i * 0.03}) translateY(${(1 - i) * 12}px)` }}
            >
              {c.poster && <img src={c.poster} alt="" className="h-full w-full object-cover opacity-60" draggable={false} />}
            </div>
          ))}

          {card ? (
            <div
              key={card.id}
              className="absolute inset-0 cursor-grab overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl"
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px) rotate(${pos.x / 18}deg)`,
                transition: drag.active && !flying ? "none" : "transform 240ms ease-out",
              }}
              onPointerDown={(e) => {
                start.current = { x: e.clientX, y: e.clientY };
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                setDrag({ dx: 0, dy: 0, active: true });
              }}
              onPointerMove={(e) => {
                if (!start.current) return;
                setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y, active: true });
              }}
              onPointerUp={() => {
                start.current = null;
                const a = directionFor(drag.dx, drag.dy);
                if (a) answer(a, drag);
                else setDrag({ dx: 0, dy: 0, active: false });
              }}
              onPointerCancel={() => {
                start.current = null;
                setDrag({ dx: 0, dy: 0, active: false });
              }}
            >
              {card.poster ? (
                <img src={card.poster} alt={card.title} className="h-full w-full object-cover" draggable={false} />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-2xl font-bold">{card.title}</div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent p-4 pt-16">
                <div className="text-lg font-bold leading-tight">
                  {card.title} <span className="font-normal text-gray-300">{card.year ?? ""}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-gray-300">{card.overview}</p>
              </div>
              {aiming && (
                <div
                  className={`absolute left-1/2 top-8 -translate-x-1/2 -rotate-6 whitespace-nowrap rounded-lg border-4 bg-black/50 px-3 py-1 text-2xl font-black transition-opacity ${
                    aiming.kind === "unseen" ? "border-sky-400 text-sky-400" : "border-accent text-accent"
                  } ${armed ? "opacity-100" : "opacity-50"}`}
                >
                  {aiming.kind === "unseen" ? "NOT SEEN" : <StarStamp stars={aiming.stars} />}
                </div>
              )}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center rounded-3xl border border-dashed border-line p-6 text-center text-gray-400">
              {loading ? "Loading films…" : error ?? empty ?? "That's every film here that fits. Try other filters."}
            </div>
          )}
        </div>
      </div>

      {error && card && <p className="mt-1 text-center text-sm text-red-400">{error}</p>}

      <p className="mt-2 text-center text-xs text-gray-500">Swipe towards the stars you&apos;d give it · down if you haven&apos;t seen it</p>
    </div>
  );
}
