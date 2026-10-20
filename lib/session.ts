import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { db } from "./db";
import { USER_COOKIE } from "./token";

export async function allUsers(): Promise<User[]> {
  return db.user.findMany({ orderBy: { createdAt: "asc" } });
}

// The person holding this phone. Sends them to "who's this?" if unknown.
export async function me(): Promise<User> {
  const id = cookies().get(USER_COOKIE)?.value;
  const user = id ? await db.user.findUnique({ where: { id } }) : null;
  if (!user) redirect("/who");
  return user;
}

export async function partnerOf(user: User): Promise<User | null> {
  return db.user.findFirst({ where: { id: { not: user.id } }, orderBy: { createdAt: "asc" } });
}
