"use client";

import { useCallback, useState } from "react";
import { Button, ErrorText, Field, Input, Select, StatusBadge, Textarea, cx } from "@/components/ui";
import { useEvery } from "@/components/live";
import { ReportTable } from "@/components/report-table";
import { SidePanel } from "@/components/side-panel";
import { fmtDate, fmtDateLong, inr, round2 } from "@/lib/format";
import {
  cancelHotelPayment,
  getHotelDetail,
  recordHotelPayment,
  type HotelDetail,
} from "./actions";

export type HotelRow = {
  id: string;
  name: string;
  city: string;
  /** Cost of all the rooms owed for, past and future nights. */
  owed: number;
  /** The part of it for nights already passed. */
  owedToDate: number;
  paid: number;
  balance: number;
  /** Room-nights to be paid for that have no cost entered. */
  uncosted: number;
  lastPaid: string | null;
};

const MODES = ["Bank transfer", "UPI", "Cash", "Card", "Cheque"];

function Balance({ value }: { value: number }) {
  if (value > 0.004) return <span className="font-medium text-fg">{inr(value)}</span>;
  if (value < -0.004) return <span className="text-ok">Paid ahead {inr(-value)}</span>;
  return <span className="text-fg-3">Settled</span>;
}

export function HotelsClient({
  rows,
  hotels,
  companies,
  today,
}: {
  rows: HotelRow[];
  hotels: { id: string; name: string; city: string }[];
  companies: { id: string; name: string }[];
  today: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HotelDetail | null>(null);
  const [paying, setPaying] = useState<{ hotelId: string } | null>(null);

  const owed = round2(rows.reduce((sum, r) => sum + r.owed, 0));
  const paid = round2(rows.reduce((sum, r) => sum + r.paid, 0));
  const balance = round2(rows.reduce((sum, r) => sum + r.balance, 0));
  const open = rows.find((r) => r.id === openId) ?? null;

  const loadDetail = useCallback(async (id: string) => {
    const result = await getHotelDetail(id);
    if (result.ok) setDetail(result.data);
  }, []);
  const reloadOpen = useCallback(() => {
    if (openId) void loadDetail(openId);
  }, [openId, loadDetail]);
  useEvery(15, reloadOpen);

  function openHotel(id: string) {
    setPaying(null);
    setDetail(null);
    setOpenId(id);
    void loadDetail(id);
  }

  const payButton = (hotelId = "") => (
    <Button
      variant="primary"
      onClick={() => {
        setOpenId(null);
        setPaying({ hotelId });
      }}
    >
      Record payment to hotel
    </Button>
  );

  return (
    <div className={cx("space-y-4 px-4 py-4 pb-6 transition-[padding] duration-150 md:px-6", (open || paying) && "lg:pr-[444px]")}>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
          <p className="text-body font-semibold text-fg">Nothing owed to hotels yet</p>
          <p className="mx-auto mt-1 max-w-md text-body text-fg-2">
            What you owe a hotel is worked out from the rooms you hold there and their cost, which you enter on the
            Inventory screen. Each block says whether the hotel is paid for every room held or only for rooms sold.
          </p>
          <div className="mt-4 flex justify-center">{hotels.length ? payButton() : null}</div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <dl className="flex flex-wrap gap-6 tabular-nums">
              <div>
                <dt className="text-ui text-fg-3">Cost of rooms</dt>
                <dd className="text-title font-semibold tracking-tight text-fg">{inr(owed)}</dd>
              </div>
              <div>
                <dt className="text-ui text-fg-3">Paid to hotels</dt>
                <dd className="text-title font-semibold tracking-tight text-fg">{inr(paid)}</dd>
              </div>
              <div>
                <dt className="text-ui text-fg-3">Still to pay</dt>
                <dd data-total className="text-title font-semibold tracking-tight text-fg">
                  {inr(balance)}
                </dd>
              </div>
            </dl>
            {payButton()}
          </div>

          <ReportTable
            id="hotel-payables"
            title="What you owe each hotel"
            note="Cost of every room you pay for, including nights still to come. Pick a hotel to see how it is made up and its payments."
            rows={rows}
            rowKey={(r) => r.id}
            filename={`owed-to-hotels-${today}.csv`}
            empty="Nothing owed."
            columns={[
              {
                label: "Hotel",
                value: (r) => r.name,
                display: (r) => (
                  <button
                    type="button"
                    data-open-hotel={r.id}
                    onClick={() => openHotel(r.id)}
                    className="text-left font-medium text-accent hover:underline"
                  >
                    {r.name}
                    {r.city ? <span className="ml-1.5 font-normal text-fg-3">{r.city}</span> : null}
                  </button>
                ),
              },
              { label: "Cost of rooms", kind: "money", value: (r) => r.owed, total: owed },
              { label: "For nights passed", kind: "money", value: (r) => r.owedToDate },
              { label: "Paid", kind: "money", value: (r) => r.paid, total: paid },
              {
                label: "Still to pay",
                kind: "money",
                value: (r) => r.balance,
                display: (r) => (
                  <span className="inline-flex items-center gap-2">
                    {r.uncosted > 0 ? (
                      <StatusBadge tone="warn">
                        {r.uncosted} room-night{r.uncosted === 1 ? "" : "s"} without a cost
                      </StatusBadge>
                    ) : null}
                    <Balance value={r.balance} />
                  </span>
                ),
                total: balance,
              },
              { label: "Last paid", value: (r) => r.lastPaid ?? "", display: (r) => (r.lastPaid ? fmtDate(r.lastPaid) : "") },
            ]}
          />
        </>
      )}

      {paying ? (
        <HotelPaymentForm
          hotels={hotels}
          companies={companies}
          today={today}
          initialHotelId={paying.hotelId}
          onClose={() => {
            const back = paying.hotelId;
            setPaying(null);
            if (back) openHotel(back);
          }}
          onSaved={(hotelId) => {
            setPaying(null);
            openHotel(hotelId);
          }}
        />
      ) : open ? (
        <HotelPanel
          key={open.id}
          hotel={open}
          detail={detail}
          onClose={() => setOpenId(null)}
          onPay={() => {
            setOpenId(null);
            setPaying({ hotelId: open.id });
          }}
          onChanged={() => loadDetail(open.id)}
        />
      ) : null}
    </div>
  );
}

function HotelPanel({
  hotel,
  detail,
  onClose,
  onPay,
  onChanged,
}: {
  hotel: HotelRow;
  detail: HotelDetail | null;
  onClose: () => void;
  onPay: () => void;
  onChanged: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function cancel(id: string) {
    setPending(true);
    setError("");
    const result = await cancelHotelPayment(id);
    setPending(false);
    setConfirming(null);
    if (!result.ok) return setError(result.error);
    await onChanged();
  }

  return (
    <SidePanel
      title={hotel.name}
      subtitle={hotel.city}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onPay}>
          Record payment
        </Button>
      }
    >
      <div className="grid grid-cols-3 border-b border-line">
        {(
          [
            ["Cost", hotel.owed],
            ["Paid", hotel.paid],
            ["Still to pay", hotel.balance],
          ] as const
        ).map(([label, value], i) => (
          <div key={label} className={cx("px-4 py-3 md:px-5", i < 2 && "border-r border-line")}>
            <p className="text-ui text-fg-3">{label}</p>
            <p className="text-body font-semibold text-fg tabular-nums">{inr(value)}</p>
          </div>
        ))}
      </div>

      <section className="border-b border-line px-4 py-4 md:px-5">
        <h3 className="text-ui font-medium text-fg-3">How the cost is made up</h3>
        {!detail ? (
          <div aria-hidden className="mt-2 h-10 rounded-md bg-sunken" />
        ) : detail.rooms.length === 0 ? (
          <p className="mt-1 text-body text-fg-2">No rooms held at this hotel.</p>
        ) : (
          <ul data-room-costs className="mt-1 divide-y divide-line">
            {detail.rooms.map((r) => (
              <li key={r.roomTypeId} className="flex items-baseline gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body text-fg">{r.room}</p>
                  <p className="text-ui text-fg-3 tabular-nums">
                    {fmtDate(r.firstNight)} to {fmtDateLong(r.lastNight)}
                    {r.uncosted > 0 ? `, ${r.uncosted} room-nights without a cost` : ""}
                  </p>
                </div>
                <span className="text-body font-medium text-fg tabular-nums">{inr(r.owed)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-ui text-fg-3">
          Rooms paid for whether sold or not cost every room held. Rooms paid for only when sold cost the rooms sold.
          Change this on each block in Inventory.
        </p>
      </section>

      <section className="px-4 py-4 md:px-5">
        <h3 className="text-ui font-medium text-fg-3">Payments to this hotel</h3>
        {!detail ? null : detail.payments.length === 0 ? (
          <p className="mt-1 text-body text-fg-2">None recorded yet.</p>
        ) : (
          <ul data-hotel-payments className="mt-1 divide-y divide-line">
            {detail.payments.map((p) => (
              <li key={p.id} className="py-2">
                <div className="flex items-baseline gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-body text-fg tabular-nums">{fmtDateLong(p.paidOn)}</p>
                    <p className="text-ui text-fg-3">
                      {[p.mode, p.reference, p.company && `paid by ${p.company}`, p.notes].filter(Boolean).join(", ") ||
                        "No details"}
                    </p>
                  </div>
                  <span className={cx("text-body font-medium tabular-nums", p.cancelled && "text-fg-3 line-through")}>
                    {inr(p.amount)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-ui">
                  {p.recordedBy ? <span className="text-fg-3">Recorded by {p.recordedBy}</span> : null}
                  {p.cancelled ? (
                    <StatusBadge tone="muted">Cancelled</StatusBadge>
                  ) : confirming === p.id ? (
                    <>
                      <span className="text-fg-2">Cancel this payment?</span>
                      <Button variant="ghost" className="h-8 px-2 md:h-8" onClick={() => setConfirming(null)} disabled={pending}>
                        Keep
                      </Button>
                      <Button className="h-8 px-2 md:h-8" onClick={() => cancel(p.id)} disabled={pending}>
                        Yes, cancel it
                      </Button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirming(p.id)} className="text-fg-3 hover:text-fg">
                      Cancel payment
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </section>
    </SidePanel>
  );
}

function HotelPaymentForm({
  hotels,
  companies,
  today,
  initialHotelId,
  onClose,
  onSaved,
}: {
  hotels: { id: string; name: string; city: string }[];
  companies: { id: string; name: string }[];
  today: string;
  initialHotelId: string;
  onClose: () => void;
  onSaved: (hotelId: string) => void;
}) {
  const [hotelId, setHotelId] = useState(initialHotelId);
  const [companyId, setCompanyId] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState(MODES[0]);
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await recordHotelPayment({
      hotelId,
      companyId,
      amount: amount === "" ? NaN : Number(amount),
      paidOn,
      mode,
      reference,
      notes,
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onSaved(hotelId);
  }

  return (
    <SidePanel
      title="Record payment to hotel"
      subtitle="Money you paid a hotel for rooms."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="hotel-payment-form" disabled={pending}>
            {pending ? "Saving" : "Save payment"}
          </Button>
        </>
      }
    >
      <form id="hotel-payment-form" onSubmit={submit} className="flex flex-col gap-4 p-4 md:p-5">
        <Field label="Hotel" htmlFor="hp-hotel">
          <Select id="hp-hotel" value={hotelId} onChange={(e) => setHotelId(e.target.value)}>
            <option value="">Pick a hotel</option>
            {hotels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.city ? `${h.name}, ${h.city}` : h.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount paid" htmlFor="hp-amount">
          <Input
            id="hp-amount"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={amount}
            autoFocus
            onChange={(e) => setAmount(e.target.value)}
            className="tabular-nums"
          />
        </Field>
        <Field label="How it was paid" htmlFor="hp-mode">
          <Select id="hp-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date paid" htmlFor="hp-date">
          <Input id="hp-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label="Paid by" htmlFor="hp-company" hint="Optional. Which of your companies paid.">
          <Select id="hp-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">Not recorded</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" htmlFor="hp-ref" hint="Optional. UTR, cheque number or similar.">
          <Input id="hp-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="hp-notes" hint="Optional. For example which stay this covers.">
          <Textarea id="hp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
      </form>
    </SidePanel>
  );
}
