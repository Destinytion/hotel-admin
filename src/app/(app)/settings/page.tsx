import { Suspense } from "react";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { zohoEnabled } from "@/lib/auth";
import { requireUser } from "@/lib/session";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { CompaniesClient } from "./companies-client";
import { PeopleClient } from "./people-client";

export const metadata = { title: "Settings | Hotel Admin" };

async function SettingsContent() {
  const me = await requireUser();
  const [companies, formats, users] = await Promise.all([
    db.select().from(schema.companies).orderBy(asc(schema.companies.name)),
    db
      .select({
        id: schema.formats.id,
        companyId: schema.formats.companyId,
        name: schema.formats.name,
        numberPrefix: schema.formats.numberPrefix,
      })
      .from(schema.formats)
      .orderBy(asc(schema.formats.createdAt), asc(schema.formats.name)),
    db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .orderBy(asc(schema.users.createdAt)),
  ]);

  return (
    <>
      <CompaniesClient
        companies={companies.map((c) => ({
          id: c.id,
          name: c.name,
          initials: c.initials,
          color: c.color,
          address: c.address,
          registration: c.registration,
          bankDetails: c.bankDetails,
          terms: c.terms,
          active: c.active,
          version: c.version,
          changedBy: users.find((u) => u.id === c.updatedBy)?.name ?? "",
          formats: formats.filter((f) => f.companyId === c.id).map((f) => f.name),
        }))}
      />

      <PeopleClient people={users} meId={me.id} zoho={zohoEnabled()} />
    </>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="The companies you bill from, and who can sign in." />
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <SettingsContent />
      </Suspense>
    </>
  );
}
