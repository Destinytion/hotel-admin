"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@/components/ui";
import { PRESETS, type Range } from "@/lib/ranges";

/*
  The date range and company a report or list covers. Both live in the address,
  so a report can be bookmarked or sent to someone and opens the same way.
*/
export function ReportFilters({
  path,
  range,
  companies,
  companyId,
}: {
  path: string;
  range: Range;
  companies: { id: string; name: string }[];
  companyId: string;
}) {
  const router = useRouter();
  const [custom, setCustom] = useState(range.key === "custom");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  function go(next: { range?: string; from?: string; to?: string; company?: string }) {
    const params = new URLSearchParams();
    if (next.from && next.to) {
      params.set("from", next.from);
      params.set("to", next.to);
    } else {
      params.set("range", next.range ?? range.key);
    }
    const company = next.company ?? companyId;
    if (company) params.set("company", company);
    router.push(`${path}?${params}`);
  }

  // Keeps the current dates when only the company changes.
  const current = range.key === "custom" ? { from: range.from, to: range.to } : { range: range.key };

  return (
    <div className="flex flex-wrap items-end gap-3 px-4 py-3 md:px-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="rf-range" className="text-ui font-medium text-fg-2">
          Dates
        </label>
        <Select
          id="rf-range"
          value={custom ? "custom" : range.key}
          onChange={(e) => {
            if (e.target.value === "custom") return setCustom(true);
            setCustom(false);
            go({ range: e.target.value });
          }}
          className="sm:w-56"
        >
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value="custom">Pick dates</option>
        </Select>
      </div>

      {custom ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to) go({ from, to });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rf-from" className="text-ui font-medium text-fg-2">
              From
            </label>
            <Input id="rf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rf-to" className="text-ui font-medium text-fg-2">
              To
            </label>
            <Input id="rf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button type="submit" disabled={!from || !to}>
            Show
          </Button>
        </form>
      ) : null}

      {companies.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rf-company" className="text-ui font-medium text-fg-2">
            Company
          </label>
          <Select
            id="rf-company"
            value={companyId}
            onChange={(e) => go({ ...current, company: e.target.value })}
            className="sm:w-64"
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </div>
  );
}
