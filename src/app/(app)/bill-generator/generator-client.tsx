"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
  billTotals,
  emptyDetails,
  stayDays,
  type BookingDetails,
  type Layout,
} from "@/lib/bill-document";
import { addDays, inr, isISODate, round2 } from "@/lib/format";
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
};

type Line = {
  id: number;
  /** "other" is any item or service. "room" is a room, from stock or typed by hand. */
  kind: "room" | "other";
  /** A room typed by hand: it has no room type and never touches inventory. */
  manual: boolean;
  roomTypeId: string;
  description: string;
  checkIn: string;
  nights: number;
  quantity: number;
  rate: number;
};

export type Draft = {
  id: string;
  /** Goes up on every save; used to notice someone else's change. */
  version: number;
  changedBy: string;
  companyId: string;
  formatId: string;
  clientId: string;
  billDate: string;
  taxPercent: number;
  discount: number;
  notes: string;
  details: BookingDetails;
  lines: Line[];
  availability: Record<number, StayAvailability>;
};

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
  const [clientId, setClientId] = useState(draft?.clientId ?? initialClientId);
  const [billDate, setBillDate] = useState(draft?.billDate ?? today);
  const [taxPercent, setTaxPercent] = useState(draft?.taxPercent ?? 0);
  const [discount, setDiscount] = useState(draft?.discount ?? 0);
  const [details, setDetails] = useState<BookingDetails>(draft?.details ?? emptyDetails());
  const [notes, setNotes] = useState(draft?.notes ?? "");
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
  const client = options.clients.find((c) => c.id === clientId) ?? null;

  const layout: Layout = format?.layout ?? "gst";
  const amounts = useMemo(() => lines.map((l) => ({ amount: lineAmount(l) })), [lines]);
  const { subtotal, tax, discount: discountShown, total } = billTotals(
    amounts,
    layout,
    Boolean(format?.hasTaxLine),
    taxPercent,
    discount,
  );

  const setDetail = (patch: Partial<BookingDetails>) => {
    touch();
    setDetails((d) => ({ ...d, ...patch }));
  };

  /*
    Fills the booking details from the room items: the hotel, the first
    check-in, the last check-out and the number of rooms. Only empty fields
    are filled, so nothing typed is lost.
  */
  function fillFromItems() {
    const rooms = lines.filter((l) => l.kind === "room" && isISODate(l.checkIn) && l.nights > 0);
    if (!rooms.length) return;
    const first = rooms[0];
    const stock = options.rooms.find((r) => r.id === first.roomTypeId);
    const typed = first.manual ? first.description.split(",").map((s) => s.trim()) : [];
    const hotel = stock ? stock.hotel : (typed[1] ?? "");
    const checkIn = rooms.map((l) => l.checkIn).sort()[0];
    const checkOut = rooms.map((l) => addDays(l.checkIn, l.nights)).sort().at(-1) ?? "";
    const roomCount = rooms.reduce((sum, l) => sum + l.quantity, 0);
    const kinds = [...new Set(rooms.map((l) => (stock && l.roomTypeId ? options.rooms.find((r) => r.id === l.roomTypeId)?.room : typed[0]) ?? ""))].filter(Boolean);
    setDetail({
      hotelName: details.hotelName || [hotel, stock?.city].filter(Boolean).join(", "),
      checkIn: details.checkIn || checkIn,
      checkOut: details.checkOut || checkOut,
      rooms: details.rooms || `${roomCount} ${kinds.join(", ")}`.trim(),
    });
  }

  const touch = () => {
    setSaved("");
    setError("");
    setConfirming(false);
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
        checkIn: kind === "room" ? today : "",
        nights: 1,
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
    clientId,
    billDate,
    taxPercent,
    discount: layout === "proforma" ? discount : 0,
    notes,
    details,
    lines: lines.map((l) => ({
      kind: l.kind,
      manual: l.manual,
      roomTypeId: l.roomTypeId,
      description: l.description,
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
    router.replace("/bill-generator");
  }

  const paper: PaperData = {
    layout,
    company,
    client,
    details,
    logoUrl: company.logoUrl,
    stampUrl: company.stampUrl,
    title: format?.title ?? "",
    number: null,
    billDate,
    lines: lines.map((l) => ({
      key: l.id,
      kind: l.kind,
      description:
        l.kind === "room" && !l.manual
          ? (options.rooms.find((r) => r.id === l.roomTypeId)?.label ?? "Pick a room")
          : l.description,
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
    total,
    notes,
    paid: null,
  };
  const hasRooms = lines.some((l) => l.kind === "room");

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
          <div className="flex-1 space-y-6 p-4 md:p-6">
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bill from" htmlFor="company">
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

              <Field
                label="Format"
                htmlFor="format"
                hint={
                  format && !format.countsAsSale
                    ? "Not a sale: takes no rooms and nothing is owed until a bill is made from it."
                    : undefined
                }
              >
                <Select
                  id="format"
                  value={format?.id ?? ""}
                  onChange={(e) => {
                    touch();
                    setFormatId(e.target.value);
                  }}
                >
                  {company.formats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Client"
                htmlFor="client"
                hint={
                  options.clients.length === 0 ? (
                    <Link href="/clients" className="text-accent hover:underline">
                      Add your first client
                    </Link>
                  ) : undefined
                }
              >
                <Select
                  id="client"
                  value={clientId}
                  onChange={(e) => {
                    touch();
                    setClientId(e.target.value);
                  }}
                >
                  <option value="">Pick a client</option>
                  {options.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Bill date" htmlFor="billDate">
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

            <section aria-labelledby="lines-heading" className="space-y-3">
              <h2 id="lines-heading" className="text-body font-semibold text-fg">
                Items
              </h2>

              {lines.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-body text-fg-2">
                  No items yet. Add any service, such as a transfer, tour or visa, or a room.
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
                <Button onClick={() => addLine("room")}>
                  <Plus size={16} weight="bold" />
                  Room from inventory
                </Button>
                <Button variant="ghost" onClick={() => addLine("room", true)}>
                  <Plus size={16} weight="bold" />
                  Room, not from stock
                </Button>
              </div>
            </section>

            <section aria-labelledby="details-heading" className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id="details-heading" className="text-body font-semibold text-fg">
                    Booking details
                  </h2>
                  <p className="text-ui text-fg-3">Printed on the bill. Leave out anything that does not apply.</p>
                </div>
                {hasRooms ? (
                  <Button variant="ghost" onClick={fillFromItems}>
                    Fill from the rooms above
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Booking ref" htmlFor="d-ref" hint="Team or person the booking is for.">
                  <Input id="d-ref" value={details.bookingRef} onChange={(e) => setDetail({ bookingRef: e.target.value })} />
                </Field>
                {layout === "proforma" ? (
                  <Field label="Pay by" htmlFor="d-payby" hint="Printed as: kindly pay the full amount before this date.">
                    <Input id="d-payby" type="date" value={details.payBy} onChange={(e) => setDetail({ payBy: e.target.value })} />
                  </Field>
                ) : (
                  <Field label="Place of supply" htmlFor="d-place" hint="The state.">
                    <Input
                      id="d-place"
                      list="indian-states"
                      value={details.placeOfSupply}
                      onChange={(e) => setDetail({ placeOfSupply: e.target.value })}
                    />
                    <datalist id="indian-states">
                      {INDIAN_STATES.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </Field>
                )}
                <Field label="Hotel name" htmlFor="d-hotel">
                  <Input id="d-hotel" value={details.hotelName} onChange={(e) => setDetail({ hotelName: e.target.value })} />
                </Field>
                <Field label="Hotel address" htmlFor="d-haddr">
                  <Input id="d-haddr" value={details.hotelAddress} onChange={(e) => setDetail({ hotelAddress: e.target.value })} />
                </Field>
                <Field label="Check-in date" htmlFor="d-in">
                  <Input id="d-in" type="date" value={details.checkIn} onChange={(e) => setDetail({ checkIn: e.target.value })} />
                </Field>
                <Field
                  label="Check-out date"
                  htmlFor="d-out"
                  hint={stayDays(details.checkIn, details.checkOut) ? `${stayDays(details.checkIn, details.checkOut)} days` : undefined}
                >
                  <Input id="d-out" type="date" value={details.checkOut} onChange={(e) => setDetail({ checkOut: e.target.value })} />
                </Field>
                <Field label="Members" htmlFor="d-members">
                  <Input id="d-members" value={details.members} onChange={(e) => setDetail({ members: e.target.value })} />
                </Field>
                <Field label="Rooms" htmlFor="d-rooms" hint="For example 12 Deluxe.">
                  <Input id="d-rooms" value={details.rooms} onChange={(e) => setDetail({ rooms: e.target.value })} />
                </Field>
                <Field label="Occupancy" htmlFor="d-occ" hint="For example Triple sharing.">
                  <Input id="d-occ" value={details.occupancy} onChange={(e) => setDetail({ occupancy: e.target.value })} />
                </Field>
                <Field label={layout === "proforma" ? "Meal plan" : "Food facility"} htmlFor="d-meal" hint="For example Breakfast and dinner.">
                  <Input id="d-meal" value={details.mealPlan} onChange={(e) => setDetail({ mealPlan: e.target.value })} />
                </Field>
                <Field label="Transport facility" htmlFor="d-transport" className="sm:col-span-2">
                  <Input id="d-transport" value={details.transport} onChange={(e) => setDetail({ transport: e.target.value })} />
                </Field>
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              {format?.hasTaxLine ? (
                <Field
                  label="GST %"
                  htmlFor="tax"
                  hint={layout === "gst" ? "Printed as CGST and SGST, half each." : "Leave at 0 for no GST line."}
                >
                  <Input
                    id="tax"
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    inputMode="decimal"
                    value={taxPercent}
                    onChange={(e) => {
                      touch();
                      setTaxPercent(toNumber(e.target.value));
                    }}
                    className="tabular-nums"
                  />
                </Field>
              ) : null}
              {layout === "proforma" ? (
                <Field label="Discount" htmlFor="discount" hint="An amount in rupees, taken off the total.">
                  <Input
                    id="discount"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={discount}
                    onChange={(e) => {
                      touch();
                      setDiscount(toNumber(e.target.value));
                    }}
                    className="tabular-nums"
                  />
                </Field>
              ) : null}
              <Field label="Notes on the bill" htmlFor="notes" className="sm:col-span-2">
                <Textarea
                  id="notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => {
                    touch();
                    setNotes(e.target.value);
                  }}
                  placeholder="Shown at the bottom of the bill"
                />
              </Field>
            </div>
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
  onChange,
  onRemove,
}: {
  line: Line;
  rooms: Options["rooms"];
  services: Options["services"];
  availability: StayAvailability | undefined;
  onChange: (patch: Partial<Line>, takePrice?: boolean) => void;
  onRemove: () => void;
}) {
  const p = `line-${line.id}`;
  const room = line.kind === "room";
  const stockRoom = room && !line.manual;

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
          room
            ? "sm:grid-cols-[160px_80px_80px_minmax(0,1fr)_36px]"
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
          <Field label="Room and hotel" htmlFor={`${p}-desc`} className="col-span-full">
            <Input
              id={`${p}-desc`}
              value={line.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="For example Deluxe Room, Sea View Resort, Goa"
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

        {room ? (
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
                value={line.nights}
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
            value={line.quantity}
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
              value={line.nights}
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
            value={line.rate}
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

      <div className="mt-2 flex items-baseline justify-between gap-3 text-ui">
        <span className={note?.bad ? "font-medium text-bad" : "text-fg-3"}>{note?.text ?? ""}</span>
        <span className="text-fg-2 tabular-nums">
          Amount <span className="font-medium text-fg">{inr(lineAmount(line))}</span>
        </span>
      </div>
    </li>
  );
}
