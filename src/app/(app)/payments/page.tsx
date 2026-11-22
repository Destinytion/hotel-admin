import { Suspense } from "react";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { reportParams, type SearchParams } from "@/lib/report-params";
import { isUuid } from "@/lib/result";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { ReportFilters } from "@/components/report-filters";
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
      company: string;
      initials: string;
      color: string;
      recorded_by: string;
    }>(sql`
      select p.id, p.paid_on::text as paid_on, p.amount::float8 as amount, p.mode, p.reference, p.notes,
        p.kind, p.status, p.receipt_number,
        p.bill_id, b.number as bill_number, b.status::text as bill_status,
        c.name as client, co.name as company, co.initials, co.color,
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
    company: r.company,
    initials: r.initials,
    color: r.color,
    recordedBy: r.recorded_by,
  }));

  // The Clients screen links here with ?advance=<client> to record an advance from that client.
  const advanceFor =
    typeof params.advance === "string" && isUuid(params.advance) && clients.some((c) => c.id === params.advance)
      ? params.advance
      : "";

  return (
    <>
      <ReportFilters path="/payments" range={range} companies={companies} companyId={companyId} />
      <PaymentsClient
        key={`${range.from}-${range.to}-${companyId}`}
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
      <Suspense fallback={<ListSkeleton />}>
        <PaymentsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
