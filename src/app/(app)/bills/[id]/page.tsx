import { Suspense } from "react";
import Link from "@/components/link";
import { notFound, redirect } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { billState } from "@/lib/bill-state";
import { fmtDateLong, inr, round2, todayISO } from "@/lib/format";
import { isUuid } from "@/lib/result";
import { ListSkeleton, PageHeader, StatusBadge } from "@/components/ui";
import { BillPaper, type PaperData } from "@/components/bill-paper";
import { BillActions } from "./bill-actions";

export const metadata = { title: "Bill | Hotel Admin" };

type Params = Promise<{ id: string }>;

type Snapshot = {
  company: PaperData["company"];
  client: NonNullable<PaperData["client"]>;
  format: { title: string; hasTaxLine: boolean };
};

async function BillContent({ params }: { params: Params }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, id));
  if (!bill) notFound();
  if (bill.status === "draft") redirect(`/bill-generator?bill=${bill.id}`);

  // Everything anyone did to this bill, oldest first.
  const history = await db.execute<{ id: string; who: string; action: string; summary: string; at: string }>(sql`
    select a.id, coalesce(u.name, 'Someone') as who, a.action, a.summary,
      to_char(a.created_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI am') as at
    from audit_log a
    left join users u on u.id = a.user_id
    where (a.entity = 'bill' and a.entity_id = ${id})
       or (a.entity = 'payment' and a.detail->>'billId' = ${id})
    order by a.created_at
  `);

  const [lines, payments] = await Promise.all([
    db
      .select()
      .from(schema.billLines)
      .where(eq(schema.billLines.billId, bill.id))
      .orderBy(asc(schema.billLines.position)),
    db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.billId, bill.id))
      .orderBy(desc(schema.payments.paidOn), desc(schema.payments.createdAt)),
  ]);

  // A finalised bill shows the details frozen when it was finalised.
  const snapshot = bill.snapshot as Snapshot;
  const data = bill.data as { taxPercent?: number; notes?: string };
  const total = Number(bill.total);
  const paid = round2(payments.reduce((sum, p) => sum + Number(p.amount), 0));
  const outstanding = round2(total - paid);
  const state = billState({ status: bill.status, isSale: bill.isSale, total, paid });

  const paper: PaperData = {
    company: snapshot.company,
    client: snapshot.client,
    title: snapshot.format.title,
    number: bill.number,
    billDate: bill.billDate,
    lines: lines.map((l) => ({
      key: l.id,
      kind: l.kind,
      description: l.description,
      checkIn: l.checkIn ?? "",
      nights: l.nights ?? 0,
      quantity: Number(l.quantity),
      rate: Number(l.rate),
      amount: Number(l.amount),
    })),
    subtotal: Number(bill.subtotal),
    hasTaxLine: snapshot.format.hasTaxLine,
    taxPercent: Number(data.taxPercent ?? 0),
    tax: Number(bill.taxTotal),
    total,
    notes: data.notes ?? "",
    cancelled: bill.status === "cancelled",
  };

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={bill.number ?? "Bill"}
          description={`${snapshot.format.title} for ${snapshot.client.name}, ${fmtDateLong(bill.billDate)}`}
          actions={
            <BillActions
              billId={bill.id}
              canPay={bill.status === "final" && bill.isSale && outstanding > 0}
              canCancel={bill.status === "final"}
              isSale={bill.isSale}
              outstanding={outstanding}
              today={todayISO()}
            />
          }
        />
      </div>

      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="border-line p-4 md:p-6 lg:border-r print:hidden">
          <p className="mb-3">
            <Link href="/bills" className="text-ui text-accent hover:underline">
              All bills
            </Link>
          </p>
          <dl className="grid grid-cols-2 gap-y-2 text-body tabular-nums">
            <dt className="text-fg-2">Status</dt>
            <dd className="text-right">
              <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
            </dd>
            <dt className="text-fg-2">Total</dt>
            <dd className="text-right font-medium text-fg">{inr(total)}</dd>
            {bill.isSale ? (
              <>
                <dt className="text-fg-2">Received</dt>
                <dd className="text-right text-fg">{inr(paid)}</dd>
                <dt className="border-t border-line pt-2 font-medium text-fg">Outstanding</dt>
                <dd className="border-t border-line pt-2 text-right font-semibold text-fg">
                  {bill.status === "cancelled" ? "Cancelled" : inr(outstanding)}
                </dd>
              </>
            ) : null}
          </dl>

          {bill.isSale ? (
            <>
              <h2 className="mt-6 text-ui font-medium text-fg-3">Payments</h2>
              {payments.length === 0 ? (
                <p className="mt-1 text-body text-fg-2">None recorded yet.</p>
              ) : (
                <ul className="mt-1 divide-y divide-line">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-baseline gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-body text-fg tabular-nums">{fmtDateLong(p.paidOn)}</p>
                        <p className="truncate text-ui text-fg-3">
                          {[p.mode, p.reference].filter(Boolean).join(", ") || "No details"}
                        </p>
                      </div>
                      <span className="text-body font-medium text-ok tabular-nums">{inr(Number(p.amount))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-6 text-ui text-fg-2">
              This format does not count as a sale, so it takes no rooms from inventory and has no payments.
            </p>
          )}

          <h2 className="mt-6 text-ui font-medium text-fg-3">History</h2>
          <ol data-history className="mt-1 divide-y divide-line">
            {history.rows.map((h) => (
              <li key={h.id} className="py-2">
                <p className="text-body text-fg">
                  <span className="font-medium">{h.who}</span> {h.action} {h.summary}
                </p>
                <p className="text-ui text-fg-3 tabular-nums">{h.at}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="bg-canvas p-4 md:p-6 print:bg-paper print:p-0">
          <BillPaper data={paper} />
        </div>
      </div>
    </>
  );
}

export default function BillPage({ params }: { params: Params }) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Bill" />
          <ListSkeleton />
        </>
      }
    >
      <BillContent params={params} />
    </Suspense>
  );
}
