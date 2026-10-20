// The Movie Database. Free for non-commercial use; "where to watch" data in
// here comes from JustWatch and must be credited where it is shown.
//
// TMDB_TOKEN can be either the long "API Read Access Token" or the short "API
// Key" — the settings page shows both and people paste whichever they see.

// Read when used, not at import, so tests can point it at a fake server.
const base = () => process.env.TMDB_BASE ?? "https://api.themoviedb.org/3";
export const IMG = "https://image.tmdb.org/t/p/";
export const REGION = "NL";

export type TmdbListItem = {
  id: number;
  title: string;
  release_date?: string;
  overview?: string;
  poster_path?: string | null;
  genre_ids?: number[];
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
};

export type Provider = { id: number; name: string; logo: string | null };
export type Providers = {
  link: string | null;
  stream: Provider[];
  rent: Provider[];
  buy: Provider[];
};

export type TmdbDetails = TmdbListItem & {
  runtime?: number | null;
  imdb_id?: string | null;
  genres?: { id: number; name: string }[];
  providers: Providers;
  nlRelease: string | null;
  trailerKey: string | null;
};

export type TmdbVideo = {
  key: string;
  site: string;
  type: string;
  official?: boolean;
  iso_639_1?: string;
  published_at?: string;
};

// The best trailer: YouTube, a Trailer over a Teaser, official first, English
// first, newest first.
export function pickTrailer(videos: TmdbVideo[]): string | null {
  const rank = (v: TmdbVideo) => [
    v.type === "Trailer" ? 0 : 1,
    v.official ? 0 : 1,
    v.iso_639_1 === "en" ? 0 : 1,
  ];
  const best = videos
    .filter((v) => v.site === "YouTube" && v.key && (v.type === "Trailer" || v.type === "Teaser"))
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return (b.published_at ?? "").localeCompare(a.published_at ?? "");
    })[0];
  return best?.key ?? null;
}

export class TmdbMissingKey extends Error {
  constructor() {
    super("TMDB_TOKEN is not set");
  }
}

export function hasTmdb(): boolean {
  return Boolean(process.env.TMDB_TOKEN?.trim());
}

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const token = process.env.TMDB_TOKEN?.trim();
  if (!token) throw new TmdbMissingKey();
  const url = new URL(base() + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { accept: "application/json" };
  // The read-access token is a long JWT; the v3 key is 32 hex characters.
  if (token.length > 40) headers.authorization = `Bearer ${token}`;
  else url.searchParams.set("api_key", token);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`TMDB ${path} → ${res.status}`);
    return (await res.json()) as T;
  }
}

type Page = { page: number; total_pages: number; results: TmdbListItem[] };

// Films in a genre, most-voted first: the order in which you are most likely
// to have already seen them, which is what the swipe deck wants.
// Optional narrowing for a filtered swipe deck: earliest year, and a minimum
// TMDB score as a cheap first pass before the IMDb/RT check.
export async function mostWatched(
  genreId: number,
  page: number,
  opts: { fromYear?: number; minVote?: number } = {},
): Promise<Page> {
  return get<Page>("/discover/movie", {
    sort_by: "vote_count.desc",
    include_adult: "false",
    page,
    ...(genreId ? { with_genres: genreId } : {}),
    ...(opts.fromYear ? { "primary_release_date.gte": `${opts.fromYear}-01-01` } : {}),
    ...(opts.minVote ? { "vote_average.gte": opts.minVote } : {}),
  });
}

// Highly rated films in a genre — the fallback when there is nothing to base
// suggestions on yet.
export async function topRated(genreId: number, page: number): Promise<Page> {
  return get<Page>("/discover/movie", {
    sort_by: "vote_average.desc",
    "vote_count.gte": 800,
    include_adult: "false",
    page,
    ...(genreId ? { with_genres: genreId } : {}),
  });
}

export async function recommendations(id: number): Promise<TmdbListItem[]> {
  const [recs, similar] = await Promise.all([
    get<Page>(`/movie/${id}/recommendations`, { page: 1 }),
    get<Page>(`/movie/${id}/similar`, { page: 1 }),
  ]);
  // Recommendations first (TMDB's "people who liked this also liked"), then
  // similar titles to fill in; no duplicates.
  const seen = new Set<number>();
  return [...recs.results, ...similar.results].filter((m) =>
    seen.has(m.id) ? false : (seen.add(m.id), true),
  );
}

export async function search(title: string, year?: number): Promise<TmdbListItem | null> {
  const params: Record<string, string | number> = { query: title, include_adult: "false" };
  if (year) params.year = year;
  const res = await get<Page>("/search/movie", params);
  if (res.results.length) return res.results[0];
  // Letterboxd's year and TMDB's sometimes differ by one (festival vs release).
  if (year) {
    for (const y of [year - 1, year + 1]) {
      const r = await get<Page>("/search/movie", { ...params, year: y });
      if (r.results.length) return r.results[0];
    }
  }
  return null;
}

// Free-text film search (the Search tab): best matches first.
export async function searchMany(query: string): Promise<TmdbListItem[]> {
  const res = await get<Page>("/search/movie", { query, include_adult: "false", region: REGION });
  return res.results;
}

type RawProvider = { provider_id: number; provider_name: string; logo_path: string | null };
type RawDetails = TmdbListItem & {
  runtime?: number | null;
  imdb_id?: string | null;
  genres?: { id: number; name: string }[];
  external_ids?: { imdb_id?: string | null };
  "watch/providers"?: {
    results?: Record<string, { link?: string; flatrate?: RawProvider[]; rent?: RawProvider[]; buy?: RawProvider[] }>;
  };
  release_dates?: {
    results?: { iso_3166_1: string; release_dates: { release_date: string; type: number }[] }[];
  };
  videos?: { results?: TmdbVideo[] };
};

const toProvider = (p: RawProvider): Provider => ({
  id: p.provider_id,
  name: p.provider_name,
  logo: p.logo_path,
});

// One call for everything a film page needs.
export async function details(id: number): Promise<TmdbDetails> {
  const d = await get<RawDetails>(`/movie/${id}`, {
    append_to_response: "external_ids,watch/providers,release_dates,videos",
    // Videos in any language: plenty of films only have an English trailer
    // filed under a different language, and pickTrailer prefers English anyway.
    include_video_language: "en,nl,null",
  });
  const nl = d["watch/providers"]?.results?.[REGION];
  const nlDates = d.release_dates?.results?.find((r) => r.iso_3166_1 === REGION);
  // Type 3 = theatrical, 2 = limited theatrical.
  const cinema = nlDates?.release_dates
    .filter((r) => r.type === 3 || r.type === 2)
    .map((r) => r.release_date.slice(0, 10))
    .sort()[0];
  return {
    ...d,
    genre_ids: d.genres?.map((g) => g.id) ?? d.genre_ids,
    imdb_id: d.imdb_id ?? d.external_ids?.imdb_id ?? null,
    providers: {
      link: nl?.link ?? null,
      stream: (nl?.flatrate ?? []).map(toProvider),
      rent: (nl?.rent ?? []).map(toProvider),
      buy: (nl?.buy ?? []).map(toProvider),
    },
    nlRelease: cinema ?? null,
    trailerKey: pickTrailer(d.videos?.results ?? []),
  };
}

// Films opening in Dutch cinemas between two dates.
export async function dutchCinema(from: string, to: string, page: number): Promise<Page> {
  return get<Page>("/discover/movie", {
    region: REGION,
    with_release_type: "2|3",
    "release_date.gte": from,
    "release_date.lte": to,
    sort_by: "popularity.desc",
    include_adult: "false",
    page,
  });
}

// Every streaming service TMDB knows about in the Netherlands.
export async function dutchServices(): Promise<Provider[]> {
  const res = await get<{ results: RawProvider[] }>("/watch/providers/movie", {
    watch_region: REGION,
  });
  return res.results.map(toProvider);
}

export const trailerUrl = (key: string) => `https://www.youtube.com/watch?v=${key}`;

export function poster(path: string | null | undefined, size = "w342"): string | null {
  return path ? `${IMG}${size}${path}` : null;
}
