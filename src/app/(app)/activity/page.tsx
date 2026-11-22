import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { ActivityClient, type ActivityRow } from "./activity-client";

export const metadata = { title: "Activity | Hotel Admin" };

async function ActivityContent() {
  await requireUser();
  const result = await db.execute<{
    id: string;
    who: string;
    action: string;
    summary: string;
    entity: string;
    entity_id: string | null;
    bill_id: string | null;
    day: string;
    time: string;
  }>(sql`
    select a.id, coalesce(u.name, 'Someone') as who, a.action, a.summary, a.entity, a.entity_id,
      a.detail->>'billId' as bill_id,
      to_char(a.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') as day,
      to_char(a.created_at at time zone 'Asia/Kolkata', 'HH12:MI am') as time
    from audit_log a
    left join users u on u.id = a.user_id
    order by a.created_at desc
    limit 400
  `);

  const rows: ActivityRow[] = result.rows.map((r) => {
    // Bills and payments link to the bill, unless the bill itself was deleted.
    const billId = r.entity === "payment" ? r.bill_id : r.entity === "bill" ? r.entity_id : null;
    return {
      id: r.id,
      who: r.who,
      action: r.action,
      summary: r.summary || `a ${r.entity.replace("_", " ")}`,
      href: billId && r.action !== "deleted" ? `/bills/${billId}` : null,
      day: r.day,
      time: r.time,
    };
  });

  return <ActivityClient rows={rows} />;
}

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" description="Who did what, newest first." />
      <Suspense fallback={<ListSkeleton rows={8} />}>
        <ActivityContent />
      </Suspense>
    </>
  );
}
