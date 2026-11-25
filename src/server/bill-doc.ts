import { asc, desc, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import { asLayout, readDetails, readSchedule, type BillDoc, type DocClient, type DocCompany } from "@/lib/bill-document";
import type { Executor } from "./availability";

type Snapshot = {
  company?: Partial<DocCompany>;
  client?: Partial<DocClient>;
  format?: { title?: string; hasTaxLine?: boolean; layout?: string };
} | null;

/** Where the company's logo and stamp can be fetched, with a version so a new upload shows at once. */
export async function pictureUrls(ex: Executor, companyId: string) {
  const rows = await ex
    .select({ kind: schema.companyImages.kind, updatedAt: schema.companyImages.updatedAt })
    .from(schema.companyImages)
    .where(eq(schema.companyImages.companyId, companyId));
  const url = (kind: string) => {
    const row = rows.find((r) => r.kind === kind);
    return row ? `/api/company-images/${companyId}/${kind}?v=${row.updatedAt.getTime()}` : null;
  };
  return { logoUrl: url("logo"), stampUrl: url("stamp") };
}

/*
  A saved bill as a BillDoc, ready for the screen, PDF or Word. A finalised
  bill uses the company and client details frozen when it was finalised;
  details added to the app later (email, phone, layout) fall back to today's.
*/
export async function loadBillDoc(ex: Executor, billId: string) {
  const [bill] = await ex.select().from(schema.bills).where(eq(schema.bills.id, billId));
  if (!bill) return null;
  const [[format], [company], [client], lines, contact, paidRow] = await Promise.all([
    ex.select().from(schema.formats).where(eq(schema.formats.id, bill.formatId)),
    ex.select().from(schema.companies).where(eq(schema.companies.id, bill.companyId)),
    ex.select().from(schema.clients).where(eq(schema.clients.id, bill.clientId)),
    ex.select().from(schema.billLines).where(eq(schema.billLines.billId, bill.id)).orderBy(asc(schema.billLines.position)),
    ex
      .select({ name: schema.clientContacts.name, phone: schema.clientContacts.phone })
      .from(schema.clientContacts)
      .where(eq(schema.clientContacts.clientId, bill.clientId))
      .orderBy(desc(schema.clientContacts.isPrimary), asc(schema.clientContacts.createdAt))
      .limit(1),
    ex.execute<{ paid: number }>(sql`select coalesce(sum(amount), 0)::float8 as paid from bill_receipts where bill_id = ${bill.id}`),
  ]);
  const data = (bill.data ?? {}) as { taxPercent?: number; notes?: string; discount?: number; discountPercent?: number | null; billTo?: Partial<DocClient>; showGstin?: boolean };
  // A finalised bill has its snapshot; a draft has the client as typed on it.
  const snap = (bill.snapshot ?? (data.billTo?.name ? { client: data.billTo } : null)) as Snapshot;

  const docCompany: DocCompany = {
    name: snap?.company?.name ?? company.name,
    initials: snap?.company?.initials ?? company.initials,
    color: snap?.company?.color ?? company.color,
    address: snap?.company?.address ?? company.address,
    registration: snap?.company?.registration ?? company.registration,
    email: snap?.company?.email ?? company.email,
    phone: snap?.company?.phone ?? company.phone,
    bankDetails: snap?.company?.bankDetails ?? company.bankDetails,
    terms: snap?.company?.terms ?? company.terms,
  };
  const docClient: DocClient = {
    name: snap?.client?.name ?? client.name,
    address: snap?.client?.address ?? client.address,
    registration: snap?.client?.registration ?? client.registration,
    contact: snap?.client?.contact ?? contact[0]?.name ?? "",
    phone: snap?.client?.phone ?? contact[0]?.phone ?? "",
  };

  const doc: BillDoc = {
    layout: asLayout(snap?.format?.layout ?? format.layout),
    title: snap?.format?.title ?? format.title,
    number: bill.number,
    billDate: bill.billDate,
    company: docCompany,
    client: docClient,
    details: readDetails(bill.data),
    lines: lines.map((l) => ({
      key: l.id,
      kind: l.kind,
      description: l.description,
      checkIn: l.checkIn ?? "",
      nights: l.nights ?? 1,
      quantity: Number(l.quantity),
      rate: Number(l.rate),
      amount: Number(l.amount),
    })),
    subtotal: Number(bill.subtotal),
    taxPercent: Number(data.taxPercent ?? 0),
    tax: Number(bill.taxTotal),
    discount: Number(data.discount ?? 0),
    discountPercent: data.discountPercent ?? null,
    showGstin: Boolean(data.showGstin),
    total: Number(bill.total),
    notes: data.notes ?? "",
    cancelled: bill.status === "cancelled",
    paid: bill.status === "draft" ? null : (paidRow.rows[0]?.paid ?? 0),
    schedule: readSchedule(bill.data),
  };
  return { bill, doc, companyId: company.id };
}
