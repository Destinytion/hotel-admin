"use server";

import { refresh } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { inr, isISODate, round2, todayISO } from "@/lib/format";
import { isUuid, run, text, UserError } from "@/lib/result";
import { logActivity } from "@/server/activity";
import { billOutstanding, issueReceiptNumber, receiptSnapshot } from "@/server/receipts";
import { PROFORMA_NOTE, QUOTATION_NOTE, asLayout, defaultSchedule, readSchedule, type Layout } from "@/lib/bill-document";

/** The note a format starts with, from the user's own formats. */
const starterNote = (layout: Layout) => (layout === "proforma" ? PROFORMA_NOTE : layout === "quotation" ? QUOTATION_NOTE : "");

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

/*
  Cancelling keeps the bill and its number on record and puts its rooms back
  on sale. Advances used on it are freed to use on another bill; payments made
  on it stay on record and count as the client's credit.
*/
export async function cancelBill(id: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(id)) throw new UserError("That bill could not be found.");
    await db.transaction(async (tx) => {
      const cancelled = await tx
        .update(schema.bills)
        .set({ status: "cancelled", cancelledAt: new Date(), updatedBy: user.id })
        .where(and(eq(schema.bills.id, id), eq(schema.bills.status, "final")))
        .returning({ id: schema.bills.id, number: schema.bills.number, isSale: schema.bills.isSale });
      if (!cancelled.length) {
        throw new UserError("Only a finalised bill can be cancelled. Someone may have cancelled it already.");
      }
      const freed = await tx.delete(schema.advanceUses).where(eq(schema.advanceUses.billId, id)).returning();
      const freedTotal = round2(freed.reduce((sum, u) => sum + Number(u.amount), 0));
      await logActivity(tx, {
        userId: user.id,
        // A quotation or proforma the client did not take is declined, not cancelled.
        action: cancelled[0].isSale ? "cancelled" : "marked as declined",
        entity: "bill",
        entityId: id,
        summary: `${cancelled[0].number}` + (freed.length ? `, freeing ${inr(freedTotal)} of advances` : ""),
      });
    });
    refresh();
    return null;
  });
}

export type Voucher = {
  /** One name per line. */
  guests: string;
  /** The hotel's confirmation number for each room line, by line id. */
  confirmations: Record<string, string>;
  /** Requests for the hotel: arrival time, bed type and the like. */
  requests: string;
};

/** Saves what the hotel voucher adds to a bill. Prices are never on a voucher. */
export async function saveVoucher(billId: string, input: Voucher) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(billId)) throw new UserError("That bill could not be found.");
    const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, billId));
    if (!bill || bill.status === "draft") throw new UserError("A voucher is made from a finalised bill.");
    const lineIds = new Set(
      (await db.select({ id: schema.billLines.id }).from(schema.billLines).where(eq(schema.billLines.billId, billId))).map(
        (l) => l.id,
      ),
    );
    const confirmations: Record<string, string> = {};
    for (const [lineId, value] of Object.entries(input.confirmations ?? {})) {
      const clean = text(String(value ?? ""), 100);
      if (lineIds.has(lineId) && clean) confirmations[lineId] = clean;
    }
    const voucher: Voucher = {
      guests: text(input.guests ?? "", 2000),
      confirmations,
      requests: text(input.requests ?? "", 2000),
    };
    await db.update(schema.bills).set({ voucher }).where(eq(schema.bills.id, billId));
    await logActivity(db, {
      userId: user.id,
      action: "updated the voucher of",
      entity: "bill",
      entityId: billId,
      summary: `${bill.number}`,
    });
    refresh();
    return null;
  });
}

/*
  Starts a new draft with the same client, booking and items, in the format
  asked for: a quotation becomes a proforma or a bill in one click. Without a
  format, a sale is copied as it is and a quotation or proforma becomes the
  company's first format that counts as a sale.
*/
export async function copyToDraft(id: string, toFormatId?: string) {
  return run(() => makeDraft(id, toFormatId, false));
}

/*
  A new version of a quotation or proforma, for when the client asks for
  changes: a draft in the same format with everything filled in. When it is
  issued, the old one is marked "Revised" (see saveBill).
*/
export async function reviseDocument(id: string) {
  return run(async () => {
    if (!isUuid(id)) throw new UserError("That document could not be found.");
    const [bill] = await db
      .select({ formatId: schema.bills.formatId, isSale: schema.bills.isSale, status: schema.bills.status })
      .from(schema.bills)
      .where(eq(schema.bills.id, id));
    if (!bill) throw new UserError("That document could not be found.");
    if (bill.isSale) throw new UserError("A bill is not revised. Cancel it and make a new one.");
    if (bill.status !== "final") throw new UserError("Only an issued quotation or proforma can be revised.");
    return makeDraft(id, bill.formatId, true);
  });
}

async function makeDraft(id: string, toFormatId: string | undefined, revise: boolean) {
  const user = await requireUser();
  if (!isUuid(id)) throw new UserError("That bill could not be found.");
  if (toFormatId !== undefined && !isUuid(toFormatId)) throw new UserError("Pick the format to make.");

  const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, id));
  if (!bill) throw new UserError("That bill could not be found.");
  const [lines, [fromFormat], [company]] = await Promise.all([
    db.select().from(schema.billLines).where(eq(schema.billLines.billId, id)).orderBy(asc(schema.billLines.position)),
    db.select({ layout: schema.formats.layout }).from(schema.formats).where(eq(schema.formats.id, bill.formatId)),
    db.select({ phone: schema.companies.phone }).from(schema.companies).where(eq(schema.companies.id, bill.companyId)),
  ]);

  let formatId = bill.formatId;
  let isSale = bill.isSale;
  let toLayout = asLayout(fromFormat?.layout);
  if (toFormatId) {
    const [target] = await db
      .select()
      .from(schema.formats)
      .where(
        and(
          eq(schema.formats.id, toFormatId),
          eq(schema.formats.companyId, bill.companyId),
          eq(schema.formats.active, true),
        ),
      );
    if (!target) throw new UserError("That format is not available for this company.");
    formatId = target.id;
    isSale = target.countsAsSale;
    toLayout = asLayout(target.layout);
  } else if (!bill.isSale) {
    const [sale] = await db
      .select({ id: schema.formats.id, layout: schema.formats.layout })
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
    toLayout = asLayout(sale.layout);
  }

  /*
    What changes with the format. A quotation's letter and a proforma's
    payment note belong to that document, so the new one starts with its own
    note instead; a bill's note is kept. A quotation gets its usual payment
    schedule and is signed by whoever makes it.
  */
  const fromLayout = asLayout(fromFormat?.layout);
  const old = (bill.data ?? {}) as Record<string, unknown>;
  // Which document a revision replaces is its own; a copy never carries it on.
  const { revises: _revises, revisedBy: _revisedBy, ...kept } = old;
  void _revises;
  void _revisedBy;
  const data: Record<string, unknown> = { ...kept, ...(revise ? { revises: bill.id } : {}) };
  if (toLayout !== fromLayout) {
    const notes = typeof old.notes === "string" ? old.notes.trim() : "";
    if (!notes || fromLayout === "proforma" || fromLayout === "quotation") data.notes = starterNote(toLayout);
    if (toLayout === "quotation") {
      if (!readSchedule(old).length) data.schedule = defaultSchedule();
      const details = (old.details && typeof old.details === "object" ? old.details : {}) as Record<string, unknown>;
      data.details = {
        ...details,
        signName: details.signName || user.name,
        signPhone: details.signPhone || company?.phone || "",
      };
    } else {
      data.schedule = [];
    }
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
        data,
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
      action: revise ? "started a revision of" : "started a draft from",
      entity: "bill",
      entityId: created.id,
      summary: `${bill.number}`,
      detail: { copiedFrom: bill.id },
    });
    return created.id;
  });

  refresh();
  return { id: newId };
}
