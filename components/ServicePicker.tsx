"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setService } from "@/app/actions";
import type { Provider } from "@/lib/tmdb";

const IMG = "https://image.tmdb.org/t/p/w92";

// A scrollable row of streaming services; tap to tick the ones you have.
// Shared by both of you, and the same list as in Settings.
export function ServicePicker({ services, initial }: { services: Provider[]; initial: number[] }) {
  const router = useRouter();
  const [mine, setMine] = useState(initial);
  const [, start] = useTransition();
  if (!services.length) return null;
  const toggle = (id: number) => {
    const on = !mine.includes(id);
    setMine((m) => (on ? [...m, id] : m.filter((x) => x !== id)));
    start(async () => {
      await setService(id, on);
      router.refresh();
    });
  };
  return (
    <div>
      <div className="mb-1 text-xs text-gray-400">Our services (tap to tick):</div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {services.slice(0, 20).map((p) => {
          const on = mine.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs ${
                on ? "border-accent bg-accent/15 text-white" : "border-line text-gray-400"
              }`}
            >
              {p.logo ? (
                <img src={`${IMG}${p.logo}`} alt="" className={`h-6 w-6 rounded-full ${on ? "" : "opacity-50"}`} />
              ) : (
                <span className="h-6 w-6 rounded-full bg-line" />
              )}
              {p.name}
              {on && <span className="text-accent">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
