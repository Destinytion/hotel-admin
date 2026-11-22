import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { ListSkeleton, PageHeader } from "@/components/ui";
import { ImportClient } from "./import-client";

export const metadata = { title: "Import | Hotel Admin" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function ImportContent({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const params = await searchParams;
  return <ImportClient initialKind={params.what === "rooms" ? "rooms" : "clients"} />;
}

export default function ImportPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        title="Import from a spreadsheet"
        description="Bring in clients or rooms held from Google Sheets, Excel or a CSV file. Nothing is saved until you press Import."
      />
      <Suspense fallback={<ListSkeleton />}>
        <ImportContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
