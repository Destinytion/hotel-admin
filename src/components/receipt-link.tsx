import { DownloadSimple } from "@phosphor-icons/react";
import { cx } from "@/components/ui";

/**
 * Downloads the PDF receipt for a payment. A plain link, so the browser handles
 * the file like any other download and it works without the page's script.
 */
export function ReceiptLink({
  paymentId,
  receiptNumber,
  className,
}: {
  paymentId: string;
  receiptNumber: string | null;
  className?: string;
}) {
  return (
    <a
      href={`/api/receipts/${paymentId}`}
      download
      data-receipt={paymentId}
      className={cx("inline-flex items-center gap-1 text-accent hover:underline", className)}
      title={receiptNumber ? `Download receipt ${receiptNumber} as PDF` : "Download receipt as PDF"}
    >
      <DownloadSimple size={14} />
      <span className="tabular-nums">{receiptNumber ?? "Receipt"}</span>
    </a>
  );
}
