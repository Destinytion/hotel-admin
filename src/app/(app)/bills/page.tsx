import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { BillsClient, type BillRow } from "./bills-client";

export const metadata = { title: "Bills | Hotel Admin" };

async function BillsContent() {
  await requireUser();
  const result = await db.execute<{
    id: string;
    number: string | null;
    status: BillRow["status"];
    is_sale: boolean;
    revised: boolean;
    bill_date: string;
    total: number;
    paid: number;
    title: string;
    client: string;
    company: string;
    initials: string;
    color: string;
    made_by: string;
  }>(sql`
    select
      b.id, b.number, b.status, b.is_sale, (b.data ? 'revisedBy') as revised, b.bill_date::text as bill_date,
      b.total::float8 as total,
      coalesce((select sum(r.amount) from bill_receipts r where r.bill_id = b.id), 0)::float8 as paid,
      f.title, c.name as client, co.name as company, co.initials, co.color,
      coalesce(u.name, '') as made_by
    from bills b
    left join users u on u.id = b.created_by
    join formats f on f.id = b.format_id
    join clients c on c.id = b.client_id
    join companies co on co.id = b.company_id
    order by b.bill_date desc, b.created_at desc
    limit 500
  `);

  const rows: BillRow[] = result.rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    isSale: r.is_sale,
    revised: r.revised,
    billDate: r.bill_date,
    total: r.total,
    paid: r.paid,
    title: r.title,
    client: r.client,
    company: r.company,
    initials: r.initials,
    color: r.color,
    madeBy: r.made_by,
  }));

  return <BillsClient rows={rows} />;
}

export default function BillsPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Bills" />
          <ListSkeleton />
        </>
      }
    >
      <BillsContent />
    </Suspense>
  );
}
