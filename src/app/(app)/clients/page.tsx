import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { ClientsClient, type ClientRow } from "./clients-client";
import type { ClientType } from "./actions";

export const metadata = { title: "Clients | Hotel Admin" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function ClientsContent({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const params = await searchParams;
  const result = await db.execute<{
    id: string;
    name: string;
    type: ClientType;
    address: string;
    registration: string;
    tags: string[];
    contact_name: string;
    contact_role: string;
    contact_phone: string;
    contact_email: string;
    outstanding: number;
    last_activity: string;
    version: number;
    changed_by: string;
    contacts: ClientRow["contacts"];
  }>(sql`
    select
      c.id, c.name, c.type, c.address, c.registration, c.tags, c.version,
      coalesce(cu.name, '') as changed_by,
      coalesce(pc.name, '') as contact_name,
      coalesce(pc.role, '') as contact_role,
      coalesce(pc.phone, '') as contact_phone,
      coalesce(pc.email, '') as contact_email,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', cc.id, 'name', cc.name, 'role', cc.role, 'phone', cc.phone, 'email', cc.email)
          order by cc.is_primary desc, cc.created_at)
        from client_contacts cc where cc.client_id = c.id
      ), '[]'::jsonb) as contacts,
      (coalesce(b.billed, 0) - coalesce(p.paid, 0))::float8 as outstanding,
      (greatest(c.updated_at, b.last, p.last, n.last) at time zone 'Asia/Kolkata')::date::text as last_activity
    from clients c
    left join users cu on cu.id = c.updated_by
    left join lateral (
      select cc.name, cc.role, cc.phone, cc.email
      from client_contacts cc where cc.client_id = c.id
      order by cc.is_primary desc, cc.created_at limit 1
    ) pc on true
    left join lateral (
      select sum(bl.total) as billed, max(bl.finalised_at) as last
      from bills bl where bl.client_id = c.id and bl.status = 'final' and bl.is_sale
    ) b on true
    left join lateral (
      select sum(pm.amount) filter (where pm.status = 'active') as paid, max(pm.created_at) as last
      from payments pm where pm.client_id = c.id
    ) p on true
    left join lateral (
      select max(cn.created_at) as last from client_notes cn where cn.client_id = c.id
    ) n on true
    order by lower(c.name)
  `);

  const rows: ClientRow[] = result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    address: r.address,
    registration: r.registration,
    tags: r.tags,
    contactName: r.contact_name,
    contactRole: r.contact_role,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    contacts: r.contacts,
    outstanding: r.outstanding,
    lastActivity: r.last_activity,
    version: r.version,
    changedBy: r.changed_by,
  }));

  // Search links here with ?open=<client> or ?new=1. A new key starts the
  // screen afresh when such a link is followed from this same screen.
  const open = typeof params.open === "string" && rows.some((r) => r.id === params.open) ? params.open : null;
  const add = params.new === "1";
  return <ClientsClient key={`${open ?? ""}-${add}`} rows={rows} initialOpenId={open} initialNew={add} />;
}

export default function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Clients" />
          <ListSkeleton />
        </>
      }
    >
      <ClientsContent searchParams={searchParams} />
    </Suspense>
  );
}
