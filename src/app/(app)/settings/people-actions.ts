"use server";

import { refresh } from "next/cache";
import { and, count, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { auth, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { getSession, requireUser } from "@/lib/session";
import { run, text, UserError } from "@/lib/result";
import { logActivity } from "@/server/activity";

function checkPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new UserError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > 128) throw new UserError("Use a password of 128 characters or fewer.");
  return password;
}

const hashPassword = async (password: string) => (await auth.$context).password.hash(password);

/** Everyone with a login is an owner, so any of them can add another person. */
export async function addPerson(input: { name: string; email: string; password: string }) {
  return run(async () => {
    const me = await requireUser();
    const name = text(input.name, 100);
    const email = text(input.email, 200).toLowerCase();
    if (!name) throw new UserError("Enter the person's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter a valid email address.");
    const password = checkPassword(input.password);

    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (existing) throw new UserError(`${email} already has a login.`);

    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser(
      { name, email, emailVerified: true, role: "admin" },
      { method: "admin" },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await hashPassword(password),
    });
    await logActivity(db, {
      userId: me.id,
      action: "added",
      entity: "user",
      entityId: user.id,
      summary: `a login for ${name}`,
    });

    refresh();
    return null;
  });
}

/** Removes someone's login. Their bills and other records stay. */
export async function removePerson(userId: string) {
  return run(async () => {
    const me = await requireUser();
    if (typeof userId !== "string" || !userId) throw new UserError("That person could not be found.");
    if (userId === me.id) throw new UserError("You cannot remove your own login.");

    await db.transaction(async (tx) => {
      const [total] = await tx.select({ n: count() }).from(schema.users);
      if (total.n <= 1) throw new UserError("This is the only login. Add another one first.");
      // Their sessions and password are removed with them, which signs them out everywhere.
      const gone = await tx
        .delete(schema.users)
        .where(eq(schema.users.id, userId))
        .returning({ name: schema.users.name });
      if (!gone.length) throw new UserError("That person no longer has a login.");
      await logActivity(tx, {
        userId: me.id,
        action: "removed",
        entity: "user",
        summary: `the login for ${gone[0].name}`,
      });
    });

    refresh();
    return null;
  });
}

/** Sets a new password for someone who forgot theirs, and signs them out everywhere. */
export async function resetPassword(input: { userId: string; password: string }) {
  return run(async () => {
    const me = await requireUser();
    if (typeof input.userId !== "string" || !input.userId) {
      throw new UserError("That person could not be found.");
    }
    if (input.userId === me.id) throw new UserError("To change your own password, use Change my password.");
    const password = checkPassword(input.password);
    const hash = await hashPassword(password);

    await db.transaction(async (tx) => {
      const [person] = await tx
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, input.userId));
      if (!person) throw new UserError("That person no longer has a login.");
      await tx
        .update(schema.accounts)
        .set({ password: hash })
        .where(and(eq(schema.accounts.userId, input.userId), eq(schema.accounts.providerId, "credential")));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, input.userId));
      await logActivity(tx, {
        userId: me.id,
        action: "reset",
        entity: "user",
        entityId: input.userId,
        summary: `the password for ${person.name}`,
      });
    });

    refresh();
    return null;
  });
}

/** Changes your own password. Needs the current one, and signs out your other devices. */
export async function changeMyPassword(input: { current: string; next: string }) {
  return run(async () => {
    const me = await requireUser();
    const next = checkPassword(input.next);
    if (typeof input.current !== "string" || !input.current) {
      throw new UserError("Enter your current password.");
    }
    if (next === input.current) throw new UserError("The new password is the same as the current one.");

    const session = await getSession();
    if (!session) throw new UserError("Sign in again, then change your password.");
    const ctx = await auth.$context;
    const [account] = await db
      .select({ id: schema.accounts.id, password: schema.accounts.password })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, me.id), eq(schema.accounts.providerId, "credential")));
    if (!account?.password || !(await ctx.password.verify({ hash: account.password, password: input.current }))) {
      throw new UserError("Your current password is not right.");
    }

    const hash = await ctx.password.hash(next);
    await db.transaction(async (tx) => {
      await tx.update(schema.accounts).set({ password: hash }).where(eq(schema.accounts.id, account.id));
      // Signs out every other device. This one stays signed in, so the
      // person is not thrown out of the screen they are on.
      await tx
        .delete(schema.sessions)
        .where(and(eq(schema.sessions.userId, me.id), ne(schema.sessions.id, session.session.id)));
    });
    await logActivity(db, {
      userId: me.id,
      action: "changed",
      entity: "user",
      entityId: me.id,
      summary: "their own password",
    });
    return null;
  });
}
