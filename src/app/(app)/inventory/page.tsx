import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { addDays, isISODate, todayISO } from "@/lib/format";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { nights } from "@/server/availability";
import { InventoryClient, type RoomRow } from "./inventory-client";

export const metadata = { title: "Inventory | Hotel Admin" };

const WINDOW_DAYS = 14;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function InventoryContent({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const params = await searchParams;
  const today = todayISO();
  const from = isISODate(params.from) ? params.from : today;
  const dates = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(from, i));

  const [rooms, cells] = await Promise.all([
    db.execute<{
      id: string;
      name: string;
      hotel: string;
      city: string;
      release_date: string | null;
    }>(sql`
      select
        rt.id, rt.name, h.name as hotel, h.city,
        (
          select min(b.release_date)::text from stock_blocks b
          where b.room_type_id = rt.id and b.release_date >= ${today}::date
        ) as release_date
      from room_types rt
      join hotels h on h.id = rt.hotel_id
      order by lower(h.name), lower(rt.name)
    `),
    nights(db, dates[0], dates[dates.length - 1]),
  ]);

  const byRoom = new Map<string, RoomRow["cells"]>();
  for (const cell of cells) {
    const list = byRoom.get(cell.roomTypeId) ?? [];
    list.push({ held: cell.held, sold: cell.sold, stopped: cell.stopped, price: cell.price });
    byRoom.set(cell.roomTypeId, list);
  }

  const rows: RoomRow[] = rooms.rows.map((r) => ({
    id: r.id,
    name: r.name,
    hotel: r.hotel,
    city: r.city,
    releaseDate: r.release_date,
    cells: byRoom.get(r.id) ?? [],
  }));

  // Search links here with ?room=<room type> or ?add=1. A new key starts the
  // screen afresh when such a link is followed from this same screen.
  const room = typeof params.room === "string" && rows.some((r) => r.id === params.room) ? params.room : null;
  const add = params.add === "1";
  return (
    <InventoryClient
      key={`${room ?? ""}-${add}`}
      rows={rows}
      dates={dates}
      today={today}
      initialRoomId={room}
      initialAdd={add}
    />
  );
}

export default function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Inventory" />
          <ListSkeleton />
        </>
      }
    >
      <InventoryContent searchParams={searchParams} />
    </Suspense>
  );
}
