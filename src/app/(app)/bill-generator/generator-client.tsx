"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "@/components/link";
import { useRouter } from "next/navigation";
import { Plus, Trash } from "@phosphor-icons/react";
import {
  Button,
  CompanyChip,
  ErrorText,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  cx,
} from "@/components/ui";
import { BillPaper, type PaperData } from "@/components/bill-paper";
import { ConflictNotice, useEvery } from "@/components/live";
import {
  INDIAN_STATES,
  PROFORMA_NOTE,
  QUOTATION_NOTE,
  billTotals,
  defaultSchedule,
  emptyDetails,
  hasField,
  stayDays,
  type BookingDetails,
  type DocClient,
  type FormatField,
  type Layout,
  type ScheduleRow,
} from "@/lib/bill-document";
import { addDays, fmtDate, inr, isISODate, round2 } from "@/lib/format";
import type { StayAvailability } from "@/server/availability";
import { checkAvailability, deleteDraft, saveBill } from "./actions";

export type Options = {
  companies: {
    id: string;
    name: string;
    initials: string;
    color: string;
    address: string;
    registration: string;
    email: string;
    phone: string;
    bankDetails: string;
    terms: string;
    logoUrl: string | null;
    stampUrl: string | null;
    formats: { id: string; name: string; title: string; hasTaxLine: boolean; countsAsSale: boolean; layout: Layout }[];
  }[];
  clients: { id: string; name: string; address: string; registration: string; contact: string; phone: string }[];
  rooms: { id: string; label: string; room: string; hotel: string; city: string }[];
  services: { id: string; name: string; details: string; rate: number }[];
  /** Whoever is signed in: a new quotation is signed in their name. */
  myName: string;
};

type Line = {
  id: number;
  /** "other" is any item or service. "room" is a room, from stock or typed by hand. */
  kind: "room" | "other";
  /** A room typed by hand: it has no room type and never touches inventory. */
  manual: boolean;
  roomTypeId: string;
  description: string;
  /** Room: sharing, meals and the like, printed under the room and in the booking details. */
  extra: string;
  checkIn: string;
  nights: number;
  quantity: number;
  rate: number;
};

/** A line's description as saved and printed: its name, then for a room the sharing and meals on the next line. */
const savedDescription = (l: Pick<Line, "kind" | "manual" | "description" | "extra">, roomLabel = "") => {
  if (l.kind !== "room") return l.description;
  const name = l.manual ? l.description : roomLabel;
  return [name, l.extra.trim()].filter(Boolean).join("\n");
};

export type Draft = {
  id: string;
  /** Goes up on every save; used to notice someone else's change. */
  version: number;
  changedBy: string;
  companyId: string;
  formatId: string;
  billTo: DocClient;
  billDate: string;
  taxPercent: number;
  discount: number;
  /** Whether `discount` is rupees or a percentage of the subtotal. */
  discountMode: "amount" | "percent";
  /** Non-GST bill: print the GSTINs anyway. */
  showGstin: boolean;
  notes: string;
  details: BookingDetails;
  /** Quotation: the payment schedule. */
  schedule: ScheduleRow[];
  lines: Line[];
  availability: Record<number, StayAvailability>;
};

const EMPTY_CLIENT: DocClient = { name: "", address: "", registration: "", contact: "", phone: "" };

const noSubscribe = () => () => {};

/** The GST rate a new bill starts with. */
const DEFAULT_GST = 5;

/** How many single-letter edits turn one word into another. */
function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/** Two names that are probably the same client: one inside the other, or a typo or two apart. */
function looksAlike(saved: string, typed: string) {
  const a = saved.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = typed.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (a.length < 3 || b.length < 3) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return editDistance(a, b) <= (Math.max(a.length, b.length) > 8 ? 2 : 1);
}

/** A saved client's details, as they go on a bill. */
const clientDetails = (c: Options["clients"][number]): DocClient => ({
  name: c.name,
  address: c.address,
  registration: c.registration,
  contact: c.contact,
  phone: c.phone,
});

/** Rooms: nights x rooms x rate. Any other item: quantity x days x rate. */
const lineAmount = (l: Line) => round2(Math.max(l.nights, 1) * l.quantity * l.rate);

const toNumber = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

type Props = {
  options: Options;
  draft: Draft | null;
  today: string;
  initialClientId: string;
  description: string;
};

/*
  The form keeps its own copy of the bill while it is edited. "Load their
  version" throws that copy away and starts again from the database, which is
  what changing the key does.
*/
export function GeneratorClient(props: Props) {
  const [round, setRound] = useState(0);
  return <GeneratorForm key={round} {...props} onLoadLatest={() => setRound((n) => n + 1)} />;
}

function GeneratorForm({
  options,
  draft,
  today,
  initialClientId,
  description,
  onLoadLatest,
}: Props & { onLoadLatest: () => void }) {
  const router = useRouter();
  const nextId = useRef((draft?.lines.length ?? 0) + 1);
  const requestNo = useRef<Record<number, number>>({});
  const wantPrice = useRef<Record<number, boolean>>({});

  const firstCompany = options.companies.find((c) => c.id === draft?.companyId) ?? options.companies[0];
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [billId, setBillId] = useState(draft?.id);
  const [version, setVersion] = useState(draft?.version);
  const [companyId, setCompanyId] = useState(firstCompany.id);
  const [formatId, setFormatId] = useState(draft?.formatId ?? firstCompany.formats[0]?.id ?? "");
  // Whoever the bill is to, typed. A saved client fills it in; a new name becomes a client on saving.
  const [billTo, setBillTo] = useState<DocClient>(() => {
    if (draft) return draft.billTo;
    const start = options.clients.find((c) => c.id === initialClientId);
    return start ? clientDetails(start) : { ...EMPTY_CLIENT };
  });
  const [billDate, setBillDate] = useState(draft?.billDate ?? today);
  // A new bill starts at the usual 5% GST; it can be changed on each bill.
  const [taxPercent, setTaxPercent] = useState(draft?.taxPercent ?? DEFAULT_GST);
  const [discount, setDiscount] = useState(draft?.discount ?? 0);
  // A discount is usually a percentage; ₹ is one click away.
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">(draft?.discountMode ?? "percent");
  const [showGstin, setShowGstin] = useState(draft?.showGstin ?? false);
  const [details, setDetails] = useState<BookingDetails>(draft?.details ?? emptyDetails());
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [schedule, setSchedule] = useState<ScheduleRow[]>(draft?.schedule ?? []);
  const [lines, setLines] = useState<Line[]>(draft?.lines ?? []);
  const [availability, setAvailability] = useState<Record<number, StayAvailability | undefined>>(
    draft?.availability ?? {},
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const company = options.companies.find((c) => c.id === companyId) ?? firstCompany;
  const format = company.formats.find((f) => f.id === formatId) ?? company.formats[0];
  const matched = options.clients.find((c) => c.name.trim().toLowerCase() === billTo.name.trim().toLowerCase()) ?? null;

  function changeBillToName(name: string) {
    touch();
    const saved = options.clients.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    // Picking a saved client fills in their details, replacing those of whoever was there before.
    setBillTo((b) => (saved && saved.id !== matched?.id ? clientDetails(saved) : { ...b, name }));
  }
  const setBillToField = (patch: Partial<DocClient>) => {
    touch();
    setBillTo((b) => ({ ...b, ...patch }));
  };

  const layout: Layout = format?.layout ?? "gst";
  /** Whether the chosen format asks for this field. */
  const has = (field: FormatField) => hasField(layout, field);
  const [noteOpen, setNoteOpen] = useState(false);
  const amounts = useMemo(() => lines.map((l) => ({ amount: lineAmount(l) })), [lines]);
  const { subtotal, tax, discount: discountShown, total } = billTotals(
    amounts,
    layout,
    Boolean(format?.hasTaxLine),
    taxPercent,
    discount,
    discountMode === "percent" ? discount : null,
  );

  const stay = stayDays(details.checkIn, details.checkOut);
  const quote = layout === "quotation";
  const scheduled = round2(schedule.reduce((sum, r) => sum + (r.amount || 0), 0));

  function setScheduleRow(index: number, patch: Partial<ScheduleRow>) {
    touch();
    setSchedule((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  /*
    Switching format brings in what the user's own format starts with: the
    proforma's payment note, or the quotation's letter, schedule and sign-off.
    Leaving it takes back only what was never edited.
  */
  function changeFormat(id: string) {
    touch();
    setFormatId(id);
    const next = company.formats.find((f) => f.id === id)?.layout;
    const starter: Partial<Record<Layout, string>> = { proforma: PROFORMA_NOTE, quotation: QUOTATION_NOTE };
    const untouched = !notes.trim() || Object.values(starter).includes(notes);
    if (untouched) setNotes(next ? (starter[next] ?? "") : "");
    if (next === "quotation") {
      if (!schedule.length) setSchedule(defaultSchedule());
      setDetails((d) => ({
        ...d,
        signName: d.signName || options.myName,
        signPhone: d.signPhone || company.phone,
      }));
    }
  }

  /*
    The booking's dates are typed once. Room lines that were following them
    (same check-in and nights as before) move with them, so a change of
    dates does not have to be made twice.
  */
  function setDetail(patch: Partial<BookingDetails>) {
    touch();
    const next = { ...details, ...patch };
    setDetails(next);
    if (!("checkIn" in patch) && !("checkOut" in patch)) return;
    const newDays = stayDays(next.checkIn, next.checkOut);
    if (!isISODate(next.checkIn)) return;
    for (const line of lines) {
      if (line.kind !== "room") continue;
      const following = line.checkIn === details.checkIn || (!details.checkIn && line.checkIn === today);
      const sameNights = line.nights === stay || (!stay && line.nights === 1);
      if (!following || !sameNights) continue;
      void changeLine(line, { checkIn: next.checkIn, ...(newDays ? { nights: newDays } : {}) }, line.rate === 0);
    }
  }

  const [dirty, setDirty] = useState(false);
  const touch = () => {
    setSaved("");
    setError("");
    setConfirming(false);
    setDirty(true);
  };

  function changeCompany(id: string) {
    touch();
    const next = options.companies.find((c) => c.id === id);
    if (!next) return;
    setCompanyId(id);
    // Keep the same kind of format when switching company, by name.
    const same = next.formats.find((f) => f.name === format?.name);
    setFormatId((same ?? next.formats[0])?.id ?? "");
  }

  const patchLine = (id: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  /** Updates a line and, for rooms, asks the server what is left for those nights. */
  async function changeLine(line: Line, patch: Partial<Line>, takePrice = false) {
    touch();
    const next = { ...line, ...patch };
    patchLine(line.id, patch);
    if (next.kind !== "room" || next.manual) return;
    // Sharing and meals do not change what is available.
    if (Object.keys(patch).every((k) => k === "extra")) return;
    // The first room picked names the hotel in the booking details, if not typed yet.
    if (patch.roomTypeId && !details.hotelName) {
      const room = options.rooms.find((r) => r.id === patch.roomTypeId);
      if (room) setDetails((d) => (d.hotelName ? d : { ...d, hotelName: [room.hotel, room.city].filter(Boolean).join(", ") }));
    }

    // Picking a room or date asks for the inventory price. The request stays
    // open until an answer fills it in, even if other fields change meanwhile.
    // Typing a rate by hand cancels it.
    if ("rate" in patch) wantPrice.current[line.id] = false;
    if (takePrice) wantPrice.current[line.id] = true;

    const request = (requestNo.current[line.id] = (requestNo.current[line.id] ?? 0) + 1);
    if (!next.roomTypeId || !isISODate(next.checkIn) || !Number.isInteger(next.nights) || next.nights < 1) {
      setAvailability((a) => ({ ...a, [line.id]: undefined }));
      return;
    }
    const result = await checkAvailability(next.roomTypeId, next.checkIn, next.nights);
    if (requestNo.current[line.id] !== request || !result.ok) return;
    setAvailability((a) => ({ ...a, [line.id]: result.data }));
    if (wantPrice.current[line.id] && result.data.price !== null) {
      wantPrice.current[line.id] = false;
      patchLine(line.id, { rate: result.data.price });
    }
  }

  function addLine(kind: Line["kind"], manual = false) {
    touch();
    setLines((prev) => [
      ...prev,
      {
        id: nextId.current++,
        kind,
        manual: kind === "room" && manual,
        roomTypeId: "",
        description: "",
        extra: "",
        // A room starts on the booking's dates, if they are typed.
        checkIn: kind === "room" ? (isISODate(details.checkIn) ? details.checkIn : today) : "",
        nights: kind === "room" && stay ? stay : 1,
        quantity: 1,
        rate: 0,
      },
    ]);
  }

  function removeLine(id: number) {
    touch();
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  // Room counts on screen are re-checked while the bill is open, because other
  // people may be selling the same rooms. Finalising checks again regardless.
  const recheck = useCallback(() => {
    for (const line of lines) {
      if (line.kind !== "room" || line.manual || !line.roomTypeId || !isISODate(line.checkIn) || line.nights < 1) continue;
      const request = (requestNo.current[line.id] = (requestNo.current[line.id] ?? 0) + 1);
      void checkAvailability(line.roomTypeId, line.checkIn, line.nights).then((result) => {
        if (requestNo.current[line.id] !== request || !result.ok) return;
        setAvailability((a) => ({ ...a, [line.id]: result.data }));
      });
    }
  }, [lines]);
  useEvery(15, recheck);

  // Someone else saved this same draft after it was opened here.
  const stale = Boolean(draft && billId === draft.id && !pending && draft.version !== version);

  const payload = () => ({
    id: billId,
    version,
    companyId,
    formatId: format?.id ?? "",
    clientId: matched?.id ?? "",
    billTo,
    billDate,
    taxPercent,
    discount: discountMode === "amount" ? discount : 0,
    discountPercent: discountMode === "percent" ? discount : null,
    notes,
    details,
    showGstin,
    schedule: quote ? schedule : [],
    lines: lines.map((l) => ({
      kind: l.kind,
      manual: l.manual,
      roomTypeId: l.roomTypeId,
      // A room from inventory sends only its sharing and meals; its name comes from the inventory.
      description: l.kind === "room" && !l.manual ? l.extra.trim() : savedDescription(l),
      checkIn: l.checkIn,
      nights: l.nights,
      quantity: l.quantity,
      rate: l.rate,
    })),
  });

  async function save(finalise: boolean) {
    setPending(true);
    setError("");
    setSaved("");
    const result = await saveBill(payload(), finalise);
    setConfirming(false);
    if (!result.ok) {
      setPending(false);
      // On a conflict, fetch the other person's version so the choice can be offered.
      if (result.conflict) router.refresh();
      // A refusal is often about rooms just sold by someone else: show the new counts now.
      recheck();
      return setError(result.error);
    }
    setVersion(result.data.version);
    setPending(false);
    clearAutosave();
    setDirty(false);

    if (finalise) {
      // Clear the form so coming back here starts a new bill.
      setBillId(undefined);
      setLines([]);
      setNotes("");
      setDetails(emptyDetails());
      setDiscount(0);
      setAvailability({});
      router.push(`/bills/${result.data.id}`);
      return;
    }
    setSaved("Draft saved.");
    if (!billId) {
      setBillId(result.data.id);
      router.replace(`/bill-generator?bill=${result.data.id}`);
    }
  }

  async function removeDraft() {
    if (!billId) return;
    setPending(true);
    const result = await deleteDraft(billId);
    setPending(false);
    if (!result.ok) return setError(result.error);
    clearAutosave();
    router.replace("/bill-generator");
  }

  /*
    Autosave. Everything typed is kept in this browser until the bill is
    saved, so leaving the page by mistake loses nothing. Coming back offers it
    again. Nothing is written until something is typed, so an old unsaved
    bill is not overwritten by an empty form.
  */
  const autosaveKey = `bill-autosave:${draft?.id ?? "new"}`;
  const snapshotJson = JSON.stringify({ companyId, formatId, billTo, billDate, taxPercent, discount, discountMode, showGstin, details, notes, schedule, lines });
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(autosaveKey, snapshotJson);
      } catch {
        // Storage can be off in private windows; the form still works.
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [dirty, autosaveKey, snapshotJson]);
  const stored = useSyncExternalStore(
    noSubscribe,
    () => {
      try {
        return localStorage.getItem(autosaveKey);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const [restoreDismissed, setRestoreDismissed] = useState(false);
  const offerRestore = !dirty && !restoreDismissed && stored !== null && stored !== snapshotJson;
  const clearAutosave = () => {
    try {
      localStorage.removeItem(autosaveKey);
    } catch {}
  };
  function restoreAutosave() {
    try {
      const s = JSON.parse(stored ?? "{}");
      if (s.companyId && options.companies.some((c) => c.id === s.companyId)) setCompanyId(s.companyId);
      if (s.formatId) setFormatId(s.formatId);
      if (s.billTo) setBillTo(s.billTo);
      if (s.billDate) setBillDate(s.billDate);
      setTaxPercent(Number(s.taxPercent ?? 0));
      setDiscount(Number(s.discount ?? 0));
      setDiscountMode(s.discountMode === "amount" ? "amount" : "percent");
      setShowGstin(Boolean(s.showGstin));
      if (s.details) setDetails({ ...emptyDetails(), ...s.details });
      setNotes(String(s.notes ?? ""));
      setSchedule(Array.isArray(s.schedule) ? s.schedule : []);
      const restored: Line[] = Array.isArray(s.lines) ? s.lines.map((l: Line) => ({ ...l, extra: l.extra ?? "" })) : [];
      setLines(restored);
      nextId.current = Math.max(0, ...restored.map((l) => l.id)) + 1;
      setDirty(true);
    } catch {
      setRestoreDismissed(true);
    }
  }
  function discardAutosave() {
    clearAutosave();
    setRestoreDismissed(true);
  }

  /** Saved clients whose names look like what was typed, to catch a typo before it becomes a new client. */
  const suggestions =
    matched || billTo.name.trim().length < 3
      ? []
      : options.clients.filter((c) => looksAlike(c.name, billTo.name)).slice(0, 3);

  const paper: PaperData = {
    layout,
    company,
    client: billTo.name.trim() ? billTo : null,
    details,
    logoUrl: company.logoUrl,
    stampUrl: company.stampUrl,
    title: format?.title ?? "",
    number: null,
    billDate,
    lines: lines.map((l) => ({
      key: l.id,
      kind: l.kind,
      description: savedDescription(l, options.rooms.find((r) => r.id === l.roomTypeId)?.label ?? "Pick a room"),
      checkIn: l.checkIn,
      nights: l.nights,
      quantity: l.quantity,
      rate: l.rate,
      amount: lineAmount(l),
    })),
    subtotal,
    taxPercent: format?.hasTaxLine ? taxPercent : 0,
    tax,
    discount: discountShown,
    discountPercent: discountMode === "percent" && discount > 0 ? discount : null,
    showGstin,
    total,
    notes,
    paid: null,
    schedule,
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader
        title={billId ? "Edit draft" : "Bill Generator"}
        description={description}
        actions={
          billId ? (
            <>
              <Button variant="ghost" onClick={removeDraft} disabled={pending}>
                Delete draft
              </Button>
              <Link
                href="/bill-generator"
                className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-3 text-body font-medium text-fg transition-colors duration-150 hover:bg-sunken md:h-9"
              >
                New bill
              </Link>
            </>
          ) : null
        }
      />

      {/* Phone: switch between the form and the preview. */}
      <div className="grid grid-cols-2 border-b border-line lg:hidden" role="tablist">
        {(["edit", "preview"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={cx(
              "h-11 border-b-2 text-body font-medium capitalize transition-colors duration-150",
              view === v ? "border-ink text-fg" : "border-transparent text-fg-3",
            )}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---------- form ---------- */}
        <div className={cx("flex flex-col", view === "preview" && "hidden lg:flex")}>
          <div className="flex-1 space-y-7 p-4 md:p-6">
            {stale && draft ? (
              <ConflictNotice
                who={draft.changedBy}
                thing="draft"
                onLoadLatest={onLoadLatest}
                onKeepMine={() => {
                  setError("");
                  setVersion(draft.version);
                }}
              />
            ) : null}
            {offerRestore ? (
              <div role="status" data-autosave className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-sunken px-3 py-2">
                <p className="mr-auto text-body text-fg">You have an unsaved bill from earlier on this device.</p>
                <Button onClick={restoreAutosave}>Bring it back</Button>
                <Button variant="ghost" onClick={discardAutosave}>
                  Discard
                </Button>
              </div>
            ) : null}

            {/* 1. Which bill */}
            <div className="grid gap-4 sm:grid-cols-3">
              {options.companies.length > 1 ? (
                <Field label="Bill from" htmlFor="company" className="sm:col-span-3">
                  <div className="flex items-center gap-2">
                    <CompanyChip initials={company.initials} color={company.color} size={28} />
                    <Select id="company" value={companyId} onChange={(e) => changeCompany(e.target.value)}>
                      {options.companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </Field>
              ) : null}
              <Field label="Format" htmlFor="format" className="sm:col-span-2">
                <Select id="format" value={format?.id ?? ""} onChange={(e) => changeFormat(e.target.value)}>
                  {company.formats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={quote ? "Date" : "Bill date"} htmlFor="billDate">
                <Input
                  id="billDate"
                  type="date"
                  value={billDate}
                  onChange={(e) => {
                    touch();
                    setBillDate(e.target.value);
                  }}
                />
              </Field>
            </div>

            {/* 2. Who it is to */}
            <section aria-labelledby="billto-heading" className="space-y-3">
              <h2 id="billto-heading" className="text-body font-semibold text-fg">
                {quote ? "To" : "Billed to"}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="client" className="sm:col-span-2">
                  <Input
                    id="client"
                    list="client-names"
                    autoComplete="off"
                    value={billTo.name}
                    onChange={(e) => changeBillToName(e.target.value)}
                    placeholder="College, company or person"
                  />
                  <datalist id="client-names">
                    {options.clients.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                  {suggestions.length ? (
                    <p data-did-you-mean className="text-ui text-fg-2">
                      Did you mean{" "}
                      {suggestions.map((c, i) => (
                        <span key={c.id}>
                          {i ? " or " : ""}
                          <button type="button" onClick={() => changeBillToName(c.name)} className="font-medium text-accent hover:underline">
                            {c.name}
                          </button>
                        </span>
                      ))}
                      ? Otherwise a new client is added.
                    </p>
                  ) : billTo.name.trim() && !matched ? (
                    <p className="text-ui text-fg-3">New client. Added to Clients when the bill is saved.</p>
                  ) : null}
                </Field>
                <Field label="Address" htmlFor="bt-address" className="sm:col-span-2">
                  <Textarea id="bt-address" rows={2} value={billTo.address} onChange={(e) => setBillToField({ address: e.target.value })} />
                </Field>
                {layout === "non-gst" ? (
                  <label className="flex items-center gap-2 text-body text-fg sm:col-span-2">
                    <input
                      type="checkbox"
                      id="show-gstin"
                      checked={showGstin}
                      onChange={(e) => {
                        touch();
                        setShowGstin(e.target.checked);
                      }}
                      className="size-4 accent-ink"
                    />
                    Show GSTIN on this bill, yours and the client&rsquo;s
                  </label>
                ) : null}
                {has("clientGstin") || (layout === "non-gst" && showGstin) ? (
                  <Field label="GSTIN" htmlFor="bt-gstin">
                    <Input id="bt-gstin" value={billTo.registration} placeholder="If they have one" onChange={(e) => setBillToField({ registration: e.target.value })} />
                  </Field>
                ) : null}
                <Field label="Phone, for WhatsApp" htmlFor="bt-phone">
                  <Input
                    id="bt-phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="Not printed"
                    value={billTo.phone}
                    onChange={(e) => setBillToField({ phone: e.target.value })}
                  />
                </Field>
              </div>
            </section>

            {/* 3. The booking: typed once, rooms below follow its dates */}
            <section aria-labelledby="details-heading" className="space-y-3">
              <h2 id="details-heading" className="text-body font-semibold text-fg">
                Booking
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {has("eventName") ? (
                  <Field label="Event name" htmlFor="d-event" className="sm:col-span-2">
                    <Input id="d-event" value={details.eventName} placeholder="What the enquiry is for" onChange={(e) => setDetail({ eventName: e.target.value })} />
                  </Field>
                ) : null}
                {has("bookingRef") ? (
                  <Field label={layout === "non-gst" ? "Team name" : "Booking ref"} htmlFor="d-ref">
                    <Input id="d-ref" value={details.bookingRef} placeholder="Team or person" onChange={(e) => setDetail({ bookingRef: e.target.value })} />
                  </Field>
                ) : null}
                {has("placeOfSupply") ? (
                  <Field label="Place of supply" htmlFor="d-place">
                    <Input
                      id="d-place"
                      list="indian-states"
                      placeholder="State"
                      value={details.placeOfSupply}
                      onChange={(e) => setDetail({ placeOfSupply: e.target.value })}
                    />
                    <datalist id="indian-states">
                      {INDIAN_STATES.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </Field>
                ) : null}
                <Field label="Hotel name" htmlFor="d-hotel">
                  <Input id="d-hotel" value={details.hotelName} onChange={(e) => setDetail({ hotelName: e.target.value })} />
                </Field>
                {has("hotelAddress") ? (
                  <Field label="Hotel address" htmlFor="d-haddr">
                    <Input id="d-haddr" value={details.hotelAddress} onChange={(e) => setDetail({ hotelAddress: e.target.value })} />
                  </Field>
                ) : null}
                <Field label="Check-in" htmlFor="d-in">
                  <Input id="d-in" type="date" value={details.checkIn} onChange={(e) => setDetail({ checkIn: e.target.value })} />
                </Field>
                <Field label={stay ? `Check-out, ${stay} night${stay > 1 ? "s" : ""}` : "Check-out"} htmlFor="d-out">
                  <Input id="d-out" type="date" value={details.checkOut} onChange={(e) => setDetail({ checkOut: e.target.value })} />
                </Field>
                {has("members") ? (
                  <Field label="Members" htmlFor="d-members">
                    <Input id="d-members" inputMode="numeric" value={details.members} onChange={(e) => setDetail({ members: e.target.value })} />
                  </Field>
                ) : null}
              </div>
            </section>

            {/* 4. What is charged */}
            <section aria-labelledby="lines-heading" className="space-y-3">
              <h2 id="lines-heading" className="text-body font-semibold text-fg">
                Charges
              </h2>
              {lines.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-center text-body text-fg-2">
                  Add the rooms (with their sharing) and anything else you are charging for, such as food or transport.
                  The booking details on the bill are filled in from these.
                </p>
              ) : (
                <ul className="space-y-3">
                  {lines.map((line) => (
                    <LineEditor
                      key={line.id}
                      line={line}
                      rooms={options.rooms}
                      services={options.services}
                      availability={availability[line.id]}
                      booking={{ checkIn: details.checkIn, nights: stay }}
                      onChange={(patch, takePrice) => changeLine(line, patch, takePrice)}
                      onRemove={() => removeLine(line.id)}
                    />
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => addLine("other")}>
                  <Plus size={16} weight="bold" />
                  Add item
                </Button>
                {options.rooms.length ? (
                  <Button onClick={() => addLine("room")}>
                    <Plus size={16} weight="bold" />
                    Add room
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => addLine("room", true)}>
                  <Plus size={16} weight="bold" />
                  {options.rooms.length ? "Room not in your inventory" : "Add room"}
                </Button>
              </div>
            </section>

            {/* 5. Tax, discount and note, next to the total */}
            {has("tax") || has("discount") || has("notes") || notes || noteOpen ? (
              <section aria-label="Tax and notes" className="grid gap-4 sm:grid-cols-2">
                {has("tax") ? (
                  <Field label={layout === "gst" ? "GST %, split into CGST and SGST" : "GST %"} htmlFor="tax">
                    <Input
                      id="tax"
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      inputMode="decimal"
                      value={taxPercent || ""}
                      placeholder="0"
                      onChange={(e) => {
                        touch();
                        setTaxPercent(toNumber(e.target.value));
                      }}
                      className="tabular-nums"
                    />
                  </Field>
                ) : null}
                {has("discount") ? (
                  <Field
                    label="Discount"
                    htmlFor="discount"
                    hint={discountMode === "percent" && discountShown > 0 ? `${inr(discountShown)} off the subtotal` : undefined}
                  >
                    <div className="flex gap-2">
                      <Input
                        id="discount"
                        type="number"
                        min={0}
                        max={discountMode === "percent" ? 100 : undefined}
                        step={discountMode === "percent" ? "0.5" : "0.01"}
                        inputMode="decimal"
                        value={discount || ""}
                        placeholder="0"
                        onChange={(e) => {
                          touch();
                          setDiscount(toNumber(e.target.value));
                        }}
                        className="tabular-nums"
                      />
                      {/* Rupees or a percentage of the subtotal. */}
                      <div role="group" aria-label="Discount in" className="flex shrink-0 rounded-md border border-line p-0.5">
                        {(["amount", "percent"] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            aria-pressed={discountMode === m}
                            data-discount-mode={m}
                            onClick={() => {
                              touch();
                              setDiscountMode(m);
                            }}
                            className={cx(
                              "h-10 w-10 rounded text-body font-medium transition-colors duration-150 md:h-8",
                              discountMode === m ? "bg-sunken text-fg" : "text-fg-3 hover:text-fg",
                            )}
                          >
                            {m === "amount" ? "₹" : "%"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Field>
                ) : null}
                {has("notes") || notes || noteOpen ? (
                  <Field
                    label={
                      quote ? "Letter, printed under To" : layout === "proforma" ? "Payment note, printed above the bank details" : "Note on the bill"
                    }
                    htmlFor="notes"
                    className="sm:col-span-2"
                  >
                    <Textarea
                      id="notes"
                      rows={quote ? 4 : layout === "proforma" ? 3 : 2}
                      value={notes}
                      onChange={(e) => {
                        touch();
                        setNotes(e.target.value);
                      }}
                    />
                  </Field>
                ) : null}
              </section>
            ) : null}
            {has("notes") || notes || noteOpen ? null : (
              <button type="button" onClick={() => setNoteOpen(true)} className="text-ui text-accent hover:underline">
                Add a note
              </button>
            )}

            {/* 6. Quotation: when each part is paid, and who signs it */}
            {has("schedule") ? (
              <section aria-labelledby="schedule-heading" className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="schedule-heading" className="text-body font-semibold text-fg">
                    Payment schedule
                  </h2>
                  <p data-schedule-sum className={cx("text-ui tabular-nums", scheduled > 0 && Math.abs(scheduled - total) > 0.004 ? "font-medium text-bad" : "text-fg-3")}>
                    {scheduled > 0 ? `Adds up to ${inr(scheduled)} of ${inr(total)}` : "Amounts are optional"}
                  </p>
                </div>
                <ul className="space-y-2">
                  {schedule.map((r, i) => (
                    <li key={i} data-schedule-row className="grid grid-cols-[minmax(0,1fr)_110px_36px] gap-2 sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1.3fr)_36px] sm:items-end">
                      <Field label={i === 0 ? "Instalment" : ""} htmlFor={`sch-${i}-label`}>
                        <Input id={`sch-${i}-label`} aria-label="Instalment" value={r.label} onChange={(e) => setScheduleRow(i, { label: e.target.value })} />
                      </Field>
                      <Field label={i === 0 ? "Amount" : ""} htmlFor={`sch-${i}-amount`}>
                        <Input
                          id={`sch-${i}-amount`}
                          aria-label="Amount"
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={r.amount || ""}
                          placeholder="0"
                          onChange={(e) => setScheduleRow(i, { amount: toNumber(e.target.value) })}
                          className="tabular-nums"
                        />
                      </Field>
                      <Field label={i === 0 ? "When" : ""} htmlFor={`sch-${i}-due`} className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                        <Input id={`sch-${i}-due`} aria-label="When" value={r.due} onChange={(e) => setScheduleRow(i, { due: e.target.value })} />
                      </Field>
                      <Button
                        variant="ghost"
                        aria-label="Remove this instalment"
                        className="px-0 sm:w-9"
                        onClick={() => {
                          touch();
                          setSchedule((rows) => rows.filter((_, j) => j !== i));
                        }}
                      >
                        <Trash size={16} />
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      touch();
                      setSchedule((rows) => [...rows, { label: `Installment ${rows.length + 1}`, amount: 0, due: "" }]);
                    }}
                  >
                    <Plus size={16} weight="bold" />
                    Add instalment
                  </Button>
                  {schedule.length && total > 0 ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        touch();
                        // Equal parts of the total; the last one takes the paise left over.
                        const part = Math.floor((total / schedule.length) * 100) / 100;
                        setSchedule((rows) =>
                          rows.map((r, i) => ({ ...r, amount: i === rows.length - 1 ? round2(total - part * (rows.length - 1)) : part })),
                        );
                      }}
                    >
                      Split the total equally
                    </Button>
                  ) : null}
                </div>
              </section>
            ) : null}
            {has("signatory") ? (
              <section aria-labelledby="sign-heading" className="space-y-3">
                <h2 id="sign-heading" className="text-body font-semibold text-fg">
                  Signed by
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Booking manager" htmlFor="d-sign-name">
                    <Input id="d-sign-name" value={details.signName} onChange={(e) => setDetail({ signName: e.target.value })} />
                  </Field>
                  <Field label="Mobile" htmlFor="d-sign-phone">
                    <Input id="d-sign-phone" type="tel" inputMode="tel" value={details.signPhone} onChange={(e) => setDetail({ signPhone: e.target.value })} />
                  </Field>
                </div>
              </section>
            ) : null}
          </div>

          <div className="sticky bottom-(--tabbar-h) z-10 border-t border-line bg-surface px-4 py-3 md:bottom-0 md:px-6">
            {error ? (
              <div className="mb-2">
                <ErrorText>{error}</ErrorText>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <div className="mr-auto min-w-0">
                <p className="text-ui text-fg-3">{saved || "Total"}</p>
                <p className="text-title font-semibold tracking-tight text-fg tabular-nums">{inr(total)}</p>
              </div>
              {confirming ? (
                <>
                  <p className="basis-full text-ui text-fg-2 sm:basis-auto">
                    {total === 0 ? (
                      <span className="font-medium text-bad">The total is ₹0. Check the rates first. </span>
                    ) : null}
                    {layout === "gst" && taxPercent === 0 ? (
                      <span data-gst-warning className="font-medium text-bad">GST is 0% on this GST bill. Check the rate first. </span>
                    ) : null}
                    Finalising gives the bill a number. It can no longer be edited, only cancelled.
                  </p>
                  <Button onClick={() => setConfirming(false)} disabled={pending}>
                    Back
                  </Button>
                  <Button variant="primary" onClick={() => save(true)} disabled={pending}>
                    {pending ? "Finalising" : "Yes, finalise"}
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={() => save(false)} disabled={pending}>
                    {pending ? "Saving" : "Save draft"}
                  </Button>
                  <Button variant="primary" onClick={() => setConfirming(true)} disabled={pending}>
                    Finalise
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ---------- preview ---------- */}
        <div className={cx("border-line bg-canvas lg:border-l", view === "edit" && "hidden lg:block")}>
          <div className="p-4 md:p-6 lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-auto">
            <BillPaper data={paper} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LineEditor({
  line,
  rooms,
  services,
  availability,
  booking,
  onChange,
  onRemove,
}: {
  line: Line;
  rooms: Options["rooms"];
  services: Options["services"];
  availability: StayAvailability | undefined;
  /** The booking's check-in and nights, typed once at the top. */
  booking: { checkIn: string; nights: number };
  onChange: (patch: Partial<Line>, takePrice?: boolean) => void;
  onRemove: () => void;
}) {
  const p = `line-${line.id}`;
  const room = line.kind === "room";
  const stockRoom = room && !line.manual;
  /*
    A room stays on the booking's dates, which are typed once at the top and
    moved with it when they change. Its own dates show only when asked for
    (a split stay), or when they already differ, or before the booking has dates.
  */
  const bookingDated = isISODate(booking.checkIn) && booking.nights > 0;
  const onBookingDates = bookingDated && line.checkIn === booking.checkIn && line.nights === booking.nights;
  const [ownDates, setOwnDates] = useState(false);
  const showDates = room && (!onBookingDates || ownDates);

  let note: { text: string; bad: boolean } | null = null;
  if (line.kind === "room" && line.manual) {
    note = { text: "Typed by hand. Not taken from your inventory.", bad: false };
  } else if (line.kind === "room" && availability) {
    if (availability.left === null) {
      note = { text: "No rooms are held for these nights.", bad: true };
    } else if (availability.stopped) {
      note = { text: "On stop sale for these nights.", bad: true };
    } else if (availability.left < line.quantity) {
      note = {
        text: availability.left <= 0 ? "Sold out for these nights." : `Only ${availability.left} left for these nights.`,
        bad: true,
      };
    } else {
      note = { text: `${availability.left} of ${availability.held} left for these nights.`, bad: false };
    }
  }

  return (
    <li data-line-kind={room ? (line.manual ? "typed-room" : "room") : "item"} className="rounded-lg border border-line p-3">
      <div
        className={cx(
          "grid grid-cols-2 gap-3 sm:items-end",
          room && showDates
            ? "sm:grid-cols-[160px_80px_80px_minmax(0,1fr)_36px]"
            : room
              ? "sm:grid-cols-[110px_minmax(0,1fr)_36px]"
              : "grid-cols-3 sm:grid-cols-[90px_90px_140px_minmax(0,1fr)_36px]",
        )}
      >
        {stockRoom ? (
          <Field label="Room" htmlFor={`${p}-room`} className="col-span-full">
            <Select
              id={`${p}-room`}
              value={line.roomTypeId}
              onChange={(e) => onChange({ roomTypeId: e.target.value }, true)}
            >
              <option value="">{rooms.length ? "Pick a room" : "No rooms in inventory yet"}</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {room && line.manual ? (
          <Field label="Room" htmlFor={`${p}-desc`} className="col-span-full">
            <Input
              id={`${p}-desc`}
              value={line.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="For example Deluxe Room"
            />
          </Field>
        ) : null}

        {room ? (
          <Field label="Sharing and meals" htmlFor={`${p}-extra`} className="col-span-full">
            <Input
              id={`${p}-extra`}
              value={line.extra}
              onChange={(e) => onChange({ extra: e.target.value })}
              placeholder="For example triple sharing, breakfast and dinner"
            />
          </Field>
        ) : null}

        {!room ? (
          <>
            {services.length ? (
              <Field label="Saved service" htmlFor={`${p}-service`} className="col-span-full">
                <Select
                  id={`${p}-service`}
                  value=""
                  onChange={(e) => {
                    const s = services.find((x) => x.id === e.target.value);
                    if (!s) return;
                    onChange({
                      description: s.details ? `${s.name}\n${s.details}` : s.name,
                      rate: s.rate || line.rate,
                    });
                  }}
                >
                  <option value="">Pick one to fill in the item, or type your own below</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.rate ? `${s.name}, ${inr(s.rate)}` : s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Item" htmlFor={`${p}-desc`} className="col-span-full">
              <Textarea
                id={`${p}-desc`}
                rows={Math.min(Math.max(line.description.split("\n").length, 2), 8)}
                value={line.description}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder="What you are billing for, for example Airport transfer, Innova, both ways"
              />
            </Field>
          </>
        ) : null}

        {showDates ? (
          <>
            <Field label="Check-in" htmlFor={`${p}-in`}>
              <Input
                id={`${p}-in`}
                type="date"
                value={line.checkIn}
                onChange={(e) => onChange({ checkIn: e.target.value }, true)}
              />
            </Field>
            <Field label="Nights" htmlFor={`${p}-nights`}>
              <Input
                id={`${p}-nights`}
                type="number"
                min={1}
                inputMode="numeric"
                value={line.nights || ""}
                onChange={(e) => onChange({ nights: Math.floor(toNumber(e.target.value)) })}
                className="tabular-nums"
              />
            </Field>
          </>
        ) : null}

        <Field label={line.kind === "room" ? "Rooms" : "Qty"} htmlFor={`${p}-qty`}>
          <Input
            id={`${p}-qty`}
            type="number"
            min={1}
            inputMode="numeric"
            value={line.quantity || ""}
            onChange={(e) =>
              onChange({
                quantity: line.kind === "room" ? Math.floor(toNumber(e.target.value)) : toNumber(e.target.value),
              })
            }
            className="tabular-nums"
          />
        </Field>

        {!room ? (
          <Field label="Days" htmlFor={`${p}-days`}>
            <Input
              id={`${p}-days`}
              type="number"
              min={1}
              inputMode="numeric"
              value={line.nights || ""}
              onChange={(e) => onChange({ nights: Math.max(Math.floor(toNumber(e.target.value)), 0) })}
              className="tabular-nums"
            />
          </Field>
        ) : null}

        <Field label="Rate" htmlFor={`${p}-rate`}>
          <Input
            id={`${p}-rate`}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={line.rate || ""}
            placeholder="0"
            onChange={(e) => onChange({ rate: toNumber(e.target.value) })}
            className="tabular-nums"
          />
        </Field>

        {/* Keeps Remove at the far right on wide screens. */}
        {!room ? <span aria-hidden className="hidden sm:block" /> : null}

        <Button
          variant="ghost"
          onClick={onRemove}
          aria-label="Remove this line"
          className="col-span-full px-0 sm:col-span-1 sm:w-9"
        >
          <Trash size={16} />
          <span className="sm:hidden">Remove</span>
        </Button>
      </div>

      {room && bookingDated ? (
        <p data-room-dates className="mt-2 text-ui text-fg-3">
          {showDates && !onBookingDates ? (
            <>
              Its own dates.{" "}
              <button
                type="button"
                onClick={() => {
                  setOwnDates(false);
                  onChange({ checkIn: booking.checkIn, nights: booking.nights }, line.rate === 0);
                }}
                className="font-medium text-accent hover:underline"
              >
                Use the booking dates
              </button>
            </>
          ) : (
            <>
              {fmtDate(booking.checkIn)} to {fmtDate(addDays(booking.checkIn, booking.nights))}, {booking.nights} night
              {booking.nights > 1 ? "s" : ""}, as booked.{" "}
              {showDates ? null : (
                <button type="button" onClick={() => setOwnDates(true)} className="font-medium text-accent hover:underline">
                  Different dates?
                </button>
              )}
            </>
          )}
        </p>
      ) : null}

      <div className="mt-2 flex items-baseline justify-between gap-3 text-ui">
        <span className={note?.bad ? "font-medium text-bad" : "text-fg-3"}>{note?.text ?? ""}</span>
        <span className="text-fg-2 tabular-nums">
          Amount <span className="font-medium text-fg">{inr(lineAmount(line))}</span>
        </span>
      </div>
    </li>
  );
}
