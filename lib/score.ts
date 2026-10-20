// The suggestion maths, with no database or network so it can be tested.
//
// Every film either of you has an opinion on is a "seed". Each seed has TMDB's
// list of films people who liked it also liked. A candidate earns points from
// every seed that lists it — more for super likes (and more again for the ones
// you ranked highest), more for appearing near the top of a list, and LOSES
// points when it comes from a film you disliked. The two of you are scored
// separately and combined so a film you'd both like beats one only one of you
// would love.

export type Verdict = "superlike" | "like" | "seen" | "dislike" | "unseen";

export type Seed = {
  userId: string;
  movieId: number;
  verdict: Verdict;
  elo: number;
};

export type Scored = {
  movieId: number;
  score: number;
  perUser: Record<string, number>;
  // The seeds that contributed most, best first (for "because you liked…").
  because: number[];
};

// Verdicts that mean "has seen it" — a film like this is never suggested.
export const SEEN: ReadonlySet<string> = new Set(["superlike", "like", "seen", "dislike"]);

export function seedWeight(verdict: string, elo = 1000): number {
  switch (verdict) {
    case "superlike":
      // 2..5 depending on where it sits in your "this or that" ranking.
      return 3 + Math.max(-1, Math.min(2, (elo - 1000) / 200));
    case "like":
      return 1;
    case "seen":
      return 0.4;
    case "dislike":
      return -1.5;
    default:
      return 0;
  }
}

// Being #1 on a list counts about twice as much as being #8.
export const positionFactor = (rank: number) => 1 / (1 + rank / 8);

export function scoreCandidates(input: {
  seeds: Seed[];
  recs: Map<number, number[]>;
  users: string[];
  excluded: Set<number>;
  // Genre ids per film; used to boost seeds in the genre being browsed.
  genresOf: Map<number, number[]>;
  genre: number; // 0 = all
}): Scored[] {
  const { seeds, recs, users, excluded, genresOf, genre } = input;
  const per = new Map<number, Record<string, number>>();
  const contrib = new Map<number, Map<number, number>>();

  for (const seed of seeds) {
    if (!users.includes(seed.userId)) continue;
    let w = seedWeight(seed.verdict, seed.elo);
    if (!w) continue;
    if (genre && genresOf.get(seed.movieId)?.includes(genre)) w *= 1.5;
    const list = recs.get(seed.movieId) ?? [];
    list.forEach((cand, rank) => {
      if (excluded.has(cand)) return;
      const pts = w * positionFactor(rank);
      const row = per.get(cand) ?? {};
      row[seed.userId] = (row[seed.userId] ?? 0) + pts;
      per.set(cand, row);
      if (pts > 0) {
        const c = contrib.get(cand) ?? new Map<number, number>();
        c.set(seed.movieId, (c.get(seed.movieId) ?? 0) + pts);
        contrib.set(cand, c);
      }
    });
  }

  // Only count a person once they have rated something; otherwise a partner
  // who hasn't started swiping would drag every film's "together" score to 0.
  const active = users.filter((u) => seeds.some((s) => s.userId === u && SEEN.has(s.verdict)));

  const out: Scored[] = [];
  for (const [movieId, row] of per) {
    const parts = active.map((u) => row[u] ?? 0);
    const sum = parts.reduce((a, b) => a + b, 0);
    // With two people, add the weaker of the two scores again: agreement wins,
    // and a film one of you is steered away from is pulled down for both.
    const score = parts.length > 1 ? sum + Math.min(...parts) : sum;
    if (score <= 0) continue;
    const because = [...(contrib.get(movieId) ?? new Map()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);
    out.push({ movieId, score, perUser: row, because });
  }
  return out.sort((a, b) => b.score - a.score);
}

export type Filters = {
  minImdb?: number; // 0–10
  minRt?: number; // 0–100
  yearFrom?: number;
  yearTo?: number;
  maxRuntime?: number; // minutes
  servicesOnly?: boolean;
};

export type FilterableMovie = {
  year: number | null;
  runtime: number | null;
  imdbRating: number | null;
  rtScore: number | null;
  voteAverage: number;
  streamIds: number[];
};

// Filters that need nothing but the list data (cheap, applied before lookups).
export function passesCheap(m: Pick<FilterableMovie, "year">, f: Filters): boolean {
  if (f.yearFrom && (m.year ?? 0) < f.yearFrom) return false;
  if (f.yearTo && (m.year ?? 9999) > f.yearTo) return false;
  return true;
}

export function passes(m: FilterableMovie, f: Filters, myServices: number[]): boolean {
  if (!passesCheap(m, f)) return false;
  if (f.minImdb) {
    // No IMDb score yet (no OMDb key, or OMDb has none): TMDB's own 0–10 user
    // score is a close stand-in.
    const s = m.imdbRating ?? m.voteAverage;
    if (s < f.minImdb) return false;
  }
  if (f.minRt && (m.rtScore ?? -1) < f.minRt) return false;
  if (f.maxRuntime && m.runtime && m.runtime > f.maxRuntime) return false;
  if (f.servicesOnly && !m.streamIds.some((id) => myServices.includes(id))) return false;
  return true;
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const n = (k: string) => {
    const v = Number(Array.isArray(sp[k]) ? sp[k]![0] : sp[k]);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  return {
    minImdb: n("imdb"),
    minRt: n("rt"),
    yearFrom: n("from"),
    yearTo: n("to"),
    maxRuntime: n("len"),
    servicesOnly: sp.mine === "1",
  };
}

// How much a film's reputation multiplies its taste score. TMDB's average is
// shrunk towards 6.5 when few people have voted (so a 9.0 from 40 votes
// doesn't outrank a 8.4 from 30,000), then turned into a steep curve:
// 6.0 → ×0.35, 7.0 → ×1, 8.0 → ×1.8. "People who liked X also liked" lists
// are full of middling films; this keeps the acclaimed ones on top.
export const MIN_VOTES = 200;

export function qualityFactor(voteAverage: number, voteCount: number): number {
  const prior = 500;
  const q = (voteAverage * voteCount + 6.5 * prior) / (voteCount + prior);
  return Math.max(0.05, (q - 5) / 2) ** 1.5;
}
