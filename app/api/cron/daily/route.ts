import { NextRequest } from "next/server";
import { syncImdbRatings } from "@/lib/imdb";
import { upcomingDutch } from "@/lib/calendar";
import { tagPending } from "@/lib/vibes";
import { backfillAnswered } from "@/lib/profile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called once a day by Vercel Cron (vercel.json): refresh IMDb ratings from
// IMDb's own file, rebuild the Dutch cinema calendar so nobody waits for
// it on their first visit, and tag new films with vibes. Vercel sends "Authorization: Bearer <CRON_SECRET>";
// anything else is turned away.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Not found", { status: 404 });
  }
  const result: Record<string, unknown> = {};
  // Each job on its own: one failing must not stop the other.
  try {
    result.imdb = await syncImdbRatings();
  } catch (err) {
    result.imdb = `failed: ${String((err as Error)?.message ?? err)}`;
  }
  try {
    result.calendar = (await upcomingDutch({ force: true })).length;
  } catch (err) {
    result.calendar = `failed: ${String((err as Error)?.message ?? err)}`;
  }
  // Keywords and people for answered films, so the taste profile sees them.
  try {
    result.details = await backfillAnswered(300);
  } catch (err) {
    result.details = `failed: ${String((err as Error)?.message ?? err)}`;
  }
  // Claude's vibe tags for films you've answered or been shown (no key → 0).
  try {
    result.vibes = await tagPending(400);
  } catch (err) {
    result.vibes = `failed: ${String((err as Error)?.message ?? err)}`;
  }
  console.log("[daily]", result);
  return Response.json(result);
}
