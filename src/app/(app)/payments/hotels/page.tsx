import { Suspense } from "react";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { round2, todayISO } from "@/lib/format";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { LinkTabs, PAYMENT_TABS } from "@/components/tabs";
import { roomCosts } from "@/server/payables";
import { HotelsClient, type HotelRow } from "./hotels-client";

export const metadata = { title: "Payments to hotels | Hotel Admin" };

async function HotelsContent() {
  await requireUser();
  const today = todayISO();
  const [costs, hotels, paid, companies] = await Promise.all([
    roomCosts(db, today),
    db.execute<{ id: string; name: string; city: string }>(sql`
      select id, name, city from hotels order by lower(name)
    `),
    db.execute<{ hotel_id: string; paid: number; last_paid: string | null }>(sql`
      select hotel_id, sum(amount)::float8 as paid, max(paid_on)::text as last_paid
      from hotel_payments where status = 'active'
      group by hotel_id
    `),
    db
      .select({ id: schema.companies.id, name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.active, true))
      .orderBy(asc(schema.companies.name)),
  ]);

  const rows: HotelRow[] = hotels.rows
    .map((h) => {
      const mine = costs.filter((c) => c.hotelId === h.id);
      const p = paid.rows.find((r) => r.hotel_id === h.id);
      const owed = round2(mine.reduce((sum, c) => sum + c.owed, 0));
      const owedToDate = round2(mine.reduce((sum, c) => sum + c.owedToDate, 0));
      const paidTotal = p?.paid ?? 0;
      return {
        id: h.id,
        name: h.name,
        city: h.city,
        owed,
        owedToDate,
        paid: paidTotal,
        balance: round2(owed - paidTotal),
        uncosted: mine.reduce((sum, c) => sum + c.uncosted, 0),
        lastPaid: p?.last_paid ?? null,
      };
    })
    // Hotels with nothing held and nothing paid have nothing to show.
    .filter((r) => r.owed > 0 || r.paid > 0 || r.uncosted > 0);

  return <HotelsClient rows={rows} hotels={hotels.rows} companies={companies} today={today} />;
}

export default function HotelPaymentsPage() {
  return (
    <>
      <PageHeader
        title="Payments"
        description="What you owe each hotel for the rooms you hold, and what you have paid them."
      />
      <LinkTabs label="Payments" current="/payments/hotels" tabs={PAYMENT_TABS} />
      <Suspense fallback={<ListSkeleton />}>
        <HotelsContent />
      </Suspense>
    </>
  );
}
