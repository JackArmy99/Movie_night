// The pool of films "similar to" one or more anchor films (Tonight and the
// swipe deck). Built from TMDB's "also liked" lists, which are cached on each
// film for two months, so a repeat visit costs nothing.
import { db } from "./db";
import { ensureRecs } from "./movies";
import { blendCloseness } from "./score";

export const MAX_LIKE = 5;

export function parseLike(raw: string | string[] | undefined): number[] {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return [...new Set((s ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_LIKE);
}

async function listsFor(ids: number[]): Promise<number[][]> {
  await ensureRecs(ids);
  const rows = await db.movie.findMany({ where: { id: { in: ids } }, select: { id: true, recIds: true } });
  return ids.map((id) => rows.find((r) => r.id === id)?.recIds ?? []);
}

// closeness by film id. Anchors and `excluded` (seen / not interested) are
// never in it. When too few films are left, one more hop: the "also liked"
// lists of the 10 closest films, at half weight. `direct` holds the films the
// anchors list themselves, so a deck can show those before the wider ones.
export async function similarPool(
  likeIds: number[],
  opts: { minSize?: number; excluded?: Set<number> } = {},
): Promise<Map<number, number> & { direct: Set<number> }> {
  if (!likeIds.length) return Object.assign(new Map<number, number>(), { direct: new Set<number>() });
  const drop = (m: Map<number, number>) => {
    for (const id of likeIds) m.delete(id);
    for (const id of opts.excluded ?? []) m.delete(id);
    return m;
  };
  const pool = drop(blendCloseness(await listsFor(likeIds)));
  const direct = new Set(pool.keys());
  if (pool.size < (opts.minSize ?? 0)) {
    const closest = [...pool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
    const second = drop(blendCloseness(await listsFor(closest), 0.5));
    for (const [id, c] of second) pool.set(id, (pool.get(id) ?? 0) + c);
  }
  return Object.assign(pool, { direct });
}
