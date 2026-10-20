import { NextRequest } from "next/server";
import { syncImdbRatings } from "@/lib/imdb";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called once a day by Vercel Cron (vercel.json). Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; anything else is turned away.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const result = await syncImdbRatings();
    console.log("[imdb] daily ratings:", result);
    return Response.json(result);
  } catch (err) {
    console.error("[imdb] daily ratings failed:", err);
    return new Response(String((err as Error)?.message ?? err), { status: 502 });
  }
}
