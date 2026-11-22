"use server";

import { refresh } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { inr, isISODate, round2, todayISO } from "@/lib/format";
import { isUuid, run, text, UserError } from "@/lib/result";
import { logActivity } from "@/server/activity";
import { billOutstanding, issueReceiptNumber, receiptSnapshot } from "@/server/receipts";

/** Records money received against a bill, with its own receipt number. */
export async function recordPayment(input: {
  billId: string;
  amount: number;
  mode: string;
  paidOn: string;
  reference: string;
  notes?: string;
}) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(input.billId)) throw new UserError("That bill could not be found.");
    const amount = round2(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new UserError("Enter the amount received.");
    if (!isISODate(input.paidOn)) throw new UserError("Pick the date the payment was received.");

    const saved = await db.transaction(async (tx) => {
      const [bill] = await tx
        .select()
        .from(schema.bills)
        .where(eq(schema.bills.id, input.billId))
        .for("update");
      if (!bill) throw new UserError("That bill could not be found.");
      if (bill.status !== "final" || !bill.isSale) {
        throw new UserError("Payments can only be recorded on a finalised bill.");
      }
      const outstanding = await billOutstanding(tx, bill);
      if (amount > outstanding) {
        throw new UserError(`Only ${inr(outstanding)} is outstanding on this bill.`);
      }
      const [[company], [client]] = await Promise.all([
        tx.select().from(schema.companies).where(eq(schema.companies.id, bill.companyId)),
        tx.select().from(schema.clients).where(eq(schema.clients.id, bill.clientId)),
      ]);
      const receiptNumber = await issueReceiptNumber(tx, company, input.paidOn);
      const [payment] = await tx
        .insert(schema.payments)
        .values({
          companyId: bill.companyId,
          clientId: bill.clientId,
          billId: bill.id,
          kind: "payment",
          amount: amount.toFixed(2),
          mode: text(input.mode, 40),
          reference: text(input.reference, 200),
          notes: text(input.notes ?? "", 500),
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
        summary: `a payment of ${inr(amount)} on ${bill.number}, receipt ${receiptNumber}`,
        detail: { billId: bill.id, amount },
      });
      return { id: payment.id, receiptNumber };
    });

    refresh();
    return saved;
  });
}

/** Cancelling keeps the bill and its number on record and puts its rooms back on sale. */
export async function cancelBill(id: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(id)) throw new UserError("That bill could not be found.");
    const cancelled = await db
      .update(schema.bills)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedBy: user.id })
      .where(and(eq(schema.bills.id, id), eq(schema.bills.status, "final")))
      .returning({ id: schema.bills.id, number: schema.bills.number });
    if (!cancelled.length) {
      throw new UserError("Only a finalised bill can be cancelled. Someone may have cancelled it already.");
    }
    await logActivity(db, {
      userId: user.id,
      action: "cancelled",
      entity: "bill",
      entityId: id,
      summary: `${cancelled[0].number}`,
    });
    refresh();
    return null;
  });
}

/*
  Starts a new draft with the same client and items. From a quotation, the
  draft uses the company's first format that counts as a sale.
*/
export async function copyToDraft(id: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(id)) throw new UserError("That bill could not be found.");

    const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, id));
    if (!bill) throw new UserError("That bill could not be found.");
    const lines = await db
      .select()
      .from(schema.billLines)
      .where(eq(schema.billLines.billId, id))
      .orderBy(asc(schema.billLines.position));

    let formatId = bill.formatId;
    let isSale = bill.isSale;
    if (!bill.isSale) {
      const [sale] = await db
        .select({ id: schema.formats.id })
        .from(schema.formats)
        .where(
          and(
            eq(schema.formats.companyId, bill.companyId),
            eq(schema.formats.countsAsSale, true),
            eq(schema.formats.active, true),
          ),
        )
        .orderBy(asc(schema.formats.createdAt), asc(schema.formats.name))
        .limit(1);
      if (!sale) throw new UserError("This company has no format to bill with.");
      formatId = sale.id;
      isSale = true;
    }

    const newId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.bills)
        .values({
          companyId: bill.companyId,
          formatId,
          clientId: bill.clientId,
          isSale,
          billDate: todayISO(),
          data: bill.data,
          subtotal: bill.subtotal,
          taxTotal: bill.taxTotal,
          total: bill.total,
          sourceBillId: bill.id,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: schema.bills.id });
      if (lines.length) {
        await tx.insert(schema.billLines).values(
          lines.map((l) => ({
            billId: created.id,
            position: l.position,
            kind: l.kind,
            roomTypeId: l.roomTypeId,
            description: l.description,
            checkIn: l.checkIn,
            nights: l.nights,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.amount,
          })),
        );
      }
      await logActivity(tx, {
        userId: user.id,
        action: "started a draft from",
        entity: "bill",
        entityId: created.id,
        summary: `${bill.number}`,
        detail: { copiedFrom: bill.id },
      });
      return created.id;
    });

    refresh();
    return { id: newId };
  });
}
