"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GENRES, SUPERHERO } from "@/lib/genres";
import { MOODS } from "@/lib/moods";
import { useControlBar } from "./ControlBar";

// Every choosable item in "Custom": the genres plus Superhero.
const CUSTOM_ITEMS = [...GENRES.map((g) => ({ key: String(g.id), name: g.name })), { key: SUPERHERO, name: "🦸 Superhero" }];

// The genre panel.
// - Any genre, or one mood (Tonight) / one genre: sets ?mood or ?g (Tonight)
//   or /swipe/<id> (deck), and closes the panel.
// - Custom: everything starts ticked; untick what you don't want (?gx= holds
//   the unticked ones). Clear unticks all, to pick just a few. The panel stays
//   open while you tick.
export function GenreChoices({ mode, counts }: { mode: "tonight" | "deck"; counts?: Record<number, number> }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const bar = useControlBar();

  // Build the next address from the current one; `deckGenre` moves the deck.
  const go = (edit: (p: URLSearchParams) => void, deckGenre?: number) => {
    const next = new URLSearchParams(params.toString());
    next.delete("n");
    edit(next);
    const q = next.toString();
    const base = mode === "deck" ? `/swipe/${deckGenre ?? (path.split("/")[2] || 0)}` : path;
    router.replace(`${base}${q ? `?${q}` : ""}`);
  };

  const pickTonight = (patch: { mood?: string; g?: string }) => {
    go((p) => {
      for (const k of ["mood", "g", "gx"]) p.delete(k);
      if (patch.mood) p.set("mood", patch.mood);
      if (patch.g) p.set("g", patch.g);
    });
    bar?.close();
  };
  const pickDeck = (id: number) => {
    go((p) => p.delete("gx"), id);
    bar?.close();
  };

  const custom = params.has("gx");
  const unticked = new Set((params.get("gx") ?? "").split(",").filter(Boolean));
  const setUnticked = (keys: Set<string>) =>
    go(
      (p) => {
        p.delete("mood");
        p.delete("g");
        // Keep the key even when empty: an empty list still means "Custom".
        p.set("gx", [...keys].join(","));
      },
      0, // Custom works across all genres
    );
  const toggle = (key: string) => {
    const next = new Set(unticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setUnticked(next);
  };

  const currentMood = params.get("mood");
  const currentGenre = mode === "deck" ? Number(path.split("/")[2] ?? 0) : Number(params.get("g") ?? 0);
  const anyOn = !custom && (mode === "deck" ? currentGenre === 0 : !currentMood && !currentGenre);
  const count = (id: number) => (counts?.[id] ? <span className="ml-1 text-[10px] opacity-60">{counts[id]}</span> : null);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button onClick={() => (mode === "deck" ? pickDeck(0) : pickTonight({}))} className={anyOn ? "chip-on" : "chip"}>
          🎞️ Any genre{mode === "deck" && count(0)}
        </button>
        <button onClick={() => (custom ? undefined : setUnticked(new Set()))} className={custom ? "chip-on" : "chip"}>
          ✏️ Custom
        </button>
      </div>

      {custom ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Untick what you don&apos;t want</span>
            <span className="flex gap-3">
              <button onClick={() => setUnticked(new Set(CUSTOM_ITEMS.map((i) => i.key)))} className="underline">
                Clear
              </button>
              <button onClick={() => setUnticked(new Set())} className="underline">
                Select all
              </button>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {CUSTOM_ITEMS.map((i) => {
              const on = !unticked.has(i.key);
              return (
                <button
                  key={i.key}
                  onClick={() => toggle(i.key)}
                  aria-pressed={on}
                  className={on ? "chip border-accent/70 bg-accent/15 text-white" : "chip text-gray-500 line-through"}
                >
                  {on ? "✓ " : ""}
                  {i.name}
                </button>
              );
            })}
          </div>
          <button onClick={() => bar?.close()} className="btn-primary w-full py-2 text-sm">
            Done
          </button>
        </div>
      ) : (
        <>
          {mode === "tonight" && (
            <div>
              <div className="mb-1.5 text-xs text-gray-400">Moods</div>
              <div className="flex flex-wrap gap-2">
                {MOODS.map((m) => (
                  <button key={m.key} onClick={() => pickTonight({ mood: m.key })} className={currentMood === m.key ? "chip-on" : "chip"}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1.5 text-xs text-gray-400">Genres</div>
            <div className="flex flex-wrap gap-2">
              {GENRES.map((g) => (
                <button
                  key={g.id}
                  onClick={() => (mode === "deck" ? pickDeck(g.id) : pickTonight({ g: String(g.id) }))}
                  className={currentGenre === g.id ? "chip-on" : "chip"}
                >
                  {g.name}
                  {mode === "deck" && count(g.id)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
