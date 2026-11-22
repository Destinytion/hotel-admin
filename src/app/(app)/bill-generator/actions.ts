"use server";

import { refresh } from "next/cache";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { addDays, fiscalYear, fmtDate, inr, isISODate, round2 } from "@/lib/format";
import { isUuid, run, text, UserError } from "@/lib/result";
import { conflict, logActivity, userName } from "@/server/activity";
import { nights, summariseStay, type StayAvailability } from "@/server/availability";

export type BillLineInput = {
  kind: "room" | "other";
  /** A room typed by hand rather than picked from your stock. */
  manual?: boolean;
  roomTypeId: string;
  description: string;
  checkIn: string;
  nights: number;
  quantity: number;
  rate: number;
};

export type BillInput = {
  id?: string;
  /** The version this edit started from. Missing for a new bill. */
  version?: number;
  companyId: string;
  formatId: string;
  clientId: string;
  billDate: string;
  taxPercent: number;
  notes: string;
  lines: BillLineInput[];
};

export async function checkAvailability(roomTypeId: string, checkIn: string, stayNights: number) {
  return run(async (): Promise<StayAvailability> => {
    await requireUser();
    if (!isUuid(roomTypeId) || !isISODate(checkIn) || !Number.isInteger(stayNights) || stayNights < 1 || stayNights > 365) {
      throw new UserError("Pick a room, a check-in date and the number of nights.");
    }
    return summariseStay(await nights(db, checkIn, addDays(checkIn, stayNights - 1), roomTypeId));
  });
}

/** Saves a draft, or saves and finalises in one step. */
export async function saveBill(input: BillInput, finalise: boolean) {
  return run(async () => {
    const user = await requireUser();

    if (!isUuid(input.companyId)) throw new UserError("Pick the company to bill from.");
    if (!isUuid(input.formatId)) throw new UserError("Pick a format.");
    if (!isUuid(input.clientId)) throw new UserError("Pick a client.");
    if (!isISODate(input.billDate)) throw new UserError("Pick the bill date.");
    if (input.id && !isUuid(input.id)) throw new UserError("That bill could not be found.");
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new UserError("Add at least one item.");
    }
    if (input.lines.length > 100) throw new UserError("A bill can have up to 100 items.");

    const [[company], [format], [client]] = await Promise.all([
      db.select().from(schema.companies).where(eq(schema.companies.id, input.companyId)),
      db
        .select()
        .from(schema.formats)
        .where(and(eq(schema.formats.id, input.formatId), eq(schema.formats.companyId, input.companyId))),
      db.select().from(schema.clients).where(eq(schema.clients.id, input.clientId)),
    ]);
    if (!company) throw new UserError("That company could not be found.");
    if (!format) throw new UserError("That format does not belong to this company. Pick the format again.");
    if (!client) throw new UserError("That client could not be found.");

    // Room names come from the database, not from what the screen sent.
    // A room typed by hand (not from your stock) has no room type at all.
    const fromStock = (l: BillLineInput) => l.kind === "room" && !l.manual;
    const roomIds = [...new Set(input.lines.filter(fromStock).map((l) => l.roomTypeId))];
    if (roomIds.some((id) => !isUuid(id))) throw new UserError("Pick a room for every room item.");
    const rooms = roomIds.length
      ? await db
          .select({
            id: schema.roomTypes.id,
            name: schema.roomTypes.name,
            hotel: schema.hotels.name,
            city: schema.hotels.city,
          })
          .from(schema.roomTypes)
          .innerJoin(schema.hotels, eq(schema.hotels.id, schema.roomTypes.hotelId))
          .where(inArray(schema.roomTypes.id, roomIds))
      : [];
    const roomLabel = new Map(rooms.map((r) => [r.id, [r.name, r.hotel, r.city].filter(Boolean).join(", ")]));

    const lines = input.lines.map((line, index) => {
      const quantity = Number(line.quantity);
      const rate = Number(line.rate);
      const where = `Item ${index + 1}`;
      if (!Number.isFinite(rate) || rate < 0) throw new UserError(`${where}: enter a rate.`);
      if (line.kind === "room") {
        const label = line.manual ? text(line.description, 500) : roomLabel.get(line.roomTypeId);
        const stayNights = Number(line.nights);
        if (!label) {
          throw new UserError(line.manual ? `${where}: type the room and hotel.` : `${where}: pick a room.`);
        }
        if (!isISODate(line.checkIn)) throw new UserError(`${where}: pick the check-in date.`);
        if (!Number.isInteger(stayNights) || stayNights < 1 || stayNights > 365) {
          throw new UserError(`${where}: nights must be a whole number, 1 or more.`);
        }
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new UserError(`${where}: rooms must be a whole number, 1 or more.`);
        }
        return {
          position: index,
          kind: "room" as const,
          // Empty for a room typed by hand: it never touches inventory.
          roomTypeId: line.manual ? null : line.roomTypeId,
          description: label,
          checkIn: line.checkIn,
          nights: stayNights,
          quantity,
          rate,
          amount: round2(stayNights * quantity * rate),
        };
      }
      const description = text(line.description, 1000);
      if (!description) throw new UserError(`${where}: describe what this item is.`);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new UserError(`${where}: enter a quantity.`);
      return {
        position: index,
        kind: "other" as const,
        roomTypeId: null,
        description,
        checkIn: null,
        nights: null,
        quantity,
        rate,
        amount: round2(quantity * rate),
      };
    });

    const taxPercent = format.hasTaxLine ? Number(input.taxPercent) : 0;
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
      throw new UserError("The tax % must be between 0 and 100.");
    }
    const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
    const taxTotal = round2((subtotal * taxPercent) / 100);
    const total = round2(subtotal + taxTotal);

    const header = {
      companyId: company.id,
      formatId: format.id,
      clientId: client.id,
      billDate: input.billDate,
      isSale: format.countsAsSale,
      data: { taxPercent, notes: text(input.notes) },
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      total: total.toFixed(2),
    };

    const saved = await db.transaction(async (tx) => {
      let billId = input.id;
      let number: string | null = null;
      if (billId) {
        const [existing] = await tx
          .select({
            status: schema.bills.status,
            version: schema.bills.version,
            updatedBy: schema.bills.updatedBy,
            updatedAt: schema.bills.updatedAt,
          })
          .from(schema.bills)
          .where(eq(schema.bills.id, billId))
          .for("update");
        if (!existing) throw new UserError("This draft was deleted by someone else.");
        if (existing.status !== "draft") {
          throw new UserError(
            `${await userName(tx, existing.updatedBy)} already finalised this bill. It can no longer be edited.`,
          );
        }
        // Only saves if nobody else has saved since this draft was opened.
        if (existing.version !== Number(input.version)) throw await conflict(tx, "draft", existing);
        await tx
          .update(schema.bills)
          .set({ ...header, version: existing.version + 1, updatedBy: user.id })
          .where(eq(schema.bills.id, billId));
        await tx.delete(schema.billLines).where(eq(schema.billLines.billId, billId));
      } else {
        const [created] = await tx
          .insert(schema.bills)
          .values({ ...header, createdBy: user.id, updatedBy: user.id })
          .returning({ id: schema.bills.id });
        billId = created.id;
      }

      await tx.insert(schema.billLines).values(
        lines.map((l) => ({
          billId: billId!,
          position: l.position,
          kind: l.kind,
          roomTypeId: l.roomTypeId,
          description: l.description,
          checkIn: l.checkIn,
          nights: l.nights,
          quantity: String(l.quantity),
          rate: l.rate.toFixed(2),
          amount: l.amount.toFixed(2),
        })),
      );

      if (finalise) {
        // 1. A sale must fit in the rooms that are left. Each room type is
        //    locked first so two people cannot sell the same last room.
        if (format.countsAsSale) {
          const wanted = new Map<string, Map<string, number>>();
          for (const l of lines) {
            // Only rooms from your stock are checked; typed rooms and services are not.
            if (l.kind !== "room" || !l.roomTypeId) continue;
            const perNight = wanted.get(l.roomTypeId) ?? new Map<string, number>();
            for (let i = 0; i < l.nights; i++) {
              const night = addDays(l.checkIn, i);
              perNight.set(night, (perNight.get(night) ?? 0) + l.quantity);
            }
            wanted.set(l.roomTypeId, perNight);
          }
          for (const roomTypeId of [...wanted.keys()].sort()) {
            // Without this lock, four people selling at the same instant sold 8 of 5
            // rooms in testing. scripts/multi-user-test.mjs checks it stays in place.
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${roomTypeId}))`);
            const perNight = wanted.get(roomTypeId)!;
            const dates = [...perNight.keys()].sort();
            const rows = await nights(tx, dates[0], dates[dates.length - 1], roomTypeId);
            const label = roomLabel.get(roomTypeId);
            for (const night of dates) {
              const row = rows.find((r) => r.night === night);
              const on = fmtDate(night);
              if (!row || row.held === 0) throw new UserError(`No rooms are held for ${label} on ${on}.`);
              if (row.stopped) throw new UserError(`${label} is on stop sale on ${on}.`);
              const left = row.held - row.sold;
              if (perNight.get(night)! > left) {
                throw new UserError(
                  left <= 0 ? `${label} is sold out on ${on}.` : `Only ${left} left for ${label} on ${on}.`,
                );
              }
            }
          }
        }

        // 2. The next number in this company and format's series for the year.
        const year = fiscalYear(input.billDate);
        const [series] = await tx
          .insert(schema.numberSeries)
          .values({ companyId: company.id, formatId: format.id, fiscalYear: year, nextNumber: 2 })
          .onConflictDoUpdate({
            target: [schema.numberSeries.companyId, schema.numberSeries.formatId, schema.numberSeries.fiscalYear],
            set: { nextNumber: sql`${schema.numberSeries.nextNumber} + 1` },
          })
          .returning({ next: schema.numberSeries.nextNumber });
        number = `${format.numberPrefix}${year}/${String(series.next - 1).padStart(4, "0")}`;

        // 3. Freeze the company and client details as they are today.
        const [contact] = await tx
          .select({ name: schema.clientContacts.name, phone: schema.clientContacts.phone })
          .from(schema.clientContacts)
          .where(eq(schema.clientContacts.clientId, client.id))
          .orderBy(desc(schema.clientContacts.isPrimary), asc(schema.clientContacts.createdAt))
          .limit(1);
        await tx
          .update(schema.bills)
          .set({
            status: "final",
            number,
            finalisedAt: new Date(),
            snapshot: {
              company: {
                name: company.name,
                initials: company.initials,
                color: company.color,
                address: company.address,
                registration: company.registration,
                bankDetails: company.bankDetails,
                terms: company.terms,
              },
              client: {
                name: client.name,
                address: client.address,
                registration: client.registration,
                contact: contact?.name ?? "",
                phone: contact?.phone ?? "",
              },
              format: { title: format.title, hasTaxLine: format.hasTaxLine },
            },
          })
          .where(eq(schema.bills.id, billId));
      }

      await logActivity(tx, {
        userId: user.id,
        action: finalise ? "finalised" : "saved a draft of",
        entity: "bill",
        entityId: billId,
        summary: `${format.title} ${number ?? ""}`.trim() + ` for ${client.name}, ${inr(total)}`,
      });
      const [row] = await tx
        .select({ version: schema.bills.version })
        .from(schema.bills)
        .where(eq(schema.bills.id, billId));
      return { id: billId, version: row.version };
    });

    refresh();
    return saved;
  });
}

export async function deleteDraft(id: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(id)) throw new UserError("That draft could not be found.");
    const [client] = await db
      .select({ name: schema.clients.name })
      .from(schema.bills)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.bills.clientId))
      .where(eq(schema.bills.id, id));
    const gone = await db
      .delete(schema.bills)
      .where(and(eq(schema.bills.id, id), eq(schema.bills.status, "draft")))
      .returning({ id: schema.bills.id });
    if (!gone.length) throw new UserError("Only drafts can be deleted. Cancel a finalised bill instead.");
    await logActivity(db, {
      userId: user.id,
      action: "deleted",
      entity: "bill",
      entityId: id,
      summary: `a draft for ${client?.name ?? "a client"}`,
    });
    refresh();
    return null;
  });
}
