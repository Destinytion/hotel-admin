"use client";

import { useState } from "react";
import { cx } from "@/components/ui";
import { ReportTable } from "@/components/report-table";
import { fmtDateLong, inr, round2 } from "@/lib/format";

export type ReportData = {
  byMonth: { month: string; bills: number; subtotal: number; tax: number; total: number }[];
  byClient: { id: string; name: string; bills: number; total: number; received: number }[];
  byCompany: { id: string; name: string; bills: number; subtotal: number; tax: number; total: number }[];
  cancelled: { bills: number; total: number };
  outstanding: {
    id: string;
    name: string;
    d0: number;
    d31: number;
    d61: number;
    d90: number;
    credit: number;
    oldest: string | null;
  }[];
  inventory: {
    id: string;
    hotel: string;
    city: string;
    room: string;
    held: number;
    soldAll: number;
    sold: number;
    revenue: number;
    costOfSold: number | null;
  }[];
};

const TABS = [
  { key: "sales", label: "Sales" },
  { key: "owed", label: "Owed" },
  { key: "inventory", label: "Inventory" },
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const sum = <T,>(rows: T[], pick: (r: T) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));

export function ReportsClient({
  data,
  period,
  today,
  companyName,
  rangeSlug,
  companySlug,
}: {
  data: ReportData;
  /** "in this financial year" or "from 01 Nov 2026 to 30 Nov 2026" */
  period: string;
  today: string;
  companyName: string;
  rangeSlug: string;
  companySlug: string;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("sales");
  const scope = companyName || "both companies";

  return (
    <div className="space-y-4 px-4 pb-6 md:px-6">
      <div role="tablist" aria-label="Report" className="inline-flex rounded-md border border-line p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              "h-10 rounded-md px-3 text-ui font-medium transition-colors duration-150 md:h-8",
              tab === t.key ? "bg-sunken text-fg" : "text-fg-3 hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "sales" ? <Sales data={data} period={period} scope={scope} slug={rangeSlug} /> : null}
      {tab === "owed" ? <Owed data={data} today={today} scope={scope} slug={`${today}${companySlug}`} /> : null}
      {tab === "inventory" ? (
        <Inventory data={data} period={period} companyName={companyName} slug={rangeSlug} />
      ) : null}
    </div>
  );
}

function Figures({ items }: { items: [string, string][] }) {
  return (
    <dl data-figures className="flex flex-wrap gap-x-8 gap-y-3 tabular-nums">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-ui text-fg-3">{label}</dt>
          <dd className="text-title font-semibold tracking-tight text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Sales({ data, period, scope, slug }: { data: ReportData; period: string; scope: string; slug: string }) {
  const bills = data.byMonth.reduce((s, r) => s + r.bills, 0);
  const subtotal = sum(data.byMonth, (r) => r.subtotal);
  const tax = sum(data.byMonth, (r) => r.tax);
  const total = sum(data.byMonth, (r) => r.total);
  const received = sum(data.byClient, (r) => r.received);

  return (
    <div className="space-y-4">
      <p className="text-ui text-fg-2">
        Finalised bills dated {period}, for {scope}. Drafts, quotations and cancelled bills are left out.
      </p>
      <Figures
        items={[
          ["Bills", bills.toLocaleString("en-IN")],
          ["Before tax", inr(subtotal)],
          ["Tax", inr(tax)],
          ["Total billed", inr(total)],
          ["Received on these bills", inr(received)],
        ]}
      />
      {data.cancelled.bills ? (
        <p className="text-ui text-fg-3">
          Not counted: {data.cancelled.bills} cancelled {data.cancelled.bills === 1 ? "bill" : "bills"} worth{" "}
          {inr(data.cancelled.total)}.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <ReportTable
          id="sales-month"
          title="By month"
          rows={data.byMonth}
          rowKey={(r) => r.month}
          filename={`sales-by-month-${slug}.csv`}
          empty="No sales in these dates."
          columns={[
            { label: "Month", value: (r) => monthName(r.month) },
            { label: "Bills", kind: "count", value: (r) => r.bills, total: bills },
            { label: "Before tax", kind: "money", value: (r) => r.subtotal, total: subtotal },
            { label: "Tax", kind: "money", value: (r) => r.tax, total: tax },
            { label: "Total", kind: "money", value: (r) => r.total, total },
          ]}
        />
        <ReportTable
          id="sales-company"
          title="By company"
          rows={data.byCompany}
          rowKey={(r) => r.id}
          filename={`sales-by-company-${slug}.csv`}
          empty="No sales in these dates."
          columns={[
            { label: "Company", value: (r) => r.name },
            { label: "Bills", kind: "count", value: (r) => r.bills, total: bills },
            { label: "Before tax", kind: "money", value: (r) => r.subtotal, total: subtotal },
            { label: "Tax", kind: "money", value: (r) => r.tax, total: tax },
            { label: "Total", kind: "money", value: (r) => r.total, total },
          ]}
        />
      </div>

      <ReportTable
        id="sales-client"
        title="By client"
        note="Received and still owed are for these bills only, whenever the money came in."
        rows={data.byClient}
        rowKey={(r) => r.id}
        filename={`sales-by-client-${slug}.csv`}
        empty="No sales in these dates."
        columns={[
          { label: "Client", value: (r) => r.name },
          { label: "Bills", kind: "count", value: (r) => r.bills, total: bills },
          { label: "Billed", kind: "money", value: (r) => r.total, total },
          { label: "Received", kind: "money", value: (r) => r.received, total: received },
          { label: "Still owed", kind: "money", value: (r) => round2(r.total - r.received), total: round2(total - received) },
        ]}
      />
    </div>
  );
}

function Owed({ data, today, scope, slug }: { data: ReportData; today: string; scope: string; slug: string }) {
  const rows = data.outstanding.map((r) => ({ ...r, net: round2(r.d0 + r.d31 + r.d61 + r.d90 - r.credit) }));
  const net = sum(rows, (r) => r.net);
  const late = sum(rows, (r) => r.d31 + r.d61 + r.d90);

  return (
    <div className="space-y-4">
      <p className="text-ui text-fg-2">
        As of today, {fmtDateLong(today)}, for {scope}, whatever dates are picked above. Each bill counts by its age
        from the bill date. Credit is money received that is not tied to a live bill, such as a payment on a bill that was
        later cancelled.
      </p>
      <Figures
        items={[
          ["Owed to you", inr(net)],
          ["Of that, over 30 days old", inr(late)],
          ["Clients owing", rows.filter((r) => r.net > 0).length.toLocaleString("en-IN")],
        ]}
      />
      <ReportTable
        id="owed"
        title="What each client owes, by age"
        rows={rows}
        rowKey={(r) => r.id}
        filename={`owed-${slug}.csv`}
        empty="Nobody owes anything."
        columns={[
          { label: "Client", value: (r) => r.name },
          { label: "Oldest unpaid bill", value: (r) => r.oldest ?? "", display: (r) => (r.oldest ? fmtDateLong(r.oldest) : "") },
          { label: "0 to 30 days", kind: "money", value: (r) => r.d0, total: sum(rows, (r) => r.d0) },
          { label: "31 to 60", kind: "money", value: (r) => r.d31, total: sum(rows, (r) => r.d31) },
          { label: "61 to 90", kind: "money", value: (r) => r.d61, total: sum(rows, (r) => r.d61) },
          { label: "Over 90", kind: "money", value: (r) => r.d90, total: sum(rows, (r) => r.d90) },
          { label: "Less credit", kind: "money", value: (r) => r.credit, total: sum(rows, (r) => r.credit) },
          { label: "Owed", kind: "money", value: (r) => r.net, total: net },
        ]}
      />
    </div>
  );
}

function Inventory({
  data,
  period,
  companyName,
  slug,
}: {
  data: ReportData;
  period: string;
  companyName: string;
  slug: string;
}) {
  const rows = data.inventory.map((r) => ({
    ...r,
    unsold: Math.max(round2(r.held - r.soldAll), 0),
    sellThrough: r.held ? (r.soldAll / r.held) * 100 : 0,
    margin: r.costOfSold === null ? null : round2(r.revenue - r.costOfSold),
  }));
  const held = rows.reduce((s, r) => s + r.held, 0);
  const soldAll = sum(rows, (r) => r.soldAll);
  const sold = sum(rows, (r) => r.sold);
  const revenue = sum(rows, (r) => r.revenue);
  const allCosted = rows.every((r) => r.margin !== null || r.sold === 0);
  const margin = allCosted ? sum(rows, (r) => r.margin ?? 0) : null;

  return (
    <div className="space-y-4">
      <p className="text-ui text-fg-2">
        Every night {period}, counted by the night the room is used. Room revenue is before tax.{" "}
        {companyName
          ? `Rooms held are shared by both companies, so held and unsold cover both; sold, revenue and margin are ${companyName}'s.`
          : null}{" "}
        A margin is shown only where a cost was entered for the rooms.
      </p>
      <Figures
        items={[
          ["Room nights held", held.toLocaleString("en-IN")],
          ["Room nights sold", soldAll.toLocaleString("en-IN")],
          ["Sold %", held ? `${Math.round((soldAll / held) * 100)}%` : "0%"],
          [companyName ? `Room revenue, ${companyName}` : "Room revenue", inr(revenue)],
          ["Margin", margin === null ? "Some costs missing" : inr(margin)],
        ]}
      />
      <ReportTable
        id="inventory"
        title="By room"
        rows={rows}
        rowKey={(r) => r.id}
        filename={`inventory-${slug}.csv`}
        empty="No rooms held or sold in these dates."
        columns={[
          { label: "Room", value: (r) => r.room },
          { label: "Hotel", value: (r) => [r.hotel, r.city].filter(Boolean).join(", ") },
          { label: "Nights held", kind: "count", value: (r) => r.held, total: held },
          { label: companyName ? "Sold by anyone" : "Sold", kind: "count", value: (r) => r.soldAll, total: soldAll },
          ...(companyName
            ? [{ label: `Sold by ${companyName}`, kind: "count" as const, value: (r: (typeof rows)[number]) => r.sold, total: sold }]
            : []),
          { label: "Unsold", kind: "count", value: (r) => r.unsold, total: Math.max(round2(held - soldAll), 0) },
          { label: "Sold %", kind: "percent", value: (r) => r.sellThrough, total: held ? (soldAll / held) * 100 : 0 },
          { label: "Room revenue", kind: "money", value: (r) => r.revenue, total: revenue },
          {
            label: "Margin",
            kind: "money",
            value: (r) => r.margin,
            display: (r) =>
              r.margin === null ? (
                <span className="text-fg-3">{r.sold === 0 ? "" : "No cost entered"}</span>
              ) : (
                <span className={r.margin < 0 ? "text-bad" : undefined}>{inr(r.margin)}</span>
              ),
            total: margin,
          },
        ]}
      />
    </div>
  );
}
