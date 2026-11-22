import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { ConflictError } from "@/lib/result";
import type { Executor } from "./availability";

/*
  Records who did what. `action` is a past-tense verb and `summary` names the
  thing in words, so the Activity screen can print "Asha finalised Tax Invoice
  SR/26-27/0004 for Tarang Events" even after the record is gone.
*/
export async function logActivity(
  ex: Executor,
  entry: {
    userId: string;
    action: string;
    entity: string;
    entityId?: string | null;
    summary: string;
    detail?: Record<string, unknown>;
  },
) {
  await ex.insert(schema.auditLog).values({
    userId: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    detail: entry.detail ?? null,
  });
}

export function ago(date: Date) {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 90) return "a minute ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export async function userName(ex: Executor, userId: string | null) {
  if (!userId) return "Someone";
  const [user] = await ex
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return user?.name ?? "Someone";
}

/** The error for a save that arrived after someone else's save of the same record. */
export async function conflict(
  ex: Executor,
  thing: string,
  current: { updatedBy: string | null; updatedAt: Date },
) {
  const who = await userName(ex, current.updatedBy);
  return new ConflictError(
    `${who} changed this ${thing} ${ago(current.updatedAt)}, after you opened it. Your changes were not saved.`,
  );
}
