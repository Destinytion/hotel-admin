import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { addDays, fmtDateLong } from "@/lib/format";
import { isUuid } from "@/lib/result";
import { ListSkeleton, PageHeader } from "@/components/ui";
import type { PaperData } from "@/components/bill-paper";
import type { Voucher } from "../../actions";
import { VoucherClient, type VoucherLine } from "./voucher-client";

export const metadata = { title: "Voucher | Hotel Admin" };

type Params = Promise<{ id: string }>;

type Snapshot = {
  company: PaperData["company"];
  client: NonNullable<PaperData["client"]>;
  format: { title: string };
};

async function VoucherContent({ params }: { params: Params }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, id));
  if (!bill) notFound();
  if (bill.status === "draft") redirect(`/bill-generator?bill=${bill.id}`);

  const [lines, contact] = await Promise.all([
    db.select().from(schema.billLines).where(eq(schema.billLines.billId, id)).orderBy(asc(schema.billLines.position)),
    db
      .select({ phone: schema.clientContacts.phone })
      .from(schema.clientContacts)
      .where(eq(schema.clientContacts.clientId, bill.clientId))
      .orderBy(desc(schema.clientContacts.isPrimary), asc(schema.clientContacts.createdAt))
      .limit(1),
  ]);
  const snapshot = bill.snapshot as Snapshot;
  const saved = (bill.voucher ?? null) as Voucher | null;

  const rooms: VoucherLine[] = lines
    .filter((l) => l.kind === "room" && l.checkIn && l.nights)
    .map((l) => ({
      id: l.id,
      // First line names the room and hotel; any more lines are details.
      title: l.description.split("\n")[0],
      details: l.description.includes("\n") ? l.description.slice(l.description.indexOf("\n") + 1) : "",
      checkIn: l.checkIn!,
      checkOut: addDays(l.checkIn!, l.nights!),
      nights: l.nights!,
      rooms: Number(l.quantity),
    }));
  const services = lines
    .filter((l) => l.kind === "other")
    .map((l) => ({ id: l.id, title: l.description.split("\n")[0], quantity: Number(l.quantity) }));

  return (
    <VoucherClient
      billId={bill.id}
      billNumber={bill.number ?? ""}
      billDate={bill.billDate}
      cancelled={bill.status === "cancelled"}
      company={snapshot.company}
      client={snapshot.client}
      phone={snapshot.client.phone || contact[0]?.phone || ""}
      rooms={rooms}
      services={services}
      initial={{
        guests: saved?.guests ?? "",
        requests: saved?.requests ?? "",
        confirmations: saved?.confirmations ?? {},
      }}
      dateLabel={fmtDateLong(bill.billDate)}
    />
  );
}

export default function VoucherPage({ params }: { params: Params }) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title="Voucher" />
          <ListSkeleton />
        </>
      }
    >
      <VoucherContent params={params} />
    </Suspense>
  );
}
