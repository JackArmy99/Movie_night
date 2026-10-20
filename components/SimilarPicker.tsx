"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { searchFilms } from "@/app/actions";

type Hit = { id: number; title: string; year: number | null; poster: string | null };
const MAX = 5;

// "Similar to…": pick one or more films and the list narrows to films like
// them. Lives in the address (?like=329865,157336) like the other filters.
export function SimilarPicker({ chosen }: { chosen: { id: number; title: string }[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const setLike = (ids: number[]) => {
    const next = new URLSearchParams(params.toString());
    next.delete("n");
    if (ids.length) next.set("like", ids.join(","));
    else next.delete("like");
    start(() => router.replace(`${path}?${next.toString()}`));
  };

  // Search as you type, a moment after the last key.
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        setHits(await searchFilms(q));
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const ids = chosen.map((c) => c.id);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {chosen.map((c) => (
          <button key={c.id} onClick={() => setLike(ids.filter((id) => id !== c.id))} className="chip-on">
            Like {c.title} ✕
          </button>
        ))}
        {ids.length < MAX && (
          <button onClick={() => setOpen((o) => !o)} className={open ? "chip border-accent text-accent" : "chip"}>
            ＋ Similar to…
          </button>
        )}
      </div>
      {open && (
        <div className="card space-y-2 p-3">
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="A film you'd like more of, e.g. Arrival"
            enterKeyHint="search"
            className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-base"
          />
          {busy && <p className="text-xs text-gray-400">Searching…</p>}
          {hits.map((h) => (
            <button
              key={h.id}
              disabled={ids.includes(h.id)}
              onClick={() => {
                setLike([...ids, h.id]);
                setQ("");
                setHits([]);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-lg p-1 text-left active:bg-white/5 disabled:opacity-40"
            >
              {h.poster ? <img src={h.poster} alt="" className="h-12 w-8 rounded object-cover" /> : <span className="h-12 w-8 rounded bg-line" />}
              <span className="text-sm">
                {h.title} <span className="text-gray-400">{h.year ?? ""}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
