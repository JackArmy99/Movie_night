"use client";

import { createContext, useContext, useState } from "react";

const Ctx = createContext<{ close: () => void } | null>(null);
export const useControlBar = () => useContext(Ctx);

// The one row of controls above Tonight and the swipe deck: a genre button and
// a Filters button. Each opens its panel underneath; when both are closed, a
// single line says what's switched on. Keeps the films near the top.
export function ControlBar({
  genreLabel,
  genreActive,
  genrePanel,
  filtersPanel,
  summary,
}: {
  genreLabel: string;
  genreActive: boolean;
  genrePanel: React.ReactNode;
  filtersPanel: React.ReactNode;
  summary: string[];
}) {
  const [open, setOpen] = useState<"genre" | "filters" | null>(null);
  const toggle = (which: "genre" | "filters") => setOpen((o) => (o === which ? null : which));
  return (
    <Ctx.Provider value={{ close: () => setOpen(null) }}>
      <div className="mb-2 space-y-2">
        <div className="flex items-center gap-2">
          <button onClick={() => toggle("genre")} className={`${genreActive ? "chip-on" : "chip"} max-w-[60%] truncate`}>
            {genreLabel} {open === "genre" ? "▴" : "▾"}
          </button>
          <button onClick={() => toggle("filters")} className={summary.length ? "chip-on shrink-0" : "chip shrink-0"}>
            ⚙ Filters{summary.length ? ` · ${summary.length}` : ""} {open === "filters" ? "▴" : "▾"}
          </button>
        </div>
        {!open && summary.length > 0 && <p className="truncate text-xs text-gray-400">{summary.join(" · ")}</p>}
        {open === "genre" && <div className="card p-3">{genrePanel}</div>}
        {open === "filters" && <div className="card space-y-3 p-3">{filtersPanel}</div>}
      </div>
    </Ctx.Provider>
  );
}
