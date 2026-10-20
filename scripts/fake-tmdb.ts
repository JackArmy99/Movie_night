// A stand-in for TMDB and OMDb, for tests and for trying the app without keys
// or network. 600 made-up films across the real genre ids; "recommendations"
// link films that share a genre, so taste signals behave like the real thing.
import http from "node:http";
import { gzipSync } from "node:zlib";

const GENRES = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53, 10752, 37];
const PROVIDERS = [
  { provider_id: 8, provider_name: "Netflix", logo_path: null },
  { provider_id: 119, provider_name: "Amazon Prime Video", logo_path: null },
  { provider_id: 72, provider_name: "Videoland", logo_path: null },
  { provider_id: 337, provider_name: "Disney Plus", logo_path: null },
];

export type FakeFilm = {
  id: number;
  title: string;
  release_date: string;
  genre_ids: number[];
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  poster_path: null;
};

export const FILMS: FakeFilm[] = Array.from({ length: 600 }, (_, i) => {
  const id = 1000 + i;
  const g1 = GENRES[i % GENRES.length];
  const g2 = GENRES[(i * 7 + 3) % GENRES.length];
  return {
    id,
    title: `Film ${id}`,
    release_date: `${1970 + (i % 55)}-0${1 + (i % 9)}-15`,
    genre_ids: g1 === g2 ? [g1] : [g1, g2],
    vote_average: 5 + ((i * 37) % 45) / 10,
    vote_count: 100000 - i * 150,
    popularity: 100 - i / 10,
    overview: `A made-up film number ${id}.`,
    poster_path: null,
  };
});
const byId = new Map(FILMS.map((f) => [f.id, f]));

// Upcoming Dutch releases for the calendar: 10 films dated from tomorrow on.
export function nlDate(id: number): string | null {
  const idx = id - 1000;
  if (idx < 590) return null;
  const d = new Date(Date.now() + (idx - 589) * 6 * 864e5);
  return d.toISOString().slice(0, 10);
}

function page<T>(list: T[], p: number) {
  const per = 20;
  return {
    page: p,
    total_pages: Math.max(1, Math.ceil(list.length / per)),
    total_results: list.length,
    results: list.slice((p - 1) * per, p * per),
  };
}

export function recsFor(id: number): FakeFilm[] {
  const f = byId.get(id);
  if (!f) return [];
  return FILMS.filter((o) => o.id !== id && o.genre_ids.some((g) => f.genre_ids.includes(g)))
    .sort((a, b) => ((a.id * 31 + id) % 97) - ((b.id * 31 + id) % 97))
    .slice(0, 20);
}

// The IMDb rating the fake daily file gives a film (OMDb's differs on purpose).
export const imdbOf = (id: number) => (6 + (id % 30) / 10).toFixed(1);

export function startFake(port = 0): Promise<{ url: string; close: () => void; calls: string[] }> {
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    calls.push(url.pathname);
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const p = Number(url.searchParams.get("page") ?? 1);
    const path = url.pathname.replace(/^\/3/, "");

    if (path === "/imdb/title.ratings.tsv.gz") {
      // IMDb's daily file: every fake film, plus films we don't hold.
      const lines = ["tconst\taverageRating\tnumVotes"];
      for (const f of FILMS) lines.push(`tt${String(f.id).padStart(7, "0")}\t${imdbOf(f.id)}\t${50000 + f.id}`);
      for (let i = 0; i < 5000; i++) lines.push(`tt9${String(i).padStart(7, "0")}\t5.0\t10`);
      res.writeHead(200, { "content-type": "application/gzip" });
      res.end(gzipSync(lines.join("\n") + "\n"));
      return;
    }
    if (path.startsWith("/omdb") && url.searchParams.get("apikey") === "not-activated") {
      return json({ Response: "False", Error: "Invalid API key!" }, 401);
    }
    if (path.startsWith("/omdb")) {
      const imdb = url.searchParams.get("i") ?? "";
      const n = Number(imdb.replace(/\D/g, "")) || 0;
      return json({
        Response: "True",
        imdbRating: (5 + (n % 45) / 10).toFixed(1),
        Metascore: String(40 + (n % 55)),
        Ratings: [{ Source: "Rotten Tomatoes", Value: `${30 + (n % 70)}%` }],
      });
    }
    if (path === "/discover/movie") {
      const g = Number(url.searchParams.get("with_genres") ?? 0);
      let list = FILMS.filter((f) => !g || f.genre_ids.includes(g));
      if (url.searchParams.get("region")) list = FILMS.filter((f) => nlDate(f.id));
      const sort = url.searchParams.get("sort_by");
      if (sort === "vote_average.desc") list = [...list].sort((a, b) => b.vote_average - a.vote_average);
      else list = [...list].sort((a, b) => b.vote_count - a.vote_count);
      return json(page(list, p));
    }
    if (path === "/search/movie") {
      const q = (url.searchParams.get("query") ?? "").toLowerCase();
      return json(page(FILMS.filter((f) => f.title.toLowerCase() === q), 1));
    }
    if (path === "/watch/providers/movie") return json({ results: PROVIDERS });
    const m = path.match(/^\/movie\/(\d+)(\/(recommendations|similar))?$/);
    if (m) {
      const id = Number(m[1]);
      const f = byId.get(id);
      if (!f) return json({ status_message: "not found" }, 404);
      if (m[3] === "recommendations") return json(page(recsFor(id), 1));
      if (m[3] === "similar") return json(page([], 1));
      const nl = nlDate(id);
      return json({
        ...f,
        runtime: 80 + (id % 90),
        imdb_id: `tt${String(id).padStart(7, "0")}`,
        genres: f.genre_ids.map((g) => ({ id: g, name: String(g) })),
        "watch/providers": {
          results: {
            NL: {
              link: `https://www.themoviedb.org/movie/${id}/watch?locale=NL`,
              flatrate: [PROVIDERS[id % PROVIDERS.length]],
              rent: [PROVIDERS[(id + 1) % PROVIDERS.length]],
            },
          },
        },
        videos: {
          results: [
            { key: `teaser${id}`, site: "YouTube", type: "Teaser", official: true, iso_639_1: "en" },
            { key: `trailer${id}`, site: "YouTube", type: "Trailer", official: true, iso_639_1: "en" },
          ],
        },
        release_dates: {
          results: nl ? [{ iso_3166_1: "NL", release_dates: [{ release_date: `${nl}T00:00:00.000Z`, type: 3 }] }] : [],
        },
      });
    }
    json({ status_message: "unknown path " + path }, 404);
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close(), calls });
    }),
  );
}

// `npx tsx scripts/fake-tmdb.ts` runs it on port 4010 for trying the app.
if (process.argv[1]?.endsWith("fake-tmdb.ts")) {
  startFake(4010).then((s) => console.log(`Fake TMDB on ${s.url}/3 and OMDb on ${s.url}/omdb`));
}
