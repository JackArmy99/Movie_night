"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ensureDetails } from "@/lib/movies";
import { explain, hasClaude } from "@/lib/claude";

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
