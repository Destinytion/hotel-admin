"use server";

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { inr, isISODate, round2, todayISO } from "@/lib/format";
import { isUuid, run, text, UserError } from "@/lib/result";
import { logActivity, userName } from "@/server/activity";
import { advanceLeft, billOutstanding, issueReceiptNumber, receiptSnapshot } from "@/server/receipts";

export type AdvanceInput = {
  companyId: string;
  clientId: string;
  amount: number;
  mode: string;
  paidOn: string;
  reference: string;
  /** What the advance is for. Printed on the receipt. */
  notes: string;
};

/** Money taken before there is a bill. It gets a receipt and counts as the client's credit. */
export async function recordAdvance(input: AdvanceInput) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(input.companyId)) throw new UserError("Pick the company that received the money.");
    if (!isUuid(input.clientId)) throw new UserError("Pick the client who paid.");
    const amount = round2(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new UserError("Enter the amount received.");
    if (amount > 100_000_000) throw new UserError("That amount is too large.");
    if (!isISODate(input.paidOn)) throw new UserError("Pick the date the money was received.");

    const saved = await db.transaction(async (tx) => {
      const [[company], [client]] = await Promise.all([
        tx.select().from(schema.companies).where(eq(schema.companies.id, input.companyId)),
        tx.select().from(schema.clients).where(eq(schema.clients.id, input.clientId)),
      ]);
      if (!company) throw new UserError("That company could not be found.");
      if (!client) throw new UserError("That client could not be found.");
      const receiptNumber = await issueReceiptNumber(tx, company, input.paidOn);
      const [payment] = await tx
        .insert(schema.payments)
        .values({
          companyId: company.id,
          clientId: client.id,
          kind: "advance",
          amount: amount.toFixed(2),
          mode: text(input.mode, 40),
          reference: text(input.reference, 200),
          notes: text(input.notes, 500),
          paidOn: input.paidOn,
          receiptNumber,
          snapshot: receiptSnapshot(company, client),
          createdBy: user.id,
        })
        .returning({ id: schema.payments.id });
      await logActivity(tx, {
        userId: user.id,
        action: "recorded",
        entity: "payment",
        entityId: payment.id,
        summary: `an advance of ${inr(amount)} from ${client.name}, receipt ${receiptNumber}`,
        detail: { amount, advance: true },
      });
      return { id: payment.id, receiptNumber };
    });

    refresh();
    return saved;
  });
}

/*
  A payment entered by mistake is cancelled, not deleted: its receipt number
  stays on record, the receipt shows CANCELLED, and the money stops counting.
*/
export async function cancelPayment(id: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(id)) throw new UserError("That payment could not be found.");

    await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, id)).for("update");
      if (!payment) throw new UserError("That payment could not be found.");
      if (payment.status === "cancelled") {
        throw new UserError(`${await userName(tx, payment.cancelledBy)} already cancelled this payment.`);
      }
      await tx
        .update(schema.payments)
        .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: user.id })
        .where(eq(schema.payments.id, id));
      await logActivity(tx, {
        userId: user.id,
        action: "cancelled",
        entity: "payment",
        entityId: id,
        summary: `receipt ${payment.receiptNumber} for ${inr(Number(payment.amount))}`,
        detail: { billId: payment.billId, amount: Number(payment.amount) },
      });
    });

    refresh();
    return null;
  });
}

/*
  Uses an advance, in full or in part, to pay a bill. Leave the amount out to
  use whatever is left of the advance. The amount must be no more than what is
  left of the advance or still due on the bill, and both must belong to the
  same company, since one company's money cannot settle another's bill. What
  is not used stays as credit for a later bill.
*/
export async function applyAdvance(input: { paymentId: string; billId: string; amount?: number }) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(input.paymentId) || !isUuid(input.billId)) {
      throw new UserError("That advance or bill could not be found.");
    }
    const asked = input.amount === undefined ? null : round2(Number(input.amount));
    if (asked !== null && (!Number.isFinite(asked) || asked <= 0)) {
      throw new UserError("Enter how much of the advance to use.");
    }

    await db.transaction(async (tx) => {
      const [bill] = await tx.select().from(schema.bills).where(eq(schema.bills.id, input.billId)).for("update");
      const [advance] = await tx
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, input.paymentId))
        .for("update");
      if (!bill) throw new UserError("That bill could not be found.");
      if (!advance) throw new UserError("That advance could not be found.");
      if (bill.status !== "final" || !bill.isSale) {
        throw new UserError("An advance can only be used on a finalised bill.");
      }
      if (advance.kind !== "advance" || advance.status !== "active") {
        throw new UserError("This advance has been cancelled.");
      }
      if (advance.clientId !== bill.clientId) throw new UserError("This advance is from a different client.");
      if (advance.companyId !== bill.companyId) {
        throw new UserError("This advance was received by the other company, so it cannot pay this bill.");
      }
      const left = await advanceLeft(tx, advance);
      if (left <= 0) throw new UserError("Someone has already used all of this advance.");
      const outstanding = await billOutstanding(tx, bill);
      const amount = asked ?? left;
      if (amount > left) {
        throw new UserError(`Only ${inr(left)} of this advance is left to use.`);
      }
      if (amount > outstanding) {
        throw new UserError(
          asked === null
            ? `This advance of ${inr(amount)} is more than the ${inr(outstanding)} still due on this bill.`
            : `Only ${inr(outstanding)} is still due on this bill.`,
        );
      }
      const [use] = await tx
        .insert(schema.advanceUses)
        .values({
          advanceId: advance.id,
          billId: bill.id,
          amount: amount.toFixed(2),
          usedOn: todayISO(),
          createdBy: user.id,
        })
        .returning({ id: schema.advanceUses.id });
      await tx.update(schema.payments).set({ appliedAt: new Date() }).where(eq(schema.payments.id, advance.id));
      await logActivity(tx, {
        userId: user.id,
        action: "applied",
        entity: "payment",
        entityId: advance.id,
        summary:
          amount === Number(advance.amount)
            ? `advance ${advance.receiptNumber} of ${inr(amount)} to ${bill.number}`
            : amount === left
              ? `the last ${inr(amount)} of advance ${advance.receiptNumber} to ${bill.number}`
              : `${inr(amount)} of advance ${advance.receiptNumber} to ${bill.number}, ${inr(round2(left - amount))} left`,
        detail: { billId: bill.id, amount, useId: use.id },
      });
    });

    refresh();
    return null;
  });
}

/** Takes an advance back off a bill, for example when it was used on the wrong one. */
export async function undoAdvanceUse(useId: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(useId)) throw new UserError("That could not be found.");
    await db.transaction(async (tx) => {
      const [gone] = await tx.delete(schema.advanceUses).where(eq(schema.advanceUses.id, useId)).returning();
      if (!gone) throw new UserError("Someone has already taken this advance off the bill.");
      const [[advance], [bill]] = await Promise.all([
        tx.select().from(schema.payments).where(eq(schema.payments.id, gone.advanceId)),
        tx.select().from(schema.bills).where(eq(schema.bills.id, gone.billId)),
      ]);
      await logActivity(tx, {
        userId: user.id,
        action: "took back",
        entity: "payment",
        entityId: gone.advanceId,
        summary: `${inr(Number(gone.amount))} of advance ${advance?.receiptNumber ?? ""} from ${bill?.number ?? "a bill"}`,
        detail: { billId: gone.billId, amount: Number(gone.amount) },
      });
    });
    refresh();
    return null;
  });
}
