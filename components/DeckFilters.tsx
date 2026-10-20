"use client";

import { useState } from "react";

// The swipe deck's filters fold away behind one button, so the card keeps the
// screen; a one-line summary shows what's active.
export function DeckFilters({ summary, children }: { summary: string[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1 space-y-2">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((o) => !o)} className={summary.length ? "chip-on shrink-0" : "chip shrink-0"}>
          {open ? "✕ Close" : `⚙ Filters${summary.length ? ` · ${summary.length}` : ""}`}
        </button>
        {!open && summary.length > 0 && <span className="truncate text-xs text-gray-400">{summary.join(" · ")}</span>}
      </div>
      {open && <div className="card space-y-3 p-3">{children}</div>}
    </div>
  );
}
