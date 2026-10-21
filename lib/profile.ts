// What kinds of film each of you loves or avoids, learned from every answer:
// stars, "Not for me", "seen". A film is described by features (its genres,
// kinds like anime/superhero, language, keywords, vibes and the people who
// made it); each feature earns a score from your answers to films that have
// it. A new film's "affinity" is how your scores add up across its features,
// turned into a ranking factor. Strong patterns push a kind of film very far
// down, but never to zero.
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ensureDetails } from "./movies";
import { isSuperhero } from "./genres";
import { hasTmdb, type People } from "./tmdb";

export type FeatureFilm = {
  genreIds: number[];
  keywordIds: number[];
  originalLanguage: string | null;
  people: Prisma.JsonValue | People | null;
  vibes: string[];
};

type Weighted = { f: string; w: number };

// Broad features (genres, kinds, language) and fine ones (keywords, vibes,
// people). Fine ones only count once seen on at least two of your films.
export function featuresOf(m: FeatureFilm): { top: string[]; fine: Weighted[] } {
  const top = m.genreIds.map((g) => `g:${g}`);
  if (m.genreIds.includes(16) && m.originalLanguage === "ja") top.push("kind:anime");
  if (isSuperhero(m)) top.push("kind:superhero");
  if (m.originalLanguage && m.originalLanguage !== "en") top.push(`lang:${m.originalLanguage}`);
  const fine: Weighted[] = [
    ...m.keywordIds.map((k) => ({ f: `k:${k}`, w: 0.5 })),
    ...m.vibes.map((v) => ({ f: `v:${v}`, w: 1 })),
  ];
  const p = m.people as People | null;
  if (p) {
    fine.push(...(p.d ?? []).map((x) => ({ f: `p:${x.id}`, w: 1 })));
    fine.push(...(p.w ?? []).map((x) => ({ f: `p:${x.id}`, w: 0.7 })));
    fine.push(...(p.c ?? []).map((x) => ({ f: `p:${x.id}`, w: 0.5 })));
  }
  return { top, fine };
}

// What one answer says about a film's features.
export function signalOf(verdict: string, stars: number | null): number {
  if (verdict === "pass") return -1.2;
  if (stars == null) return verdict === "seen" ? 0.2 : 0;
  if (stars >= 5) return 2;
  if (stars >= 4.5) return 1.6;
  if (stars >= 4) return 1;
  if (stars >= 3.5) return 0.4;
  if (stars >= 3) return 0;
  if (stars >= 2.5) return -0.6;
  if (stars >= 2) return -1;
  return -1.5;
}

export type Profile = Map<string, { sum: number; n: number }>;

// Cautious start: one answer barely moves a feature, a pattern moves it a lot.
const PRIOR = 3;

export function buildProfile(rows: { verdict: string; stars: number | null; movie: FeatureFilm }[]): Profile {
  const p: Profile = new Map();
  for (const r of rows) {
    const s = signalOf(r.verdict, r.stars);
    if (s === 0 && r.verdict !== "seen") continue;
    const { top, fine } = featuresOf(r.movie);
    for (const { f, w } of [...top.map((f) => ({ f, w: 1 })), ...fine]) {
      const e = p.get(f) ?? { sum: 0, n: 0 };
      e.sum += s * w;
      e.n += w;
      p.set(f, e);
    }
  }
  return p;
}

export function featureScore(p: Profile, f: string): number {
  const e = p.get(f);
  return e ? e.sum / (e.n + PRIOR) : 0;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// How well a film fits, roughly -2..2. Broad features average out, but the
// most negative one also counts on its own, so one strongly avoided kind
// (superhero, anime) isn't diluted by the film's harmless genres.
export function affinity(p: Profile, m: FeatureFilm): number {
  const { top, fine } = featuresOf(m);
  const topScores = top.filter((f) => p.has(f)).map((f) => featureScore(p, f));
  const fineScores = fine.filter(({ f }) => (p.get(f)?.n ?? 0) >= 2).map(({ f }) => featureScore(p, f));
  const broad = topScores.length ? mean(topScores) + 0.5 * Math.min(0, ...topScores) : 0;
  const base = fineScores.length ? 0.6 * broad + 0.4 * (mean(fineScores) + 0.5 * Math.min(0, ...fineScores)) : broad;
  // A kind you keep rejecting (superhero, anime) counts on its own: liking
  // action and sci-fi mustn't excuse the Avengers. One rejection (score
  // about -0.3) is mostly forgiven; a clear pattern sinks the film.
  const kinds = top.filter((f) => f.startsWith("kind:")).map((f) => featureScore(p, f));
  return base + KIND_WEIGHT * Math.min(0, ...kinds.map((s) => s + KIND_SLACK));
}
const KIND_WEIGHT = 2.2;
const KIND_SLACK = 0.25;

// Affinity → ranking multiplier: ~3% at worst (very rare, never removed),
// up to 2.5× for films that match what you love.
export function factorOf(a: number): number {
  return Math.min(2.5, Math.max(0.03, Math.exp(2.5 * a)));
}

// Readable names for the kinds you avoid most (for Claude's prompt).
const KIND_NAMES: Record<string, string> = { "kind:anime": "anime", "kind:superhero": "superhero films" };
export function avoidedKinds(p: Profile, genreName: (id: number) => string): string[] {
  return [...p.entries()]
    .filter(([f, e]) => e.n >= 3 && (f.startsWith("kind:") || f.startsWith("g:") || f.startsWith("v:")))
    .map(([f]) => ({ f, s: featureScore(p, f) }))
    .filter((x) => x.s < -0.4)
    .sort((a, b) => a.s - b.s)
    .slice(0, 5)
    .map(({ f }) => KIND_NAMES[f] ?? (f.startsWith("g:") ? genreName(Number(f.slice(2))) : f.slice(2)));
}

// ---------- loading ----------

const FEATURE_SELECT = {
  genreIds: true,
  keywordIds: true,
  originalLanguage: true,
  people: true,
  vibes: true,
} as const;
export { FEATURE_SELECT };

export type Taste = {
  profile: Profile;
  // People behind 2+ of your 4½–5★ films: their other films are worth a look.
  lovedPeople: { id: number; name: string; count: number }[];
};

// Films answered but never looked up in full (Letterboxd imports, quick
// swipes) have no keywords or people yet, so a superhero pattern would go
// unnoticed. Fill in a batch of them (TMDB, free); the nightly job does more.
export async function backfillAnswered(limit: number, userId?: string): Promise<number> {
  if (!hasTmdb()) return 0;
  // Most recent answers first: a fresh run of "Not for me" should count at once.
  const rows = (
    await db.swipe.findMany({
      where: { ...(userId ? { userId } : {}), movie: { peopleAt: null } },
      select: { movieId: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    })
  ).map((s) => ({ id: s.movieId }));
  if (!rows.length) return 0;
  await ensureDetails(rows.map((r) => r.id));
  // Films TMDB couldn't give us are marked as tried, so they don't block the
  // queue (the monthly details refresh tries them again).
  await db.movie.updateMany({ where: { id: { in: rows.map((r) => r.id) }, peopleAt: null }, data: { peopleAt: new Date() } });
  return rows.length;
}

export async function loadTaste(userId: string): Promise<Taste> {
  await backfillAnswered(60, userId);
  const rows = await db.swipe.findMany({
    where: { userId, OR: [{ stars: { not: null } }, { verdict: { in: ["pass", "seen"] } }] },
    select: { verdict: true, stars: true, movie: { select: FEATURE_SELECT } },
  });
  const profile = buildProfile(rows);
  const counts = new Map<number, { name: string; count: number }>();
  for (const r of rows) {
    if ((r.stars ?? 0) < 4.5) continue;
    const p = r.movie.people as People | null;
    // Once per film, even when someone both wrote and directed it.
    const once = new Map([...(p?.d ?? []), ...(p?.w ?? [])].map((x) => [x.id, x]));
    for (const x of once.values()) {
      const e = counts.get(x.id) ?? { name: x.name, count: 0 };
      e.count++;
      counts.set(x.id, e);
    }
  }
  const lovedPeople = [...counts.entries()]
    .filter(([, e]) => e.count >= 2)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return { profile, lovedPeople };
}

// The ranking factor for several people at once ("Both of us"): the average,
// so one person's strong dislike still pulls a film well down.
export function combinedFactor(tastes: Taste[], m: FeatureFilm): number {
  if (!tastes.length) return 1;
  return mean(tastes.map((t) => factorOf(affinity(t.profile, m))));
}
