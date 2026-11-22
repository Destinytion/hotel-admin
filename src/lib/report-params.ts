import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayISO } from "@/lib/format";
import { resolveRange } from "@/lib/ranges";
import { isUuid } from "@/lib/result";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The date range, company and company list shared by Payments and Reports. */
export async function reportParams(searchParams: SearchParams) {
  const params = await searchParams;
  const today = todayISO();
  const companies = await db
    .select({ id: schema.companies.id, name: schema.companies.name })
    .from(schema.companies)
    .orderBy(asc(schema.companies.name));
  const requested = params.company;
  const companyId =
    typeof requested === "string" && isUuid(requested) && companies.some((c) => c.id === requested)
      ? requested
      : "";
  return { today, range: resolveRange(params, today), companies, companyId };
}
