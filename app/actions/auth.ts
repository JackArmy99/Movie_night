"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { AUTH_COOKIE, USER_COOKIE, authToken } from "@/lib/token";
import { getSetting, incrementSetting } from "@/lib/settings";

const YEAR = 60 * 60 * 24 * 365;

// Cookies are HTTPS-only whenever the site is served over HTTPS (always, on
// Vercel). Over plain http — a laptop on the home network — a secure cookie
// would be silently dropped and sign-in would loop.
const cookieOpts = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: headers().get("x-forwarded-proto") === "https",
  maxAge: YEAR,
  path: "/",
});

// ---------- signing in ----------

// After this many wrong passcodes in a day, every try waits a moment, so
// guessing it would take forever. You two typing it once per phone never notice.
const FREE_TRIES = 5;
const BRAKE_MS = 2000;

export async function login(_: unknown, form: FormData): Promise<{ error?: string }> {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return { error: "APP_PASSCODE isn't set on the server yet." };
  const failKey = `login_fail:${new Date().toISOString().slice(0, 10)}`;
  if (Number((await getSetting(failKey)) ?? 0) >= FREE_TRIES) await new Promise((r) => setTimeout(r, BRAKE_MS));
  if (String(form.get("passcode") ?? "").trim() !== passcode) {
    await incrementSetting(failKey, 1);
    return { error: "That's not the passcode." };
  }
  cookies().set(AUTH_COOKIE, await authToken(), cookieOpts());
  redirect("/who");
}

export async function createPeople(form: FormData) {
  const existing = await db.user.count();
  const names = [form.get("a"), form.get("b")].map((n) => String(n ?? "").trim()).filter(Boolean);
  for (const name of names.slice(0, Math.max(0, 2 - existing))) await db.user.create({ data: { name } });
  redirect("/who");
}

export async function pickUser(id: string) {
  cookies().set(USER_COOKIE, id, cookieOpts());
  redirect("/");
}

export async function switchUser() {
  cookies().delete(USER_COOKIE);
  redirect("/who");
}
