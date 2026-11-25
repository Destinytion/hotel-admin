"use client";

import { useState } from "react";
import Link from "@/components/link";
import { CompanyChip, EmptyState, PageHeader, StatusBadge, cx } from "@/components/ui";
import { billState } from "@/lib/bill-state";
import { fmtDateLong, inr } from "@/lib/format";

export type BillRow = {
  id: string;
  number: string | null;
  status: "draft" | "final" | "cancelled";
  isSale: boolean;
  /** A quotation or proforma replaced by a revised one. */
  revised: boolean;
  billDate: string;
  total: number;
  paid: number;
  title: string;
  client: string;
  company: string;
  initials: string;
  color: string;
  /** Who started this bill. */
  madeBy: string;
};

const FILTERS = ["all", "draft", "final", "cancelled"] as const;
const FILTER_LABEL = { all: "All", draft: "Drafts", final: "Finalised", cancelled: "Cancelled or declined" };

const hrefFor = (row: BillRow) =>
  row.status === "draft" ? `/bill-generator?bill=${row.id}` : `/bills/${row.id}`;

const newBillLink =
  "inline-flex h-11 items-center rounded-md bg-ink px-3 text-body font-medium text-on-ink transition-colors duration-150 hover:bg-ink-hover md:h-9";

export function BillsClient({ rows }: { rows: BillRow[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const visible = rows.filter((r) => filter === "all" || r.status === filter);

  return (
    <>
      <PageHeader
        title="Bills"
        description={rows.length === 1 ? "1 bill" : `${rows.length} bills`}
        actions={
          <Link href="/bill-generator" className={newBillLink}>
            New bill
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No bills yet"
          action={
            <Link href="/bill-generator" className={newBillLink}>
              New bill
            </Link>
          }
        >
          Drafts, finalised bills and quotations from all your companies are listed here.
        </EmptyState>
      ) : (
        <>
          <div className="px-4 py-3 md:px-6">
            <div role="group" aria-label="Status" className="inline-flex rounded-md border border-line p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cx(
                    "h-10 rounded-md px-2.5 text-ui font-medium transition-colors duration-150 md:h-8",
                    filter === f ? "bg-sunken text-fg" : "text-fg-3 hover:text-fg",
                  )}
                >
                  {FILTER_LABEL[f]}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState title="Nothing with this status">Pick another status above.</EmptyState>
          ) : (
            <>
              <table className="hidden w-full border-collapse md:table">
                <thead>
                  <tr className="border-y border-line bg-canvas text-left text-ui text-fg-3">
                    <th className="px-6 py-2 font-medium">Number</th>
                    <th className="px-3 py-2 font-medium">Client</th>
                    <th className="px-3 py-2 font-medium">Format</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Made by</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-6 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const state = billState(r);
                    return (
                      <tr key={r.id} className="h-10 border-b border-line text-body transition-colors duration-150 hover:bg-sunken">
                        <td className="px-6">
                          <Link href={hrefFor(r)} className="flex items-center gap-2 font-medium text-fg hover:underline">
                            <CompanyChip initials={r.initials} color={r.color} />
                            <span className="tabular-nums">{r.number ?? "Draft"}</span>
                          </Link>
                        </td>
                        <td className="px-3 text-fg-2">{r.client}</td>
                        <td className="px-3 text-fg-2">{r.title}</td>
                        <td className="px-3 text-fg-2 tabular-nums">{fmtDateLong(r.billDate)}</td>
                        <td className="px-3 text-fg-2">{r.madeBy}</td>
                        <td className="px-3">
                          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                        </td>
                        <td className={cx("px-6 text-right font-medium tabular-nums", r.status === "cancelled" ? "text-fg-3 line-through" : "text-fg")}>
                          {inr(r.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <ul className="divide-y divide-line border-y border-line md:hidden">
                {visible.map((r) => {
                  const state = billState(r);
                  return (
                    <li key={r.id}>
                      <Link href={hrefFor(r)} className="flex items-center gap-3 px-4 py-3">
                        <CompanyChip initials={r.initials} color={r.color} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body font-medium text-fg">{r.client}</p>
                          <p className="truncate text-ui text-fg-3 tabular-nums">
                            {r.number ?? "Draft"}, {fmtDateLong(r.billDate)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-body font-medium text-fg tabular-nums">{inr(r.total)}</p>
                          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}
