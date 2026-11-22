import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { isUuid } from "@/lib/result";
import { renderReceiptPdf } from "@/server/receipt-pdf";
import type { ReceiptSnapshot } from "@/server/receipts";

/*
  The PDF receipt for one payment, made fresh from the database each time.
  Signed-in people only. Add ?inline=1 to open it in the browser instead of
  downloading it.
*/
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Sign in to see receipts.", { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) return new Response("No such receipt.", { status: 404 });

  const result = await db.execute<{
    receipt_number: string | null;
    kind: "payment" | "advance";
    paid_on: string;
    amount: number;
    mode: string;
    reference: string;
    notes: string;
    cancelled_on: string | null;
    recorded_by: string;
    snapshot: ReceiptSnapshot | null;
    company: ReceiptSnapshot["company"];
    client: ReceiptSnapshot["client"];
    bill_number: string | null;
    bill_date: string | null;
    bill_title: string | null;
    bill_total: number | null;
    received_to_date: number | null;
  }>(sql`
    select p.receipt_number, p.kind, p.paid_on::text as paid_on, p.amount::float8 as amount,
      p.mode, p.reference, p.notes,
      (p.cancelled_at at time zone 'Asia/Kolkata')::date::text as cancelled_on,
      coalesce(u.name, '') as recorded_by,
      p.snapshot,
      -- Today's details, only used if the payment has no snapshot.
      jsonb_build_object('name', co.name, 'initials', co.initials, 'color', co.color, 'address', co.address,
        'registration', co.registration, 'bankDetails', co.bank_details, 'terms', co.terms) as company,
      jsonb_build_object('name', c.name, 'address', c.address, 'registration', c.registration) as client,
      b.number as bill_number, b.bill_date::text as bill_date,
      coalesce(b.snapshot->'format'->>'title', 'Bill') as bill_title,
      b.total::float8 as bill_total,
      (
        select coalesce(sum(p2.amount), 0)::float8 from payments p2
        where p2.bill_id = p.bill_id and p2.status = 'active'
          and (p2.paid_on, p2.created_at, p2.id) <= (p.paid_on, p.created_at, p.id)
      ) as received_to_date
    from payments p
    join companies co on co.id = p.company_id
    join clients c on c.id = p.client_id
    left join bills b on b.id = p.bill_id
    left join users u on u.id = p.created_by
    where p.id = ${id}
  `);
  const row = result.rows[0];
  if (!row || !row.receipt_number) return new Response("No such receipt.", { status: 404 });

  const pdf = await renderReceiptPdf({
    number: row.receipt_number,
    kind: row.kind,
    paidOn: row.paid_on,
    amount: row.amount,
    mode: row.mode,
    reference: row.reference,
    notes: row.notes,
    cancelledOn: row.cancelled_on,
    recordedBy: row.recorded_by,
    snapshot: row.snapshot ?? { company: row.company, client: row.client },
    bill: row.bill_number
      ? {
          title: row.bill_title ?? "Bill",
          number: row.bill_number,
          date: row.bill_date ?? row.paid_on,
          total: row.bill_total ?? 0,
          receivedToDate: row.received_to_date ?? 0,
        }
      : null,
  });

  const filename = `Receipt ${row.receipt_number.replace(/\//g, "-")}.pdf`;
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
