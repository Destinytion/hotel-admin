import { eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import { fiscalYear, round2 } from "@/lib/format";
import type { Executor } from "./availability";

/**
 * What is still unpaid on a bill: its total less its own payments and any
 * advances used on it. Cancelled payments and advances do not count.
 */
export async function billOutstanding(ex: Executor, bill: { id: string; total: string }) {
  const result = await ex.execute<{ paid: number }>(
    sql`select coalesce(sum(amount), 0)::float8 as paid from bill_receipts where bill_id = ${bill.id}`,
  );
  return round2(Number(bill.total) - (result.rows[0]?.paid ?? 0));
}

/** How much of an advance is still free to use: its amount less every use. */
export async function advanceLeft(ex: Executor, advance: { id: string; amount: string }) {
  const [used] = await ex
    .select({ total: sql<number>`coalesce(sum(${schema.advanceUses.amount}), 0)::float8` })
    .from(schema.advanceUses)
    .where(eq(schema.advanceUses.advanceId, advance.id));
  return round2(Number(advance.amount) - used.total);
}

export type ReceiptSnapshot = {
  company: {
    name: string;
    initials: string;
    color: string;
    address: string;
    registration: string;
    bankDetails: string;
    terms: string;
  };
  client: { name: string; address: string; registration: string };
};

type Company = typeof schema.companies.$inferSelect;
type Client = typeof schema.clients.$inferSelect;

/**
 * The next receipt number for a company in the financial year of the payment,
 * for example SR/R/26-27/0004. Call inside the transaction that saves the
 * payment: the counter row is locked until it commits, so two people recording
 * payments at once never get the same number and no number is skipped.
 */
export async function issueReceiptNumber(ex: Executor, company: Company, paidOn: string) {
  const year = fiscalYear(paidOn);
  const [series] = await ex
    .insert(schema.receiptSeries)
    .values({ companyId: company.id, fiscalYear: year, nextNumber: 2 })
    .onConflictDoUpdate({
      target: [schema.receiptSeries.companyId, schema.receiptSeries.fiscalYear],
      set: { nextNumber: sql`${schema.receiptSeries.nextNumber} + 1` },
    })
    .returning({ next: schema.receiptSeries.nextNumber });
  return `${company.initials}/R/${year}/${String(series.next - 1).padStart(4, "0")}`;
}

/** Company and client details as they are now, kept on the payment for its receipt. */
export function receiptSnapshot(company: Company, client: Client): ReceiptSnapshot {
  return {
    company: {
      name: company.name,
      initials: company.initials,
      color: company.color,
      address: company.address,
      registration: company.registration,
      bankDetails: company.bankDetails,
      terms: company.terms,
    },
    client: { name: client.name, address: client.address, registration: client.registration },
  };
}
