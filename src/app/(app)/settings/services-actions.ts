"use server";

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { inr, round2 } from "@/lib/format";
import { isUuid, run, text, UserError } from "@/lib/result";
import { logActivity } from "@/server/activity";

export type ServiceInput = { id?: string; name: string; details: string; rate: number };

/** The database refused a second service with the same name. Drizzle wraps its errors, so look inside too. */
function isDuplicate(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === "23505") return true;
  }
  return false;
}

export async function saveService(input: ServiceInput) {
  return run(async () => {
    const user = await requireUser();
    const name = text(input.name, 120);
    const details = text(input.details, 500);
    const rate = round2(Number(input.rate));
    if (!name) throw new UserError("Enter the service name.");
    if (!Number.isFinite(rate) || rate < 0) throw new UserError("Enter the usual rate, or 0 if it varies.");
    if (input.id && !isUuid(input.id)) throw new UserError("That service could not be found.");

    try {
      await db.transaction(async (tx) => {
        if (input.id) {
          const updated = await tx
            .update(schema.services)
            .set({ name, details, rate: rate.toFixed(2) })
            .where(eq(schema.services.id, input.id))
            .returning({ id: schema.services.id });
          if (!updated.length) throw new UserError("This service was removed by someone else.");
        } else {
          await tx.insert(schema.services).values({ name, details, rate: rate.toFixed(2), createdBy: user.id });
        }
        await logActivity(tx, {
          userId: user.id,
          action: input.id ? "changed" : "added",
          entity: "service",
          entityId: input.id ?? null,
          summary: `service ${name} at ${inr(rate)}`,
        });
      });
    } catch (error) {
      if (isDuplicate(error)) throw new UserError(`There is already a service called ${name}.`);
      throw error;
    }

    refresh();
    return null;
  });
}

/** Removing a service leaves bills that used it exactly as they are. */
export async function deleteService(id: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(id)) throw new UserError("That service could not be found.");
    const gone = await db
      .delete(schema.services)
      .where(eq(schema.services.id, id))
      .returning({ name: schema.services.name });
    if (!gone.length) throw new UserError("This service was already removed.");
    await logActivity(db, {
      userId: user.id,
      action: "removed",
      entity: "service",
      entityId: id,
      summary: `service ${gone[0].name}`,
    });
    refresh();
    return null;
  });
}
