import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import { fmtDate, isISODate } from "@/lib/format";
import { UserError } from "@/lib/result";
import { logActivity } from "./activity";
import type { Executor } from "./availability";

/*
  Rules for blocks of rooms, shared by the Inventory screen and the
  spreadsheet import. Nothing here checks who is signed in: callers do that.
*/

export type PayFor = "held" | "sold";

export type BlockNumbers = {
  firstNight: string;
  lastNight: string;
  roomsHeld: number;
  sellPrice: number;
  /** Empty when not recorded. */
  costPrice: number | null;
  releaseDate: string;
  payFor: PayFor;
};

const MAX_NIGHTS = 731;
const spanNights = (first: string, last: string) =>
  Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1;

export function checkRange(first: string, last: string) {
  if (!isISODate(first) || !isISODate(last)) throw new UserError("Pick the first and last night.");
  if (last < first) throw new UserError("The last night is before the first night.");
  if (spanNights(first, last) > MAX_NIGHTS) throw new UserError("Keep a block to two years or less.");
}

/** Checks the numbers of a block, new or edited, and returns them ready to store. */
export function checkBlock(input: BlockNumbers) {
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
  return {
    firstNight: input.firstNight,
    lastNight: input.lastNight,
    roomsHeld,
    sellPrice: sellPrice.toFixed(2),
    costPrice: costPrice === null ? null : costPrice.toFixed(2),
    releaseDate: input.releaseDate || null,
    payFor: (input.payFor === "sold" ? "sold" : "held") as PayFor,
  };
}

export type CheckedBlock = ReturnType<typeof checkBlock>;

/** Finds a hotel by name whatever the capitals, or adds it. */
export async function findOrAddHotel(tx: Executor, name: string, city: string) {
  // Two people adding the same new hotel at once take turns here.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"hotel:" + name.toLowerCase()}))`);
  const [found] = await tx
    .select({ id: schema.hotels.id, name: schema.hotels.name })
    .from(schema.hotels)
    .where(sql`lower(${schema.hotels.name}) = ${name.toLowerCase()}`)
    .limit(1);
  if (found) return { ...found, added: false };
  const [added] = await tx
    .insert(schema.hotels)
    .values({ name, city })
    .returning({ id: schema.hotels.id, name: schema.hotels.name });
  return { ...added, added: true };
}

/** Finds a room type at a hotel by name whatever the capitals, or adds it. */
export async function findOrAddRoomType(tx: Executor, hotelId: string, name: string) {
  const [found] = await tx
    .select({ id: schema.roomTypes.id, name: schema.roomTypes.name })
    .from(schema.roomTypes)
    .where(and(eq(schema.roomTypes.hotelId, hotelId), sql`lower(${schema.roomTypes.name}) = ${name.toLowerCase()}`))
    .limit(1);
  if (found) return found;
  const [added] = await tx
    .insert(schema.roomTypes)
    .values({ hotelId, name })
    .returning({ id: schema.roomTypes.id, name: schema.roomTypes.name });
  return added;
}

/**
 * Adds a block of rooms, adding the hotel and room type the first time they
 * are named. Call inside a transaction.
 */
export async function addBlock(
  tx: Executor,
  userId: string,
  input: { hotel: string; city: string; roomType: string; block: CheckedBlock },
  /** An import records one line for the whole file instead of one per block. */
  options: { log?: boolean } = {},
) {
  const hotel = await findOrAddHotel(tx, input.hotel, input.city);
  const roomType = await findOrAddRoomType(tx, hotel.id, input.roomType);
  const [block] = await tx
    .insert(schema.stockBlocks)
    .values({ roomTypeId: roomType.id, ...input.block, createdBy: userId })
    .returning({ id: schema.stockBlocks.id });
  if (options.log === false) return { id: block.id, hotelAdded: hotel.added };
  await logActivity(tx, {
    userId,
    action: "added",
    entity: "stock_block",
    entityId: block.id,
    // The names as stored, not as this person happened to type them.
    summary: `${input.block.roomsHeld} rooms of ${roomType.name}, ${hotel.name}, ${fmtDate(input.block.firstNight)} to ${fmtDate(input.block.lastNight)}`,
  });
  return { id: block.id, hotelAdded: hotel.added };
}
