import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { reportParams, type SearchParams } from "@/lib/report-params";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { ReportFilters } from "@/components/report-filters";
import { PaymentsClient, type PaymentRow } from "./payments-client";

export const metadata = { title: "Payments | Hotel Admin" };

async function PaymentsContent({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const { range, companies, companyId } = await reportParams(searchParams);
  const onlyCompany = companyId ? sql`and p.company_id = ${companyId}` : sql``;

  const result = await db.execute<{
    id: string;
    paid_on: string;
    amount: number;
    mode: string;
    reference: string;
    bill_id: string | null;
    bill_number: string | null;
    bill_status: string | null;
    client: string;
    company: string;
    initials: string;
    color: string;
    recorded_by: string;
  }>(sql`
    select p.id, p.paid_on::text as paid_on, p.amount::float8 as amount, p.mode, p.reference,
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
  `);

  const rows: PaymentRow[] = result.rows.map((r) => ({
    id: r.id,
    paidOn: r.paid_on,
    amount: r.amount,
    mode: r.mode,
    reference: r.reference,
    billId: r.bill_id,
    billNumber: r.bill_number,
    billCancelled: r.bill_status === "cancelled",
    client: r.client,
    company: r.company,
    initials: r.initials,
    color: r.color,
    recordedBy: r.recorded_by,
  }));

  return (
    <>
      <ReportFilters path="/payments" range={range} companies={companies} companyId={companyId} />
      <PaymentsClient
        key={`${range.from}-${range.to}-${companyId}`}
        rows={rows}
        rangeLabel={range.label}
        filename={`payments-${range.from}-to-${range.to}.csv`}
      />
    </>
  );
}

export default function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader title="Payments" description="Money received from clients, across both companies." />
      <Suspense fallback={<ListSkeleton />}>
        <PaymentsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
