"use server";

import { refresh } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { isUuid, run, text, UserError } from "@/lib/result";
import { conflict, logActivity } from "@/server/activity";
import { COMPANY_COLORS } from "./colors";

export type CompanyInput = {
  id?: string;
  /** The version this edit started from. Missing for a new company. */
  version?: number;
  name: string;
  initials: string;
  color: string;
  address: string;
  registration: string;
  bankDetails: string;
  terms: string;
  email: string;
  phone: string;
  active: boolean;
};

/*
  The formats every company bills with, from the user's own Word formats: the
  GST bill, the Non-GST bill, the Proforma Invoice and the Quotation. Each has
  its own number prefix so numbers never collide inside a company. The
  proforma and the quotation are not sales: they take no rooms and nothing is
  owed on them until a bill is made from them.
*/
const starterFormats = (companyId: string, initials: string) => [
  {
    companyId,
    name: "GST Bill",
    // Both bills print simply as "Invoice", at the user's request.
    title: "Invoice",
    numberPrefix: `${initials}/`,
    layout: "gst",
    hasTaxLine: true,
    countsAsSale: true,
  },
  {
    companyId,
    name: "Non-GST Bill",
    title: "Invoice",
    numberPrefix: `${initials}/N/`,
    layout: "non-gst",
    hasTaxLine: true,
    countsAsSale: true,
  },
  {
    companyId,
    name: "Proforma Invoice",
    title: "Proforma Invoice",
    numberPrefix: `${initials}/P/`,
    layout: "proforma",
    hasTaxLine: true,
    countsAsSale: false,
  },
  {
    companyId,
    name: "Quotation",
    title: "Quotation",
    numberPrefix: `${initials}/Q/`,
    layout: "quotation",
    hasTaxLine: true,
    countsAsSale: false,
  },
];

export async function saveCompany(input: CompanyInput) {
  return run(async () => {
    const user = await requireUser();

    const name = text(input.name, 200);
    const initials = text(input.initials, 3).toUpperCase();
    if (!name) throw new UserError("Enter the company name.");
    if (!/^[A-Z0-9]{1,3}$/.test(initials)) {
      throw new UserError("Initials are 1 to 3 letters or digits, for example SR.");
    }
    const email = text(input.email ?? "", 200).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("That email address does not look right.");
    const values = {
      name,
      initials,
      color: COMPANY_COLORS.includes(input.color) ? input.color : COMPANY_COLORS[0],
      address: text(input.address),
      registration: text(input.registration, 200),
      bankDetails: text(input.bankDetails),
      terms: text(input.terms),
      email,
      phone: text(input.phone ?? "", 60),
      active: Boolean(input.active),
    };

    await db.transaction(async (tx) => {
      if (input.id) {
        const id = input.id;
        if (!isUuid(id)) throw new UserError("That company could not be found.");
        // Only saves if nobody else has saved since this edit was opened.
        const updated = await tx
          .update(schema.companies)
          .set({ ...values, version: sql`${schema.companies.version} + 1`, updatedBy: user.id })
          .where(and(eq(schema.companies.id, id), eq(schema.companies.version, Number(input.version))))
          .returning({ id: schema.companies.id });
        if (!updated.length) {
          const [current] = await tx
            .select({ updatedBy: schema.companies.updatedBy, updatedAt: schema.companies.updatedAt })
            .from(schema.companies)
            .where(eq(schema.companies.id, id));
          if (!current) throw new UserError("This company no longer exists.");
          throw await conflict(tx, "company", current);
        }
        await logActivity(tx, {
          userId: user.id,
          action: "changed",
          entity: "company",
          entityId: id,
          summary: `company ${name}`,
        });
        return;
      }
      const [created] = await tx
        .insert(schema.companies)
        .values({ ...values, createdBy: user.id, updatedBy: user.id })
        .returning({ id: schema.companies.id });
      await tx.insert(schema.formats).values(starterFormats(created.id, initials));
      await logActivity(tx, {
        userId: user.id,
        action: "added",
        entity: "company",
        entityId: created.id,
        summary: `company ${name}`,
      });
    });

    refresh();
    return null;
  });
}
