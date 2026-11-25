import { addDays, fmtDateLong, round2 } from "./format";

/*
  One description of a bill, made the same way for the screen, the PDF and the
  Word file, so all three always agree. The layouts follow the user's own
  formats: the GST bill (with CGST and SGST), the Non-GST bill, the Proforma
  Invoice and the Quotation. GST and Non-GST bills are both titled "Invoice".
*/

export type Layout = "gst" | "non-gst" | "proforma" | "quotation";

export const LAYOUTS: { key: Layout; label: string }[] = [
  { key: "gst", label: "GST bill" },
  { key: "non-gst", label: "Non-GST bill" },
  { key: "proforma", label: "Proforma Invoice" },
  { key: "quotation", label: "Quotation" },
];

/** The note on the user's own Proforma Invoice, put in the notes of a new proforma to edit as needed. */
export const PROFORMA_NOTE =
  "Please proceed with the payment to the account detailed below:\nKindly Complete Full Amount before Specific Date.";

/** The letter on the user's own Quotation, put in the notes of a new quotation to edit as needed. */
export const QUOTATION_NOTE =
  "Greetings!!!\n\nDear Team,\nThis is with reference to your enquiry. Below is the Quotation for your accommodation arrangements.";

export const asLayout = (value: unknown): Layout =>
  value === "non-gst" || value === "proforma" || value === "quotation" ? value : "gst";

/** Layouts whose items table puts the rate before the number and days, as on the user's proforma and quotation. */
export const rateFirst = (layout: Layout) => layout === "proforma" || layout === "quotation";

/** One instalment of a quotation's payment schedule. */
export type ScheduleRow = { label: string; amount: number; due: string };

/** The schedule on the user's own Quotation; amounts are filled in on each quotation. */
export const defaultSchedule = (): ScheduleRow[] => [
  { label: "1st Installment", amount: 0, due: "At the time of Booking" },
  { label: "2nd Installment", amount: 0, due: "Before a Month of Check-in" },
  { label: "3rd Installment", amount: 0, due: "At the time of Check-in" },
];

/** A schedule from a bill's stored data, with anything malformed dropped. */
export function readSchedule(data: unknown): ScheduleRow[] {
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>).schedule : null;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map((r) => ({
      label: typeof r.label === "string" ? r.label : "",
      amount: Number.isFinite(Number(r.amount)) ? Number(r.amount) : 0,
      due: typeof r.due === "string" ? r.due : "",
    }));
}

/** The schedule rows worth printing: those with a name, an amount or a due note. */
export const scheduleShown = (rows: ScheduleRow[] | undefined) =>
  (rows ?? []).filter((r) => r.label.trim() || r.due.trim() || r.amount > 0);

/*
  What each of the user's formats asks for, taken from the Word files. The
  Bill Generator shows only these fields for the chosen format, and the bill
  prints only these.
*/
export type FormatField =
  | "bookingRef"
  | "placeOfSupply"
  | "clientGstin"
  | "hotelName"
  | "hotelAddress"
  | "checkIn"
  | "checkOut"
  | "members"
  | "rooms"
  | "occupancy"
  | "mealPlan"
  | "transport"
  | "tax"
  | "discount"
  | "notes"
  /** Quotation: the event the enquiry is for. */
  | "eventName"
  /** Quotation: instalments, each with an amount and when it is due. */
  | "schedule"
  /** Quotation: the booking manager signing it, with a mobile number. */
  | "signatory";

/*
  Rooms, sharing, food and transport are not asked for here: they are typed
  once, as charges, and the printed Booking Details box is filled in from
  those (see stayFromLines). The "rooms", "occupancy", "mealPlan" and
  "transport" fields stay only so bills saved before this still print.
*/
const FORMAT_FIELDS: Record<Layout, FormatField[]> = {
  // Discount is on every format at the user's request; it prints only when one is given.
  gst: ["bookingRef", "placeOfSupply", "clientGstin", "hotelName", "checkIn", "checkOut", "tax", "discount"],
  // GST is on the Non-GST bill too, at the user's request: a GST line prints only when a rate is given.
  "non-gst": ["bookingRef", "placeOfSupply", "hotelName", "checkIn", "checkOut", "members", "tax", "discount"],
  proforma: ["clientGstin", "hotelName", "hotelAddress", "checkIn", "checkOut", "members", "tax", "discount", "notes"],
  quotation: ["eventName", "hotelName", "checkIn", "checkOut", "members", "tax", "discount", "notes", "schedule", "signatory"],
};

/** Whether a format has this field. */
export const hasField = (layout: Layout, field: FormatField) => FORMAT_FIELDS[layout].includes(field);

/** Whether the company's GSTIN prints: always, except on a Non-GST bill where it is ticked to show. */
export const showsCompanyGstin = (doc: { layout: Layout; showGstin?: boolean }) => doc.layout !== "non-gst" || Boolean(doc.showGstin);

/** Whether the client's GSTIN prints: where the format asks for it, or on a Non-GST bill ticked to show it. */
export const showsClientGstin = (doc: { layout: Layout; showGstin?: boolean }) =>
  hasField(doc.layout, "clientGstin") || (doc.layout === "non-gst" && Boolean(doc.showGstin));

/** The booking a bill is for, as typed on the Bill Generator. Every field may be empty. */
export type BookingDetails = {
  /** Team or person the booking is for, printed as Booking Ref. */
  bookingRef: string;
  /** State, for the GST bill. */
  placeOfSupply: string;
  hotelName: string;
  hotelAddress: string;
  checkIn: string;
  checkOut: string;
  members: string;
  rooms: string;
  occupancy: string;
  /** Food facility or meal plan. */
  mealPlan: string;
  transport: string;
  /** Proforma: pay the full amount before this date. */
  payBy: string;
  /** Quotation: the event the enquiry is for. */
  eventName: string;
  /** Quotation: who signs it, and their mobile. */
  signName: string;
  signPhone: string;
};

export const emptyDetails = (): BookingDetails => ({
  bookingRef: "",
  placeOfSupply: "",
  hotelName: "",
  hotelAddress: "",
  checkIn: "",
  checkOut: "",
  members: "",
  rooms: "",
  occupancy: "",
  mealPlan: "",
  transport: "",
  payBy: "",
  eventName: "",
  signName: "",
  signPhone: "",
});

/** Reads booking details from a bill's stored data, whatever is missing left empty. */
export function readDetails(data: unknown): BookingDetails {
  const d = (data && typeof data === "object" ? (data as Record<string, unknown>).details : null) ?? {};
  const out = emptyDetails();
  for (const key of Object.keys(out) as (keyof BookingDetails)[]) {
    const v = (d as Record<string, unknown>)[key];
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

export type DocCompany = {
  name: string;
  initials: string;
  color: string;
  address: string;
  registration: string;
  email: string;
  phone: string;
  bankDetails: string;
  terms: string;
};

export type DocClient = {
  name: string;
  address: string;
  registration: string;
  contact: string;
  phone: string;
};

export type DocLine = {
  key: string | number;
  kind: "room" | "other";
  description: string;
  checkIn: string;
  /** Nights for a room, days for any other item. */
  nights: number;
  quantity: number;
  rate: number;
  amount: number;
};

export type BillDoc = {
  layout: Layout;
  title: string;
  number: string | null;
  billDate: string;
  company: DocCompany;
  client: DocClient | null;
  details: BookingDetails;
  lines: DocLine[];
  subtotal: number;
  taxPercent: number;
  tax: number;
  /** The discount in rupees. */
  discount: number;
  /** Non-GST bill only: print the GSTINs (company's and client's) anyway, when ticked. */
  showGstin?: boolean;
  /** When the discount was given as a percentage, that percentage, for the printed label. */
  discountPercent?: number | null;
  total: number;
  notes: string;
  cancelled?: boolean;
  /** What has been received, for the proforma's paid or not-paid line. Null on a draft. */
  paid?: number | null;
  /** Quotation: the payment schedule. */
  schedule?: ScheduleRow[];
};

/** Days between check-in and check-out, or 0 when either is missing. */
export function stayDays(checkIn: string, checkOut: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) return 0;
  const days = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
  return days > 0 ? days : 0;
}

/** CGST and SGST are each half of the tax, as on the GST bill. */
export function gstSplit(tax: number, taxPercent: number) {
  const cgst = round2(tax / 2);
  return { rate: round2(taxPercent / 2), cgst, sgst: round2(tax - cgst) };
}

/** The GST bill's tax table: CGST and SGST on the subtotal, then their total. */
export function gstTable(doc: BillDoc) {
  const g = gstSplit(doc.tax, doc.taxPercent);
  return [
    { type: "CGST", rate: `${g.rate}%`, taxable: doc.subtotal, amount: g.cgst },
    { type: "SGST", rate: `${g.rate}%`, taxable: doc.subtotal, amount: g.sgst },
    { type: "Total GST", rate: `${round2(doc.taxPercent)}%`, taxable: null as number | null, amount: doc.tax },
  ];
}

/**
 * Item name and details: the first line of a description names it, the rest
 * describe it. A room's dates are shown under it only when they differ from
 * the stay in the booking details, so the same dates are not printed twice.
 */
export function splitDescription(line: DocLine, booking?: Pick<BookingDetails, "checkIn" | "checkOut">) {
  const [first, ...rest] = line.description.split("\n");
  const details = rest.join("\n").trim();
  const out = line.checkIn && line.nights > 0 ? addDays(line.checkIn, line.nights) : "";
  const sameAsBooking = booking && booking.checkIn === line.checkIn && booking.checkOut === out;
  const stay =
    line.kind === "room" && out && !sameAsBooking ? `${fmtDateLong(line.checkIn)} to ${fmtDateLong(out)}` : "";
  return { name: first || "New item", details, stay };
}

/** Days to print for a line: always for a room; for anything else only when it is charged per day. */
export const daysShown = (line: DocLine) => (line.kind === "room" || line.nights > 1 ? String(line.nights || 1) : "-");

/** "GSTIN: 23AERPU4151P1ZR", unless the number is already written with its label. */
export function gstinLine(value: string) {
  const v = value.trim();
  if (!v) return "";
  return /^(gst|gstin|pan|reg)/i.test(v) ? v : `GSTIN: ${v}`;
}

/**
 * What the charges say about the stay, for the printed Booking Details box:
 * each room with how many and its sharing ("12 × Deluxe Room (triple
 * sharing)"), and everything else included ("Breakfast and dinner, Airport
 * transfer"). Typed once as charges, never again as booking details.
 */
export function stayFromLines(lines: DocLine[]) {
  const rooms = lines
    .filter((l) => l.kind === "room")
    .map((l) => {
      const { name, details } = splitDescription(l);
      const extra = details.split("\n")[0].trim();
      return `${l.quantity} × ${name}${extra ? ` (${extra})` : ""}`;
    });
  const extras = lines.filter((l) => l.kind === "other").map((l) => splitDescription(l).name);
  return { rooms: rooms.join("; "), extras: extras.join(", ") };
}

/** The booking details worth printing, in the order the formats list them. */
export function detailRows(doc: BillDoc): [string, string][] {
  const d = doc.details;
  const days = stayDays(d.checkIn, d.checkOut);
  const has = (f: FormatField) => hasField(doc.layout, f);
  const quote = doc.layout === "quotation";
  // Bills saved before rooms and facilities came from the charges keep what was typed for them.
  const typed = Boolean(d.rooms.trim() || d.occupancy.trim() || d.mealPlan.trim() || d.transport.trim());
  const fromLines = stayFromLines(doc.lines);
  const rows: [string, string, boolean][] = [
    ["Hotel name", d.hotelName, has("hotelName")],
    ["Hotel address", d.hotelAddress, has("hotelAddress")],
    [quote ? "Check-in" : "Check-in date", d.checkIn ? fmtDateLong(d.checkIn) : "", has("checkIn")],
    [quote ? "Check-out" : "Check-out date", d.checkOut ? fmtDateLong(d.checkOut) : "", has("checkOut")],
    [quote ? "Total nights" : "No. of days", days ? String(days) : "", has("checkIn")],
    ["Members", d.members, has("members")],
    // As typed on older bills.
    [quote ? "Rooms" : "No. of rooms", d.rooms, typed],
    [quote ? "Occupancy type" : doc.layout === "proforma" ? "Occupancy" : "Room & occupancy", d.occupancy, typed],
    [doc.layout === "proforma" ? "Meal plan" : "Food facility", d.mealPlan, typed],
    ["Transport facility", d.transport, typed],
    // Filled in from the charges.
    ["Rooms", fromLines.rooms, !typed],
    ["Includes", fromLines.extras, !typed],
  ];
  return rows.filter(([, v, shown]) => shown && v.trim() !== "").map(([label, v]) => [label, v]);
}

/** The amount figures, in the order they are printed under the items. */
export function totalRows(doc: BillDoc): { label: string; value: number; strong?: boolean }[] {
  const quote = doc.layout === "quotation";
  // The quotation's cost summary words it as the user's format does.
  const rows: { label: string; value: number; strong?: boolean }[] = [{ label: quote ? "Amount" : "Subtotal", value: doc.subtotal }];
  if (doc.layout === "gst") {
    // CGST and SGST are set out in their own table; here only their sum.
    rows.push({ label: "Total GST", value: doc.tax });
  } else if (doc.taxPercent > 0) {
    rows.push({ label: quote ? `GST (${doc.taxPercent}%)` : `GST @ ${doc.taxPercent}%`, value: doc.tax });
  }
  if (doc.discount > 0) rows.push({ label: doc.discountPercent ? `Discount (${doc.discountPercent}%)` : "Discount", value: -doc.discount });
  rows.push({
    label: doc.layout === "gst" ? "Grand Total (incl. GST)" : rateFirst(doc.layout) ? "Total Amount" : "Grand Total",
    value: doc.total,
    strong: true,
  });
  return rows;
}

/** Column headings of the items table, per layout, as in the formats. */
export function itemColumns(layout: Layout) {
  if (layout === "quotation") {
    return { item: "Accommodation Charges", qty: "Rooms / Persons", days: "Nights", rate: "Per Person/Room Charges (₹)", amount: "Amount (₹)" };
  }
  return layout === "proforma"
    ? { item: "Description", qty: "Total Number", days: "Total Days of Stay", rate: "Amount per Day (₹)", amount: "Total (₹)" }
    : { item: "Room Category / Item", qty: "Total Number", days: "No. of Days", rate: layout === "gst" ? "Rate per Night (₹)" : "Rate per Night per Room (₹)", amount: "Amount (₹)" };
}

/** Headings and wording that differ between layouts, shared by the screen, PDF and Word. */
export function layoutWords(layout: Layout) {
  switch (layout) {
    case "proforma":
      return { number: "Proforma No.", date: "Date", by: "Invoice By", to: "Invoice To", charges: "Charges" };
    case "quotation":
      return { number: "Quotation No.", date: "Date", by: "From", to: "To", charges: "Cost Summary" };
    default:
      return { number: "Invoice No.", date: "Invoice Date", by: "Billed By", to: "Billed To", charges: "Accommodation & Charges" };
  }
}

/** The quotation's sign-off: "Warm Regards," then the booking manager, their mobile and the company. */
export function signOffLines(doc: BillDoc) {
  const d = doc.details;
  return ["Warm Regards,", d.signName.trim(), d.signPhone.trim() ? `Mob: ${d.signPhone.trim()}` : "", doc.company.name].filter(Boolean);
}

/** Paid, part paid or not paid, for the proforma. Null on a draft. */
export function paymentState(doc: BillDoc): string | null {
  if (doc.paid === null || doc.paid === undefined) return null;
  if (doc.paid <= 0.004) return "Amount Not Paid";
  if (doc.paid >= doc.total - 0.004) return "Amount Paid";
  return `Part Paid, balance due`;
}

/** Totals worked out the same way on the screen and on the server. */
export function billTotals(
  lines: { amount: number }[],
  layout: Layout,
  hasTaxLine: boolean,
  taxPercent: number,
  discount: number,
  /** Set when the discount is a percentage of the subtotal; then `discount` is ignored. */
  discountPercent: number | null = null,
) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const tax = hasTaxLine ? round2((subtotal * taxPercent) / 100) : 0;
  const off =
    discountPercent !== null
        ? round2((subtotal * Math.min(Math.max(discountPercent, 0), 100)) / 100)
        : round2(Math.max(discount, 0));
  return { subtotal, tax, discount: off, total: round2(subtotal + tax - off) };
}

/**
 * A best guess at what kind of client a typed name is: a travel agent, an
 * organisation (anything with a GSTIN, or a name like a college or company),
 * or else a person. It can be changed on the Clients screen.
 */
export function guessClientType(name: string, gstin: string): "agent" | "company" | "individual" {
  if (/travel|tour|holiday|trip|dmc|journey|vacation|yatra/i.test(name)) return "agent";
  if (gstin.trim()) return "company";
  if (/college|universit|school|institut|academy|vidyalaya|ltd|limited|pvt|private|llp|inc\b|company|corp|foundation|trust|society|association|hospital|hotel|bank|club|group|enterprise|industr|solution|technolog|services|events|team|department|ministry|council|church|temple|mission/i.test(name)) {
    return "company";
  }
  return "individual";
}

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh",
  "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal",
];
