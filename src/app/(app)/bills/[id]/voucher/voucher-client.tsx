"use client";

import { useState } from "react";
import Link from "@/components/link";
import { Button, CompanyChip, ErrorText, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { WhatsAppButton } from "@/components/share";
import type { PaperData } from "@/components/bill-paper";
import { fmtDate, fmtDateLong } from "@/lib/format";
import { saveVoucher, type Voucher } from "../../actions";

export type VoucherLine = {
  id: string;
  title: string;
  details: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
};

/*
  A booking voucher: what the guest shows at the hotel, or what is sent to the
  hotel to confirm the booking. It never shows prices.
*/
export function VoucherClient({
  billId,
  billNumber,
  billDate,
  dateLabel,
  cancelled,
  company,
  client,
  phone,
  rooms,
  services,
  initial,
}: {
  billId: string;
  billNumber: string;
  billDate: string;
  dateLabel: string;
  cancelled: boolean;
  company: PaperData["company"];
  client: NonNullable<PaperData["client"]>;
  phone: string;
  rooms: VoucherLine[];
  services: { id: string; title: string; quantity: number }[];
  initial: Voucher;
}) {
  const [voucher, setVoucher] = useState<Voucher>(initial);
  const [savedAs, setSavedAs] = useState(JSON.stringify(initial));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const dirty = JSON.stringify(voucher) !== savedAs;

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    setPending(true);
    setError("");
    const result = await saveVoucher(billId, voucher);
    setPending(false);
    if (!result.ok) return setError(result.error);
    setSavedAs(JSON.stringify(voucher));
  }

  const guests = voucher.guests
    .split("\n")
    .map((g) => g.trim())
    .filter(Boolean);

  const message = [
    `Booking confirmation ${billNumber}`,
    guests.length ? `Guest${guests.length > 1 ? "s" : ""}: ${guests.join(", ")}` : "",
    "",
    ...rooms.map((r) =>
      [
        r.title,
        `${fmtDateLong(r.checkIn)} to ${fmtDateLong(r.checkOut)}, ${r.nights} night${r.nights > 1 ? "s" : ""}, ${r.rooms} room${r.rooms > 1 ? "s" : ""}`,
        voucher.confirmations[r.id] ? `Confirmation no. ${voucher.confirmations[r.id]}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    services.length ? `\nAlso included: ${services.map((s) => s.title).join(", ")}` : "",
    voucher.requests ? `\nRequests: ${voucher.requests}` : "",
    "",
    company.name,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Voucher ${billNumber}`}
          description={`For ${client.name}. No prices are shown on a voucher.`}
          actions={
            <>
              <Button onClick={() => window.print()}>Print</Button>
              <WhatsAppButton phone={phone} text={message} />
            </>
          }
        />
      </div>

      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <form
          id="voucher-form"
          onSubmit={save}
          className="flex flex-col gap-4 border-line p-4 md:p-6 lg:border-r print:hidden"
        >
          <p>
            <Link href={`/bills/${billId}`} className="text-ui text-accent hover:underline">
              Back to the bill
            </Link>
          </p>
          <Field label="Guest names" htmlFor="v-guests" hint="One name per line.">
            <Textarea
              id="v-guests"
              rows={4}
              value={voucher.guests}
              onChange={(e) => setVoucher({ ...voucher, guests: e.target.value })}
            />
          </Field>
          {rooms.length ? (
            <p className="-mb-2 text-ui font-medium text-fg-2">Hotel confirmation numbers, if you have them</p>
          ) : null}
          {rooms.map((r) => (
            <Field key={r.id} label={r.title} htmlFor={`v-conf-${r.id}`}>
              <Input
                id={`v-conf-${r.id}`}
                value={voucher.confirmations[r.id] ?? ""}
                onChange={(e) =>
                  setVoucher({ ...voucher, confirmations: { ...voucher.confirmations, [r.id]: e.target.value } })
                }
              />
            </Field>
          ))}
          <Field label="Requests for the hotel" htmlFor="v-requests" hint="For example early check-in or twin beds.">
            <Textarea
              id="v-requests"
              rows={3}
              value={voucher.requests}
              onChange={(e) => setVoucher({ ...voucher, requests: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button variant="primary" type="submit" disabled={pending || !dirty}>
              {pending ? "Saving" : "Save voucher"}
            </Button>
            {!dirty && !pending ? <span className="text-ui text-fg-3">Saved</span> : null}
          </div>
          <ErrorText>{error}</ErrorText>
        </form>

        <div className="bg-canvas p-4 md:p-6 print:bg-paper print:p-0">
          <article
            aria-label="Voucher preview"
            className="relative mx-auto flex w-full max-w-[620px] flex-col border border-paper-line bg-paper p-6 text-[11px] leading-[16px] text-paper-ink sm:p-9 print:max-w-none print:border-0 print:p-0"
          >
            {cancelled ? (
              <p className="absolute right-6 top-24 rotate-[-8deg] border-2 border-bad px-3 py-1 text-[18px] font-semibold uppercase tracking-[0.12em] text-bad sm:right-9">
                Cancelled
              </p>
            ) : null}
            <header className="flex items-start justify-between gap-6 border-b border-paper-line pb-5">
              <div className="flex gap-3">
                <CompanyChip initials={company.initials} color={company.color} size={36} />
                <div>
                  <p className="text-[15px] font-semibold leading-[20px]">{company.name}</p>
                  {company.address ? <p className="whitespace-pre-line text-paper-muted">{company.address}</p> : null}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[13px] font-semibold uppercase tracking-[0.08em]">Booking voucher</p>
                <p className="text-paper-muted">{billNumber}</p>
                <p className="text-paper-muted" data-date={billDate}>
                  {dateLabel}
                </p>
              </div>
            </header>

            <section className="grid grid-cols-2 gap-6 py-5">
              <div>
                <p className="text-paper-muted">Booked for</p>
                <p className="text-[13px] font-semibold leading-[18px]">{client.name}</p>
                {client.contact || client.phone ? (
                  <p className="text-paper-muted">{[client.contact, client.phone].filter(Boolean).join(", ")}</p>
                ) : null}
              </div>
              <div>
                <p className="text-paper-muted">Guests</p>
                {guests.length ? (
                  <ul data-voucher-guests>
                    {guests.map((g, i) => (
                      <li key={i} className="font-medium">
                        {g}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-paper-muted">To be advised</p>
                )}
              </div>
            </section>

            <table className="w-full border-collapse tabular-nums">
              <thead>
                <tr className="border-y border-paper-line text-left text-paper-muted">
                  <th className="py-1.5 pr-2 font-medium">Hotel and room</th>
                  <th className="w-16 py-1.5 font-medium">Check-in</th>
                  <th className="w-16 py-1.5 font-medium">Check-out</th>
                  <th className="w-12 py-1.5 text-right font-medium">Nights</th>
                  <th className="w-12 py-1.5 text-right font-medium">Rooms</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id} className="border-b border-paper-line align-top">
                    <td className="py-2 pr-2">
                      <p className="font-medium">{r.title}</p>
                      {r.details ? <p className="whitespace-pre-line text-paper-muted">{r.details}</p> : null}
                      {voucher.confirmations[r.id] ? (
                        <p className="text-paper-muted">Confirmation no. {voucher.confirmations[r.id]}</p>
                      ) : null}
                    </td>
                    <td className="py-2">{fmtDate(r.checkIn)}</td>
                    <td className="py-2">{fmtDate(r.checkOut)}</td>
                    <td className="py-2 text-right">{r.nights}</td>
                    <td className="py-2 text-right">{r.rooms}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {services.length ? (
              <section className="mt-5">
                <p className="text-paper-muted">Also included</p>
                <ul className="list-disc pl-4">
                  {services.map((s) => (
                    <li key={s.id}>
                      {s.title}
                      {s.quantity !== 1 ? ` x ${s.quantity}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {voucher.requests ? (
              <section className="mt-5">
                <p className="text-paper-muted">Requests</p>
                <p className="whitespace-pre-wrap">{voucher.requests}</p>
              </section>
            ) : null}

            <footer className="mt-10 flex items-end justify-between gap-6">
              <p className="max-w-[60%] text-paper-muted">
                Please show this voucher at check-in. Requests are subject to availability at the hotel.
              </p>
              <div className="shrink-0 text-right">
                <p>For {company.name}</p>
                <p className="mt-8 text-paper-muted">Authorised signatory</p>
              </div>
            </footer>
          </article>
        </div>
      </div>
    </>
  );
}
