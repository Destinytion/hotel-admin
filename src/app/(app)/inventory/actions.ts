"use server";

import { refresh } from "next/cache";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { fmtDate } from "@/lib/format";
import { isUuid, run, text, UserError } from "@/lib/result";
import { logActivity } from "@/server/activity";
import { nights, type Executor } from "@/server/availability";
import { addBlock, checkBlock, checkRange, type PayFor } from "@/server/stock";

export type { PayFor };

export type StockInput = {
  hotel: string;
  city: string;
  roomType: string;
  firstNight: string;
  lastNight: string;
  roomsHeld: number;
  sellPrice: number;
  /** Empty when not recorded. */
  costPrice: number | null;
  releaseDate: string;
  /** What the hotel is paid for: every room held, or only rooms sold. */
  payFor: PayFor;
};

export type BlockInput = {
  id: string;
  /** When the block was last saved, as it was when the edit began. */
  updatedAt: string;
  firstNight: string;
  lastNight: string;
  roomsHeld: number;
  sellPrice: number;
  costPrice: number | null;
  releaseDate: string;
  payFor: PayFor;
};

export type RoomDetail = {
  blocks: {
    id: string;
    firstNight: string;
    lastNight: string;
    roomsHeld: number;
    sellPrice: number;
    costPrice: number | null;
    releaseDate: string | null;
    payFor: PayFor;
    updatedAt: string;
  }[];
  stopSales: { id: string; firstNight: string; lastNight: string }[];
};

async function roomName(ex: Executor, roomTypeId: string) {
  const [room] = await ex
    .select({ name: schema.roomTypes.name, hotel: schema.hotels.name })
    .from(schema.roomTypes)
    .innerJoin(schema.hotels, eq(schema.hotels.id, schema.roomTypes.hotelId))
    .where(eq(schema.roomTypes.id, roomTypeId));
  return room ? `${room.name}, ${room.hotel}` : "a room";
}

/** Holds a lock on one room type until the transaction ends, so two people cannot change its stock at once. */
const lockRoom = (roomTypeId: string) => sql`select pg_advisory_xact_lock(hashtext(${roomTypeId}))`;

export async function addStock(input: StockInput) {
  return run(async () => {
    const user = await requireUser();
    const hotel = text(input.hotel, 200);
    const roomType = text(input.roomType, 200);
    if (!hotel) throw new UserError("Enter the hotel name.");
    if (!roomType) throw new UserError("Enter the room type.");
    const block = checkBlock(input);
    await db.transaction((tx) => addBlock(tx, user.id, { hotel, city: text(input.city, 100), roomType, block }));
    refresh();
    return null;
  });
}

/*
  Changes a block's dates, rooms or prices. Rooms already sold must still be
  covered on every night afterwards, so a block cannot shrink under bills.
*/
export async function updateStockBlock(input: BlockInput) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(input.id)) throw new UserError("That block could not be found.");
    const values = checkBlock(input);

    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.stockBlocks).where(eq(schema.stockBlocks.id, input.id));
      if (!before) throw new UserError("Someone has removed these rooms while you were editing them.");
      await tx.execute(lockRoom(before.roomTypeId));
      const [current] = await tx.select().from(schema.stockBlocks).where(eq(schema.stockBlocks.id, input.id));
      if (!current) throw new UserError("Someone has removed these rooms while you were editing them.");
      if (current.updatedAt.toISOString() !== input.updatedAt) {
        throw new UserError("Someone changed these rooms while you were editing them. Close this and open it again to see their change.");
      }

      const from = current.firstNight < values.firstNight ? current.firstNight : values.firstNight;
      const to = current.lastNight > values.lastNight ? current.lastNight : values.lastNight;
      const inside = (night: string, first: string, last: string) => night >= first && night <= last;
      const rows = await nights(tx, from, to, current.roomTypeId);
      const short = rows.find((r) => {
        const after =
          r.held -
          (inside(r.night, current.firstNight, current.lastNight) ? current.roomsHeld : 0) +
          (inside(r.night, values.firstNight, values.lastNight) ? values.roomsHeld : 0);
        return after < r.sold;
      });
      if (short) {
        throw new UserError(
          `${short.sold} rooms are already sold on ${fmtDate(short.night)}, more than would be held after this change. Cancel those bills first.`,
        );
      }

      await tx.update(schema.stockBlocks).set(values).where(eq(schema.stockBlocks.id, input.id));
      await logActivity(tx, {
        userId: user.id,
        action: "changed",
        entity: "stock_block",
        entityId: input.id,
        summary: `rooms of ${await roomName(tx, current.roomTypeId)}, now ${values.roomsHeld} rooms ${fmtDate(values.firstNight)} to ${fmtDate(values.lastNight)}`,
      });
    });

    refresh();
    return null;
  });
}

export async function getRoomDetail(roomTypeId: string) {
  return run(async (): Promise<RoomDetail> => {
    await requireUser();
    if (!isUuid(roomTypeId)) throw new UserError("That room could not be found.");
    const [blocks, stopSales] = await Promise.all([
      db
        .select()
        .from(schema.stockBlocks)
        .where(eq(schema.stockBlocks.roomTypeId, roomTypeId))
        .orderBy(asc(schema.stockBlocks.firstNight)),
      db
        .select()
        .from(schema.stopSales)
        .where(eq(schema.stopSales.roomTypeId, roomTypeId))
        .orderBy(asc(schema.stopSales.firstNight)),
    ]);
    return {
      blocks: blocks.map((b) => ({
        id: b.id,
        firstNight: b.firstNight,
        lastNight: b.lastNight,
        roomsHeld: b.roomsHeld,
        sellPrice: Number(b.sellPrice),
        costPrice: b.costPrice === null ? null : Number(b.costPrice),
        releaseDate: b.releaseDate,
        payFor: b.payFor === "sold" ? "sold" : "held",
        updatedAt: b.updatedAt.toISOString(),
      })),
      stopSales: stopSales.map((s) => ({ id: s.id, firstNight: s.firstNight, lastNight: s.lastNight })),
    };
  });
}

export async function deleteStockBlock(id: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(id)) throw new UserError("That block could not be found.");

    await db.transaction(async (tx) => {
      const [block] = await tx.select().from(schema.stockBlocks).where(eq(schema.stockBlocks.id, id));
      if (!block) throw new UserError("That block could not be found.");
      await tx.execute(lockRoom(block.roomTypeId));

      // Rooms already sold must still be covered by what remains.
      const rows = await nights(tx, block.firstNight, block.lastNight, block.roomTypeId);
      const short = rows.find((r) => r.held - block.roomsHeld < r.sold);
      if (short) {
        throw new UserError(
          `Rooms from this block are already sold on ${fmtDate(short.night)}. Cancel those bills first.`,
        );
      }

      await tx.delete(schema.stockBlocks).where(eq(schema.stockBlocks.id, id));
      await logActivity(tx, {
        userId: user.id,
        action: "removed",
        entity: "stock_block",
        entityId: id,
        summary: `${block.roomsHeld} rooms of ${await roomName(tx, block.roomTypeId)}, ${fmtDate(block.firstNight)} to ${fmtDate(block.lastNight)}`,
      });
    });

    refresh();
    return null;
  });
}

export async function addStopSale(input: { roomTypeId: string; firstNight: string; lastNight: string }) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(input.roomTypeId)) throw new UserError("That room could not be found.");
    checkRange(input.firstNight, input.lastNight);
    await db.insert(schema.stopSales).values({
      roomTypeId: input.roomTypeId,
      firstNight: input.firstNight,
      lastNight: input.lastNight,
    });
    await logActivity(db, {
      userId: user.id,
      action: "stopped sale on",
      entity: "stop_sale",
      summary: `${await roomName(db, input.roomTypeId)}, ${fmtDate(input.firstNight)} to ${fmtDate(input.lastNight)}`,
    });
    refresh();
    return null;
  });
}

export async function deleteStopSale(id: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(id)) throw new UserError("That stop sale could not be found.");
    const [gone] = await db.delete(schema.stopSales).where(eq(schema.stopSales.id, id)).returning();
    if (gone) {
      await logActivity(db, {
        userId: user.id,
        action: "lifted the stop sale on",
        entity: "stop_sale",
        summary: `${await roomName(db, gone.roomTypeId)}, ${fmtDate(gone.firstNight)} to ${fmtDate(gone.lastNight)}`,
      });
    }
    refresh();
    return null;
  });
}
