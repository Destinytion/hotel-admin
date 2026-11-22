"use client";

import { useMemo, useState } from "react";
import Link from "@/components/link";
import {
  Button,
  CompanyChip,
  ErrorText,
  Field,
  Input,
  Select,
  StatusBadge,
  Textarea,
  cx,
} from "@/components/ui";
import { ReportTable } from "@/components/report-table";
import { ReceiptLink } from "@/components/receipt-link";
import { ShareReceipt, receiptMessage } from "@/components/share";
import { SidePanel } from "@/components/side-panel";
import { fmtDateLong, inr, round2 } from "@/lib/format";
import { cancelPayment, recordAdvance } from "./actions";

export type PaymentRow = {
  id: string;
  paidOn: string;
  amount: number;
  mode: string;
  reference: string;
  notes: string;
  advance: boolean;
  cancelled: boolean;
  receiptNumber: string | null;
  billId: string | null;
  billNumber: string | null;
  /** The bill was cancelled after this payment, so it now counts as credit. */
  billCancelled: boolean;
  client: string;
  /** The client's main phone, for sending the receipt. */
  phone: string;
  company: string;
  initials: string;
  color: string;
  recordedBy: string;
  /** For an advance: how much has been used on bills, and which bills. */
  used: number;
  usedOn: { id: string; number: string }[];
};

const MODES = ["Bank transfer", "UPI", "Cash", "Card", "Cheque"];
const TYPES = [
  { key: "", label: "Payments and advances" },
  { key: "payment", label: "Payments on bills" },
  { key: "advance", label: "Advances" },
];

function CancelPayment({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (confirming) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Button variant="ghost" className="h-8 px-2 md:h-8" onClick={() => setConfirming(false)} disabled={pending}>
          Keep
        </Button>
        <Button
          className="h-8 px-2 md:h-8"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const result = await cancelPayment(id);
            setPending(false);
            setConfirming(false);
            if (!result.ok) setError(result.error);
          }}
        >
          Yes, cancel it
        </Button>
        {error ? <span className="text-ui text-bad">{error}</span> : null}
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setConfirming(true)} className="text-ui text-fg-3 hover:text-fg">
      Cancel
    </button>
  );
}

export function PaymentsClient({
  rows,
  rangeLabel,
  filename,
  companies,
  clients,
  today,
  advanceFor,
  openAdvance,
}: {
  rows: PaymentRow[];
  rangeLabel: string;
  filename: string;
  companies: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  today: string;
  /** The client to record an advance from, if one was picked before coming here. */
  advanceFor: string;
  /** Opens the advance form straight away. */
  openAdvance: boolean;
}) {
  const [client, setClient] = useState("");
  const [mode, setMode] = useState("");
  const [type, setType] = useState("");
  const [form, setForm] = useState(
    openAdvance ? { clientId: advanceFor } : (null as null | { clientId: string }),
  );
  const [created, setCreated] = useState<{ id: string; receiptNumber: string } | null>(null);

  const clientNames = useMemo(() => [...new Set(rows.map((r) => r.client))].sort(), [rows]);
  const modes = useMemo(() => [...new Set(rows.map((r) => r.mode).filter(Boolean))].sort(), [rows]);
  const visible = rows.filter(
    (r) =>
      (!client || r.client === client) &&
      (!mode || r.mode === mode) &&
      (!type || (type === "advance") === r.advance),
  );
  const counted = visible.filter((r) => !r.cancelled);
  const total = round2(counted.reduce((sum, r) => sum + r.amount, 0));

  const advanceButton = (
    <Button
      variant="primary"
      onClick={() => {
        setCreated(null);
        setForm({ clientId: "" });
      }}
    >
      Record advance
    </Button>
  );

  return (
    <div className="space-y-4 px-4 pb-6 md:px-6">
      {created ? (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-ok-soft px-3 py-2 text-body text-fg">
          Advance recorded with receipt {created.receiptNumber}.
          <ReceiptLink paymentId={created.id} receiptNumber="Download receipt" />
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
          <p className="text-body font-semibold text-fg">No payments in these dates</p>
          <p className="mx-auto mt-1 max-w-md text-body text-fg-2">
            Payments on bills are recorded on each bill with Record payment. Money taken before a bill exists is an
            advance. Pick other dates above to see earlier payments.
          </p>
          <div className="mt-4 flex justify-center">{advanceButton}</div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <dl className="flex gap-6 tabular-nums">
              <div>
                <dt className="text-ui text-fg-3">Received, {rangeLabel.toLowerCase()}</dt>
                <dd data-total className="text-title font-semibold tracking-tight text-fg">
                  {inr(total)}
                </dd>
              </div>
              <div>
                <dt className="text-ui text-fg-3">Payments</dt>
                <dd className="text-title font-semibold tracking-tight text-fg">{counted.length}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-3">
              <Select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)} className="sm:w-52">
                <option value="">All clients</option>
                {clientNames.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
              <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="sm:w-52">
                {TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Select aria-label="How it was paid" value={mode} onChange={(e) => setMode(e.target.value)} className="sm:w-40">
                <option value="">Any method</option>
                {modes.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
              {advanceButton}
            </div>
          </div>

          <ReportTable
            id="payments"
            title="Payments received"
            note="Cancelled payments are listed but not added up."
            rows={visible}
            rowKey={(r) => r.id}
            filename={filename}
            empty="No payments match these filters."
            columns={[
              {
                label: "Date",
                value: (r) => r.paidOn,
                display: (r) => <span className="tabular-nums">{fmtDateLong(r.paidOn)}</span>,
              },
              {
                label: "Receipt",
                value: (r) => r.receiptNumber ?? "",
                display: (r) => (
                  <span className="inline-flex flex-wrap items-center gap-x-3">
                    <ReceiptLink paymentId={r.id} receiptNumber={r.receiptNumber} />
                    {r.cancelled ? null : (
                      <ShareReceipt
                        paymentId={r.id}
                        receiptNumber={r.receiptNumber}
                        phone={r.phone}
                        text={receiptMessage({ client: r.client, company: r.company }, r)}
                      />
                    )}
                  </span>
                ),
              },
              { label: "Client", value: (r) => r.client },
              {
                label: "For",
                value: (r) =>
                  r.billNumber
                    ? r.billNumber
                    : r.advance
                      ? ["Advance", ...r.usedOn.map((u) => u.number)].join(" ")
                      : "",
                display: (r) => (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {r.billId ? (
                      <Link href={`/bills/${r.billId}`} className="text-accent tabular-nums hover:underline">
                        {r.billNumber}
                      </Link>
                    ) : null}
                    {r.advance && r.used === 0 ? <span>Advance, not yet used</span> : null}
                    {r.advance && r.used > 0 ? (
                      <>
                        <span>Advance, used on</span>
                        {r.usedOn.map((u, i) => (
                          <Link key={i} href={`/bills/${u.id}`} className="text-accent tabular-nums hover:underline">
                            {u.number}
                          </Link>
                        ))}
                        {r.amount - r.used > 0.004 ? (
                          <StatusBadge tone="muted">{inr(round2(r.amount - r.used))} left</StatusBadge>
                        ) : null}
                      </>
                    ) : null}
                    {r.billCancelled ? <StatusBadge tone="muted">Bill cancelled</StatusBadge> : null}
                  </span>
                ),
              },
              {
                label: "Company",
                value: (r) => r.company,
                display: (r) => (
                  <span className="inline-flex items-center gap-2">
                    <CompanyChip initials={r.initials} color={r.color} />
                    <span className="hidden xl:inline">{r.company}</span>
                  </span>
                ),
              },
              { label: "Method", value: (r) => r.mode },
              { label: "Reference", value: (r) => r.reference },
              { label: "Recorded by", value: (r) => r.recordedBy },
              {
                label: "Status",
                value: (r) => (r.cancelled ? "Cancelled" : "Received"),
                display: (r) => (r.cancelled ? <StatusBadge tone="bad">Cancelled</StatusBadge> : <CancelPayment id={r.id} />),
              },
              {
                label: "Amount",
                kind: "money",
                value: (r) => (r.cancelled ? 0 : r.amount),
                display: (r) => (
                  <span className={cx(r.cancelled && "text-fg-3 line-through")}>{inr(r.amount)}</span>
                ),
                total,
              },
            ]}
          />
        </>
      )}

      {form ? (
        <AdvanceForm
          companies={companies}
          clients={clients}
          today={today}
          initialClientId={form.clientId}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            setForm(null);
            setCreated(saved);
          }}
        />
      ) : null}
    </div>
  );
}

function AdvanceForm({
  companies,
  clients,
  today,
  initialClientId,
  onClose,
  onSaved,
}: {
  companies: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  today: string;
  initialClientId: string;
  onClose: () => void;
  onSaved: (saved: { id: string; receiptNumber: string }) => void;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [clientId, setClientId] = useState(initialClientId);
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
    const result = await recordAdvance({
      companyId,
      clientId,
      amount: amount === "" ? NaN : Number(amount),
      mode,
      paidOn,
      reference,
      notes,
    });
    setPending(false);
    if (!result.ok) return setError(result.error);
    onSaved(result.data);
  }

  return (
    <SidePanel
      title="Record advance"
      subtitle="Money received before there is a bill. It gets its own receipt and can be used on a bill later."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="advance-form" disabled={pending}>
            {pending ? "Saving" : "Save and make receipt"}
          </Button>
        </>
      }
    >
      {companies.length === 0 || clients.length === 0 ? (
        <p className="p-4 text-body text-fg-2 md:p-5">
          Add {companies.length === 0 ? "a company in Settings" : "a client"} first.
        </p>
      ) : (
        <form id="advance-form" onSubmit={submit} className="flex flex-col gap-4 p-4 md:p-5">
          <Field label="Received by" htmlFor="adv-company" hint="The company whose receipt this is.">
            <Select id="adv-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Received from" htmlFor="adv-client">
            <Select id="adv-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Pick a client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount received" htmlFor="adv-amount">
            <Input
              id="adv-amount"
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
          <Field label="How it was paid" htmlFor="adv-mode">
            <Select id="adv-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date received" htmlFor="adv-date">
            <Input id="adv-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <Field label="Reference" htmlFor="adv-ref" hint="Optional. UTR, cheque number or similar.">
            <Input id="adv-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="What it is for" htmlFor="adv-notes" hint="Printed on the receipt, for example the booking it is for.">
            <Textarea id="adv-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
        </form>
      )}
    </SidePanel>
  );
}
