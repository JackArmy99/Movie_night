# Movie Night 🎬

Films the two of you will **both** like — and never one you've already seen.

- **Swipe** through the most-watched films per genre towards the stars you'd
  give: left 1★, up 3★, right 5★ (diagonals 2★ and 4★); down = haven't seen.
- **To decide**: films you haven't seen, with their trailer → want to see / not interested.
- **Search** any film (seen one at the cinema?) and give it stars.
- **Import Letterboxd** (the export .zip, straight from your phone).
- **Tonight**: suggestions by mood or genre with sliders (IMDb, Rotten Tomatoes,
  year, length), your streaming services (via JustWatch), for both of you or just
  you. IMDb and Rotten Tomatoes scores steer the order.
- **This or that**: rank your super likes in a couple of minutes.
- **Shared watchlist**: films you both want float to the top.
- **Dutch cinema calendar** with trailers, subscribable in your phone's calendar.

## Put it online (one-off, ~15 minutes, free)

1. **Vercel** — go to vercel.com, sign up with GitHub (Hobby plan, free).
   *Add New → Project →* import **Movie_night** → **Deploy**.
   The first deploy works but shows errors until steps 2–3 are done.
2. **Database** — in the Vercel project: *Storage → Create Database → Neon
   (Postgres) → Free* → connect it to this project. That fills in
   `DATABASE_URL` and `DATABASE_URL_UNPOOLED` by itself.
3. **Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `APP_PASSCODE` | a passcode the two of you will type once per phone |
   | `SESSION_SECRET` | any long random text (mash the keyboard, 40+ characters) |
   | `TMDB_TOKEN` | TMDB → Settings → API → **API Read Access Token** |
   | `OMDB_KEY` | the key OMDb emailed you |
   | `CRON_SECRET` | any random text; protects the daily IMDb ratings update |
   | `ANTHROPIC_API_KEY` | Claude picks the films for Tonight and "Similar to" (about 0.1p per fresh list, capped at $1/month; without it the app uses TMDB's lists only) |

4. **Deployments → ⋯ → Redeploy.** Open the address Vercel shows
   (`something.vercel.app`) on your phone → type the passcode → enter both names.
5. On the phone: Safari **Share → Add to Home Screen** (Android Chrome: **⋮ → Add
   to Home screen**). Your partner does steps 4–5 on their phone and picks their name.

Every push to GitHub redeploys by itself. Your data lives in the Neon database
and survives redeploys; **Settings → Download a backup** gives you a copy.

## What it costs

TMDB, JustWatch data, IMDb's daily ratings file, Vercel Hobby (incl. its daily
cron) and Neon free tier: **€0**. OMDb free key:
1,000 lookups a day (the app stops at 950 and caches each film for a month).
Claude explanations: optional, about 1p per batch of 10, monthly cap via
`CLAUDE_MONTHLY_CAP_USD` (default $3).

## For developers

```bash
npm install
cp .env.example .env      # point DATABASE_URL at a local Postgres
npx prisma migrate dev
npm run fake-tmdb         # optional: offline stand-in for TMDB/OMDb on :4010
npm run dev
DATABASE_URL=postgresql://…/movienight_test npm test   # free test gate
```
