import { redirect } from "next/navigation";

// The Swipe tab opens straight on the cards (all genres); genre is a filter
// there now. Old links keep their filters.
export default function Swipe({ searchParams }: { searchParams: Record<string, string> }) {
  const q = new URLSearchParams(searchParams).toString();
  redirect(`/swipe/0${q ? `?${q}` : ""}`);
}
