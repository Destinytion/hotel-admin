"use server";

import { refresh } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { fmtDate, isISODate } from "@/lib/format";
import { isUuid, run, text, UserError } from "@/lib/result";
import { logActivity } from "@/server/activity";
import { nights, type Executor } from "@/server/availability";

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
  }[];
  stopSales: { id: string; firstNight: string; lastNight: string }[];
};

const MAX_NIGHTS = 731;
const spanNights = (first: string, last: string) =>
  Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1;

function checkRange(first: string, last: string) {
  if (!isISODate(first) || !isISODate(last)) throw new UserError("Pick the first and last night.");
  if (last < first) throw new UserError("The last night is before the first night.");
  if (spanNights(first, last) > MAX_NIGHTS) throw new UserError("Keep a block to two years or less.");
}

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

    const hotelName = text(input.hotel, 200);
    const roomTypeName = text(input.roomType, 200);
    if (!hotelName) throw new UserError("Enter the hotel name.");
    if (!roomTypeName) throw new UserError("Enter the room type.");
    checkRange(input.firstNight, input.lastNight);
    const roomsHeld = Number(input.roomsHeld);
    const sellPrice = Number(input.sellPrice);
    const costPrice = input.costPrice === null ? null : Number(input.costPrice);
    if (!Number.isInteger(roomsHeld) || roomsHeld < 1 || roomsHeld > 5000) {
      throw new UserError("Rooms held must be a whole number, 1 or more.");
    }
    if (!Number.isFinite(sellPrice) || sellPrice < 0) throw new UserError("Enter the selling price.");
    if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0)) {
      throw new UserError("The cost price is not a valid amount.");
    }
    if (input.releaseDate && !isISODate(input.releaseDate)) {
      throw new UserError("Pick a valid release date.");
    }

    await db.transaction(async (tx) => {
      // Two people adding the same new hotel at once take turns here.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"hotel:" + hotelName.toLowerCase()}))`);
      let [hotel] = await tx
        .select({ id: schema.hotels.id, name: schema.hotels.name })
        .from(schema.hotels)
        .where(sql`lower(${schema.hotels.name}) = ${hotelName.toLowerCase()}`)
        .limit(1);
      if (!hotel) {
        [hotel] = await tx
          .insert(schema.hotels)
          .values({ name: hotelName, city: text(input.city, 100) })
          .returning({ id: schema.hotels.id, name: schema.hotels.name });
      }

      let [roomType] = await tx
        .select({ id: schema.roomTypes.id })
        .from(schema.roomTypes)
        .where(
          and(
            eq(schema.roomTypes.hotelId, hotel.id),
            sql`lower(${schema.roomTypes.name}) = ${roomTypeName.toLowerCase()}`,
          ),
        )
        .limit(1);
      if (!roomType) {
        [roomType] = await tx
          .insert(schema.roomTypes)
          .values({ hotelId: hotel.id, name: roomTypeName })
          .returning({ id: schema.roomTypes.id });
      }

      const [block] = await tx
        .insert(schema.stockBlocks)
        .values({
          roomTypeId: roomType.id,
          firstNight: input.firstNight,
          lastNight: input.lastNight,
          roomsHeld,
          sellPrice: sellPrice.toFixed(2),
          costPrice: costPrice === null ? null : costPrice.toFixed(2),
          releaseDate: input.releaseDate || null,
          createdBy: user.id,
        })
        .returning({ id: schema.stockBlocks.id });

      await logActivity(tx, {
        userId: user.id,
        action: "added",
        entity: "stock_block",
        entityId: block.id,
        // The hotel's name as stored, not as this person happened to type it.
        summary: `${roomsHeld} rooms of ${roomTypeName}, ${hotel.name}, ${fmtDate(input.firstNight)} to ${fmtDate(input.lastNight)}`,
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
