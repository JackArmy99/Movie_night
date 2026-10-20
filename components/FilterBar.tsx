"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

type Slider = { key: string; label: string; min: number; max: number; step: number; fmt: (v: number) => string };

const SLIDERS: Slider[] = [
  { key: "imdb", label: "IMDb at least", min: 0, max: 9, step: 0.5, fmt: (v) => (v ? v.toFixed(1) : "any") },
  { key: "rt", label: "Rotten Tomatoes at least", min: 0, max: 100, step: 5, fmt: (v) => (v ? `${v}%` : "any") },
  { key: "from", label: "Released from", min: 1950, max: new Date().getFullYear(), step: 1, fmt: (v) => (v > 1950 ? String(v) : "any") },
  { key: "len", label: "Shorter than", min: 80, max: 200, step: 10, fmt: (v) => (v < 200 ? `${Math.floor(v / 60)}h ${v % 60}m` : "any") },
];

const DEFAULTS: Record<string, number> = { imdb: 0, rt: 0, from: 1950, len: 200 };

// Sliders live in the address (?imdb=7&rt=80), so a filtered list can be
// bookmarked or shared between your phones.
export function FilterBar({ showFor = true, rtAvailable }: { showFor?: boolean; rtAvailable: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState(() =>
    Object.fromEntries(SLIDERS.map((s) => [s.key, Number(params.get(s.key) ?? DEFAULTS[s.key])])),
  );

  const apply = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    start(() => router.replace(`${path}?${next.toString()}`));
  };

  const commit = () =>
    apply(
      Object.fromEntries(
        SLIDERS.map((s) => [s.key, vals[s.key] === DEFAULTS[s.key] ? null : String(vals[s.key])]),
      ),
    );

  const active = SLIDERS.filter((s) => vals[s.key] !== DEFAULTS[s.key]).length;
  const mine = params.get("mine") === "1";
  const solo = params.get("for") === "me";

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {showFor && (
          <>
            <button className={solo ? "chip" : "chip-on"} onClick={() => apply({ for: null })}>
              Both of us
            </button>
            <button className={solo ? "chip-on" : "chip"} onClick={() => apply({ for: "me" })}>
              Just me
            </button>
          </>
        )}
        <button className={mine ? "chip-on" : "chip"} onClick={() => apply({ mine: mine ? null : "1" })}>
          On our services
        </button>
        <button className={active ? "chip-on" : "chip"} onClick={() => setOpen((o) => !o)}>
          Filters{active ? ` · ${active}` : ""}
        </button>
        {pending && <span className="self-center text-xs text-gray-400">Updating…</span>}
      </div>
      {open && (
        <div className="card space-y-4 p-4">
          {SLIDERS.map((s) => (
            <label key={s.key} className={`block ${s.key === "rt" && !rtAvailable ? "opacity-40" : ""}`}>
              <div className="flex justify-between text-sm">
                <span>{s.label}</span>
                <span className="font-semibold text-accent">{s.fmt(vals[s.key])}</span>
              </div>
              <input
                type="range"
                className="w-full"
                min={s.min}
                max={s.max}
                step={s.step}
                value={vals[s.key]}
                disabled={s.key === "rt" && !rtAvailable}
                onChange={(e) => setVals((v) => ({ ...v, [s.key]: Number(e.target.value) }))}
                onPointerUp={commit}
                onKeyUp={commit}
              />
            </label>
          ))}
          {!rtAvailable && <p className="text-xs text-gray-400">Rotten Tomatoes needs the free OMDb key (see Settings).</p>}
          <div className="flex gap-2">
            <button className="btn-primary flex-1 py-2" onClick={() => { commit(); setOpen(false); }}>
              Apply
            </button>
            <button
              className="btn-ghost py-2"
              onClick={() => {
                setVals({ ...DEFAULTS });
                apply({ imdb: null, rt: null, from: null, len: null });
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
