import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { reportParams, type SearchParams } from "@/lib/report-params";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { ReportFilters } from "@/components/report-filters";
import { ReportsClient, type ReportData } from "./reports-client";

export const metadata = { title: "Reports | Hotel Admin" };

/*
  What counts as a sale everywhere in these reports: a finalised bill whose
  format counts as a sale. Drafts, quotations and cancelled bills are left out.
*/
async function ReportsContent({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const { today, range, companies, companyId } = await reportParams(searchParams);
  const { from, to } = range;
  const billCompany = companyId ? sql`and b.company_id = ${companyId}` : sql``;
  const payCompany = companyId ? sql`and p.company_id = ${companyId}` : sql``;
  // For inventory: held rooms are shared, so only "sold by this company" is filtered.
  const soldBySelected = companyId ? sql`bl.company_id = ${companyId}` : sql`true`;

  const [byMonth, byClient, byCompany, cancelled, outstanding, inventory] = await Promise.all([
    db.execute<{ month: string; bills: number; subtotal: number; tax: number; total: number }>(sql`
      select to_char(b.bill_date, 'YYYY-MM') as month, count(*)::int as bills,
        sum(b.subtotal)::float8 as subtotal, sum(b.tax_total)::float8 as tax, sum(b.total)::float8 as total
      from bills b
      where b.status = 'final' and b.is_sale and b.bill_date between ${from}::date and ${to}::date ${billCompany}
      group by 1 order by 1
    `),
    db.execute<{ id: string; name: string; bills: number; total: number; received: number }>(sql`
      select c.id, c.name, count(*)::int as bills, sum(b.total)::float8 as total,
        coalesce(sum((select sum(p.amount) from payments p where p.bill_id = b.id)), 0)::float8 as received
      from bills b
      join clients c on c.id = b.client_id
      where b.status = 'final' and b.is_sale and b.bill_date between ${from}::date and ${to}::date ${billCompany}
      group by c.id, c.name
      order by sum(b.total) desc, lower(c.name)
    `),
    db.execute<{ id: string; name: string; bills: number; subtotal: number; tax: number; total: number }>(sql`
      select co.id, co.name, count(*)::int as bills, sum(b.subtotal)::float8 as subtotal,
        sum(b.tax_total)::float8 as tax, sum(b.total)::float8 as total
      from bills b
      join companies co on co.id = b.company_id
      where b.status = 'final' and b.is_sale and b.bill_date between ${from}::date and ${to}::date ${billCompany}
      group by co.id, co.name
      order by lower(co.name)
    `),
    db.execute<{ bills: number; total: number }>(sql`
      select count(*)::int as bills, coalesce(sum(b.total), 0)::float8 as total
      from bills b
      where b.status = 'cancelled' and b.is_sale and b.bill_date between ${from}::date and ${to}::date ${billCompany}
    `),
    // As of today, whatever the dates picked. Each bill's unpaid part is placed
    // by its age; money not tied to a live bill (an advance, or a payment on a
    // bill later cancelled) is credit. Owed = the age columns minus credit,
    // which is the same figure as on the Clients screen.
    db.execute<{
      id: string;
      name: string;
      d0: number;
      d31: number;
      d61: number;
      d90: number;
      credit: number;
      oldest: string | null;
    }>(sql`
      with due as (
        select b.client_id, b.bill_date,
          (b.total - coalesce((select sum(p.amount) from payments p where p.bill_id = b.id), 0)) as due,
          (${today}::date - b.bill_date) as age
        from bills b
        where b.status = 'final' and b.is_sale ${billCompany}
      ),
      credit as (
        select p.client_id, sum(p.amount) as amount
        from payments p
        left join bills b on b.id = p.bill_id
        where (b.id is null or b.status <> 'final' or not b.is_sale) ${payCompany}
        group by p.client_id
      ),
      per_client as (
        select d.client_id,
          sum(d.due) filter (where d.due > 0.004 and d.age <= 30) as d0,
          sum(d.due) filter (where d.due > 0.004 and d.age between 31 and 60) as d31,
          sum(d.due) filter (where d.due > 0.004 and d.age between 61 and 90) as d61,
          sum(d.due) filter (where d.due > 0.004 and d.age > 90) as d90,
          min(d.bill_date) filter (where d.due > 0.004) as oldest
        from due d
        group by d.client_id
      )
      select c.id, c.name,
        coalesce(pc.d0, 0)::float8 as d0, coalesce(pc.d31, 0)::float8 as d31,
        coalesce(pc.d61, 0)::float8 as d61, coalesce(pc.d90, 0)::float8 as d90,
        coalesce(cr.amount, 0)::float8 as credit, pc.oldest::text as oldest
      from clients c
      left join per_client pc on pc.client_id = c.id
      left join credit cr on cr.client_id = c.id
      where coalesce(pc.d0, 0) + coalesce(pc.d31, 0) + coalesce(pc.d61, 0) + coalesce(pc.d90, 0) > 0.004
         or coalesce(cr.amount, 0) > 0.004
      order by coalesce(pc.d0, 0) + coalesce(pc.d31, 0) + coalesce(pc.d61, 0) + coalesce(pc.d90, 0)
               - coalesce(cr.amount, 0) desc, lower(c.name)
    `),
    // One row per room type, adding up every night in the dates picked.
    db.execute<{
      id: string;
      hotel: string;
      city: string;
      room: string;
      held: number;
      sold_all: number;
      sold: number;
      revenue: number;
      cost_of_sold: number | null;
      uncosted_nights: number;
    }>(sql`
      with nights as (
        select rt.id as rt_id, d::date as night
        from room_types rt
        cross join generate_series(${from}::date, ${to}::date, interval '1 day') d
      ),
      held as (
        select n.rt_id, n.night, sum(sb.rooms_held) as held,
          sum(sb.rooms_held) filter (where sb.cost_price is not null) as costed_rooms,
          sum(sb.rooms_held * sb.cost_price) filter (where sb.cost_price is not null) as cost_total
        from nights n
        join stock_blocks sb on sb.room_type_id = n.rt_id and n.night between sb.first_night and sb.last_night
        group by n.rt_id, n.night
      ),
      sold as (
        select n.rt_id, n.night,
          sum(l.quantity) as sold_all,
          coalesce(sum(l.quantity) filter (where ${soldBySelected}), 0) as sold,
          coalesce(sum(l.quantity * l.rate) filter (where ${soldBySelected}), 0) as revenue
        from nights n
        join bill_lines l on l.room_type_id = n.rt_id and l.kind = 'room'
          and n.night >= l.check_in and n.night < l.check_in + l.nights
        join bills bl on bl.id = l.bill_id and bl.status = 'final' and bl.is_sale
        group by n.rt_id, n.night
      ),
      per_room as (
        select n.rt_id,
          coalesce(sum(h.held), 0) as held,
          coalesce(sum(s.sold_all), 0) as sold_all,
          coalesce(sum(s.sold), 0) as sold,
          coalesce(sum(s.revenue), 0) as revenue,
          -- Each sold night costs that night's average cost per room held.
          sum(coalesce(s.sold, 0) * h.cost_total / nullif(h.costed_rooms, 0)) as cost_of_sold,
          coalesce(sum(h.held - coalesce(h.costed_rooms, 0)) filter (where coalesce(s.sold, 0) > 0), 0) as uncosted_nights
        from nights n
        left join held h on h.rt_id = n.rt_id and h.night = n.night
        left join sold s on s.rt_id = n.rt_id and s.night = n.night
        group by n.rt_id
      )
      select rt.id, h.name as hotel, h.city, rt.name as room,
        pr.held::int as held, pr.sold_all::float8 as sold_all, pr.sold::float8 as sold,
        pr.revenue::float8 as revenue, pr.cost_of_sold::float8 as cost_of_sold,
        pr.uncosted_nights::int as uncosted_nights
      from per_room pr
      join room_types rt on rt.id = pr.rt_id
      join hotels h on h.id = rt.hotel_id
      where pr.held > 0 or pr.sold_all > 0
      order by lower(h.name), lower(rt.name)
    `),
  ]);

  const data: ReportData = {
    byMonth: byMonth.rows,
    byClient: byClient.rows,
    byCompany: byCompany.rows,
    cancelled: cancelled.rows[0] ?? { bills: 0, total: 0 },
    outstanding: outstanding.rows,
    inventory: inventory.rows.map((r) => ({
      id: r.id,
      hotel: r.hotel,
      city: r.city,
      room: r.room,
      held: r.held,
      soldAll: r.sold_all,
      sold: r.sold,
      revenue: r.revenue,
      // A margin is only shown when every sold night has a cost entered.
      costOfSold: r.uncosted_nights === 0 && r.sold > 0 ? r.cost_of_sold : null,
    })),
  };

  const companyName = companies.find((c) => c.id === companyId)?.name ?? "";
  // Used in file names, for example sales-by-month-2026-04-01-to-2027-03-31-kairav-stays.csv
  const companySlug = companyId
    ? `-${companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`
    : "";
  // Reads as part of a sentence: "in this financial year" or "from 01 Nov 2026 to 30 Nov 2026".
  const period = range.key === "custom" ? `from ${range.label}` : `in ${range.label.toLowerCase()}`;

  return (
    <>
      <ReportFilters path="/reports" range={range} companies={companies} companyId={companyId} />
      <ReportsClient
        data={data}
        period={period}
        today={today}
        companyName={companyName}
        rangeSlug={`${range.from}-to-${range.to}${companySlug}`}
        companySlug={companySlug}
      />
    </>
  );
}

export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader title="Reports" description="Sales, what clients owe, and how much of your inventory sold." />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <ReportsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
