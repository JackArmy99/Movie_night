// Turning a Letterboxd export into swipes.
//
// Letterboxd → Settings → Import & Export → Export your data gives a zip. The
// files that matter: watched.csv (everything logged), ratings.csv (the ones
// with stars), watchlist.csv and likes/films.csv (the hearts). All share Name,
// Year, Letterboxd URI.
import { parseCsv } from "./csv";

export type LbFilm = {
  name: string;
  year: number | null;
  uri: string;
  rating: number | null; // 0.5–5
  watched: boolean;
  watchlist: boolean;
  hearted: boolean; // ♥ on Letterboxd
};

export type LbFileKind = "watched" | "ratings" | "watchlist" | "diary" | "likes" | "unknown";

export function kindOf(fileName: string, rows: Record<string, string>[]): LbFileKind {
  const f = fileName.toLowerCase();
  // Hearts are likes/films.csv; likes/reviews.csv and likes/lists.csv are
  // other people's reviews and lists, not films.
  if (/(^|\/)(likes\/)?films\.csv$/.test(f)) return "likes";
  if (f.includes("likes/")) return "unknown";
  if (f.includes("watchlist")) return "watchlist";
  if (f.includes("rating")) return "ratings";
  if (f.includes("diary")) return "diary";
  if (f.includes("watched")) return "watched";
  if (rows[0] && "Rating" in rows[0]) return "ratings";
  return "unknown";
}

// Merge any of the export files into one list, one entry per film.
export function mergeExport(files: { name: string; text: string }[]): LbFilm[] {
  const films = new Map<string, LbFilm>();
  for (const file of files) {
    const rows = parseCsv(file.text);
    const kind = kindOf(file.name, rows);
    // Diary rows repeat films (one per viewing) and add nothing watched.csv
    // doesn't already have.
    if (kind === "unknown" || kind === "diary") continue;
    for (const r of rows) {
      const name = r.Name;
      if (!name) continue;
      const year = Number(r.Year) || null;
      // Not the URI: the same film's URI differs between files (a diary or
      // review link versus the film link).
      const key = `${name.toLowerCase()}|${year ?? ""}`;
      const film = films.get(key) ?? { name, year, uri: r["Letterboxd URI"] ?? "", rating: null, watched: false, watchlist: false, hearted: false };
      const rating = Number.parseFloat(r.Rating);
      if (Number.isFinite(rating) && rating > 0) film.rating = rating;
      if (kind === "watchlist") film.watchlist = true;
      else film.watched = true;
      if (kind === "likes") film.hearted = true;
      films.set(key, film);
    }
  }
  // A film both on the watchlist and logged as watched has been seen.
  for (const f of films.values()) {
    if (f.watched) f.watchlist = false;
  }
  return [...films.values()];
}

// Stars → swipe. 4.5–5 is a super like, 3–4 a like, 2.5 and below a dislike.
// Watched with no stars is "seen": counts as watched, weak signal. A heart on
// anything not rated low is a favourite, so a super like (3½★ ♥ means "rated
// fairly, but I love it").
export function verdictFor(rating: number | null, hearted = false): "superlike" | "like" | "dislike" | "seen" {
  if (hearted && (rating === null || rating >= 3)) return "superlike";
  if (rating === null) return "seen";
  if (rating >= 4.5) return "superlike";
  if (rating >= 3) return "like";
  return "dislike";
}

// Starting place in the "this or that" ranking: five stars above four and a
// half, and a heart nudges a film up within its star level.
export const eloFor = (rating: number | null, hearted = false) =>
  (rating && rating >= 4.5 ? 1000 + (rating - 4.5) * 200 : 1000) + (hearted ? 50 : 0);
