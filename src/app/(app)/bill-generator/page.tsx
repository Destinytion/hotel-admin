import { Suspense } from "react";
import Link from "@/components/link";
import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { addDays, todayISO } from "@/lib/format";
import { isUuid } from "@/lib/result";
import { EmptyState, ListSkeleton, PageHeader } from "@/components/ui";
import { userName } from "@/server/activity";
import { nights, summariseStay, type StayAvailability } from "@/server/availability";
import { GeneratorClient, type Draft, type Options } from "./generator-client";

export const metadata = { title: "Bill Generator | Hotel Admin" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DESCRIPTION = "Pick the company and format. The preview is what gets printed.";

async function GeneratorContent({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const params = await searchParams;

  const [companies, formats, clients, rooms] = await Promise.all([
    db.select().from(schema.companies).where(eq(schema.companies.active, true)).orderBy(asc(schema.companies.name)),
    db
      .select()
      .from(schema.formats)
      .where(eq(schema.formats.active, true))
      .orderBy(asc(schema.formats.createdAt), asc(schema.formats.name)),
    db.execute<{
      id: string;
      name: string;
      address: string;
      registration: string;
      contact: string;
      phone: string;
    }>(sql`
      select c.id, c.name, c.address, c.registration,
        coalesce(pc.name, '') as contact, coalesce(pc.phone, '') as phone
      from clients c
      left join lateral (
        select cc.name, cc.phone from client_contacts cc
        where cc.client_id = c.id order by cc.is_primary desc, cc.created_at limit 1
      ) pc on true
      order by lower(c.name)
    `),
    db
      .select({
        id: schema.roomTypes.id,
        name: schema.roomTypes.name,
        hotel: schema.hotels.name,
        city: schema.hotels.city,
      })
      .from(schema.roomTypes)
      .innerJoin(schema.hotels, eq(schema.hotels.id, schema.roomTypes.hotelId))
      .orderBy(asc(schema.hotels.name), asc(schema.roomTypes.name)),
  ]);

  if (companies.length === 0) {
    return (
      <>
        <PageHeader title="Bill Generator" description={DESCRIPTION} />
        <EmptyState
          title="Add a company first"
          action={
            <Link
              href="/settings"
              className="inline-flex h-11 items-center rounded-md bg-ink px-3 text-body font-medium text-on-ink transition-colors duration-150 hover:bg-ink-hover md:h-9"
            >
              Open Settings
            </Link>
          }
        >
          A bill is issued from one of your companies. Add at least one in Settings, then come back.
        </EmptyState>
      </>
    );
  }

  const options: Options = {
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      initials: c.initials,
      color: c.color,
      address: c.address,
      registration: c.registration,
      bankDetails: c.bankDetails,
      terms: c.terms,
      formats: formats
        .filter((f) => f.companyId === c.id)
        .map((f) => ({
          id: f.id,
          name: f.name,
          title: f.title,
          hasTaxLine: f.hasTaxLine,
          countsAsSale: f.countsAsSale,
        })),
    })),
    clients: clients.rows,
    rooms: rooms.map((r) => ({ id: r.id, label: [r.name, r.hotel, r.city].filter(Boolean).join(", ") })),
  };

  // Continue a saved draft when the address carries ?bill=...
  let draft: Draft | null = null;
  const billId = typeof params.bill === "string" && isUuid(params.bill) ? params.bill : null;
  if (billId) {
    const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, billId));
    if (bill && bill.status !== "draft") redirect(`/bills/${bill.id}`);
    if (!bill) {
      // Someone deleted this draft, possibly while it was open here.
      const [gone] = await db
        .select({ userId: schema.auditLog.userId })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.entity, "bill"),
            eq(schema.auditLog.entityId, billId),
            eq(schema.auditLog.action, "deleted"),
          ),
        )
        .limit(1);
      return (
        <>
          <PageHeader title="Bill Generator" description={DESCRIPTION} />
          <EmptyState
            title="This draft no longer exists"
            action={
              <Link
                href="/bill-generator"
                className="inline-flex h-11 items-center rounded-md bg-ink px-3 text-body font-medium text-on-ink transition-colors duration-150 hover:bg-ink-hover md:h-9"
              >
                Start a new bill
              </Link>
            }
          >
            {gone ? `${await userName(db, gone.userId)} deleted it.` : "It was deleted."}
          </EmptyState>
        </>
      );
    }
    if (bill) {
      const lines = await db
        .select()
        .from(schema.billLines)
        .where(eq(schema.billLines.billId, bill.id))
        .orderBy(asc(schema.billLines.position));
      const data = bill.data as { taxPercent?: number; notes?: string };
      const availability: Record<number, StayAvailability> = {};
      await Promise.all(
        lines.map(async (l, i) => {
          if (l.kind === "room" && l.roomTypeId && l.checkIn && l.nights) {
            availability[i + 1] = summariseStay(
              await nights(db, l.checkIn, addDays(l.checkIn, l.nights - 1), l.roomTypeId),
            );
          }
        }),
      );
      draft = {
        id: bill.id,
        version: bill.version,
        changedBy: await userName(db, bill.updatedBy),
        companyId: bill.companyId,
        formatId: bill.formatId,
        clientId: bill.clientId,
        billDate: bill.billDate,
        taxPercent: Number(data.taxPercent ?? 0),
        notes: data.notes ?? "",
        lines: lines.map((l, i) => ({
          id: i + 1,
          kind: l.kind,
          roomTypeId: l.roomTypeId ?? "",
          description: l.kind === "other" ? l.description : "",
          checkIn: l.checkIn ?? "",
          nights: l.nights ?? 1,
          quantity: Number(l.quantity),
          rate: Number(l.rate),
        })),
        availability,
      };
    }
  }

  const clientId =
    typeof params.client === "string" && options.clients.some((c) => c.id === params.client)
      ? params.client
      : "";

  return (
    <GeneratorClient
      key={draft?.id ?? `new-${clientId}`}
      options={options}
      draft={draft}
      today={todayISO()}
      initialClientId={clientId}
      description={DESCRIPTION}
    />
  );
}

export default function BillGeneratorPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Bill Generator" description={DESCRIPTION} />
          <ListSkeleton />
        </>
      }
    >
      <GeneratorContent searchParams={searchParams} />
    </Suspense>
  );
}
