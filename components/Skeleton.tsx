import { NavBar } from "./Nav";

// What a tab shows while the server is still working: its title, a few grey
// blocks and the tab bar, so a tap responds immediately.
export function Skeleton({ title, active, rows = 3, tall = false }: { title: string; active?: string; rows?: number; tall?: boolean }) {
  return (
    <main className="pb-tabs space-y-3">
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      <div className="flex gap-2">
        <div className="h-9 w-32 animate-pulse rounded-full bg-panel" />
        <div className="h-9 w-24 animate-pulse rounded-full bg-panel" />
      </div>
      {tall ? (
        <div className="mx-auto aspect-[2/3] w-2/3 animate-pulse rounded-3xl bg-panel" />
      ) : (
        Array.from({ length: rows }, (_, i) => <div key={i} className="card h-40 animate-pulse" />)
      )}
      <NavBar active={active} />
    </main>
  );
}
