import { addDays, fmtDateLong, round2 } from "./format";

/*
  One description of a bill, made the same way for the screen, the PDF and the
  Word file, so all three always agree. The three layouts follow the user's own
  formats: the GST bill (Tax Invoice with CGST and SGST), the Non-GST bill
  (Non-Taxable Invoice) and the Proforma Invoice.
*/

export type Layout = "gst" | "non-gst" | "proforma";

export const LAYOUTS: { key: Layout; label: string }[] = [
  { key: "gst", label: "GST bill (Tax Invoice)" },
  { key: "non-gst", label: "Non-GST bill" },
  { key: "proforma", label: "Proforma Invoice" },
];

/** The note on the user's own Proforma Invoice, put in the notes of a new proforma to edit as needed. */
export const PROFORMA_NOTE =
  "Please proceed with the payment to the account detailed below:\nKindly Complete Full Amount before Specific Date.";

export const asLayout = (value: unknown): Layout =>
  value === "non-gst" || value === "proforma" ? value : "gst";

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
  | "notes";

const FORMAT_FIELDS: Record<Layout, FormatField[]> = {
  // Discount is on every format at the user's request; it prints only when one is given.
  gst: ["bookingRef", "placeOfSupply", "clientGstin", "hotelName", "checkIn", "checkOut", "occupancy", "mealPlan", "transport", "tax", "discount"],
  "non-gst": ["bookingRef", "placeOfSupply", "hotelName", "checkIn", "checkOut", "occupancy", "members", "discount"],
  proforma: ["clientGstin", "hotelName", "hotelAddress", "checkIn", "checkOut", "members", "rooms", "occupancy", "mealPlan", "tax", "discount", "notes"],
};

/** Whether a format has this field. */
export const hasField = (layout: Layout, field: FormatField) => FORMAT_FIELDS[layout].includes(field);

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
  /** When the discount was given as a percentage, that percentage, for the printed label. */
  discountPercent?: number | null;
  total: number;
  notes: string;
  cancelled?: boolean;
  /** What has been received, for the proforma's paid or not-paid line. Null on a draft. */
  paid?: number | null;
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

/** The booking details worth printing, in the order the formats list them. */
export function detailRows(doc: BillDoc): [string, string][] {
  const d = doc.details;
  const days = stayDays(d.checkIn, d.checkOut);
  const has = (f: FormatField) => hasField(doc.layout, f);
  const rows: [string, string, boolean][] = [
    ["Hotel name", d.hotelName, has("hotelName")],
    ["Hotel address", d.hotelAddress, has("hotelAddress")],
    ["Check-in date", d.checkIn ? fmtDateLong(d.checkIn) : "", has("checkIn")],
    ["Check-out date", d.checkOut ? fmtDateLong(d.checkOut) : "", has("checkOut")],
    ["No. of days", days ? String(days) : "", has("checkIn")],
    ["Members", d.members, has("members")],
    ["No. of rooms", d.rooms, has("rooms")],
    [doc.layout === "proforma" ? "Occupancy" : "Room & occupancy", d.occupancy, has("occupancy")],
    [doc.layout === "proforma" ? "Meal plan" : "Food facility", d.mealPlan, has("mealPlan")],
    ["Transport facility", d.transport, has("transport")],
  ];
  return rows.filter(([, v, shown]) => shown && v.trim() !== "").map(([label, v]) => [label, v]);
}

/** The amount figures, in the order they are printed under the items. */
export function totalRows(doc: BillDoc): { label: string; value: number; strong?: boolean }[] {
  const rows: { label: string; value: number; strong?: boolean }[] = [{ label: "Subtotal", value: doc.subtotal }];
  if (doc.layout === "gst") {
    // CGST and SGST are set out in their own table; here only their sum.
    rows.push({ label: "Total GST", value: doc.tax });
  } else if (doc.layout === "proforma" && doc.taxPercent > 0) {
    rows.push({ label: `GST @ ${doc.taxPercent}%`, value: doc.tax });
  }
  if (doc.discount > 0) rows.push({ label: doc.discountPercent ? `Discount (${doc.discountPercent}%)` : "Discount", value: -doc.discount });
  rows.push({
    label: doc.layout === "gst" ? "Grand Total (incl. GST)" : doc.layout === "proforma" ? "Total Amount" : "Grand Total",
    value: doc.total,
    strong: true,
  });
  return rows;
}

/** Column headings of the items table, per layout, as in the formats. */
export function itemColumns(layout: Layout) {
  return layout === "proforma"
    ? { item: "Description", qty: "Total Number", days: "Total Days of Stay", rate: "Amount per Day (₹)", amount: "Total (₹)" }
    : { item: "Room Category / Item", qty: "Total Number", days: "No. of Days", rate: layout === "gst" ? "Rate per Night (₹)" : "Rate per Night per Room (₹)", amount: "Amount (₹)" };
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
