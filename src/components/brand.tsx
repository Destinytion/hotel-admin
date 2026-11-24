import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/session";
import { pictureUrls } from "@/server/bill-doc";

/** The app's own name, shown until a company is set up. */
export function DefaultBrand() {
  return (
    <>
      <span className="flex size-6 items-center justify-center rounded-md bg-ink text-ui font-semibold text-on-ink">H</span>
      <span className="text-body font-semibold tracking-tight text-fg">Hotel Admin</span>
    </>
  );
}

/** The business's own logo and name at the top of the sidebar: the first company set up. */
export async function Brand() {
  if (!(await getSession())) return <DefaultBrand />;
  const [company] = await db
    .select({ id: schema.companies.id, name: schema.companies.name })
    .from(schema.companies)
    .where(eq(schema.companies.active, true))
    .orderBy(asc(schema.companies.createdAt))
    .limit(1);
  if (!company) return <DefaultBrand />;
  const { logoUrl } = await pictureUrls(db, company.id);
  return (
    <>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-8 shrink-0 object-contain" />
      ) : (
        <span className="flex size-6 items-center justify-center rounded-md bg-ink text-ui font-semibold text-on-ink">
          {company.name.slice(0, 1)}
        </span>
      )}
      <span className="line-clamp-2 min-w-0 text-ui font-semibold leading-tight tracking-tight text-fg">{company.name}</span>
    </>
  );
}
