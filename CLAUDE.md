# CLAUDE.md — Movie Night

A private two-person film app for Jack and his girlfriend (Netherlands).
Jack is a coding beginner: explain in plain English, results first, say what
things cost. He uses it on phones; it's hosted on **Vercel + Neon Postgres**
(free tiers) — he never runs it locally.

## Stack
Next.js 14 App Router + TypeScript + Tailwind, Prisma 5.22 + PostgreSQL,
server actions in `app/actions.ts`. Data: TMDB (films, recommendations, NL
providers = JustWatch, NL release dates), OMDb (IMDb/RT/Metacritic), optional
Claude (`lib/claude.ts`, Haiku 5.5 default, monthly cap).

## How it works
- `Swipe.verdict`: superlike | like | dislike | seen | unseen | pass, plus
  `Swipe.stars` (0.5–5). Stars are what people give; the verdict is derived by
  `verdictForStars()` (4½+ superlike, 3–4 like, ≤2½ dislike) and drives "this or
  that", counts and `SEEN`. `SEEN` films are **never suggested**, which is the
  app's whole reason to exist, so keep it airtight. `pass` ("not interested") isn't
  seen but is excluded too (either person's pass hides it in "both" mode).
- Swipe deck: `directionFor()` in `lib/swipe.ts` maps a drag's compass bearing
  to 1★ (270°, left) … 3★ (0°, up) … 5★ (90°, right); the bottom 135° = unseen.
  Unseen films form the "To decide" pile (`lib/pile.ts`, Watchlist tab) with
  trailers (`Movie.trailerKey`, TMDB `videos`, `pickTrailer()`).
- Tabs: Swipe · Search (rate any film) · Tonight (all suggestions: moods/genre,
  services, `FilterBar`) · Watchlist · Cinema. `/suggest` only redirects.
- Ratings: IMDb from IMDb's daily `title.ratings.tsv.gz` (`lib/imdb.ts`, Vercel
  Cron → `/api/cron/imdb`, `CRON_SECRET`); OMDb for Rotten Tomatoes/Metacritic and
  same-day IMDb, never overwriting a fresh file value. `trustedRating()` = IMDb
  (else TMDB) mixed 70/30 with RT; `suggest()` looks up the top 40 taste matches
  and re-ranks by it.
- `lib/score.ts` is pure (tested): each seen film's TMDB recommendations score
  candidates; super likes weigh by Elo rank, dislikes subtract; two people
  combine as `a + b + min(a, b)` so agreement wins.
- `lib/recommend.ts` orchestrates: fetch missing rec lists (max 25/load), score,
  pad with top-rated when thin, then look up details/ratings/providers only for
  films about to be shown, until enough pass the sliders.
- Everything external is cached on `Movie` (providers 7d, ratings 30d, recs 60d).
- Swipe deck order = TMDB `vote_count.desc` (most-watched = most likely seen);
  per-user, per-genre bookmark in `Setting deck:<user>:<genre>`.
- Auth: one shared passcode → HMAC cookie (`middleware.ts`); profile cookie
  picks which of the two people is on this phone. Calendar feed is public but
  keyed (`calendarKey()`).
- Letterboxd import: client reads the export .zip (`lib/unzip.ts`), merges
  watched/ratings/watchlist by title+year, sends batches of 20 to `importBatch`.

## Rules
- Never hand-date a migration; `npx prisma migrate dev --name x`.
- `npm test` (needs a DB with "test" in its name) + `npx tsc --noEmit` +
  `npx next build` before pushing.
- **Cloud sessions can reach TMDB/OMDb** (allowlisted in the environment, keys
  as env vars `TMDB_TOKEN` / `OMDB_KEY`), but Node's fetch ignores the egress
  proxy unless started with `NODE_USE_ENV_PROXY=1`. A browser driving the app
  must reach it by the container IP (`hostname -I`), not localhost — Playwright
  sends localhost through the proxy, which only accepts HTTPS tunnels.
  `scripts/fake-tmdb.ts` (set `TMDB_BASE`/`OMDB_BASE`) still serves the tests.
- Read API base URLs when used (`base()`), never at import: tests import these
  modules before pointing them at `scripts/fake-tmdb.ts`.
- Cookies are `secure` only when `x-forwarded-proto` is https (always on
  Vercel); over plain http a secure cookie is dropped and sign-in loops.
- Ranking multiplies taste by `qualityFactor()` (vote-count-shrunk TMDB score,
  steep curve) and drops films under `MIN_VOTES`: TMDB "also liked" lists are
  full of middling films. Checked on real data 20 Oct: before, a 6.0 film led
  the list; after, acclaimed films did.
- No CSS-glyph-in-OG-image tricks: `app/icon.tsx` draws an SVG because a ★
  character needs a font download at build time.
- Credit JustWatch wherever providers are shown (TMDB terms).
