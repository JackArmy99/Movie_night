"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GENRES } from "@/lib/genres";
import { MOODS } from "@/lib/moods";
import { useControlBar } from "./ControlBar";

// The genre panel. Tonight: moods first, then every genre (sets ?mood or ?g).
// Swipe deck: every genre, with how many you've seen in each (goes to
// /swipe/<id>, keeping the other filters).
export function GenreChoices({ mode, counts }: { mode: "tonight" | "deck"; counts?: Record<number, number> }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const bar = useControlBar();

  const pickTonight = (patch: { mood?: string; g?: string }) => {
    const next = new URLSearchParams(params.toString());
    for (const k of ["mood", "g", "n"]) next.delete(k);
    if (patch.mood) next.set("mood", patch.mood);
    if (patch.g) next.set("g", patch.g);
    router.replace(`${path}?${next.toString()}`);
    bar?.close();
  };
  const pickDeck = (id: number) => {
    const q = params.toString();
    router.replace(`/swipe/${id}${q ? `?${q}` : ""}`);
    bar?.close();
  };

  const currentMood = params.get("mood");
  const currentGenre = mode === "deck" ? Number(path.split("/")[2] ?? 0) : Number(params.get("g") ?? 0);
  const anyOn = mode === "deck" ? currentGenre === 0 : !currentMood && !currentGenre;
  const count = (id: number) => (counts?.[id] ? <span className="ml-1 text-[10px] opacity-60">{counts[id]}</span> : null);

  return (
    <div className="space-y-3">
      <button
        onClick={() => (mode === "deck" ? pickDeck(0) : pickTonight({}))}
        className={anyOn ? "chip-on" : "chip"}
      >
        🎞️ Any genre{mode === "deck" && count(0)}
      </button>
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
    </div>
  );
}
