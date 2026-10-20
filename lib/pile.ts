import { db } from "./db";

// "To decide": films I swiped down on (haven't seen), that aren't on my
// watchlist yet and that I haven't said "not interested" to.
export function pileWhere(userId: string) {
  return {
    userId,
    verdict: "unseen",
    movie: { watchlist: { none: { userId } } },
  };
}

export async function pileCount(userId: string): Promise<number> {
  return db.swipe.count({ where: pileWhere(userId) });
}
