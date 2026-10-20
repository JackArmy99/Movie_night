# Movie Night 🎬

Films the two of you will **both** like — and never one you've already seen.

- **Swipe** through the most-watched films per genre: right liked, left didn't,
  up loved it, down haven't seen.
- **Import Letterboxd** (the export .zip, straight from your phone).
- **Suggestions per genre** with sliders: IMDb, Rotten Tomatoes, year, length,
  and "only on our services" (Netflix, Videoland… via JustWatch).
- **This or that**: rank your super likes in a couple of minutes.
- **Tonight**: mood + length → 3 picks.
- **Shared watchlist**: films you both want float to the top.
- **Dutch cinema calendar**, subscribable in your phone's calendar.

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
   | `ANTHROPIC_API_KEY` | optional — Claude's "why you'd like it" (about 1p a click, capped at $3/month) |

4. **Deployments → ⋯ → Redeploy.** Open the address Vercel shows
   (`something.vercel.app`) on your phone → type the passcode → enter both names.
5. On the phone: Safari **Share → Add to Home Screen** (Android Chrome: **⋮ → Add
   to Home screen**). Your partner does steps 4–5 on their phone and picks their name.

Every push to GitHub redeploys by itself. Your data lives in the Neon database
and survives redeploys; **Settings → Download a backup** gives you a copy.

## What it costs

TMDB, JustWatch data, Vercel Hobby and Neon free tier: **€0**. OMDb free key:
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
