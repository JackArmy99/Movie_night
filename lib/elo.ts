// "This or that" ranking of your super likes. Standard Elo: beating a film
// ranked above you moves you further than beating one ranked below.
const K = 32;

export function eloUpdate(winner: number, loser: number): [number, number] {
  const expected = 1 / (1 + 10 ** ((loser - winner) / 400));
  const delta = K * (1 - expected);
  return [winner + delta, loser - delta];
}

// Pick the next pair: the film compared least, against the one closest to it
// in score (close calls teach the ranking the most).
export function nextPair<T extends { movieId: number; elo: number; comparisons: number }>(
  items: T[],
  avoid?: [number, number],
): [T, T] | null {
  if (items.length < 2) return null;
  const sorted = [...items].sort((a, b) => a.comparisons - b.comparisons || Math.random() - 0.5);
  const first = sorted[0];
  const rest = items
    .filter((i) => i.movieId !== first.movieId)
    .filter((i) => !avoid || !(avoid.includes(i.movieId) && avoid.includes(first.movieId)))
    .sort((a, b) => Math.abs(a.elo - first.elo) - Math.abs(b.elo - first.elo));
  const second = rest[Math.floor(Math.random() * Math.min(3, rest.length))] ?? rest[0];
  return second ? [first, second] : null;
}
