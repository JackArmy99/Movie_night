import { db } from "@/lib/db";
import { allUsers, me } from "@/lib/session";
import { getMyServices } from "@/lib/settings";
import { hasTmdb, IMG } from "@/lib/tmdb";
import { serviceList } from "@/lib/services";
import { hasOmdb, omdbStatus } from "@/lib/omdb";
import { hasClaude, monthlyCap, spentThisMonth, MODEL } from "@/lib/claude";
import { renamePerson, resetDeck, saveServices, switchUser } from "../actions";
import { Header, Nav } from "@/components/Nav";
import { ImportForm } from "@/components/ImportForm";
import { ImdbNowButton } from "@/components/ImdbNowButton";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the IMDb update button

export default async function Settings({ searchParams }: { searchParams: { saved?: string } }) {
  const user = await me();
  const [users, mine, list, spent, counts] = await Promise.all([
    allUsers(),
    getMyServices(),
    serviceList(),
    spentThisMonth(),
    db.swipe.groupBy({ by: ["userId", "source"], _count: true }),
  ]);
  const sorted = list;
  const lastImdb = (await db.movie.aggregate({ _max: { imdbAt: true } }))._max.imdbAt;
  const omdb = await omdbStatus();
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
        <Row
          ok={hasOmdb() && omdb?.state !== "invalid_key"}
          label="OMDb (Rotten Tomatoes, Metacritic, same-day IMDb)"
          note={omdb?.state === "invalid_key" ? "key refused" : "free, 1,000 lookups/day"}
        />
        {omdb?.state === "invalid_key" && (
          <p className="rounded-lg bg-red-500/10 p-2 text-xs text-red-300">
            OMDb says the key is invalid, so there are no Rotten Tomatoes scores. Usually the key isn&apos;t activated
            yet: open OMDb&apos;s email and click the activation link. If it is, check <code>OMDB_KEY</code> in Vercel
            holds just the 8 characters.
          </p>
        )}
        <Row
          ok={Boolean(process.env.CRON_SECRET)}
          label="IMDb ratings, refreshed daily from IMDb's own file"
          note={lastImdb ? `last ${lastImdb.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "free, needs CRON_SECRET"}
        />
        <ImdbNowButton />
        <Row
          ok={hasClaude()}
          label={`Claude explanations (${MODEL})`}
          note={hasClaude() ? `$${spent.toFixed(3)} of $${monthlyCap()} this month` : "optional"}
        />
      </section>

      <p className="px-1 text-xs text-gray-500">
        Film data and where-to-watch: TMDB and JustWatch. IMDb ratings: IMDb non-commercial datasets.
      </p>

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
