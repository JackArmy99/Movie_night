"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type Option = { value: string; label: string };
type Picker = { key: string; label: string; options: Option[] };

const THIS_YEAR = new Date().getFullYear();

const PICKERS: Picker[] = [
  {
    key: "imdb",
    label: "IMDb",
    options: [{ value: "", label: "IMDb: any" }, ...["6", "6.5", "7", "7.5", "8", "8.5"].map((v) => ({ value: v, label: `IMDb ${v}+` }))],
  },
  {
    key: "rt",
    label: "Rotten Tomatoes",
    options: [{ value: "", label: "🍅 any" }, ...["50", "60", "70", "80", "90"].map((v) => ({ value: v, label: `🍅 ${v}%+` }))],
  },
  {
    key: "from",
    label: "Made in or after",
    options: [
      { value: "", label: "Any year" },
      ...Array.from({ length: THIS_YEAR - 1929 }, (_, i) => String(THIS_YEAR - i)).map((y) => ({ value: y, label: `From ${y}` })),
    ],
  },
  {
    key: "len",
    label: "Length",
    options: [
      { value: "", label: "Any length" },
      { value: "90", label: "Under 1h30" },
      { value: "100", label: "Under 1h40" },
      { value: "120", label: "Under 2h" },
      { value: "150", label: "Under 2h30" },
    ],
  },
];

// Filters live in the address (?imdb=7&rt=80&from=2000), so a filtered list
// can be bookmarked or shared between your phones. They're always on screen:
// tap one and your phone's own picker opens.
export function FilterBar({ showFor = true, rtAvailable }: { showFor?: boolean; rtAvailable: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();

  const apply = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.delete("n"); // a new filter starts from the first page of picks
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    start(() => router.replace(`${path}?${next.toString()}`));
  };

  const mine = params.get("mine") === "1";
  const solo = params.get("for") === "me";
  const anySet = PICKERS.some((p) => params.get(p.key));

  return (
    <div className="space-y-2">
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
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PICKERS.map((p) => {
          const value = params.get(p.key) ?? "";
          const disabled = p.key === "rt" && !rtAvailable;
          return (
            <select
              key={p.key}
              aria-label={p.label}
              value={value}
              disabled={disabled}
              onChange={(e) => apply({ [p.key]: e.target.value })}
              className={`${value ? "chip-on" : "chip bg-panel"} appearance-none disabled:opacity-40`}
            >
              {p.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          );
        })}
        {anySet && (
          <button className="text-xs text-gray-400 underline" onClick={() => apply({ imdb: null, rt: null, from: null, len: null })}>
            Clear
          </button>
        )}
        {pending && <span className="text-xs text-gray-400">Updating…</span>}
      </div>
      {!rtAvailable && (
        <p className="text-xs text-gray-500">Rotten Tomatoes scores appear once OMDb is working (see ⚙️ Settings).</p>
      )}
    </div>
  );
}
