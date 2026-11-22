import { sql } from "drizzle-orm";
import type { Executor } from "./availability";

export type RoomCost = {
  hotelId: string;
  roomTypeId: string;
  room: string;
  firstNight: string;
  lastNight: string;
  /** What the hotel is owed for this room type, all nights. */
  owed: number;
  /** The part of it for nights before today. */
  owedToDate: number;
  /** Room-nights that should be paid for but have no cost entered. */
  uncosted: number;
};

/*
  What each hotel is owed, per room type, worked out from the blocks:

  - A block paid for "every room held" costs its rooms x nights x cost,
    whether the rooms sell or not.
  - A block paid for "only the rooms sold" costs only the rooms sold from it.
    When both kinds cover the same night, sales are counted against the
    guaranteed rooms first, since those are paid for anyway.

  "Sold" is counted from finalised bills, as everywhere else.
*/
export async function roomCosts(ex: Executor, today: string, hotelId?: string): Promise<RoomCost[]> {
  const onlyHotel = hotelId ? sql`and rt.hotel_id = ${hotelId}` : sql``;
  const result = await ex.execute<{
    hotel_id: string;
    room_type_id: string;
    room: string;
    first_night: string;
    last_night: string;
    owed: number;
    owed_to_date: number;
    uncosted: number;
  }>(sql`
    with block_nights as (
      select rt.hotel_id, sb.room_type_id, d::date as night, sb.rooms_held, sb.cost_price, sb.pay_for
      from stock_blocks sb
      join room_types rt on rt.id = sb.room_type_id
      cross join generate_series(sb.first_night, sb.last_night, interval '1 day') d
      where true ${onlyHotel}
    ),
    per_night as (
      select hotel_id, room_type_id, night,
        coalesce(sum(rooms_held) filter (where pay_for = 'held'), 0) as g_held,
        coalesce(sum(rooms_held * cost_price) filter (where pay_for = 'held' and cost_price is not null), 0) as g_cost,
        coalesce(sum(rooms_held) filter (where pay_for = 'held' and cost_price is null), 0) as g_uncosted,
        coalesce(sum(rooms_held) filter (where pay_for = 'sold'), 0) as a_held,
        coalesce(sum(rooms_held * cost_price) filter (where pay_for = 'sold' and cost_price is not null), 0) as a_cost,
        coalesce(sum(rooms_held) filter (where pay_for = 'sold' and cost_price is not null), 0) as a_costed
      from block_nights
      group by hotel_id, room_type_id, night
    ),
    with_sold as (
      select pn.*,
        coalesce((
          select sum(l.quantity)
          from bill_lines l
          join bills bl on bl.id = l.bill_id
          where l.room_type_id = pn.room_type_id and l.kind = 'room'
            and bl.status = 'final' and bl.is_sale
            and pn.night >= l.check_in and pn.night < l.check_in + l.nights
        ), 0) as sold
      from per_night pn
    ),
    costed as (
      select ws.*,
        -- Rooms sold beyond the guaranteed ones, taken from the allotment.
        least(greatest(ws.sold - ws.g_held, 0), ws.a_held) as a_sold
      from with_sold ws
    ),
    owed as (
      select c.hotel_id, c.room_type_id, c.night,
        c.g_cost + case when c.a_costed > 0 then c.a_sold * c.a_cost / c.a_costed else 0 end as owed,
        c.g_uncosted + case when c.a_costed = 0 then c.a_sold
                            else greatest(c.a_sold - c.a_costed, 0) end as uncosted
      from costed c
    )
    select o.hotel_id, o.room_type_id, rt.name as room,
      min(o.night)::text as first_night, max(o.night)::text as last_night,
      round(sum(o.owed), 2)::float8 as owed,
      round(coalesce(sum(o.owed) filter (where o.night < ${today}::date), 0), 2)::float8 as owed_to_date,
      sum(o.uncosted)::int as uncosted
    from owed o
    join room_types rt on rt.id = o.room_type_id
    group by o.hotel_id, o.room_type_id, rt.name
    order by lower(rt.name)
  `);
  return result.rows.map((r) => ({
    hotelId: r.hotel_id,
    roomTypeId: r.room_type_id,
    room: r.room,
    firstNight: r.first_night,
    lastNight: r.last_night,
    owed: r.owed,
    owedToDate: r.owed_to_date,
    uncosted: r.uncosted,
  }));
}
