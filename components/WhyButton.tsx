"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { explainFilms } from "@/app/actions";

// One Claude call for the top films on screen: "why you'd both like it".
export function WhyButton({ ids, because }: { ids: number[]; because: Record<number, string[]> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!ids.length) return null;
  return (
    <div className="mb-3">
      <button
        className="btn-ghost w-full text-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await explainFilms(ids, because);
            setError(res.error ?? null);
            router.refresh();
          })
        }
      >
        {pending ? "Asking Claude…" : `✨ Why would we like these? (top ${Math.min(ids.length, 10)}, about 1p)`}
      </button>
      {error && <p className="mt-1 text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}
