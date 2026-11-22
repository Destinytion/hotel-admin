"use client";

import type { ReactNode } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { Button, cx } from "@/components/ui";
import { downloadCsv, toCsv, type CsvValue } from "@/lib/csv";
import { inr } from "@/lib/format";

export type Column<T> = {
  label: string;
  /** The raw value: shown on screen and written to the download. */
  value: (row: T) => CsvValue;
  /** Money and counts line up on the right. */
  kind?: "text" | "money" | "count" | "percent";
  /** What to show on screen instead of the raw value, such as a link. */
  display?: (row: T) => ReactNode;
  /** The figure for the totals row. Leave out for no total in this column. */
  total?: CsvValue;
};

function show(value: CsvValue, kind: Column<unknown>["kind"]) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "number") return value;
  if (kind === "money") return inr(value);
  if (kind === "percent") return `${Math.round(value)}%`;
  return value.toLocaleString("en-IN");
}

/** A report table with a totals row and a Download for Excel button. */
export function ReportTable<T>({
  id,
  title,
  note,
  rows,
  columns,
  rowKey,
  filename,
  empty,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  filename: string;
  empty: string;
}) {
  const hasTotals = columns.some((c) => c.total !== undefined);
  const right = (c: Column<T>) => c.kind && c.kind !== "text";

  function download() {
    const body = rows.map((r) => columns.map((c) => c.value(r)));
    if (hasTotals) body.push(columns.map((c, i) => (i === 0 ? "Total" : (c.total ?? ""))));
    downloadCsv(filename, toCsv(columns.map((c) => c.label), body));
  }

  return (
    <section data-report={id} className="rounded-lg border border-line">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold text-fg">{title}</h2>
          {note ? <p className="text-ui text-fg-3">{note}</p> : null}
        </div>
        <Button variant="ghost" onClick={download} disabled={rows.length === 0} aria-label={`Download ${title} for Excel`}>
          <DownloadSimple size={16} />
          Excel
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-4 text-body text-fg-2">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="bg-canvas text-left text-ui text-fg-3">
                {columns.map((c) => (
                  <th
                    key={c.label}
                    className={cx("whitespace-nowrap px-4 py-2 font-medium", right(c) && "text-right")}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)} className="border-t border-line">
                  {columns.map((c, i) => (
                    <td
                      key={c.label}
                      className={cx(
                        "px-4 py-2",
                        right(c) ? "whitespace-nowrap text-right tabular-nums" : "",
                        i === 0 ? "font-medium text-fg" : "text-fg-2",
                      )}
                    >
                      {c.display ? c.display(row) : show(c.value(row), c.kind)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {hasTotals ? (
              <tfoot>
                <tr className="border-t border-line-strong bg-canvas font-semibold text-fg">
                  {columns.map((c, i) => (
                    <td
                      key={c.label}
                      className={cx("px-4 py-2", right(c) && "whitespace-nowrap text-right tabular-nums")}
                    >
                      {i === 0 ? "Total" : show(c.total, c.kind)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </section>
  );
}
