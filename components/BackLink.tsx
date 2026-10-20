"use client";

import { useRouter } from "next/navigation";

// "‹" goes back to wherever you came from (Search, Tonight, the calendar…),
// or to `fallback` when the page was opened directly.
export function BackLink({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
      className="text-2xl text-gray-400"
      aria-label="Back"
    >
      ‹
    </button>
  );
}
