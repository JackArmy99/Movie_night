// TMDB's movie genre ids. Fixed for years, so kept here rather than fetched.
export const GENRES: { id: number; name: string }[] = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" },
  { id: 36, name: "History" },
  { id: 27, name: "Horror" },
  { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Science Fiction" },
  { id: 53, name: "Thriller" },
  { id: 10752, name: "War" },
  { id: 37, name: "Western" },
];

export function genreName(id: number): string {
  return GENRES.find((g) => g.id === id)?.name ?? "All genres";
}

// "0" in a URL means every genre.
export const ALL = 0;

// Superhero isn't a TMDB genre, but TMDB's keywords mark it reliably
// (checked 20 Oct: Avengers, Dark Knight, Black Panther, Deadpool, Logan… yes;
// Joker, Inception, Encanto no). "sh" stands for it wherever genre ids go.
export const SUPERHERO = "sh";
export const SUPERHERO_KEYWORDS = [9715, 155030, 180547, 229266]; // superhero, superhero team, MCU, DCEU

export function isSuperhero(m: { keywordIds: number[] }): boolean {
  return m.keywordIds.some((k) => SUPERHERO_KEYWORDS.includes(k));
}

const ALL_CUSTOM = [...GENRES.map((g) => ({ key: String(g.id), name: g.name })), { key: SUPERHERO, name: "Superhero" }];

// The genre button's label in "Custom" mode: whichever list is shorter —
// "No Horror, Superhero" or "Comedy, Romance".
export function customLabel(ex: { genres: number[]; superhero: boolean }): string {
  const off = new Set([...ex.genres.map(String), ...(ex.superhero ? [SUPERHERO] : [])]);
  const on = ALL_CUSTOM.filter((i) => !off.has(i.key)).map((i) => i.name);
  const offNames = ALL_CUSTOM.filter((i) => off.has(i.key)).map((i) => i.name);
  const list = (names: string[]) => (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", "));
  if (!offNames.length) return "✏️ All genres";
  if (!on.length) return "✏️ No genres picked";
  return on.length < offNames.length ? `✏️ ${list(on)}` : `✏️ No ${list(offNames)}`;
}

// True when Custom has every genre unticked (nothing could be shown).
export const nothingPicked = (ex: { genres: number[]; superhero: boolean }) =>
  GENRES.every((g) => ex.genres.includes(g.id));
