import { Suspense } from "react";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { reportParams, type SearchParams } from "@/lib/report-params";
import { isUuid } from "@/lib/result";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { ReportFilters } from "@/components/report-filters";
import { LinkTabs, PAYMENT_TABS } from "@/components/tabs";
import { PaymentsClient, type PaymentRow } from "./payments-client";

export const metadata = { title: "Payments | Hotel Admin" };

async function PaymentsContent({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const params = await searchParams;
  const { today, range, companies, companyId } = await reportParams(searchParams);
  const onlyCompany = companyId ? sql`and p.company_id = ${companyId}` : sql``;

  const [result, activeCompanies, clients] = await Promise.all([
    db.execute<{
      id: string;
      paid_on: string;
      amount: number;
      mode: string;
      reference: string;
      notes: string;
      kind: "payment" | "advance";
      status: "active" | "cancelled";
      receipt_number: string | null;
      bill_id: string | null;
      bill_number: string | null;
      bill_status: string | null;
      client: string;
      phone: string;
      company: string;
      initials: string;
      color: string;
      recorded_by: string;
      used: number;
      used_on: { id: string; number: string }[];
    }>(sql`
      select p.id, p.paid_on::text as paid_on, p.amount::float8 as amount, p.mode, p.reference, p.notes,
        p.kind, p.status, p.receipt_number,
        p.bill_id, b.number as bill_number, b.status::text as bill_status,
        coalesce((select sum(u.amount) from advance_uses u where u.advance_id = p.id), 0)::float8 as used,
        coalesce((
          select jsonb_agg(jsonb_build_object('id', ub.id, 'number', ub.number) order by u.created_at)
          from advance_uses u join bills ub on ub.id = u.bill_id where u.advance_id = p.id
        ), '[]'::jsonb) as used_on,
        c.name as client, co.name as company, co.initials, co.color,
        coalesce((
          select cc.phone from client_contacts cc where cc.client_id = c.id
          order by cc.is_primary desc, cc.created_at limit 1
        ), '') as phone,
        coalesce(u.name, '') as recorded_by
      from payments p
      join clients c on c.id = p.client_id
      join companies co on co.id = p.company_id
      left join bills b on b.id = p.bill_id
      left join users u on u.id = p.created_by
      where p.paid_on between ${range.from}::date and ${range.to}::date ${onlyCompany}
      order by p.paid_on desc, p.created_at desc
      limit 5000
    `),
    db
      .select({ id: schema.companies.id, name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.active, true))
      .orderBy(asc(schema.companies.name)),
    db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .orderBy(asc(sql`lower(${schema.clients.name})`)),
  ]);

  const rows: PaymentRow[] = result.rows.map((r) => ({
    id: r.id,
    paidOn: r.paid_on,
    amount: r.amount,
    mode: r.mode,
    reference: r.reference,
    notes: r.notes,
    advance: r.kind === "advance",
    cancelled: r.status === "cancelled",
    receiptNumber: r.receipt_number,
    billId: r.bill_id,
    billNumber: r.bill_number,
    billCancelled: r.bill_status === "cancelled",
    client: r.client,
    phone: r.phone,
    company: r.company,
    initials: r.initials,
    color: r.color,
    recordedBy: r.recorded_by,
    used: r.used,
    usedOn: r.used_on,
  }));

  // The Clients screen links here with ?advance=<client> to record an advance from that client.
  const advanceFor =
    typeof params.advance === "string" && isUuid(params.advance) && clients.some((c) => c.id === params.advance)
      ? params.advance
      : "";

  // Search links here with ?advance=new to record an advance without a client picked.
  const openAdvance = Boolean(advanceFor) || params.advance === "new";

  return (
    <>
      <ReportFilters path="/payments" range={range} companies={companies} companyId={companyId} />
      <PaymentsClient
        key={`${range.from}-${range.to}-${companyId}-${openAdvance}`}
        openAdvance={openAdvance}
        rows={rows}
        rangeLabel={range.label}
        filename={`payments-${range.from}-to-${range.to}.csv`}
        companies={activeCompanies}
        clients={clients}
        today={today}
        advanceFor={advanceFor}
      />
    </>
  );
}

export default function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received from clients, across both companies. Every payment has a PDF receipt."
      />
      <LinkTabs label="Payments" current="/payments" tabs={PAYMENT_TABS} />
      <Suspense fallback={<ListSkeleton />}>
        <PaymentsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
