import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { isUuid } from "@/lib/result";
import { companyPictures } from "@/server/doc-assets";
import { renderReceiptDocx } from "@/server/receipt-docx";
import { renderReceiptPdf } from "@/server/receipt-pdf";
import type { ReceiptSnapshot } from "@/server/receipts";

/*
  The receipt for one payment, made fresh from the database each time: a PDF,
  or with ?as=docx a Word file. Signed-in people only. Add ?inline=1 to open
  the PDF in the browser instead of downloading it.
*/
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Sign in to see receipts.", { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) return new Response("No such receipt.", { status: 404 });

  const result = await db.execute<{
    company_id: string;
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
    company_email: string;
    company_phone: string;
    team_name: string | null;
    bill_number: string | null;
    bill_date: string | null;
    bill_title: string | null;
    bill_total: number | null;
    received_to_date: number | null;
    uses: { number: string; amount: number }[];
  }>(sql`
    select p.company_id, p.receipt_number, p.kind, p.paid_on::text as paid_on, p.amount::float8 as amount,
      p.mode, p.reference, p.notes,
      (p.cancelled_at at time zone 'Asia/Kolkata')::date::text as cancelled_on,
      coalesce(u.name, '') as recorded_by,
      p.snapshot,
      -- Today's details, only used if the payment has no snapshot.
      jsonb_build_object('name', co.name, 'initials', co.initials, 'color', co.color, 'address', co.address,
        'registration', co.registration, 'bankDetails', co.bank_details, 'terms', co.terms) as company,
      jsonb_build_object('name', c.name, 'address', c.address, 'registration', c.registration) as client,
      co.email as company_email, co.phone as company_phone,
      b.data->'details'->>'bookingRef' as team_name,
      b.number as bill_number, b.bill_date::text as bill_date,
      coalesce(b.snapshot->'format'->>'title', 'Bill') as bill_title,
      b.total::float8 as bill_total,
      (
        select coalesce(sum(r.amount), 0)::float8 from bill_receipts r
        where r.bill_id = p.bill_id
          and (r.paid_on, r.created_at) <= (p.paid_on, p.created_at)
      ) as received_to_date,
      -- For an advance: the bills it has been used on so far.
      coalesce((
        select jsonb_agg(jsonb_build_object('number', ub.number, 'amount', u.amount::float8) order by u.created_at)
        from advance_uses u join bills ub on ub.id = u.bill_id
        where u.advance_id = p.id
      ), '[]'::jsonb) as uses
    from payments p
    join companies co on co.id = p.company_id
    join clients c on c.id = p.client_id
    left join bills b on b.id = p.bill_id
    left join users u on u.id = p.created_by
    where p.id = ${id}
  `);
  const row = result.rows[0];
  if (!row || !row.receipt_number) return new Response("No such receipt.", { status: 404 });

  const data = {
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
    contact: { email: row.company_email, phone: row.company_phone },
    teamName: row.team_name ?? "",
    uses: row.uses,
    bill: row.bill_number
      ? {
          title: row.bill_title ?? "Bill",
          number: row.bill_number,
          date: row.bill_date ?? row.paid_on,
          total: row.bill_total ?? 0,
          receivedToDate: row.received_to_date ?? 0,
        }
      : null,
  };
  const pictures = await companyPictures(db, row.company_id);
  const url = new URL(request.url);
  const word = url.searchParams.get("as") === "docx";
  const body = word ? await renderReceiptDocx(data, pictures) : await renderReceiptPdf(data, pictures);

  const filename = `Receipt ${row.receipt_number.replace(/\//g, "-")}.${word ? "docx" : "pdf"}`;
  const inline = !word && url.searchParams.get("inline") === "1";
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": word ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
