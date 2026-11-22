"use client";

import { useState } from "react";
import { Button, ErrorText, StatusBadge, cx } from "@/components/ui";
import { ReceiptLink } from "@/components/receipt-link";
import { fmtDateLong, inr } from "@/lib/format";
import { applyAdvance, cancelPayment } from "../../payments/actions";

type Payment = {
  id: string;
  paidOn: string;
  amount: number;
  mode: string;
  reference: string;
  receiptNumber: string | null;
  advance: boolean;
  cancelled: boolean;
};

type Advance = { id: string; paidOn: string; amount: number; receiptNumber: string | null; notes: string };

/** The payments on a bill, each with its receipt, and the client's unused advances. */
export function BillPayments({
  billId,
  canApply,
  outstanding,
  payments,
  advances,
}: {
  billId: string;
  canApply: boolean;
  outstanding: number;
  payments: Payment[];
  advances: Advance[];
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function act(work: () => ReturnType<typeof cancelPayment>) {
    setPending(true);
    setError("");
    const result = await work();
    setPending(false);
    setConfirming(null);
    if (!result.ok) setError(result.error);
  }

  return (
    <>
      <h2 className="mt-6 text-ui font-medium text-fg-3">Payments</h2>
      {payments.length === 0 ? (
        <p className="mt-1 text-body text-fg-2">None recorded yet.</p>
      ) : (
        <ul data-payments className="mt-1 divide-y divide-line">
          {payments.map((p) => (
            <li key={p.id} data-payment={p.id} className="py-2">
              <div className="flex items-baseline gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body text-fg tabular-nums">{fmtDateLong(p.paidOn)}</p>
                  <p className="truncate text-ui text-fg-3">
                    {[p.advance ? "Advance" : "", p.mode, p.reference].filter(Boolean).join(", ") || "No details"}
                  </p>
                </div>
                <span
                  className={cx(
                    "text-body font-medium tabular-nums",
                    p.cancelled ? "text-fg-3 line-through" : "text-ok",
                  )}
                >
                  {inr(p.amount)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui">
                <ReceiptLink paymentId={p.id} receiptNumber={p.receiptNumber} />
                {p.cancelled ? (
                  <StatusBadge tone="muted">Cancelled</StatusBadge>
                ) : confirming === p.id ? (
                  <>
                    <span className="text-fg-2">Cancel this payment?</span>
                    <Button variant="ghost" className="h-8 px-2 md:h-8" onClick={() => setConfirming(null)} disabled={pending}>
                      Keep
                    </Button>
                    <Button
                      className="h-8 px-2 md:h-8"
                      onClick={() => act(() => cancelPayment(p.id))}
                      disabled={pending}
                    >
                      Yes, cancel it
                    </Button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setConfirming(p.id);
                    }}
                    className="text-fg-3 hover:text-fg"
                  >
                    Cancel payment
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canApply && advances.length ? (
        <section data-advances className="mt-4 rounded-lg border border-line p-3">
          <h3 className="text-ui font-semibold text-fg">Advances from this client</h3>
          <p className="text-ui text-fg-3">Not yet used on any bill. Using one counts it as paid on this bill.</p>
          <ul className="mt-2 divide-y divide-line">
            {advances.map((a) => {
              const fits = a.amount <= outstanding + 0.004;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-body text-fg tabular-nums">
                      {inr(a.amount)}, {fmtDateLong(a.paidOn)}
                    </p>
                    <p className="truncate text-ui text-fg-3">
                      {[a.receiptNumber, a.notes].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  {fits ? (
                    <Button
                      className="h-8 px-2 md:h-8"
                      disabled={pending || outstanding <= 0}
                      onClick={() => act(() => applyAdvance({ paymentId: a.id, billId }))}
                    >
                      Use on this bill
                    </Button>
                  ) : (
                    <span className="text-ui text-fg-3">More than what is due</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </>
  );
}
