import { CompanyChip } from "@/components/ui";
import { addDays, fmtDate, fmtDateLong, inr } from "@/lib/format";

export type PaperData = {
  company: {
    name: string;
    initials: string;
    color: string;
    address: string;
    registration: string;
    bankDetails: string;
    terms: string;
  };
  client: {
    name: string;
    address: string;
    registration: string;
    contact: string;
    phone: string;
  } | null;
  title: string;
  number: string | null;
  billDate: string;
  lines: {
    key: string | number;
    kind: "room" | "other";
    description: string;
    checkIn: string;
    nights: number;
    quantity: number;
    rate: number;
    amount: number;
  }[];
  subtotal: number;
  hasTaxLine: boolean;
  taxPercent: number;
  tax: number;
  total: number;
  notes: string;
  cancelled?: boolean;
};

/*
  The bill as it looks on paper. This on-screen version stands in until the
  Word formats are added; it is also what "Print" sends to the printer.
*/
export function BillPaper({ data }: { data: PaperData }) {
  const { company, client } = data;
  return (
    <article
      aria-label="Bill preview"
      className="relative mx-auto flex aspect-[210/297] w-full max-w-[620px] flex-col border border-paper-line bg-paper p-6 text-[11px] leading-[16px] text-paper-ink sm:p-9 print:max-w-none print:border-0 print:p-0"
    >
      {data.cancelled ? (
        <p className="absolute right-6 top-24 rotate-[-8deg] border-2 border-bad px-3 py-1 text-[18px] font-semibold uppercase tracking-[0.12em] text-bad sm:right-9">
          Cancelled
        </p>
      ) : null}

      <header className="flex items-start justify-between gap-6 border-b border-paper-line pb-5">
        <div className="flex gap-3">
          <CompanyChip initials={company.initials} color={company.color} size={36} />
          <div>
            <p className="text-[15px] font-semibold leading-[20px]">{company.name}</p>
            {company.address ? (
              <p className="whitespace-pre-line text-paper-muted">{company.address}</p>
            ) : null}
            {company.registration ? (
              <p className="text-paper-muted">{company.registration}</p>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em]">{data.title}</p>
          <p className="text-paper-muted">{data.number ?? "No. assigned on finalising"}</p>
          <p className="text-paper-muted">{fmtDateLong(data.billDate)}</p>
        </div>
      </header>

      <section className="py-5">
        <p className="text-paper-muted">Bill to</p>
        {client ? (
          <>
            <p className="text-[13px] font-semibold leading-[18px]">{client.name}</p>
            {client.address ? (
              <p className="whitespace-pre-line text-paper-muted">{client.address}</p>
            ) : null}
            {client.registration ? <p className="text-paper-muted">{client.registration}</p> : null}
            {client.contact || client.phone ? (
              <p className="text-paper-muted">
                {[client.contact, client.phone].filter(Boolean).join(", ")}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-paper-muted">No client picked yet</p>
        )}
      </section>

      <table className="w-full border-collapse tabular-nums">
        <thead>
          <tr className="border-y border-paper-line text-left text-paper-muted">
            <th className="py-1.5 pr-2 font-medium">Description</th>
            <th className="w-12 py-1.5 text-right font-medium">Nights</th>
            <th className="w-10 py-1.5 text-right font-medium">Qty</th>
            <th className="w-16 py-1.5 text-right font-medium">Rate</th>
            <th className="w-20 py-1.5 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={l.key} className="border-b border-paper-line align-top">
              <td className="py-2 pr-2">
                {/* The first line names the item; any further lines are its details. */}
                <p>{l.description.split("\n")[0] || "Untitled line"}</p>
                {l.description.includes("\n") ? (
                  <p className="whitespace-pre-line text-paper-muted">
                    {l.description.slice(l.description.indexOf("\n") + 1)}
                  </p>
                ) : null}
                {l.kind === "room" && l.checkIn && l.nights > 0 ? (
                  <p className="text-paper-muted">
                    {fmtDate(l.checkIn)} to {fmtDate(addDays(l.checkIn, l.nights))}
                  </p>
                ) : null}
              </td>
              <td className="py-2 text-right">{l.kind === "room" ? l.nights : ""}</td>
              <td className="py-2 text-right">{l.quantity}</td>
              <td className="py-2 text-right">{inr(l.rate)}</td>
              <td className="py-2 text-right">{inr(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-4 grid w-56 grid-cols-2 gap-y-1 tabular-nums">
        <dt className="text-paper-muted">Subtotal</dt>
        <dd className="text-right">{inr(data.subtotal)}</dd>
        {data.hasTaxLine ? (
          <>
            <dt className="text-paper-muted">Tax {data.taxPercent}%</dt>
            <dd className="text-right">{inr(data.tax)}</dd>
          </>
        ) : null}
        <dt className="border-t border-paper-line pt-1.5 text-[13px] font-semibold">Total</dt>
        <dd className="border-t border-paper-line pt-1.5 text-right text-[13px] font-semibold">
          {inr(data.total)}
        </dd>
      </dl>

      {data.notes ? <p className="mt-5 whitespace-pre-wrap text-paper-muted">{data.notes}</p> : null}
      {company.terms ? (
        <p className="mt-3 whitespace-pre-wrap text-paper-muted">{company.terms}</p>
      ) : null}

      <footer className="mt-auto flex items-end justify-between gap-6 pt-8">
        <div>
          {company.bankDetails ? (
            <>
              <p className="text-paper-muted">Bank details</p>
              <p className="whitespace-pre-line">{company.bankDetails}</p>
            </>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p>For {company.name}</p>
          <p className="mt-8 text-paper-muted">Authorised signatory</p>
        </div>
      </footer>
    </article>
  );
}
