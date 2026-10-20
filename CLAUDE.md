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
- Tabs: Swipe (opens `/swipe/0` straight on the cards) · Search (rate any film)
  · Tonight (all suggestions) · Watchlist · Cinema. `/suggest` and `/swipe`
  only redirect. Tonight and the deck share `ControlBar`: a genre button
  (`GenreChoices`; moods only in Tonight, seen-counts only in the deck) and one
  Filters panel, with a one-line summary while shut.
- Server actions live in `app/actions/<area>.ts`; `app/actions/index.ts`
  re-exports them, so components import from `@/app/actions`.
- "Similar to…" (`?like=id,id`, max 5; `components/SimilarPicker.tsx`) works in
  Tonight and the swipe deck. `similarPool()` (`lib/similar.ts`) blends the
  anchors' TMDB "also liked" lists (`blendCloseness`, 1.5× for films shared by
  2+ anchors), adds a half-weight second hop when the pool is small, and marks
  `direct` matches. Tonight: closeness × (1 + ½ taste), then IMDb/RT. Deck: direct
  matches first, most-watched first within; films under `MIN_VOTES` are skipped.
- Swipe deck logic lives in `lib/deck.ts` (`deckCards`, testable without a
  session); `nextCards` is a thin action. Year goes to TMDB discover; IMDb/RT are
  checked per card via OMDb (cached), so each filter combination has its own
  bookmark (`deck:<user>:<genre>:<sig>`). No buttons on the deck screen by
  request; only the swipe, the labels and Undo.
- Ratings: IMDb from IMDb's daily `title.ratings.tsv.gz` (`lib/imdb.ts`, Vercel
  Cron → `/api/cron/daily` (also rebuilds the calendar), `CRON_SECRET`); OMDb for Rotten Tomatoes/Metacritic and
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
- **Speed:** functions run in Frankfurt (`vercel.json` `regions: ["fra1"]`), next to
  the Neon database; never remove that. Batch database writes per lookup batch
  (`writeAll` in `lib/movies.ts`); OMDb goes through `omdbBatch()` (one status
  read, one atomic quota reservation via `incrementSetting`, misses remembered as
  `ratingsAt`). Measured 20 Oct with a 90 ms simulated distance: cold Tonight
  321 → 148 queries, 6.9 s → 2.5 s; same region ≈ 0.5 s.
- Every tab has a `loading.tsx` (`components/Skeleton.tsx`, uses `NavBar`, which
  does no database work).
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
