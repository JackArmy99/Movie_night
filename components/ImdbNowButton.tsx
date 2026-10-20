"use client";

import { useState, useTransition } from "react";
import { updateImdbNow } from "@/app/actions";

export function ImdbNowButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1">
      <button
        disabled={pending}
        onClick={() => start(async () => setMsg((await updateImdbNow()).message))}
        className="btn-ghost w-full text-sm"
      >
        {pending ? "Fetching IMDb's ratings file… (about 10–20 s)" : "⭐ Update IMDb ratings now"}
      </button>
      {msg && <p className="text-xs text-gray-400">{msg}</p>}
    </div>
  );
}
