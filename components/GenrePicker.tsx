"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GENRES } from "@/lib/genres";

// Any single genre, for when none of the moods fits. Picking one clears the
// mood (and the other way round).
export function GenrePicker() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  return (
    <select
      value={params.get("g") ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.delete("mood");
        next.delete("n");
        if (e.target.value) next.set("g", e.target.value);
        else next.delete("g");
        router.replace(`${path}?${next.toString()}`);
      }}
      className="chip appearance-none bg-panel pr-6"
    >
      <option value="">🎞️ Any genre</option>
      {GENRES.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}
