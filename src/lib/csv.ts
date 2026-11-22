/*
  Downloads for Excel. The file is CSV, which Excel, Google Sheets and Numbers
  all open directly. It is made in the browser from the rows already on screen,
  so what downloads is exactly what was being looked at.
*/

export type CsvValue = string | number | null | undefined;

function cell(value: CsvValue) {
  if (value === null || value === undefined) return "";
  // Numbers go out bare so the spreadsheet treats them as numbers.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  // A name starting with = + - or @ would be run as a formula by a spreadsheet.
  // A leading apostrophe makes it plain text.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: CsvValue[][]) {
  const lines = [header, ...rows].map((row) => row.map(cell).join(","));
  // The mark at the start tells Excel the file is UTF-8, so names and the rupee sign survive.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
