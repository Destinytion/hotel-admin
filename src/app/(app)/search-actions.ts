"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { fmtDate, inr } from "@/lib/format";
import { run } from "@/lib/result";

export type SearchHit = {
  kind: "Client" | "Bill" | "Draft" | "Room" | "Receipt";
  title: string;
  subtitle: string;
  href: string;
};

/** Escapes % and _ so they are matched as typed. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Finds clients (by name, contact, phone or email), bills (by number or
 * client), rooms (by hotel, room or city) and receipts (by number).
 */
export async function search(query: string) {
  return run(async (): Promise<SearchHit[]> => {
    await requireUser();
    const q = String(query ?? "").trim().slice(0, 100);
    if (q.length < 2) return [];
    const pattern = like(q);
    // Only a query with no letters is looked for in phone numbers, so a bill
    // number such as AC/T/0001 does not match every phone with 0001 in it.
    const digits = q.replace(/\D/g, "");
    const phone = digits.length >= 4 && !/[a-z]/i.test(q) && !q.includes("/") ? like(digits) : null;

    const [clients, bills, rooms, receipts] = await Promise.all([
      db.execute<{ id: string; name: string; contact: string | null; phone: string | null }>(sql`
        select c.id, c.name, pc.name as contact, pc.phone
        from clients c
        left join lateral (
          select name, phone from client_contacts where client_id = c.id
          order by is_primary desc, created_at limit 1
        ) pc on true
        where c.name ilike ${pattern}
          or exists (
            select 1 from client_contacts cc where cc.client_id = c.id
              and (cc.name ilike ${pattern} or cc.email ilike ${pattern}
                ${phone ? sql`or regexp_replace(cc.phone, '[^0-9]', '', 'g') like ${phone}` : sql``})
          )
        order by (c.name ilike ${q + "%"}) desc, lower(c.name)
        limit 6
      `),
      db.execute<{ id: string; number: string | null; status: string; client: string; title: string; total: number; bill_date: string }>(sql`
        select b.id, b.number, b.status::text as status, c.name as client, f.title,
          b.total::float8 as total, b.bill_date::text as bill_date
        from bills b
        join clients c on c.id = b.client_id
        join formats f on f.id = b.format_id
        where b.number ilike ${pattern} or c.name ilike ${pattern}
        order by (b.number ilike ${pattern}) desc, b.bill_date desc, b.created_at desc
        limit 8
      `),
      db.execute<{ id: string; room: string; hotel: string; city: string }>(sql`
        select rt.id, rt.name as room, h.name as hotel, h.city
        from room_types rt join hotels h on h.id = rt.hotel_id
        where h.name ilike ${pattern} or rt.name ilike ${pattern} or h.city ilike ${pattern}
        order by lower(h.name), lower(rt.name)
        limit 6
      `),
      db.execute<{ id: string; receipt_number: string; amount: number; client: string; bill_id: string | null; status: string }>(sql`
        select p.id, p.receipt_number, p.amount::float8 as amount, c.name as client, p.bill_id, p.status::text as status
        from payments p join clients c on c.id = p.client_id
        where p.receipt_number ilike ${pattern}
        order by p.paid_on desc
        limit 4
      `),
    ]);

    const clientHits = clients.rows.map((c) => ({
      kind: "Client" as const,
      title: c.name,
      subtitle: [c.contact, c.phone].filter(Boolean).join(", "),
      href: `/clients?open=${c.id}`,
    }));
    const billHits = bills.rows.map((b) =>
        b.status === "draft"
          ? {
              kind: "Draft" as const,
              title: `${b.title} for ${b.client}`,
              subtitle: `Not finalised, ${inr(b.total)}`,
              href: `/bill-generator?bill=${b.id}`,
            }
          : {
              kind: "Bill" as const,
              title: `${b.number} ${b.client}`,
              subtitle: `${b.title}, ${fmtDate(b.bill_date)}, ${inr(b.total)}${b.status === "cancelled" ? ", cancelled" : ""}`,
              href: `/bills/${b.id}`,
            },
    );
    const roomHits = rooms.rows.map((r) => ({
      kind: "Room" as const,
      title: `${r.room}, ${r.hotel}`,
      subtitle: r.city,
      href: `/inventory?room=${r.id}`,
    }));
    const receiptHits = receipts.rows.map((p) => ({
      kind: "Receipt" as const,
      title: `${p.receipt_number} ${p.client}`,
      subtitle: `${inr(p.amount)}${p.status === "cancelled" ? ", cancelled" : ""}`,
      href: p.bill_id ? `/bills/${p.bill_id}` : `/api/receipts/${p.id}?inline=1`,
    }));
    // Something that looks like a number with slashes is a bill or receipt number.
    return q.includes("/")
      ? [...billHits, ...receiptHits, ...clientHits, ...roomHits]
      : [...clientHits, ...billHits, ...roomHits, ...receiptHits];
  });
}
