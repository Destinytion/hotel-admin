"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "@/components/link";
import { CaretLeft, CaretRight, PencilSimple, Trash } from "@phosphor-icons/react";
import {
  Button,
  EmptyState,
  ErrorText,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  cx,
} from "@/components/ui";
import { useEvery } from "@/components/live";
import { SidePanel } from "@/components/side-panel";
import { addDays, dayName, fmtDate, fmtDateLong, inr } from "@/lib/format";
import {
  addStock,
  addStopSale,
  deleteStockBlock,
  deleteStopSale,
  getRoomDetail,
  updateStockBlock,
  type PayFor,
  type RoomDetail,
} from "./actions";

type Cell = { held: number; sold: number; stopped: boolean; price: number | null };

export type RoomRow = {
  id: string;
  name: string;
  hotel: string;
  city: string;
  releaseDate: string | null;
  cells: Cell[];
};

type CellState = "none" | "open" | "low" | "sold" | "stop";

function cellState(cell: Cell | undefined): CellState {
  if (!cell || cell.held === 0) return "none";
  if (cell.stopped) return "stop";
  const left = cell.held - cell.sold;
  if (left <= 0) return "sold";
  if (left <= 2) return "low";
  return "open";
}

const cellClass: Record<CellState, string> = {
  none: "bg-canvas text-fg-3",
  open: "text-fg",
  low: "bg-warn-soft text-warn",
  sold: "bg-bad-soft text-bad",
  stop: "bg-sunken text-fg-3",
};

function priceLabel(cells: Cell[]) {
  const prices = cells.map((c) => c.price).filter((p): p is number => p !== null);
  if (!prices.length) return "";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `${inr(min)} a night` : `${inr(min)} to ${inr(max)} a night`;
}

type StockForm = {
  /** Set when editing an existing block. */
  blockId?: string;
  updatedAt?: string;
  /** The room whose panel to return to after editing. */
  roomTypeId?: string;
  hotel: string;
  city: string;
  roomType: string;
  firstNight: string;
  lastNight: string;
  roomsHeld: string;
  sellPrice: string;
  costPrice: string;
  releaseDate: string;
  payFor: PayFor;
};

const navLink =
  "inline-flex h-11 items-center justify-center gap-1 rounded-md border border-line bg-surface px-2.5 text-body font-medium text-fg transition-colors duration-150 hover:bg-sunken md:h-9";

function newForm(from: string, room?: RoomRow): StockForm {
  return {
    hotel: room?.hotel ?? "",
    city: room?.city ?? "",
    roomType: room?.name ?? "",
    firstNight: from,
    lastNight: addDays(from, 13),
    roomsHeld: "",
    sellPrice: "",
    costPrice: "",
    releaseDate: "",
    payFor: "held",
  };
}

export function InventoryClient({
  rows,
  dates,
  today,
  initialRoomId = null,
  initialAdd = false,
}: {
  rows: RoomRow[];
  dates: string[];
  today: string;
  /** Opens this room's panel straight away, for links from search. */
  initialRoomId?: string | null;
  /** Opens Add rooms straight away. */
  initialAdd?: boolean;
}) {
  const [day, setDay] = useState(0);
  const [form, setForm] = useState<StockForm | null>(() =>
    initialAdd && !initialRoomId ? newForm(dates[0]) : null,
  );
  const [openId, setOpenId] = useState<string | null>(initialRoomId);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const hotels = [...new Set(rows.map((r) => r.hotel))];
  const open = rows.find((r) => r.id === openId) ?? null;
  const from = dates[0];

  const held = rows.reduce((sum, r) => sum + r.cells.reduce((a, c) => a + c.held, 0), 0);
  const sold = rows.reduce((sum, r) => sum + r.cells.reduce((a, c) => a + c.sold, 0), 0);

  function startForm(room?: RoomRow) {
    setError("");
    setOpenId(null);
    setForm(newForm(from, room));
  }

  function editBlock(room: RoomRow, block: RoomDetail["blocks"][number]) {
    setError("");
    setOpenId(null);
    setForm({
      blockId: block.id,
      updatedAt: block.updatedAt,
      roomTypeId: room.id,
      hotel: room.hotel,
      city: room.city,
      roomType: room.name,
      firstNight: block.firstNight,
      lastNight: block.lastNight,
      roomsHeld: String(block.roomsHeld),
      sellPrice: String(block.sellPrice),
      costPrice: block.costPrice === null ? "" : String(block.costPrice),
      releaseDate: block.releaseDate ?? "",
      payFor: block.payFor,
    });
  }

  const loadDetail = useCallback(async (id: string) => {
    const result = await getRoomDetail(id);
    if (result.ok) setDetail(result.data);
  }, []);

  // The open room's blocks are kept current while others change inventory.
  const reloadOpen = useCallback(() => {
    if (openId) void loadDetail(openId);
  }, [openId, loadDetail]);
  useEvery(15, reloadOpen);

  // Opened from search with a room picked: load its details once.
  useEffect(() => {
    if (!initialRoomId) return;
    void getRoomDetail(initialRoomId).then((result) => {
      if (result.ok) setDetail(result.data);
    });
  }, [initialRoomId]);

  function openRoom(id: string) {
    setForm(null);
    setError("");
    setDetail(null);
    setOpenId(id);
    void loadDetail(id);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setPending(true);
    setError("");
    const numbers = {
      firstNight: form.firstNight,
      lastNight: form.lastNight,
      roomsHeld: Number(form.roomsHeld),
      sellPrice: form.sellPrice === "" ? NaN : Number(form.sellPrice),
      costPrice: form.costPrice === "" ? null : Number(form.costPrice),
      releaseDate: form.releaseDate,
      payFor: form.payFor,
    };
    const result =
      form.blockId && form.updatedAt
        ? await updateStockBlock({ id: form.blockId, updatedAt: form.updatedAt, ...numbers })
        : await addStock({ hotel: form.hotel, city: form.city, roomType: form.roomType, ...numbers });
    setPending(false);
    if (!result.ok) return setError(result.error);
    const backTo = form.roomTypeId;
    setForm(null);
    // After an edit, go back to the room it belongs to.
    if (backTo) openRoom(backTo);
  }

  const set = (patch: Partial<StockForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  /** Closing an edit goes back to the room's panel; closing Add rooms just closes. */
  function closeForm() {
    const backTo = form?.roomTypeId;
    setForm(null);
    if (backTo) openRoom(backTo);
  }
  const knownHotel = form ? rows.find((r) => r.hotel.toLowerCase() === form.hotel.trim().toLowerCase()) : null;

  return (
    <>
      <PageHeader
        title="Inventory"
        description={`${fmtDate(dates[0])} to ${fmtDateLong(dates[dates.length - 1])}`}
        actions={
          <>
            <Link href={`/inventory?from=${addDays(from, -14)}`} aria-label="Earlier dates" className={navLink}>
              <CaretLeft size={16} />
            </Link>
            <Link href="/inventory" className={navLink}>
              Today
            </Link>
            <Link href={`/inventory?from=${addDays(from, 14)}`} aria-label="Later dates" className={navLink}>
              <CaretRight size={16} />
            </Link>
            <Link href="/import?what=rooms" className={navLink}>
              Import
            </Link>
            <Button variant="primary" onClick={() => startForm()}>
              Add rooms
            </Button>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No rooms yet"
          action={
            <Button variant="primary" onClick={() => startForm()}>
              Add rooms
            </Button>
          }
        >
          Add the rooms you hold at a hotel: how many, for which nights, and the price. What you sell
          is taken off automatically when a bill is finalised.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-3 md:px-6">
            <dl className="flex gap-6 tabular-nums">
              {(
                [
                  ["Room nights held", held],
                  ["Sold", sold],
                  ["Left", held - sold],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-ui text-fg-3">{label}</dt>
                  <dd className="text-title font-semibold tracking-tight text-fg">{value}</dd>
                </div>
              ))}
            </dl>
            <ul aria-label="Legend" className="flex flex-wrap items-center gap-2 text-ui text-fg-2">
              <li className="mr-1 hidden md:block">Each cell shows rooms left.</li>
              <li><StatusBadge tone="warn">2 or fewer left</StatusBadge></li>
              <li><StatusBadge tone="bad">Sold out</StatusBadge></li>
              <li><StatusBadge tone="muted">Stop sale</StatusBadge></li>
            </ul>
          </div>

          {/* Desktop: rooms against dates */}
          <div className="hidden overflow-x-auto border-y border-line md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-canvas text-ui text-fg-3">
                  <th className="sticky left-0 z-10 min-w-64 border-r border-line bg-canvas px-6 py-2 text-left font-medium">
                    Room
                  </th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      className={cx(
                        "min-w-14 border-l border-line px-1 py-1.5 text-center font-medium",
                        d === today && "text-accent",
                      )}
                    >
                      <span className="block">{dayName(d)}</span>
                      <span className={cx("block tabular-nums", d === today ? "text-accent" : "text-fg")}>
                        {fmtDate(d)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hotels.map((hotel) => {
                  const group = rows.filter((r) => r.hotel === hotel);
                  return (
                    <Fragment key={hotel}>
                      <tr className="border-t border-line bg-canvas">
                        <th
                          colSpan={dates.length + 1}
                          className="sticky left-0 px-6 py-1.5 text-left text-ui font-semibold text-fg"
                        >
                          {hotel}
                          <span className="ml-2 font-normal text-fg-3">{group[0].city}</span>
                        </th>
                      </tr>
                      {group.map((r) => (
                        <tr key={r.id} className="border-t border-line">
                          <th className="sticky left-0 z-10 border-r border-line bg-surface p-0 text-left font-normal">
                            <button
                              type="button"
                              onClick={() => openRoom(r.id)}
                              className={cx(
                                "block w-full px-6 py-2 text-left transition-colors duration-150 hover:bg-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                                openId === r.id && "bg-accent-soft",
                              )}
                            >
                              <span className="block text-body font-medium text-fg">{r.name}</span>
                              <span className="block text-ui text-fg-3 tabular-nums">
                                {[priceLabel(r.cells), r.releaseDate && `release ${fmtDate(r.releaseDate)}`]
                                  .filter(Boolean)
                                  .join(", ") || "No rooms in these dates"}
                              </span>
                            </button>
                          </th>
                          {dates.map((d, i) => {
                            const cell = r.cells[i];
                            const state = cellState(cell);
                            return (
                              <td
                                key={d}
                                title={
                                  state === "none"
                                    ? "No rooms held"
                                    : `${cell.held} held, ${cell.sold} sold`
                                }
                                className={cx(
                                  "border-l border-line px-1 text-center text-body font-medium tabular-nums",
                                  cellClass[state],
                                )}
                              >
                                {state === "none" ? (
                                  ""
                                ) : state === "stop" ? (
                                  <span className="text-ui">Stop</span>
                                ) : state === "sold" ? (
                                  <span className="text-ui">Sold</span>
                                ) : (
                                  cell.held - cell.sold
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: pick a night, see what is left */}
          <div className="md:hidden">
            <div
              className="flex gap-1.5 overflow-x-auto border-y border-line px-4 py-2"
              role="group"
              aria-label="Night"
            >
              {dates.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={day === i}
                  onClick={() => setDay(i)}
                  className={cx(
                    "flex h-12 min-w-14 shrink-0 flex-col items-center justify-center rounded-md border text-ui transition-colors duration-150",
                    day === i ? "border-ink bg-ink font-medium text-on-ink" : "border-line text-fg-2",
                  )}
                >
                  <span>{dayName(d)}</span>
                  <span className="tabular-nums">{fmtDate(d)}</span>
                </button>
              ))}
            </div>

            {hotels.map((hotel) => {
              const group = rows.filter((r) => r.hotel === hotel);
              return (
                <section key={hotel}>
                  <h2 className="border-b border-line bg-canvas px-4 py-1.5 text-ui font-semibold text-fg">
                    {hotel}
                    <span className="ml-2 font-normal text-fg-3">{group[0].city}</span>
                  </h2>
                  <ul className="divide-y divide-line border-b border-line">
                    {group.map((r) => {
                      const cell = r.cells[day];
                      const state = cellState(cell);
                      return (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => openRoom(r.id)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-body font-medium text-fg">{r.name}</p>
                              <p className="text-ui text-fg-3 tabular-nums">
                                {cell?.price != null ? `${inr(cell.price)} a night` : "No price for this night"}
                              </p>
                            </div>
                            {state === "none" ? (
                              <span className="text-ui text-fg-3">No rooms held</span>
                            ) : state === "stop" ? (
                              <StatusBadge tone="muted">Stop sale</StatusBadge>
                            ) : state === "sold" ? (
                              <StatusBadge tone="bad">Sold out</StatusBadge>
                            ) : (
                              <p className="text-right tabular-nums">
                                <span
                                  className={cx(
                                    "text-title font-semibold",
                                    state === "low" ? "text-warn" : "text-fg",
                                  )}
                                >
                                  {cell.held - cell.sold}
                                </span>
                                <span className="text-ui text-fg-3"> of {cell.held} left</span>
                              </p>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}

      {form ? (
        <SidePanel
          title={form.blockId ? "Edit rooms held" : "Add rooms"}
          subtitle={
            form.blockId
              ? `${form.roomType}, ${form.hotel}`
              : "A number of rooms you hold for a run of nights."
          }
          onClose={closeForm}
          footer={
            <>
              <Button onClick={closeForm}>Cancel</Button>
              <Button variant="primary" type="submit" form="stock-form" disabled={pending}>
                {pending ? "Saving" : form.blockId ? "Save changes" : "Save rooms"}
              </Button>
            </>
          }
        >
          <form id="stock-form" onSubmit={submit} className="flex flex-col gap-4 p-4 md:p-5">
            {form.blockId ? null : (
              <>
                <Field label="Hotel" htmlFor="st-hotel" hint="Pick an existing hotel or type a new name.">
                  <Input
                    id="st-hotel"
                    list="hotel-names"
                    value={form.hotel}
                    autoFocus
                    onChange={(e) => set({ hotel: e.target.value })}
                  />
                  <datalist id="hotel-names">
                    {hotels.map((h) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                </Field>
                {knownHotel ? null : (
                  <Field label="City" htmlFor="st-city">
                    <Input id="st-city" value={form.city} onChange={(e) => set({ city: e.target.value })} />
                  </Field>
                )}
                <Field label="Room type" htmlFor="st-room" hint="For example Deluxe Lake View.">
                  <Input
                    id="st-room"
                    list="room-names"
                    value={form.roomType}
                    onChange={(e) => set({ roomType: e.target.value })}
                  />
                  <datalist id="room-names">
                    {rows
                      .filter((r) => r.hotel.toLowerCase() === form.hotel.trim().toLowerCase())
                      .map((r) => (
                        <option key={r.id} value={r.name} />
                      ))}
                  </datalist>
                </Field>
              </>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="First night" htmlFor="st-first">
                <Input
                  id="st-first"
                  type="date"
                  value={form.firstNight}
                  onChange={(e) => set({ firstNight: e.target.value })}
                />
              </Field>
              <Field label="Last night" htmlFor="st-last">
                <Input
                  id="st-last"
                  type="date"
                  value={form.lastNight}
                  onChange={(e) => set({ lastNight: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Rooms held each night" htmlFor="st-held">
              <Input
                id="st-held"
                type="number"
                min={1}
                inputMode="numeric"
                value={form.roomsHeld}
                onChange={(e) => set({ roomsHeld: e.target.value })}
                className="tabular-nums"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Selling price a night" htmlFor="st-sell">
                <Input
                  id="st-sell"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.sellPrice}
                  onChange={(e) => set({ sellPrice: e.target.value })}
                  className="tabular-nums"
                />
              </Field>
              <Field label="Your cost a night" htmlFor="st-cost" hint="Optional.">
                <Input
                  id="st-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.costPrice}
                  onChange={(e) => set({ costPrice: e.target.value })}
                  className="tabular-nums"
                />
              </Field>
            </div>
            <Field
              label="Release date"
              htmlFor="st-release"
              hint="Optional. The date unsold rooms go back to the hotel."
            >
              <Input
                id="st-release"
                type="date"
                value={form.releaseDate}
                onChange={(e) => set({ releaseDate: e.target.value })}
              />
            </Field>
            <Field
              label="Pay the hotel for"
              htmlFor="st-payfor"
              hint="Decides what you owe the hotel on the Payments screen, To hotels."
            >
              <Select id="st-payfor" value={form.payFor} onChange={(e) => set({ payFor: e.target.value as PayFor })}>
                <option value="held">Every room held, sold or not</option>
                <option value="sold">Only the rooms sold</option>
              </Select>
            </Field>
            <ErrorText>{error}</ErrorText>
          </form>
        </SidePanel>
      ) : open ? (
        <RoomPanel
          key={open.id}
          room={open}
          detail={detail}
          onClose={() => setOpenId(null)}
          onAddMore={() => startForm(open)}
          onEdit={(block) => editBlock(open, block)}
          onChanged={() => loadDetail(open.id)}
        />
      ) : null}
    </>
  );
}

function RoomPanel({
  room,
  detail,
  onClose,
  onAddMore,
  onEdit,
  onChanged,
}: {
  room: RoomRow;
  detail: RoomDetail | null;
  onClose: () => void;
  onAddMore: () => void;
  onEdit: (block: RoomDetail["blocks"][number]) => void;
  onChanged: () => Promise<void>;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function act(work: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true);
    setError("");
    const result = await work();
    setPending(false);
    if (!result.ok) return setError(result.error ?? "That did not work.");
    await onChanged();
  }

  async function stop(event: React.FormEvent) {
    event.preventDefault();
    await act(() => addStopSale({ roomTypeId: room.id, firstNight: first, lastNight: last || first }));
    setFirst("");
    setLast("");
  }

  return (
    <SidePanel
      title={room.name}
      subtitle={[room.hotel, room.city].filter(Boolean).join(", ")}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onAddMore}>
          Add more rooms
        </Button>
      }
    >
      <section className="border-b border-line px-4 py-4 md:px-5">
        <h3 className="text-ui font-medium text-fg-3">Rooms held</h3>
        {!detail ? (
          <div aria-hidden className="mt-2 h-10 rounded-md bg-sunken" />
        ) : detail.blocks.length === 0 ? (
          <p className="mt-2 text-body text-fg-2">No rooms held for this room type.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {detail.blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-fg tabular-nums">
                    {fmtDate(b.firstNight)} to {fmtDateLong(b.lastNight)}
                  </p>
                  <p className="text-ui text-fg-3 tabular-nums">
                    {[
                      `${b.roomsHeld} rooms`,
                      `${inr(b.sellPrice)} a night`,
                      b.costPrice !== null && `cost ${inr(b.costPrice)}`,
                      b.releaseDate && `release ${fmtDate(b.releaseDate)}`,
                      b.payFor === "sold" && "pay for rooms sold",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => onEdit(b)}
                  aria-label={`Edit rooms held from ${fmtDate(b.firstNight)}`}
                  className="w-11 px-0 md:w-9"
                >
                  <PencilSimple size={16} />
                </Button>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => act(() => deleteStockBlock(b.id))}
                  aria-label={`Remove rooms held from ${fmtDate(b.firstNight)}`}
                  className="w-11 px-0 md:w-9"
                >
                  <Trash size={16} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-4 py-4 md:px-5">
        <h3 className="text-ui font-medium text-fg-3">Stop sale</h3>
        <p className="text-ui text-fg-2">
          Blocks these nights from being sold. The number of rooms held does not change.
        </p>
        {detail?.stopSales.length ? (
          <ul className="mt-2 divide-y divide-line">
            {detail.stopSales.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <p className="flex-1 text-body text-fg tabular-nums">
                  {fmtDate(s.firstNight)} to {fmtDateLong(s.lastNight)}
                </p>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => act(() => deleteStopSale(s.id))}
                  aria-label={`Lift stop sale from ${fmtDate(s.firstNight)}`}
                  className="w-11 px-0 md:w-9"
                >
                  <Trash size={16} />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={stop} className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          <Field label="First night" htmlFor="ss-first">
            <Input id="ss-first" type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field label="Last night" htmlFor="ss-last">
            <Input id="ss-last" type="date" value={last} onChange={(e) => setLast(e.target.value)} />
          </Field>
          <Button type="submit" disabled={pending || !first}>
            Stop
          </Button>
        </form>
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </section>
    </SidePanel>
  );
}
