import { db } from "@/lib/db";
import { allUsers, me } from "@/lib/session";
import { getJson, getMyServices, setJson } from "@/lib/settings";
import { dutchServices, hasTmdb, IMG, Provider } from "@/lib/tmdb";
import { hasOmdb } from "@/lib/omdb";
import { hasClaude, monthlyCap, spentThisMonth, MODEL } from "@/lib/claude";
import { renamePerson, resetDeck, saveServices, switchUser } from "../actions";
import { Header, Nav } from "@/components/Nav";
import { ImportForm } from "@/components/ImportForm";

export const dynamic = "force-dynamic";

// The big Dutch services first; TMDB lists dozens of small ones.
const POPULAR = [8, 119, 337, 72, 1899, 350, 71, 1773, 2, 3];

async function services(): Promise<Provider[]> {
  const cached = await getJson<{ at: number; list: Provider[] } | null>("services_list", null);
  if (cached && Date.now() - cached.at < 7 * 864e5) return cached.list;
  if (!hasTmdb()) return cached?.list ?? [];
  try {
    const list = await dutchServices();
    await setJson("services_list", { at: Date.now(), list });
    return list;
  } catch {
    return cached?.list ?? [];
  }
}

export default async function Settings({ searchParams }: { searchParams: { saved?: string } }) {
  const user = await me();
  const [users, mine, list, spent, counts] = await Promise.all([
    allUsers(),
    getMyServices(),
    services(),
    spentThisMonth(),
    db.swipe.groupBy({ by: ["userId", "source"], _count: true }),
  ]);
  const sorted = [...list].sort((a, b) => {
    const ia = POPULAR.indexOf(a.id);
    const ib = POPULAR.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
  });
  const fromLb = (id: string) => counts.find((c) => c.userId === id && c.source === "letterboxd")?._count ?? 0;

  return (
    <main className="pb-tabs space-y-6">
      <Header title="Settings" back="/" />

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Import from Letterboxd</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-400">
          <li>
            On letterboxd.com: <b>Settings → Data → Export your data</b>. You get a .zip.
          </li>
          <li>Pick that .zip below. No need to unzip it.</li>
          <li>
            Your partner does the same <b>on their own phone</b> (so it goes to their profile).
          </li>
        </ol>
        <p className="text-xs text-gray-500">
          4½–5★ become super likes, 3–4★ likes, 2½★ and below dislikes; watched without stars counts as seen. Your
          watchlist comes across too. Films you've already swiped in the app keep your swipe.
        </p>
        <ImportForm name={user.name} />
        <p className="text-xs text-gray-500">
          Imported so far: {users.map((u) => `${u.name} ${fromLb(u.id)}`).join(" · ")}
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Our streaming services</h2>
        {searchParams.saved === "services" && <p className="text-sm text-green-400">Saved ✓</p>}
        {!sorted.length ? (
          <p className="text-sm text-gray-400">Appears once TMDB is connected.</p>
        ) : (
          <form action={saveServices} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {sorted.slice(0, 40).map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10">
                  <input type="checkbox" name="service" value={p.id} defaultChecked={mine.includes(p.id)} className="accent-[#f5b942]" />
                  {p.logo && <img src={`${IMG}w45${p.logo}`} alt="" className="h-5 w-5 rounded" />}
                  <span className="truncate">{p.name}</span>
                </label>
              ))}
            </div>
            <button className="btn-primary w-full">Save services</button>
          </form>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">The two of you</h2>
        {users.map((u) => (
          <form key={u.id} action={renamePerson} className="flex gap-2">
            <input type="hidden" name="id" value={u.id} />
            <input name="name" defaultValue={u.name} className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2" />
            <button className="btn-ghost py-2 text-sm">Rename</button>
          </form>
        ))}
        <form action={switchUser}>
          <button className="btn-ghost w-full text-sm">This isn't {user.name}'s phone — switch</button>
        </form>
      </section>

      <section className="card space-y-2 p-4 text-sm">
        <h2 className="font-semibold">Connections and costs</h2>
        <Row ok={hasTmdb()} label="TMDB (films, posters, where to watch)" note="free" />
        <Row ok={hasOmdb()} label="OMDb (IMDb, Rotten Tomatoes, Metacritic)" note="free, 1,000 lookups/day" />
        <Row
          ok={hasClaude()}
          label={`Claude explanations (${MODEL})`}
          note={hasClaude() ? `$${spent.toFixed(3)} of $${monthlyCap()} this month` : "optional"}
        />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Your data</h2>
        <a href="/api/export" className="btn-ghost w-full text-sm">
          ⬇️ Download a backup (all swipes and watchlists)
        </a>
        <form action={resetDeck}>
          <button className="btn-ghost w-full text-sm">Restart the swipe decks from the top</button>
        </form>
      </section>
      <Nav />
    </main>
  );
}

function Row({ ok, label, note }: { ok: boolean; label: string; note: string }) {
  return (
    <div className="flex items-start gap-2">
      <span>{ok ? "✅" : "⚪"}</span>
      <span className="flex-1">{label}</span>
      <span className="text-xs text-gray-400">{note}</span>
    </div>
  );
}
