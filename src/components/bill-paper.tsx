import { CompanyChip } from "@/components/ui";

const DOC_INK = "#1a1c20";
import {
  detailRows,
  gstTable,
  gstinLine,
  itemColumns,
  paymentState,
  splitDescription,
  totalRows,
  type BillDoc,
} from "@/lib/bill-document";
import { fmtDateLong, inr } from "@/lib/format";
import { amountInWords } from "@/lib/words";

export type PaperData = BillDoc & {
  /** Where the company's logo and stamp are served from, if it has them. */
  logoUrl?: string | null;
  stampUrl?: string | null;
};

const money = (n: number) => (n < 0 ? `- ${inr(-n)}` : inr(n));

/*
  The bill on screen and on paper, in the user's own formats: the GST bill,
  the Non-GST bill and the Proforma Invoice. The PDF and Word downloads are
  drawn from the same BillDoc and follow the same order.
*/
export function BillPaper({ data }: { data: PaperData }) {
  const { company, client, details, layout } = data;
  // Bills are kept plain: black and grey only, whatever the company's app colour.
  const accent = DOC_INK;
  const cols = itemColumns(layout);
  const rows = detailRows(data);
  const state = layout === "proforma" ? paymentState(data) : null;

  const meta: [string, string][] =
    layout === "proforma"
      ? [
          ["Proforma No.", data.number ?? "On finalising"],
          ["Date", fmtDateLong(data.billDate)],
          ["Booking Ref", details.bookingRef],
          ["Pay by", details.payBy ? fmtDateLong(details.payBy) : ""],
        ]
      : [
          ["Invoice No.", data.number ?? "On finalising"],
          ["Invoice Date", fmtDateLong(data.billDate)],
          ["Place of Supply", details.placeOfSupply],
          ["Booking Ref", details.bookingRef],
        ];

  return (
    <article
      aria-label="Bill preview"
      data-layout={layout}
      className="relative mx-auto flex min-h-[877px] w-full max-w-[620px] flex-col border border-paper-line bg-paper p-6 text-[10.5px] leading-[15px] text-paper-ink sm:p-8 print:min-h-0 print:max-w-none print:border-0 print:p-0"
    >
      {data.cancelled ? (
        <p className="absolute right-6 top-28 rotate-[-8deg] border-2 border-bad px-3 py-1 text-[18px] font-semibold uppercase tracking-[0.12em] text-bad sm:right-8">
          Cancelled
        </p>
      ) : null}

      {/* Letterhead */}
      <header className="flex items-start justify-between gap-6 pb-4">
        <div className="flex min-w-0 items-start gap-3">
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt="" className="h-16 w-auto max-w-[120px] object-contain" />
          ) : (
            <CompanyChip initials={company.initials} color={accent} size={40} />
          )}
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-[19px]">{company.name}</p>
            {company.address ? <p className="whitespace-pre-line text-paper-muted">{company.address}</p> : null}
            {layout !== "non-gst" && company.registration ? (
              <p className="text-paper-muted">{gstinLine(company.registration)}</p>
            ) : null}
            {company.email || company.phone ? (
              <p className="text-paper-muted">{[company.email, company.phone].filter(Boolean).join("  |  ")}</p>
            ) : null}
          </div>
        </div>
        <p className="shrink-0 pt-1 text-right text-[15px] font-semibold uppercase tracking-[0.06em]" style={{ color: accent }}>
          {data.title}
        </p>
      </header>
      <div className="h-px bg-paper-ink" />

      {/* Number, date, place of supply, booking ref */}
      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-paper-line bg-paper-line sm:grid-cols-4">
        {meta.map(([label, value]) => (
          <div key={label} className="bg-paper px-2.5 py-1.5">
            <dt className="text-[9px] uppercase tracking-[0.04em] text-paper-muted">{label}</dt>
            <dd className="font-medium tabular-nums">{value || "-"}</dd>
          </div>
        ))}
      </dl>

      {/* Billed by and to */}
      <section className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]" style={{ color: accent }}>
            {layout === "proforma" ? "Invoice By" : "Billed By"}
          </p>
          <p className="font-semibold">{company.name}</p>
          {company.address ? <p className="whitespace-pre-line text-paper-muted">{company.address}</p> : null}
          {layout !== "non-gst" && company.registration ? <p className="text-paper-muted">{gstinLine(company.registration)}</p> : null}
        </div>
        <div>
          <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]" style={{ color: accent }}>
            {layout === "proforma" ? "Invoice To" : "Billed To"}
          </p>
          {client ? (
            <>
              {layout === "non-gst" && details.bookingRef ? <p className="font-semibold">{details.bookingRef}</p> : null}
              <p className={layout === "non-gst" && details.bookingRef ? "" : "font-semibold"}>{client.name}</p>
              {client.address ? <p className="whitespace-pre-line text-paper-muted">{client.address}</p> : null}
              {layout !== "non-gst" && client.registration ? <p className="text-paper-muted">{gstinLine(client.registration)}</p> : null}
              {client.contact || client.phone ? (
                <p className="text-paper-muted">{[client.contact, client.phone].filter(Boolean).join(", ")}</p>
              ) : null}
            </>
          ) : (
            <p className="text-paper-muted">No client picked yet</p>
          )}
        </div>
      </section>

      {/* Booking details */}
      {rows.length ? (
        <section className="mt-4">
          <h3 className="mb-1.5 text-[11px] font-semibold" style={{ color: accent }}>
            Booking Details
          </h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 rounded-md bg-[#f6f7f9] px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-paper-muted">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {/* Items */}
      <section className="mt-4">
        <h3 className="mb-1.5 text-[11px] font-semibold" style={{ color: accent }}>
          {layout === "proforma" ? "Charges" : "Accommodation & Charges"}
        </h3>
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr className="border-y border-paper-ink bg-[#f3f4f6] text-left text-[9.5px] text-paper-ink">
              {layout === "proforma" ? null : <th className="w-8 px-1.5 py-1.5 font-semibold">S. No</th>}
              <th className="px-1.5 py-1.5 font-semibold">{cols.item}</th>
              {layout === "proforma" ? <th className="w-16 px-1.5 py-1.5 text-right font-semibold">{cols.rate}</th> : null}
              <th className="w-12 px-1.5 py-1.5 text-right font-semibold">{cols.qty}</th>
              <th className="w-12 px-1.5 py-1.5 text-right font-semibold">{cols.days}</th>
              {layout === "proforma" ? null : <th className="w-16 px-1.5 py-1.5 text-right font-semibold">{cols.rate}</th>}
              <th className="w-20 px-1.5 py-1.5 text-right font-semibold">{cols.amount}</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="border-b border-paper-line px-1.5 py-3 text-paper-muted">
                  No items yet
                </td>
              </tr>
            ) : (
              data.lines.map((l, i) => {
                const d = splitDescription(l);
                return (
                  <tr key={l.key} className="border-b border-paper-line align-top">
                    {layout === "proforma" ? null : <td className="px-1.5 py-1.5 text-paper-muted">{i + 1}</td>}
                    <td className="px-1.5 py-1.5">
                      <p className="font-medium">{d.name}</p>
                      {d.details ? <p className="whitespace-pre-line text-paper-muted">{d.details}</p> : null}
                      {d.stay ? <p className="text-paper-muted">{d.stay}</p> : null}
                    </td>
                    {layout === "proforma" ? <td className="px-1.5 py-1.5 text-right">{inr(l.rate)}</td> : null}
                    <td className="px-1.5 py-1.5 text-right">{l.quantity}</td>
                    <td className="px-1.5 py-1.5 text-right">{l.nights || 1}</td>
                    {layout === "proforma" ? null : <td className="px-1.5 py-1.5 text-right">{inr(l.rate)}</td>}
                    <td className="px-1.5 py-1.5 text-right font-medium">{inr(l.amount)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {/* GST table and totals */}
      <section className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {layout === "gst" ? (
          <div className="sm:w-[56%]">
            <h3 className="mb-1 text-[11px] font-semibold" style={{ color: accent }}>
              GST Calculation
            </h3>
            <table className="w-full border-collapse tabular-nums">
              <thead>
                <tr className="border-y border-paper-line text-left text-[9.5px] text-paper-muted">
                  <th className="px-1.5 py-1 font-medium">Tax Type</th>
                  <th className="px-1.5 py-1 text-right font-medium">Rate (%)</th>
                  <th className="px-1.5 py-1 text-right font-medium">Taxable (₹)</th>
                  <th className="px-1.5 py-1 text-right font-medium">GST (₹)</th>
                </tr>
              </thead>
              <tbody>
                {gstTable(data).map((g) => (
                  <tr key={g.type} className={g.taxable === null ? "font-semibold" : "border-b border-paper-line"}>
                    <td className="px-1.5 py-1">{g.type}</td>
                    <td className="px-1.5 py-1 text-right">{g.rate}</td>
                    <td className="px-1.5 py-1 text-right">{g.taxable === null ? "" : inr(g.taxable)}</td>
                    <td className="px-1.5 py-1 text-right">{inr(g.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <span className="hidden sm:block" />
        )}
        <dl className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-y-1 tabular-nums sm:ml-auto sm:w-64">
          {totalRows(data).map((r) =>
            r.strong ? (
              <div key={r.label} className="contents">
                <dt className="mt-1 border-y-2 border-paper-ink py-1.5 text-[11.5px] font-semibold">{r.label}</dt>
                <dd data-total className="mt-1 border-y-2 border-paper-ink py-1.5 text-right text-[11.5px] font-semibold">
                  {money(r.value)}
                </dd>
              </div>
            ) : (
              <div key={r.label} className="contents">
                <dt className="text-paper-muted">{r.label}</dt>
                <dd className="text-right">{money(r.value)}</dd>
              </div>
            ),
          )}
        </dl>
      </section>

      <p className="mt-3 border-t border-paper-line pt-2">
        <span className="text-paper-muted">Total in words: </span>
        <span className="font-medium">{amountInWords(Math.max(data.total, 0))}</span>
      </p>

      {/* How to pay and notes on the left, the stamp on the right. */}
      <div className="mt-4 flex items-end gap-4">
      <div className="min-w-0 flex-1">
      {layout === "proforma" ? (
        <section className="rounded-md border border-paper-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">Please proceed with the payment to the account below.</p>
            {state ? (
              <span className="rounded border border-paper-ink px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em]">
                {state}
              </span>
            ) : null}
          </div>
          {details.payBy ? (
            <p className="mt-0.5">
              Kindly pay the full amount before <span className="font-semibold">{fmtDateLong(details.payBy)}</span>.
            </p>
          ) : null}
          {company.bankDetails ? (
            <p className="mt-2 whitespace-pre-line text-paper-ink">{company.bankDetails}</p>
          ) : (
            <p className="mt-2 text-paper-muted">Add the bank details to this company in Settings.</p>
          )}
        </section>
      ) : company.bankDetails ? (
        <section>
          <p className="text-paper-muted">Bank details</p>
          <p className="whitespace-pre-line">{company.bankDetails}</p>
        </section>
      ) : null}
      {data.notes ? <p className="mt-3 whitespace-pre-wrap text-paper-muted">{data.notes}</p> : null}
      {company.terms ? <p className="mt-2 whitespace-pre-wrap text-paper-muted">{company.terms}</p> : null}
      </div>
        <div className="flex w-28 shrink-0 justify-center">
          {data.stampUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.stampUrl} alt="Company stamp" className="size-24 object-contain" />
          ) : (
            <p className="text-center text-paper-muted">For {company.name}</p>
          )}
        </div>
      </div>

      <footer className="mt-auto pt-6">
        <p className="text-center text-[9px] font-semibold text-paper-muted">
          This is an electronically generated document; no signature is required.
        </p>
      </footer>
    </article>
  );
}
