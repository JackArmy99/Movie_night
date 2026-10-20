"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { me, partnerOf } from "@/lib/session";
import { AUTH_COOKIE, USER_COOKIE, authToken } from "@/lib/token";
import { getJson, setJson, setSetting } from "@/lib/settings";
import { saveList, ensureDetails } from "@/lib/movies";
import * as tmdb from "@/lib/tmdb";
import { eloUpdate } from "@/lib/elo";
import { LbFilm, eloFor, verdictFor } from "@/lib/letterboxd";
import { verdictForStars } from "@/lib/score";
import { explain, hasClaude } from "@/lib/claude";

const YEAR = 60 * 60 * 24 * 365;

// Cookies are HTTPS-only whenever the site is served over HTTPS (always, on
// Vercel). Over plain http — a laptop on the home network — a secure cookie
// would be silently dropped and sign-in would loop.
const cookieOpts = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: headers().get("x-forwarded-proto") === "https",
  maxAge: YEAR,
  path: "/",
});

// ---------- signing in ----------

export async function login(_: unknown, form: FormData): Promise<{ error?: string }> {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return { error: "APP_PASSCODE isn't set on the server yet." };
  if (String(form.get("passcode") ?? "").trim() !== passcode) return { error: "That's not the passcode." };
  cookies().set(AUTH_COOKIE, await authToken(), cookieOpts());
  redirect("/who");
}

export async function createPeople(form: FormData) {
  const existing = await db.user.count();
  const names = [form.get("a"), form.get("b")].map((n) => String(n ?? "").trim()).filter(Boolean);
  for (const name of names.slice(0, Math.max(0, 2 - existing))) await db.user.create({ data: { name } });
  redirect("/who");
}

export async function pickUser(id: string) {
  cookies().set(USER_COOKIE, id, cookieOpts());
  redirect("/");
}

export async function switchUser() {
  cookies().delete(USER_COOKIE);
  redirect("/who");
}

// ---------- the swipe deck ----------

export type Card = {
  id: number;
  title: string;
  year: number | null;
  poster: string | null;
  overview: string;
  score: number;
};

// The next films to swipe in a genre, most-watched first, skipping ones you've
// already answered. Remembers how far down TMDB's list you've got per genre.
export async function nextCards(genre: number, skip: number[]): Promise<{ cards: Card[]; error?: string }> {
  const user = await me();
  if (!tmdb.hasTmdb()) return { cards: [], error: "TMDB isn't connected yet — add TMDB_TOKEN." };
  const cursorKey = `deck:${user.id}:${genre}`;
  const start = await getJson<number>(cursorKey, 1);
  let bookmark = start;
  let stillAtBookmark = true;
  const cards: Card[] = [];
  const skipSet = new Set(skip);

  for (let page = start; page < start + 6 && cards.length < 10; page++) {
    const res = await tmdb.mostWatched(genre, page);
    await saveList(res.results);
    const answered = new Set(
      (
        await db.swipe.findMany({
          where: { userId: user.id, movieId: { in: res.results.map((r) => r.id) } },
          select: { movieId: true },
        })
      ).map((s) => s.movieId),
    );
    const open = res.results.filter((r) => !answered.has(r.id));
    // Only move the bookmark past pages you've fully answered, so closing the
    // app halfway down a page never skips anything.
    if (stillAtBookmark && open.length === 0) bookmark = page + 1;
    else stillAtBookmark = false;
    for (const r of open) {
      if (skipSet.has(r.id)) continue;
      skipSet.add(r.id);
      cards.push({
        id: r.id,
        title: r.title,
        year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
        poster: tmdb.poster(r.poster_path, "w500"),
        overview: (r.overview ?? "").slice(0, 220),
        score: r.vote_average ?? 0,
      });
    }
    if (page >= Math.min(res.total_pages, 500)) break;
  }
  if (bookmark !== start) await setJson(cursorKey, bookmark);
  return { cards };
}

// An answer without stars: "unseen" (haven't seen it), "pass" (not
// interested) or "seen" (seen it, no opinion).
export async function swipe(movieId: number, verdict: string) {
  if (!["unseen", "pass", "seen"].includes(verdict)) return;
  const user = await me();
  await db.swipe.upsert({
    where: { userId_movieId: { userId: user.id, movieId } },
    create: { userId: user.id, movieId, verdict, source: "swipe" },
    update: { verdict, stars: null, source: "swipe" },
  });
  // Not interested any more, or seen it: no longer belongs on your watchlist.
  if (verdict !== "unseen") await db.watchlistItem.deleteMany({ where: { userId: user.id, movieId } });
}

// Seen it, with 1–5 stars (half stars allowed).
export async function rateStars(movieId: number, stars: number) {
  if (!(stars >= 0.5 && stars <= 5)) return;
  const user = await me();
  const verdict = verdictForStars(stars);
  const key = { userId_movieId: { userId: user.id, movieId } };
  const existing = await db.swipe.findUnique({ where: key });
  // Keep a film's "this or that" ranking if it was already a super like.
  const elo = existing?.verdict === "superlike" && verdict === "superlike" ? existing.elo : eloFor(stars);
  await db.swipe.upsert({
    where: key,
    create: { userId: user.id, movieId, verdict, stars, elo, source: "swipe" },
    update: { verdict, stars, elo, source: "swipe" },
  });
  await db.watchlistItem.deleteMany({ where: { userId: user.id, movieId } });
}

export async function undoSwipe(movieId: number) {
  const user = await me();
  await db.swipe.deleteMany({ where: { userId: user.id, movieId } });
}

// Rate a film from its own page: stars, or "unseen".
export async function rate(movieId: number, answer: number | "unseen") {
  if (answer === "unseen") await swipe(movieId, "unseen");
  else await rateStars(movieId, answer);
  revalidatePath(`/movie/${movieId}`);
}

// The "To decide" pile: want to see it (→ watchlist) or not interested.
export async function decide(movieId: number, want: boolean) {
  const user = await me();
  if (want) {
    await db.watchlistItem.upsert({
      where: { userId_movieId: { userId: user.id, movieId } },
      create: { userId: user.id, movieId },
      update: {},
    });
  } else {
    await swipe(movieId, "pass");
  }
  revalidatePath("/watchlist");
}

// ---------- "this or that" ----------

export async function pickWinner(winner: number, loser: number) {
  const user = await me();
  const rows = await db.swipe.findMany({
    where: { userId: user.id, movieId: { in: [winner, loser] }, verdict: "superlike" },
  });
  const w = rows.find((r) => r.movieId === winner);
  const l = rows.find((r) => r.movieId === loser);
  if (!w || !l) return;
  const [we, le] = eloUpdate(w.elo, l.elo);
  await db.$transaction([
    db.swipe.update({
      where: { userId_movieId: { userId: user.id, movieId: winner } },
      data: { elo: we, comparisons: { increment: 1 } },
    }),
    db.swipe.update({
      where: { userId_movieId: { userId: user.id, movieId: loser } },
      data: { elo: le, comparisons: { increment: 1 } },
    }),
  ]);
  revalidatePath("/rank");
}

// ---------- watchlist ----------

export async function toggleWatchlist(movieId: number): Promise<boolean> {
  const user = await me();
  const key = { userId_movieId: { userId: user.id, movieId } };
  const existing = await db.watchlistItem.findUnique({ where: key });
  if (existing) await db.watchlistItem.delete({ where: key });
  else {
    if (!(await db.movie.findUnique({ where: { id: movieId } })) && tmdb.hasTmdb()) {
      await saveList([await tmdb.details(movieId)]);
    }
    await db.watchlistItem.create({ data: { userId: user.id, movieId } });
  }
  revalidatePath("/watchlist");
  return !existing;
}

// "We watched it": my verdict, off both watchlists, and counted as seen for
// my partner until they rate it themselves.
// "We watched it": my stars, off both watchlists, and counted as seen for
// my partner until they rate it themselves.
export async function watchedTogether(movieId: number, stars: number) {
  const user = await me();
  await rateStars(movieId, stars);
  const partner = await partnerOf(user);
  if (partner) {
    await db.swipe.upsert({
      where: { userId_movieId: { userId: partner.id, movieId } },
      create: { userId: partner.id, movieId, verdict: "seen", source: "watchlist" },
      // Only overwrite "hadn't seen it" — never a rating they already gave.
      update: {},
    });
    await db.swipe.updateMany({
      where: { userId: partner.id, movieId, verdict: { in: ["unseen", "pass"] } },
      data: { verdict: "seen", source: "watchlist" },
    });
  }
  await db.watchlistItem.deleteMany({ where: { movieId } });
  revalidatePath("/watchlist");
}

// ---------- Letterboxd import ----------

export type ImportResult = { matched: number; missed: string[] };

// Called by the import screen in batches of ~20 films, so no single request
// runs long.
export async function importBatch(films: LbFilm[]): Promise<ImportResult> {
  const user = await me();
  const result: ImportResult = { matched: 0, missed: [] };
  if (!tmdb.hasTmdb()) return { matched: 0, missed: films.map((f) => f.name) };

  await Promise.all(
    films.slice(0, 40).map(async (f) => {
      try {
        const hit = await tmdb.search(f.name, f.year ?? undefined);
        if (!hit) {
          result.missed.push(`${f.name}${f.year ? ` (${f.year})` : ""}`);
          return;
        }
        await saveList([hit]);
        if (f.watched) {
          const verdict = verdictFor(f.rating, f.hearted);
          const existing = await db.swipe.findUnique({
            where: { userId_movieId: { userId: user.id, movieId: hit.id } },
          });
          // A swipe made in the app is newer and more deliberate; keep it.
          if (!existing || existing.source !== "swipe" || existing.verdict === "unseen" || existing.verdict === "pass") {
            await db.swipe.upsert({
              where: { userId_movieId: { userId: user.id, movieId: hit.id } },
              create: { userId: user.id, movieId: hit.id, verdict, stars: f.rating, elo: eloFor(f.rating, f.hearted), source: "letterboxd" },
              update: { verdict, stars: f.rating, elo: eloFor(f.rating, f.hearted), source: "letterboxd" },
            });
          }
        } else if (f.watchlist) {
          await db.watchlistItem.upsert({
            where: { userId_movieId: { userId: user.id, movieId: hit.id } },
            create: { userId: user.id, movieId: hit.id },
            update: {},
          });
        }
        result.matched++;
      } catch {
        result.missed.push(f.name);
      }
    }),
  );
  return result;
}

// ---------- settings ----------

export async function saveServices(form: FormData) {
  const ids = form.getAll("service").map(Number).filter(Number.isFinite);
  await setJson("services", ids);
  revalidatePath("/settings");
  redirect("/settings?saved=services");
}

// Tick or untick one service (Tonight's service row). Shared by both of you.
export async function setService(id: number, on: boolean) {
  const current = await getJson<number[]>("services", []);
  const next = on ? [...new Set([...current, id])] : current.filter((s) => s !== id);
  await setJson("services", next);
  revalidatePath("/tonight");
}

export async function renamePerson(form: FormData) {
  const id = String(form.get("id"));
  const name = String(form.get("name") ?? "").trim();
  if (name) await db.user.update({ where: { id }, data: { name } });
  revalidatePath("/settings");
}

export async function resetDeck() {
  const user = await me();
  await db.setting.deleteMany({ where: { key: { startsWith: `deck:${user.id}:` } } });
  await setSetting(`deck_reset:${user.id}`, new Date().toISOString());
  revalidatePath("/swipe");
}

// ---------- Claude ----------

export async function explainFilms(movieIds: number[], becauseTitles: Record<number, string[]>): Promise<{
  why: Record<number, string>;
  error?: string;
}> {
  if (!hasClaude()) return { why: {}, error: "Claude isn't connected (no ANTHROPIC_API_KEY)." };
  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });
  const people = await Promise.all(
    users.map(async (u) => {
      const s = await db.swipe.findMany({
        where: { userId: u.id, verdict: { in: ["superlike", "like", "dislike"] } },
        include: { movie: { select: { title: true } } },
        orderBy: [{ elo: "desc" }, { updatedAt: "desc" }],
      });
      const pick = (v: string, n: number) => s.filter((x) => x.verdict === v).slice(0, n).map((x) => x.movie.title);
      return { name: u.name, loved: pick("superlike", 25), liked: pick("like", 25), disliked: pick("dislike", 15) };
    }),
  );
  const films = await db.movie.findMany({ where: { id: { in: movieIds.slice(0, 10) }, why: null } });
  const cached = await db.movie.findMany({ where: { id: { in: movieIds }, why: { not: null } } });
  const why: Record<number, string> = Object.fromEntries(cached.map((m) => [m.id, m.why!]));
  if (!films.length) return { why };
  try {
    const got = await explain({
      people,
      films: films.map((f) => ({
        id: f.id,
        title: f.title,
        year: f.year,
        overview: f.overview,
        because: becauseTitles[f.id] ?? [],
      })),
    });
    for (const [id, text] of got) {
      why[id] = text;
      await db.movie.update({ where: { id }, data: { why: text, whyAt: new Date() } });
    }
    return { why };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return {
      why,
      error: msg === "monthly_cap" ? "This month's Claude budget is used up." : "Claude couldn't answer just now.",
    };
  }
}

// A film's page fills in details the first time it's opened.
export async function refreshMovie(movieId: number) {
  await ensureDetails([movieId]);
  revalidatePath(`/movie/${movieId}`);
}
