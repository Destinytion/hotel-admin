"use server";

import { refresh } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { inr, isISODate, round2, todayISO } from "@/lib/format";
import { isUuid, run, text, UserError } from "@/lib/result";
import { logActivity, userName } from "@/server/activity";
import { roomCosts, type RoomCost } from "@/server/payables";

export type HotelPaymentInput = {
  hotelId: string;
  /** Empty when not recorded. */
  companyId: string;
  amount: number;
  paidOn: string;
  mode: string;
  reference: string;
  notes: string;
};

export type HotelDetail = {
  rooms: RoomCost[];
  payments: {
    id: string;
    paidOn: string;
    amount: number;
    mode: string;
    reference: string;
    notes: string;
    company: string;
    recordedBy: string;
    cancelled: boolean;
  }[];
};

export async function recordHotelPayment(input: HotelPaymentInput) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(input.hotelId)) throw new UserError("Pick the hotel you paid.");
    if (input.companyId && !isUuid(input.companyId)) throw new UserError("Pick the company that paid.");
    const amount = round2(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new UserError("Enter the amount paid.");
    if (amount > 100_000_000) throw new UserError("That amount is too large.");
    if (!isISODate(input.paidOn)) throw new UserError("Pick the date it was paid.");

    await db.transaction(async (tx) => {
      const [hotel] = await tx.select().from(schema.hotels).where(eq(schema.hotels.id, input.hotelId));
      if (!hotel) throw new UserError("That hotel could not be found.");
      const [payment] = await tx
        .insert(schema.hotelPayments)
        .values({
          hotelId: hotel.id,
          companyId: input.companyId || null,
          amount: amount.toFixed(2),
          paidOn: input.paidOn,
          mode: text(input.mode, 40),
          reference: text(input.reference, 200),
          notes: text(input.notes, 500),
          createdBy: user.id,
        })
        .returning({ id: schema.hotelPayments.id });
      await logActivity(tx, {
        userId: user.id,
        action: "recorded",
        entity: "hotel_payment",
        entityId: payment.id,
        summary: `a payment of ${inr(amount)} to ${hotel.name}`,
        detail: { hotelId: hotel.id, amount },
      });
    });

    refresh();
    return null;
  });
}

/** A payment to a hotel entered by mistake is cancelled, not deleted, so the record stays. */
export async function cancelHotelPayment(id: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(id)) throw new UserError("That payment could not be found.");
    await db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(schema.hotelPayments)
        .where(eq(schema.hotelPayments.id, id))
        .for("update");
      if (!payment) throw new UserError("That payment could not be found.");
      if (payment.status === "cancelled") {
        throw new UserError(`${await userName(tx, payment.cancelledBy)} already cancelled this payment.`);
      }
      const [hotel] = await tx.select().from(schema.hotels).where(eq(schema.hotels.id, payment.hotelId));
      await tx
        .update(schema.hotelPayments)
        .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: user.id })
        .where(eq(schema.hotelPayments.id, id));
      await logActivity(tx, {
        userId: user.id,
        action: "cancelled",
        entity: "hotel_payment",
        entityId: id,
        summary: `the payment of ${inr(Number(payment.amount))} to ${hotel?.name ?? "a hotel"}`,
        detail: { hotelId: payment.hotelId, amount: Number(payment.amount) },
      });
    });
    refresh();
    return null;
  });
}

export async function getHotelDetail(hotelId: string) {
  return run(async (): Promise<HotelDetail> => {
    await requireUser();
    if (!isUuid(hotelId)) throw new UserError("That hotel could not be found.");
    const [rooms, payments] = await Promise.all([
      roomCosts(db, todayISO(), hotelId),
      db
        .select({
          id: schema.hotelPayments.id,
          paidOn: schema.hotelPayments.paidOn,
          amount: schema.hotelPayments.amount,
          mode: schema.hotelPayments.mode,
          reference: schema.hotelPayments.reference,
          notes: schema.hotelPayments.notes,
          status: schema.hotelPayments.status,
          company: schema.companies.name,
          recordedBy: schema.users.name,
        })
        .from(schema.hotelPayments)
        .leftJoin(schema.companies, eq(schema.companies.id, schema.hotelPayments.companyId))
        .leftJoin(schema.users, eq(schema.users.id, schema.hotelPayments.createdBy))
        .where(eq(schema.hotelPayments.hotelId, hotelId))
        .orderBy(desc(schema.hotelPayments.paidOn), desc(schema.hotelPayments.createdAt)),
    ]);
    return {
      rooms,
      payments: payments.map((p) => ({
        id: p.id,
        paidOn: p.paidOn,
        amount: Number(p.amount),
        mode: p.mode,
        reference: p.reference,
        notes: p.notes,
        company: p.company ?? "",
        recordedBy: p.recordedBy ?? "",
        cancelled: p.status === "cancelled",
      })),
    };
  });
}
