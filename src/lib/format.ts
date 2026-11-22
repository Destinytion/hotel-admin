const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** ₹1,25,000 with Indian digit grouping. Paise are shown only when present. Negative: -₹2,000. */
export const inr = (n: number) => (n < 0 ? `-₹${rupees.format(-n)}` : `₹${rupees.format(n)}`);

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

export const isISODate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(utc(value).getTime());

export function addDays(iso: string, n: number) {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 07 Dec */
export function fmtDate(iso: string | null | undefined) {
  if (!isISODate(iso)) return "";
  const d = utc(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
}

/** 07 Dec 2026 */
export function fmtDateLong(iso: string | null | undefined) {
  if (!isISODate(iso)) return "";
  return `${fmtDate(iso)} ${utc(iso).getUTCFullYear()}`;
}

export const dayName = (iso: string) => DAYS[utc(iso).getUTCDay()];

/** Today's date in India, wherever the server runs. */
export const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** A timestamp as a date in India. */
export const toISODate = (value: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(value);

/** April to March, written "26-27". */
export function fiscalYear(iso: string) {
  const d = utc(iso);
  const start = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Rounds to paise. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
