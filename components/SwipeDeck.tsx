"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, nextCards, swipe, toggleWatchlist, undoSwipe } from "@/app/actions";

type Verdict = "like" | "dislike" | "superlike" | "unseen" | "want";
const THRESHOLD = 90;

const LABEL: Record<Verdict, { text: string; cls: string }> = {
  like: { text: "LIKED", cls: "border-green-400 text-green-400" },
  dislike: { text: "NOPE", cls: "border-red-400 text-red-400" },
  superlike: { text: "LOVED IT", cls: "border-accent text-accent" },
  unseen: { text: "NOT SEEN", cls: "border-sky-400 text-sky-400" },
  want: { text: "WANT TO SEE", cls: "border-sky-400 text-sky-400" },
};

// Drag direction → answer. Right like, left nope, up loved, down not seen.
function verdictFor(dx: number, dy: number): Verdict | null {
  if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "like" : "dislike";
  return dy < 0 ? "superlike" : "unseen";
}

export function SwipeDeck({ genre }: { genre: number }) {
  const [queue, setQueue] = useState<Card[]>([]);
  const [history, setHistory] = useState<{ card: Card; verdict: Verdict }[]>([]);
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const [flying, setFlying] = useState<Verdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fetching = useRef(false);
  const known = useRef(new Set<number>());

  const refill = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const res = await nextCards(genre, [...known.current]);
      if (res.error) setError(res.error);
      res.cards.forEach((c) => known.current.add(c.id));
      setQueue((q) => [...q, ...res.cards.filter((c) => !q.some((x) => x.id === c.id))]);
    } catch {
      setError("Couldn't load films. Check your connection and try again.");
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, [genre]);

  useEffect(() => {
    refill();
  }, [refill]);

  useEffect(() => {
    if (!loading && queue.length < 5) refill();
  }, [queue.length, loading, refill]);

  const answer = useCallback(
    (verdict: Verdict) => {
      const card = queue[0];
      if (!card || flying) return;
      setFlying(verdict);
      setTimeout(() => {
        setQueue((q) => q.slice(1));
        setHistory((h) => [{ card, verdict }, ...h].slice(0, 30));
        setFlying(null);
        setDrag({ dx: 0, dy: 0, active: false });
        setDone((d) => d + 1);
      }, 220);
      const save =
        verdict === "want"
          ? swipe(card.id, "unseen").then(() => toggleWatchlist(card.id))
          : swipe(card.id, verdict);
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
    undoSwipe(last.card.id).then(() => (last.verdict === "want" ? toggleWatchlist(last.card.id) : undefined));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Verdict> = { ArrowRight: "like", ArrowLeft: "dislike", ArrowUp: "superlike", ArrowDown: "unseen" };
      if (map[e.key]) answer(map[e.key]);
      if (e.key === "Backspace") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const card = queue[0];
  const live = flying ?? (drag.active ? verdictFor(drag.dx, drag.dy) : null);
  const fly =
    flying === "like"
      ? { x: 600, y: drag.dy }
      : flying === "dislike"
        ? { x: -600, y: drag.dy }
        : flying === "superlike"
          ? { x: drag.dx, y: -900 }
          : flying
            ? { x: drag.dx, y: 900 }
            : { x: drag.dx, y: drag.dy };

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between text-sm text-gray-400">
        <span>{done} answered this session</span>
        <button onClick={undo} disabled={!history.length} className="disabled:opacity-30">
          ↶ Undo
        </button>
      </div>

      {/* Sized from the screen height so the buttons always fit above the tab bar. */}
      <div
        className="relative mx-auto aspect-[2/3] touch-none"
        style={{ width: "min(100%, 24rem, calc((100dvh - 380px) * 0.6667))" }}
      >
        {queue.slice(1, 3).reverse().map((c, i) => (
          <div key={c.id} className="absolute inset-0 overflow-hidden rounded-3xl border border-line bg-panel" style={{ transform: `scale(${0.94 + i * 0.03}) translateY(${(1 - i) * 14}px)` }}>
            {c.poster && <img src={c.poster} alt="" className="h-full w-full object-cover opacity-60" draggable={false} />}
          </div>
        ))}

        {card ? (
          <div
            key={card.id}
            className="absolute inset-0 cursor-grab overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl"
            style={{
              transform: `translate(${fly.x}px, ${fly.y}px) rotate(${fly.x / 18}deg)`,
              transition: drag.active && !flying ? "none" : "transform 220ms ease-out",
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
              const v = verdictFor(drag.dx, drag.dy);
              if (v) answer(v);
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
              <div className="text-xl font-bold">
                {card.title} <span className="font-normal text-gray-300">{card.year ?? ""}</span>
              </div>
              <p className="mt-1 line-clamp-3 text-sm text-gray-300">{card.overview}</p>
            </div>
            {live && (
              <div className={`absolute left-1/2 top-10 -translate-x-1/2 -rotate-6 rounded-lg border-4 bg-black/40 px-4 py-1 text-2xl font-black ${LABEL[live].cls}`}>
                {LABEL[live].text}
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center rounded-3xl border border-dashed border-line p-6 text-center text-gray-400">
            {loading ? "Loading films…" : error ?? "That's every film in this genre. Impressive."}
          </div>
        )}
      </div>

      {error && card && <p className="mt-2 text-center text-sm text-red-400">{error}</p>}

      <div className="mt-4 grid grid-cols-3 gap-3">
        <button onClick={() => answer("dislike")} className="btn-ghost flex-col gap-0 py-2 text-red-400">
          <span className="text-2xl">✕</span>
          <span className="text-xs text-gray-400">Didn't like ←</span>
        </button>
        <button onClick={() => answer("superlike")} className="btn-ghost flex-col gap-0 py-2 text-accent">
          <span className="text-2xl">★</span>
          <span className="text-xs text-gray-400">Loved it ↑</span>
        </button>
        <button onClick={() => answer("like")} className="btn-ghost flex-col gap-0 py-2 text-green-400">
          <span className="text-2xl">♥</span>
          <span className="text-xs text-gray-400">Liked →</span>
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button onClick={() => answer("unseen")} className="btn-ghost py-2.5 text-sm">
          Haven't seen ↓
        </button>
        <button onClick={() => answer("want")} className="btn-ghost py-2.5 text-sm">
          📌 Want to see
        </button>
      </div>
    </div>
  );
}
