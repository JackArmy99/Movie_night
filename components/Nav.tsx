import Link from "next/link";

const TABS = [
  { href: "/swipe", label: "Swipe", icon: "🃏" },
  { href: "/suggest", label: "Suggest", icon: "✨" },
  { href: "/tonight", label: "Tonight", icon: "🍿" },
  { href: "/watchlist", label: "Watchlist", icon: "📌" },
  { href: "/calendar", label: "Cinema", icon: "📅" },
];

// The bottom tab bar, like a phone app.
export function Nav({ active }: { active?: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-xl justify-around">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-1 flex-col items-center py-2 text-xs ${active === t.href ? "text-accent" : "text-gray-400"}`}
          >
            <span className="text-xl leading-6">{t.icon}</span>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function Header({ title, back, right }: { title: string; back?: string; right?: React.ReactNode }) {
  return (
    <header className="mb-4 flex items-center gap-3">
      {back && (
        <Link href={back} className="text-2xl text-gray-400" aria-label="Back">
          ‹
        </Link>
      )}
      <h1 className="flex-1 text-2xl font-bold">{title}</h1>
      {right}
    </header>
  );
}
