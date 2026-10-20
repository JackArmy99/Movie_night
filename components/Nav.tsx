import Link from "next/link";
import { cookies } from "next/headers";
import { pileCount } from "@/lib/pile";
import { USER_COOKIE } from "@/lib/token";
import { BackLink } from "./BackLink";

const TABS = [
  { href: "/swipe/0", label: "Swipe", icon: "🃏" },
  { href: "/search", label: "Search", icon: "🔍" },
  { href: "/tonight", label: "Tonight", icon: "🍿" },
  { href: "/watchlist", label: "Watchlist", icon: "📌" },
  { href: "/calendar", label: "Cinema", icon: "📅" },
];

// The bottom tab bar, like a phone app. The Watchlist tab shows how many
// films are waiting in your "To decide" pile.
export async function Nav({ active }: { active?: string }) {
  const userId = cookies().get(USER_COOKIE)?.value;
  const toDecide = userId ? await pileCount(userId).catch(() => 0) : 0;
  return <NavBar active={active} toDecide={toDecide} />;
}

// The bar itself, with no database work: loading screens use it directly so
// they appear instantly.
export function NavBar({ active, toDecide = 0 }: { active?: string; toDecide?: number }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-xl justify-around">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-1 flex-col items-center py-2 text-xs ${active === t.href ? "text-accent" : "text-gray-400"}`}
          >
            <span className="relative text-xl leading-6">
              {t.icon}
              {t.href === "/watchlist" && toDecide > 0 && (
                <span className="absolute -right-3 -top-1 min-w-[1.1rem] rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-ink">
                  {toDecide > 99 ? "99+" : toDecide}
                </span>
              )}
            </span>
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
      {back && <BackLink fallback={back} />}
      <h1 className="flex-1 text-2xl font-bold">{title}</h1>
      {right}
    </header>
  );
}
