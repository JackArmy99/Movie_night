"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { me } from "@/lib/session";
import { getJson, setJson, setSetting } from "@/lib/settings";

// ---------- settings ----------

export async function saveServices(form: FormData) {
  const ids = form.getAll("service").map(Number).filter(Number.isFinite);
  await setJson("services", ids);
  revalidatePath("/settings");
  redirect("/settings?saved=services");
}

// Tick or untick one service (Tonight's service row). Shared by both of you.
export async function setService(id: number, on: boolean) {
  const current = await getJson<number[]>("services", []);
  const next = on ? [...new Set([...current, id])] : current.filter((s) => s !== id);
  await setJson("services", next);
  revalidatePath("/tonight");
}

export async function renamePerson(form: FormData) {
  const id = String(form.get("id"));
  const name = String(form.get("name") ?? "").trim();
  if (name) await db.user.update({ where: { id }, data: { name } });
  revalidatePath("/settings");
}

export async function resetDeck() {
  const user = await me();
  await db.setting.deleteMany({ where: { key: { startsWith: `deck:${user.id}:` } } });
  await setSetting(`deck_reset:${user.id}`, new Date().toISOString());
  revalidatePath("/swipe", "layout");
}

// "Update IMDb ratings now" in Settings — the same job the daily run does.
export async function updateImdbNow(): Promise<{ message: string }> {
  await me();
  const { syncImdbRatings } = await import("@/lib/imdb");
  try {
    const r = await syncImdbRatings();
    revalidatePath("/settings");
    return { message: `Updated ${r.matched} of ${r.held} films in ${r.seconds}s.` };
  } catch (err) {
    return { message: `IMDb's file couldn't be fetched (${String((err as Error)?.message ?? err)}).` };
  }
}
