import { db } from "./db";

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setJson(key: string, value: unknown): Promise<void> {
  await setSetting(key, JSON.stringify(value));
}

// The streaming services you pay for, as TMDB/JustWatch provider ids.
export async function getMyServices(): Promise<number[]> {
  return getJson<number[]>("services", []);
}

// Add `by` to a numeric setting in one atomic step and return the new value.
// (Read-then-write would lose counts when lookups run in parallel.)
export async function incrementSetting(key: string, by: number): Promise<number> {
  const rows = await db.$queryRaw<{ value: string }[]>`
    INSERT INTO "Setting" ("key", "value") VALUES (${key}, ${String(by)})
    ON CONFLICT ("key") DO UPDATE SET "value" = (COALESCE(NULLIF("Setting"."value", ''), '0')::int + ${by})::text
    RETURNING "value"`;
  return Number(rows[0]?.value ?? by);
}
