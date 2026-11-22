"use client";

import { useState } from "react";
import { Button, ErrorText, Input, StatusBadge, cx } from "@/components/ui";
import { ReceiptLink } from "@/components/receipt-link";
import { ShareReceipt, receiptMessage } from "@/components/share";
import { fmtDateLong, inr, round2 } from "@/lib/format";
import { applyAdvance, cancelPayment, undoAdvanceUse } from "../../payments/actions";

type Payment = {
  /** Unique within the list. */
  id: string;
  /** The payment whose receipt this is: the advance itself for a use of one. */
  paymentId: string;
  /** Set when this row is part of an advance used on the bill. */
  useId: string | null;
  paidOn: string;
  amount: number;
  mode: string;
  reference: string;
  receiptNumber: string | null;
  advance: boolean;
  cancelled: boolean;
};

type Advance = {
  id: string;
  paidOn: string;
  amount: number;
  /** What is still free to use. */
  left: number;
  receiptNumber: string | null;
  notes: string;
};

/** The payments on a bill, each with its receipt, and the client's advances with something left. */
export function BillPayments({
  billId,
  share,
  canApply,
  outstanding,
  payments,
  advances,
}: {
  billId: string;
  /** Who a receipt is sent to, and from whom. */
  share: { phone: string; client: string; company: string };
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
            <li key={p.id} data-payment={p.paymentId} className="py-2">
              <div className="flex items-baseline gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body text-fg tabular-nums">{fmtDateLong(p.paidOn)}</p>
                  <p className="truncate text-ui text-fg-3">
                    {[p.useId ? "From advance" : p.advance ? "Advance" : "", p.mode, p.reference]
                      .filter(Boolean)
                      .join(", ") || "No details"}
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
                <ReceiptLink paymentId={p.paymentId} receiptNumber={p.receiptNumber} />
                {p.cancelled ? null : (
                  <ShareReceipt
                    paymentId={p.paymentId}
                    receiptNumber={p.receiptNumber}
                    phone={share.phone}
                    text={receiptMessage(share, p)}
                  />
                )}
                {p.cancelled ? (
                  <StatusBadge tone="muted">{p.useId ? "Advance cancelled" : "Cancelled"}</StatusBadge>
                ) : confirming === p.id ? (
                  <>
                    <span className="text-fg-2">
                      {p.useId ? "Take this advance off the bill?" : "Cancel this payment?"}
                    </span>
                    <Button variant="ghost" className="h-8 px-2 md:h-8" onClick={() => setConfirming(null)} disabled={pending}>
                      Keep
                    </Button>
                    <Button
                      className="h-8 px-2 md:h-8"
                      onClick={() => act(() => (p.useId ? undoAdvanceUse(p.useId) : cancelPayment(p.paymentId)))}
                      disabled={pending}
                    >
                      {p.useId ? "Yes, take it off" : "Yes, cancel it"}
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
                    {p.useId ? "Take off this bill" : "Cancel payment"}
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
          <p className="text-ui text-fg-3">
            Use all or part of one on this bill. Whatever is not used stays as credit for a later bill.
          </p>
          <ul className="mt-2 divide-y divide-line">
            {advances.map((a) => (
              <AdvanceRow
                // A fresh suggestion whenever what is left or due changes.
                key={`${a.id}-${a.left}-${outstanding}`}
                advance={a}
                outstanding={outstanding}
                pending={pending}
                onUse={(amount) => act(() => applyAdvance({ paymentId: a.id, billId, amount }))}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </>
  );
}

function AdvanceRow({
  advance,
  outstanding,
  pending,
  onUse,
}: {
  advance: Advance;
  outstanding: number;
  pending: boolean;
  onUse: (amount: number) => void;
}) {
  // Suggest as much as both the advance and the bill allow.
  const [amount, setAmount] = useState(String(round2(Math.max(Math.min(advance.left, outstanding), 0))));
  const partlyUsed = advance.left < advance.amount;
  return (
    <li data-advance={advance.id} className="py-2">
      <p className="text-body text-fg tabular-nums">
        {inr(advance.amount)}, {fmtDateLong(advance.paidOn)}
      </p>
      <p className="truncate text-ui text-fg-3">
        {[advance.receiptNumber, partlyUsed && `${inr(advance.left)} left`, advance.notes].filter(Boolean).join(", ")}
      </p>
      <form
        className="mt-1.5 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onUse(Number(amount));
        }}
      >
        <Input
          aria-label={`Amount of advance ${advance.receiptNumber ?? ""} to use`}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-8 w-32 tabular-nums md:h-8"
        />
        <Button type="submit" className="h-8 px-2 md:h-8" disabled={pending || outstanding <= 0 || !(Number(amount) > 0)}>
          Use on this bill
        </Button>
      </form>
    </li>
  );
}
