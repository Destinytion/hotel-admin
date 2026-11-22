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
import { BillPayments } from "./bill-payments";

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

  const [lines, payments, uses, advances, contact] = await Promise.all([
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
    // Parts of advances used on this bill.
    db
      .select({
        id: schema.advanceUses.id,
        advanceId: schema.advanceUses.advanceId,
        amount: schema.advanceUses.amount,
        usedOn: schema.advanceUses.usedOn,
        receiptNumber: schema.payments.receiptNumber,
        mode: schema.payments.mode,
        status: schema.payments.status,
      })
      .from(schema.advanceUses)
      .innerJoin(schema.payments, eq(schema.payments.id, schema.advanceUses.advanceId))
      .where(eq(schema.advanceUses.billId, bill.id))
      .orderBy(desc(schema.advanceUses.usedOn), desc(schema.advanceUses.createdAt)),
    // Advances from this client to this company with something left to use.
    db.execute<{ id: string; paid_on: string; amount: number; left: number; receipt_number: string | null; notes: string }>(sql`
      select p.id, p.paid_on::text as paid_on, p.amount::float8 as amount, p.receipt_number, p.notes,
        (p.amount - coalesce((select sum(u.amount) from advance_uses u where u.advance_id = p.id), 0))::float8 as left
      from payments p
      where p.client_id = ${bill.clientId} and p.company_id = ${bill.companyId}
        and p.kind = 'advance' and p.status = 'active'
        and p.amount > coalesce((select sum(u.amount) from advance_uses u where u.advance_id = p.id), 0)
      order by p.paid_on, p.created_at
    `),
    // The client's main phone today, for sharing on WhatsApp.
    db
      .select({ phone: schema.clientContacts.phone })
      .from(schema.clientContacts)
      .where(eq(schema.clientContacts.clientId, bill.clientId))
      .orderBy(desc(schema.clientContacts.isPrimary), asc(schema.clientContacts.createdAt))
      .limit(1),
  ]);

  // A finalised bill shows the details frozen when it was finalised.
  const snapshot = bill.snapshot as Snapshot;
  const data = bill.data as { taxPercent?: number; notes?: string };
  const total = Number(bill.total);
  const paid = round2(
    payments.filter((p) => p.status === "active").reduce((sum, p) => sum + Number(p.amount), 0) +
      uses.filter((u) => u.status === "active").reduce((sum, u) => sum + Number(u.amount), 0),
  );
  const outstanding = round2(total - paid);
  const state = billState({ status: bill.status, isSale: bill.isSale, total, paid });

  // For WhatsApp: the number on the bill, or the client's main number today.
  const phone = snapshot.client.phone || contact[0]?.phone || "";
  const greeting = snapshot.client.contact ? `Dear ${snapshot.client.contact.split(" ")[0]},` : `Dear ${snapshot.client.name},`;
  const billMessage = [
    greeting,
    "",
    `${snapshot.format.title} ${bill.number ?? ""} dated ${fmtDateLong(bill.billDate)} for ${inr(total)}.`.replace("  ", " "),
    bill.isSale && bill.status === "final" && outstanding > 0 && paid > 0
      ? `Received so far ${inr(paid)}. Balance due ${inr(outstanding)}.`
      : "",
    bill.isSale && bill.status === "final" && outstanding > 0 && snapshot.company.bankDetails
      ? `\nBank details:\n${snapshot.company.bankDetails}`
      : "",
    "",
    snapshot.company.name,
  ]
    .filter((line, i, all) => line !== "" || (all[i - 1] ?? "") !== "")
    .join("\n");
  const hasRooms = lines.some((l) => l.kind === "room");

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
              phone={phone}
              message={billMessage}
              voucherHref={bill.status === "final" && hasRooms ? `/bills/${bill.id}/voucher` : null}
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
            <BillPayments
              billId={bill.id}
              share={{ phone, client: snapshot.client.name, company: snapshot.company.name }}
              canApply={bill.status === "final"}
              outstanding={outstanding}
              payments={[
                ...payments.map((p) => ({
                  id: p.id,
                  paymentId: p.id,
                  useId: null,
                  paidOn: p.paidOn,
                  amount: Number(p.amount),
                  mode: p.mode,
                  reference: p.reference,
                  receiptNumber: p.receiptNumber,
                  advance: p.kind === "advance",
                  cancelled: p.status === "cancelled",
                })),
                ...uses.map((u) => ({
                  id: u.id,
                  paymentId: u.advanceId,
                  useId: u.id,
                  paidOn: u.usedOn,
                  amount: Number(u.amount),
                  mode: u.mode,
                  reference: "",
                  receiptNumber: u.receiptNumber,
                  advance: true,
                  cancelled: u.status === "cancelled",
                })),
              ].sort((a, b) => b.paidOn.localeCompare(a.paidOn))}
              advances={advances.rows.map((a) => ({
                id: a.id,
                paidOn: a.paid_on,
                amount: a.amount,
                left: a.left,
                receiptNumber: a.receipt_number,
                notes: a.notes,
              }))}
            />
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
