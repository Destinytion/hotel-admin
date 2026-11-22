"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { countUsers } from "@/lib/session";
import { db, schema } from "@/db";

export type SetupState = {
  error?: string;
  values?: { name: string; email: string };
};

/** Compares without giving away, by timing, how much of the code was right. */
function sameCode(given: string, expected: string) {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/*
  Creates the first account on a new install.

  On the internet, anyone could reach this page before the owner does, so a
  hosted install only accepts it with the SETUP_CODE set on the server. On a
  laptop (development) no code is needed unless one is set.
*/
export async function createFirstUser(
  _previous: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const values = { name, email };

  const expected = process.env.SETUP_CODE ?? "";
  if (process.env.NODE_ENV === "production" && !expected) {
    return { error: "Setup is locked. Set SETUP_CODE on the server, then try again.", values };
  }
  if (expected && !sameCode(code, expected)) {
    return { error: "That setup code is not right.", values };
  }

  if (!name) return { error: "Enter your name.", values };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address.", values };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`, values };
  }
  if (password.length > 128) {
    return { error: "Use a password of 128 characters or fewer.", values };
  }
  if (password !== confirm) {
    return { error: "The two passwords do not match.", values };
  }

  if ((await countUsers()) > 0) redirect("/login");

  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { name, email, emailVerified: true, role: "admin" },
    { method: "admin" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(password),
  });
  await db.insert(schema.auditLog).values({
    userId: user.id,
    action: "created",
    entity: "user",
    entityId: user.id,
    summary: "the first login",
    detail: { via: "first-run setup" },
  });

  await auth.api.signInEmail({
    body: { email, password },
    headers: await headers(),
  });
  redirect("/");
}
