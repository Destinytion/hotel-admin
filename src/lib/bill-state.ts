import type { Tone } from "@/components/ui";

/** The one-word status shown for a bill, and its colour. */
export function billState(row: {
  status: "draft" | "final" | "cancelled";
  isSale: boolean;
  total: number;
  paid: number;
}): { label: string; tone: Tone } {
  if (row.status === "draft") return { label: "Draft", tone: "muted" };
  if (row.status === "cancelled") return { label: "Cancelled", tone: "bad" };
  if (!row.isSale) return { label: "Issued", tone: "muted" };
  if (row.paid >= row.total) return { label: "Paid", tone: "ok" };
  if (row.paid > 0) return { label: "Part paid", tone: "warn" };
  return { label: "Unpaid", tone: "warn" };
}
