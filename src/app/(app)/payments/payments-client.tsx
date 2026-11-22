"use client";

import { useMemo, useState } from "react";
import Link from "@/components/link";
import { CompanyChip, EmptyState, Select, StatusBadge } from "@/components/ui";
import { ReportTable } from "@/components/report-table";
import { fmtDateLong, inr, round2 } from "@/lib/format";

export type PaymentRow = {
  id: string;
  paidOn: string;
  amount: number;
  mode: string;
  reference: string;
  billId: string | null;
  billNumber: string | null;
  /** The bill was cancelled after this payment, so it now counts as an advance. */
  billCancelled: boolean;
  client: string;
  company: string;
  initials: string;
  color: string;
  recordedBy: string;
};

export function PaymentsClient({
  rows,
  rangeLabel,
  filename,
}: {
  rows: PaymentRow[];
  rangeLabel: string;
  filename: string;
}) {
  const [client, setClient] = useState("");
  const [mode, setMode] = useState("");

  const clients = useMemo(() => [...new Set(rows.map((r) => r.client))].sort(), [rows]);
  const modes = useMemo(() => [...new Set(rows.map((r) => r.mode).filter(Boolean))].sort(), [rows]);
  const visible = rows.filter((r) => (!client || r.client === client) && (!mode || r.mode === mode));
  const total = round2(visible.reduce((sum, r) => sum + r.amount, 0));

  if (rows.length === 0) {
    return (
      <EmptyState title="No payments in these dates">
        Payments are recorded on each bill with Record payment. Pick other dates above to see earlier ones.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-6 md:px-6">
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
            <dd className="text-title font-semibold tracking-tight text-fg">{visible.length}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-3">
          <Select aria-label="Client" value={client} onChange={(e) => setClient(e.target.value)} className="sm:w-56">
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select aria-label="How it was paid" value={mode} onChange={(e) => setMode(e.target.value)} className="sm:w-44">
            <option value="">Any method</option>
            {modes.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </div>
      </div>

      <ReportTable
        id="payments"
        title="Payments received"
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
          { label: "Client", value: (r) => r.client },
          {
            label: "Bill",
            value: (r) => r.billNumber ?? "",
            display: (r) =>
              r.billId ? (
                <span className="inline-flex items-center gap-2">
                  <Link href={`/bills/${r.billId}`} className="text-accent tabular-nums hover:underline">
                    {r.billNumber}
                  </Link>
                  {r.billCancelled ? <StatusBadge tone="muted">Bill cancelled</StatusBadge> : null}
                </span>
              ) : (
                "Advance"
              ),
          },
          {
            label: "Company",
            value: (r) => r.company,
            display: (r) => (
              <span className="inline-flex items-center gap-2">
                <CompanyChip initials={r.initials} color={r.color} />
                <span className="hidden lg:inline">{r.company}</span>
              </span>
            ),
          },
          { label: "Method", value: (r) => r.mode },
          { label: "Reference", value: (r) => r.reference },
          { label: "Recorded by", value: (r) => r.recordedBy },
          { label: "Amount", kind: "money", value: (r) => r.amount, total },
        ]}
      />
    </div>
  );
}
