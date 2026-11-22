/*
  Reading spreadsheet text and the values in it: CSV and tab-separated text
  (what Google Sheets and Excel put on the clipboard), dates written in the
  usual Indian ways, and amounts with ₹ signs and commas. Used on the screen
  for the preview and again on the server before anything is saved.
*/

/** Splits CSV or tab-separated text into rows of cells. Handles quoted cells with commas and line breaks. */
export function parseDelimited(input: string): string[][] {
  const textIn = input.replace(/^﻿/, "");
  const firstLine = textIn.slice(0, textIn.search(/\r?\n|$/));
  const counts = { "\t": 0, ",": 0, ";": 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts]++;
  }
  const delimiter = counts["\t"] > 0 ? "\t" : counts[";"] > counts[","] ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < textIn.length; i++) {
    const ch = textIn[i];
    if (inQuotes) {
      if (ch === '"') {
        if (textIn[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && textIn[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return tidy(rows);
}

/** Trims cells and drops rows with nothing in them. */
export function tidy(rows: string[][]): string[][] {
  return rows
    .map((r) => r.map((c) => String(c ?? "").replace(/ /g, " ").trim()))
    .filter((r) => r.some((c) => c !== ""));
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "Dec", "December" and "Sept" all give 12 or 9. */
const monthOf = (word: string) => MONTHS[word.slice(0, 4).toLowerCase()] ?? MONTHS[word.slice(0, 3).toLowerCase()];

export type DateOrder = "dmy" | "mdy";

const iso = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
};

/**
 * A date as YYYY-MM-DD, from 2026-12-07, 07/12/2026, 7-12-26, 7 Dec 2026,
 * Dec 7, 2026, or an Excel date number. Slashes and dashes are read day first
 * unless told otherwise. Null if it cannot be read.
 */
export function parseDate(value: string, order: DateOrder = "dmy"): string | null {
  const v = value.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return order === "dmy" ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  m = v.match(/^(\d{1,2})(?:st|nd|rd|th)?[ -]([a-z]+)[ -](\d{2}|\d{4})$/i);
  if (m) {
    const month = monthOf(m[2]);
    if (month) return iso(+m[3], month, +m[1]);
  }
  m = v.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)? (\d{2}|\d{4})$/i);
  if (m) {
    const month = monthOf(m[1]);
    if (month) return iso(+m[3], month, +m[2]);
  }
  // Excel keeps dates as days since 30 Dec 1899.
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const serial = Math.floor(Number(v));
    if (serial > 30000 && serial < 80000) {
      return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
    }
  }
  return null;
}

/**
 * Guesses whether a column of dates is written day first or month first, from
 * any value that can only be read one way (a first number over 12 means day
 * first). Day first when nothing tells.
 */
export function guessDateOrder(values: string[]): DateOrder {
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/);
    if (!m) continue;
    if (+m[1] > 12) return "dmy";
    if (+m[2] > 12) return "mdy";
  }
  return "dmy";
}

/** An amount from "₹1,25,000", "Rs. 4500/-", "4,500.50" or "INR 3000". Null if empty or not a number. */
export function parseAmount(value: string): number | null {
  const v = value
    .trim()
    .replace(/^(rs\.?|inr|₹)\s*/i, "")
    .replace(/\/-$/, "")
    .replace(/[,\s₹]/g, "");
  if (!v || !/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}

/** Header names, lower-cased with only letters and digits, for matching columns to fields. */
export const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
