"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/link";
import { DownloadSimple } from "@phosphor-icons/react";
import { Button, ErrorText, Field, Input, Select, StatusBadge, Textarea, cx } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/csv";
import { IMPORT_FIELDS, IMPORT_MAX_ROWS, guessMapping, type ImportKind } from "@/lib/import-fields";
import { guessDateOrder, parseDelimited, tidy, type DateOrder } from "@/lib/sheet";
import { readXlsx } from "@/lib/xlsx";
import { checkImport, fetchGoogleSheet, runImport, type ImportRow, type RowResult } from "./actions";

type Source = "paste" | "file" | "link";

const KINDS: { key: ImportKind; label: string }[] = [
  { key: "clients", label: "Clients" },
  { key: "rooms", label: "Rooms held" },
];

const noun = (kind: ImportKind, n: number) =>
  kind === "clients" ? (n === 1 ? "client" : "clients") : n === 1 ? "block of rooms" : "blocks of rooms";
const SOURCES: { key: Source; label: string }[] = [
  { key: "paste", label: "Paste cells" },
  { key: "file", label: "Upload a file" },
  { key: "link", label: "Sheets link" },
];

/** Example rows for the template download. */
const EXAMPLES: Record<ImportKind, string[][]> = {
  clients: [
    ["Tarang Events LLP", "Company", "Meera Shah", "Accounts", "98111 22334", "meera@tarang.in", "Andheri East, Mumbai", "GSTIN 27AAAAA0000A1Z5", "corporate, events"],
    ["Ravi Travels", "Agent", "Ravi Kumar", "Owner", "+91 99000 11223", "", "Jaipur", "", "agent"],
  ],
  rooms: [
    ["Lake Palace Resort", "Udaipur", "Deluxe Lake View", "20/12/2026", "02/01/2027", "", "5", "8500", "6200", "05/12/2026", "Every room held"],
    ["Lake Palace Resort", "Udaipur", "Suite", "20/12/2026", "", "03/01/2027", "2", "15000", "11000", "", "Only rooms sold"],
  ],
};

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex w-full flex-wrap rounded-md border border-line p-0.5 sm:w-auto">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cx(
            "h-10 flex-1 rounded-md px-3 text-body font-medium transition-colors duration-150 sm:flex-none md:h-8",
            value === o.key ? "bg-sunken text-fg" : "text-fg-3 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-5 md:px-6">
      <h2 className="mb-3 flex items-center gap-2 text-body font-semibold text-fg">
        <span className="flex size-5 items-center justify-center rounded-full bg-sunken text-ui text-fg-2">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const columnName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export function ImportClient({ initialKind }: { initialKind: ImportKind }) {
  const [kind, setKind] = useState<ImportKind>(initialKind);
  const [source, setSource] = useState<Source>("paste");
  const [pasted, setPasted] = useState("");
  const [link, setLink] = useState("");
  const [sheet, setSheet] = useState<string[][] | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [hasHeadings, setHasHeadings] = useState(true);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [dateOrder, setDateOrder] = useState<"auto" | DateOrder>("auto");
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState<{ added: number; skipped: number; failed: number; kind: ImportKind } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = IMPORT_FIELDS[kind];
  const headings = useMemo(
    () => (sheet && hasHeadings ? sheet[0] : (sheet?.[0] ?? []).map((_, i) => `Column ${columnName(i)}`)),
    [sheet, hasHeadings],
  );
  const body = useMemo(() => (sheet ? (hasHeadings ? sheet.slice(1) : sheet) : []), [sheet, hasHeadings]);
  const width = sheet ? Math.max(...sheet.map((r) => r.length)) : 0;

  const rows: ImportRow[] = useMemo(
    () =>
      body.map((r) =>
        Object.fromEntries(
          fields.filter((f) => mapping[f.key] !== undefined).map((f) => [f.key, r[mapping[f.key]] ?? ""]),
        ),
      ),
    [body, fields, mapping],
  );

  // Dates: read as the person said, or worked out from the dates themselves.
  const order: DateOrder = useMemo(() => {
    if (dateOrder !== "auto") return dateOrder;
    const dateKeys = ["firstNight", "lastNight", "checkOut", "releaseDate"];
    return guessDateOrder(rows.flatMap((r) => dateKeys.map((k) => r[k] ?? "")));
  }, [dateOrder, rows]);

  const missing = fields.filter((f) => f.required && mapping[f.key] === undefined);
  const needsEnd = kind === "rooms" && mapping.lastNight === undefined && mapping.checkOut === undefined;
  const ready = sheet !== null && rows.length > 0 && missing.length === 0 && !needsEnd && rows.length <= IMPORT_MAX_ROWS;

  // Check every row against the database whenever what is matched changes.
  const latest = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setChecking(true);
      const result = await checkImport(kind, rows, order);
      if (ticket !== latest.current) return;
      setChecking(false);
      if (result.ok) {
        setResults(result.data);
        setError("");
      } else setError(result.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [ready, kind, rows, order]);

  function load(data: string[][], name: string) {
    const clean = tidy(data);
    if (clean.length === 0) {
      setError("No cells were found. Check you copied or picked the right sheet.");
      return;
    }
    setError("");
    setDone(null);
    setResults(null);
    setSheet(clean);
    setSheetName(name);
    setHasHeadings(true);
    setMapping(guessMapping(kind, clean[0]));
  }

  function changeKind(next: ImportKind) {
    setKind(next);
    setResults(null);
    setDone(null);
    if (sheet) setMapping(hasHeadings ? guessMapping(next, sheet[0]) : {});
  }

  async function readFile(file: File) {
    setError("");
    try {
      if (/\.xlsx$/i.test(file.name)) load(await readXlsx(file), file.name);
      else if (/\.xls$/i.test(file.name)) {
        setError("This is the old Excel format. In Excel, use Save As and pick Excel Workbook (.xlsx) or CSV, then upload that.");
      } else load(parseDelimited(await file.text()), file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This file could not be read.");
    }
  }

  async function fetchLink() {
    setPending(true);
    setError("");
    const result = await fetchGoogleSheet(link);
    setPending(false);
    if (!result.ok) return setError(result.error);
    load(result.data.rows, "Google Sheet");
  }

  async function doImport() {
    setPending(true);
    setError("");
    const result = await runImport(kind, rows, order);
    setPending(false);
    if (!result.ok) return setError(result.error);
    setResults(result.data.results);
    setDone({ added: result.data.added, skipped: result.data.skipped, failed: result.data.failed, kind });
  }

  function template() {
    const columns = fields.map((f) => f.label);
    downloadCsv(`${kind}-import-template.csv`, toCsv(columns, EXAMPLES[kind]));
  }

  const counts = results
    ? {
        add: results.filter((r) => r.status === "new").length,
        skip: results.filter((r) => r.status === "skip").length,
        bad: results.filter((r) => r.status === "error").length,
      }
    : null;
  const shown = fields.filter((f) => mapping[f.key] !== undefined);

  return (
    <div className="max-w-5xl">
      <Step n={1} title="What are you importing?">
        <Segmented label="What to import" value={kind} options={KINDS} onChange={changeKind} />
        <p className="mt-2 text-ui text-fg-3">
          {kind === "clients"
            ? "One client per row. Clients already here, by name, phone or email, are skipped."
            : "One block of rooms per row: a hotel, a room type, the nights and how many rooms. New hotels and room types are added. Rows already in inventory are skipped."}{" "}
          <button type="button" onClick={template} className="inline-flex items-center gap-1 text-accent hover:underline">
            <DownloadSimple size={14} />
            Download a template
          </button>
        </p>
      </Step>

      <Step n={2} title="Where is the sheet?">
        <Segmented label="Where from" value={source} options={SOURCES} onChange={setSource} />
        <div className="mt-3">
          {source === "paste" ? (
            <div className="flex flex-col gap-2">
              <Textarea
                id="imp-paste"
                aria-label="Cells copied from a sheet"
                rows={6}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="In Google Sheets or Excel, select the cells including the heading row, copy, and paste here."
              />
              <div>
                <Button onClick={() => load(parseDelimited(pasted), "Pasted cells")} disabled={!pasted.trim()}>
                  Read pasted cells
                </Button>
              </div>
            </div>
          ) : source === "file" ? (
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                id="imp-file"
                type="file"
                accept=".xlsx,.csv,.tsv,.txt,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file);
                }}
                className="text-body text-fg-2 file:mr-3 file:h-9 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:text-body file:font-medium file:text-fg hover:file:bg-sunken"
              />
              <p className="text-ui text-fg-3">Excel (.xlsx) or CSV. For Excel, the first sheet in the file is read.</p>
            </div>
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void fetchLink();
              }}
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="imp-link"
                  aria-label="Google Sheets link"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                />
                <Button type="submit" disabled={pending || !link.trim()}>
                  {pending ? "Fetching" : "Fetch sheet"}
                </Button>
              </div>
              <p className="text-ui text-fg-3">
                The sheet must be shared as &quot;Anyone with the link can view&quot;. The tab open when you copied the link is
                read. For a private sheet, copy the cells and use Paste instead.
              </p>
            </form>
          )}
        </div>
        <div className="mt-2">
          <ErrorText>{sheet ? "" : error}</ErrorText>
        </div>
      </Step>

      {sheet ? (
        <Step n={3} title="Match the columns">
          <p className="mb-3 text-ui text-fg-2">
            {sheetName}: {body.length} row{body.length === 1 ? "" : "s"}, {width} column{width === 1 ? "" : "s"}. Pick which column
            holds each detail. Columns left as &quot;Not in this sheet&quot; are left empty.
          </p>
          <label className="mb-4 flex items-center gap-2 text-body text-fg">
            <input
              type="checkbox"
              checked={hasHeadings}
              onChange={(e) => {
                setHasHeadings(e.target.checked);
                setMapping(e.target.checked ? guessMapping(kind, sheet[0]) : {});
              }}
              className="size-4 accent-ink"
            />
            The first row has the column headings
          </label>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <Field key={f.key} label={f.required ? `${f.label} (needed)` : f.label} htmlFor={`map-${f.key}`} hint={f.hint}>
                <Select
                  id={`map-${f.key}`}
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setMapping((m) => {
                      const next = { ...m };
                      if (value === "") delete next[f.key];
                      else next[f.key] = Number(value);
                      return next;
                    });
                  }}
                >
                  <option value="">Not in this sheet</option>
                  {Array.from({ length: width }, (_, i) => (
                    <option key={i} value={i}>
                      {columnName(i)}: {headings[i] || "No heading"}
                      {body[0]?.[i] ? `, e.g. ${body[0][i].slice(0, 30)}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
            {kind === "rooms" ? (
              <Field label="Dates are written" htmlFor="map-dates" hint={dateOrder === "auto" ? `Reading them ${order === "dmy" ? "day first" : "month first"}.` : undefined}>
                <Select id="map-dates" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as "auto" | DateOrder)}>
                  <option value="auto">Work it out from the dates</option>
                  <option value="dmy">Day first: 20/12/2026 is 20 Dec</option>
                  <option value="mdy">Month first: 12/20/2026 is 20 Dec</option>
                </Select>
              </Field>
            ) : null}
          </div>
          {missing.length || needsEnd ? (
            <p role="status" className="mt-3 text-ui font-medium text-warn">
              Still to pick: {[...missing.map((f) => f.label), ...(needsEnd ? ["Last night or Check-out day"] : [])].join(", ")}.
            </p>
          ) : null}
          {rows.length > IMPORT_MAX_ROWS ? (
            <p role="alert" className="mt-3 text-ui font-medium text-bad">
              This sheet has {rows.length} rows. Import up to {IMPORT_MAX_ROWS} at a time.
            </p>
          ) : null}
        </Step>
      ) : null}

      {sheet && ready ? (
        <Step n={4} title="Check and import">
          {done ? (
            <div role="status" data-import-done className="mb-4 rounded-lg border border-line bg-ok-soft px-3 py-2 text-body text-fg">
              Added {done.added} {noun(done.kind, done.added)}.
              {done.skipped ? ` Skipped ${done.skipped} already here.` : ""}
              {done.failed ? ` ${done.failed} could not be read and were left out.` : ""}{" "}
              <Link href={done.kind === "clients" ? "/clients" : "/inventory"} className="font-medium text-accent hover:underline">
                See {done.kind === "clients" ? "clients" : "inventory"}
              </Link>
            </div>
          ) : null}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {counts ? (
              <p data-import-counts className="flex flex-wrap gap-2 text-ui">
                <StatusBadge tone="ok">{counts.add} to add</StatusBadge>
                {counts.skip ? <StatusBadge tone="muted">{counts.skip} already here</StatusBadge> : null}
                {counts.bad ? <StatusBadge tone="bad">{counts.bad} cannot be read</StatusBadge> : null}
              </p>
            ) : (
              <p className="text-ui text-fg-3">{checking ? "Checking each row" : ""}</p>
            )}
            <Button
              variant="primary"
              className="ml-auto"
              disabled={pending || checking || !counts || counts.add === 0 || Boolean(done)}
              onClick={doImport}
            >
              {pending ? "Importing" : counts ? `Import ${counts.add} ${noun(kind, counts.add)}` : "Import"}
            </Button>
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="mt-2 max-h-[60vh] overflow-auto rounded-lg border border-line">
            <table data-import-preview className="w-full border-collapse text-body">
              <thead className="sticky top-0 bg-canvas">
                <tr className="text-left text-ui text-fg-3">
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  {shown.map((f) => (
                    <th key={f.key} className="whitespace-nowrap px-3 py-2 font-medium">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const res = results?.[i];
                  return (
                    <tr key={i} data-row-status={res?.status ?? ""} className="border-t border-line align-top">
                      <td className="px-3 py-2 text-fg-3 tabular-nums">{i + (hasHeadings ? 2 : 1)}</td>
                      <td className="min-w-48 px-3 py-2">
                        {!res ? (
                          <span className="text-fg-3">...</span>
                        ) : res.status === "new" ? (
                          <StatusBadge tone="ok">Add</StatusBadge>
                        ) : (
                          <span className="flex flex-col gap-0.5">
                            <span>
                              <StatusBadge tone={res.status === "skip" ? "muted" : "bad"}>
                                {res.status === "skip" ? "Skip" : "Cannot read"}
                              </StatusBadge>
                            </span>
                            <span className="text-ui text-fg-2">{res.message}</span>
                          </span>
                        )}
                      </td>
                      {shown.map((f) => (
                        <td key={f.key} className="max-w-56 truncate px-3 py-2 text-fg-2" title={r[f.key]}>
                          {r[f.key]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Step>
      ) : null}
    </div>
  );
}
