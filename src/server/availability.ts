import { sql } from "drizzle-orm";
import { db } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

export type Night = {
  roomTypeId: string;
  night: string;
  /** Rooms held that night across all blocks. */
  held: number;
  /** Rooms on finalised bills that night. */
  sold: number;
  stopped: boolean;
  price: number | null;
};

/*
  One row per room type per night. "Sold" is counted here from finalised bills
  that count as sales; it is never stored.
*/
export async function nights(
  ex: Executor,
  firstNight: string,
  lastNight: string,
  roomTypeId?: string,
): Promise<Night[]> {
  const only = roomTypeId ? sql`where rt.id = ${roomTypeId}` : sql``;
  const result = await ex.execute<{
    room_type_id: string;
    night: string;
    held: number;
    sold: number;
    stopped: boolean;
    price: number | null;
  }>(sql`
    select
      rt.id as room_type_id,
      d::date::text as night,
      coalesce(h.held, 0)::int as held,
      coalesce(s.sold, 0)::float8 as sold,
      exists (
        select 1 from stop_sales ss
        where ss.room_type_id = rt.id and d::date between ss.first_night and ss.last_night
      ) as stopped,
      h.price::float8 as price
    from room_types rt
    cross join generate_series(${firstNight}::date, ${lastNight}::date, interval '1 day') d
    left join lateral (
      select sum(b.rooms_held) as held, max(b.sell_price) as price
      from stock_blocks b
      where b.room_type_id = rt.id and d::date between b.first_night and b.last_night
    ) h on true
    left join lateral (
      select sum(l.quantity) as sold
      from bill_lines l
      join bills bl on bl.id = l.bill_id
      where l.room_type_id = rt.id
        and l.kind = 'room'
        and bl.status = 'final'
        and bl.is_sale
        and d::date >= l.check_in
        and d::date < l.check_in + l.nights
    ) s on true
    ${only}
    order by rt.id, d
  `);
  return result.rows.map((r) => ({
    roomTypeId: r.room_type_id,
    night: r.night,
    held: r.held,
    sold: r.sold,
    stopped: r.stopped,
    price: r.price,
  }));
}

export type StayAvailability = {
  /** Fewest rooms left across the stay. Null when no rooms are held on some night. */
  left: number | null;
  held: number;
  stopped: boolean;
  /** Selling price on the first night. */
  price: number | null;
};

export function summariseStay(rows: Night[]): StayAvailability {
  if (!rows.length || rows.some((r) => r.held === 0)) {
    return { left: null, held: 0, stopped: false, price: rows[0]?.price ?? null };
  }
  return {
    left: Math.min(...rows.map((r) => r.held - r.sold)),
    held: Math.min(...rows.map((r) => r.held)),
    stopped: rows.some((r) => r.stopped),
    price: rows[0].price,
  };
}
