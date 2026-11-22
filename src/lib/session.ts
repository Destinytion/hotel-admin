import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/db";

/** The signed-in session, checked against the database. Null when signed out. */
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

/**
 * Use at the top of anything that reads or changes data.
 * Sends signed-out visitors to the login page.
 */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

export async function countUsers() {
  const [row] = await db.select({ total: count() }).from(schema.users);
  return row.total;
}
