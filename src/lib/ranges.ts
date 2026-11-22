import { fmtDateLong, isISODate } from "./format";

/** A span of dates a report covers, both ends included. */
export type Range = { from: string; to: string; key: string; label: string };

export const PRESETS = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "this-fy", label: "This financial year" },
  { key: "last-fy", label: "Last financial year" },
] as const;

type PresetKey = (typeof PRESETS)[number]["key"];

const MAX_DAYS = 731;
const iso = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);

/** The financial year runs April to March. */
function presetRange(key: PresetKey, today: string) {
  const [year, month] = today.split("-").map(Number);
  const m = month - 1;
  const fyStart = m >= 3 ? year : year - 1;
  switch (key) {
    case "this-month":
      return { from: iso(year, m, 1), to: iso(year, m + 1, 0) };
    case "last-month":
      return { from: iso(year, m - 1, 1), to: iso(year, m, 0) };
    case "this-fy":
      return { from: iso(fyStart, 3, 1), to: iso(fyStart + 1, 2, 31) };
    case "last-fy":
      return { from: iso(fyStart - 1, 3, 1), to: iso(fyStart, 2, 31) };
  }
}

/**
 * Reads ?range=... or ?from=...&to=... from the address.
 * Anything missing or invalid falls back to this financial year.
 */
export function resolveRange(
  params: Record<string, string | string[] | undefined>,
  today: string,
): Range {
  if (isISODate(params.from) && isISODate(params.to)) {
    let [from, to] = [params.from, params.to];
    if (to < from) [from, to] = [to, from];
    // Keep a custom range to two years so a typo cannot ask for decades.
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    if (days <= MAX_DAYS) {
      return { from, to, key: "custom", label: `${fmtDateLong(from)} to ${fmtDateLong(to)}` };
    }
  }
  const preset = PRESETS.find((p) => p.key === params.range) ?? PRESETS[2];
  return { ...presetRange(preset.key, today), key: preset.key, label: preset.label };
}
