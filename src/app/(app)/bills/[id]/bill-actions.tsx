"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText, Field, Input, Select } from "@/components/ui";
import Link from "@/components/link";
import { SidePanel } from "@/components/side-panel";
import { ShareFile, WhatsAppButton } from "@/components/share";
import { DownloadSimple } from "@phosphor-icons/react";
import { inr } from "@/lib/format";
import { cancelBill, copyToDraft, recordPayment } from "../actions";

const MODES = ["Bank transfer", "UPI", "Cash", "Card", "Cheque"];
const linkButton =
  "inline-flex h-11 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-body font-medium text-fg transition-colors duration-150 hover:bg-sunken md:h-9";

export function BillActions({
  billId,
  canPay,
  canCancel,
  isSale,
  outstanding,
  today,
  phone,
  message,
  voucherHref,
  pdfName,
}: {
  billId: string;
  canPay: boolean;
  canCancel: boolean;
  isSale: boolean;
  outstanding: number;
  today: string;
  /** The client's phone for WhatsApp, if known. */
  phone: string;
  /** The WhatsApp message about this bill. */
  message: string;
  /** The hotel voucher for this bill, when it has rooms. */
  voucherHref: string | null;
  /** File name of the bill's PDF, for sending it. */
  pdfName: string;
}) {
  const router = useRouter();
  const [paying, setPaying] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [amount, setAmount] = useState(String(outstanding));
  const [mode, setMode] = useState(MODES[0]);
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await recordPayment({ billId, amount: Number(amount), mode, paidOn, reference });
    setPending(false);
    if (!result.ok) return setError(result.error);
    setPaying(false);
    setReference("");
  }

  async function cancel() {
    setPending(true);
    setError("");
    const result = await cancelBill(billId);
    setPending(false);
    setConfirmCancel(false);
    if (!result.ok) setError(result.error);
  }

  async function copy() {
    setPending(true);
    setError("");
    const result = await copyToDraft(billId);
    setPending(false);
    if (!result.ok) return setError(result.error);
    router.push(`/bill-generator?bill=${result.data.id}`);
  }

  if (confirmCancel) {
    return (
      <>
        <span className="text-ui text-fg-2">Cancel this bill? Its rooms go back on sale.</span>
        <Button onClick={() => setConfirmCancel(false)} disabled={pending}>
          Keep
        </Button>
        <Button variant="primary" onClick={cancel} disabled={pending}>
          {pending ? "Cancelling" : "Yes, cancel it"}
        </Button>
      </>
    );
  }

  return (
    <>
      <ErrorText>{paying ? "" : error}</ErrorText>
      {canCancel ? (
        <Button variant="ghost" onClick={() => setConfirmCancel(true)} disabled={pending}>
          Cancel bill
        </Button>
      ) : null}
      <Button onClick={copy} disabled={pending}>
        {isSale ? "Copy to new draft" : "Make a bill from this"}
      </Button>
      <a href={`/api/bills/${billId}?as=pdf`} download data-download="pdf" className={linkButton}>
        <DownloadSimple size={16} />
        PDF
      </a>
      <a href={`/api/bills/${billId}?as=docx`} download data-download="docx" className={linkButton}>
        <DownloadSimple size={16} />
        Word
      </a>
      <Button onClick={() => window.print()}>Print</Button>
      <ShareFile url={`/api/bills/${billId}?as=pdf`} filename={pdfName} phone={phone} text={message} />
      <WhatsAppButton phone={phone} text={message} />
      {voucherHref ? (
        <Link href={voucherHref} className={linkButton}>
          Voucher
        </Link>
      ) : null}
      {canPay ? (
        <Button
          variant="primary"
          onClick={() => {
            setError("");
            setAmount(String(outstanding));
            setPaying(true);
          }}
        >
          Record payment
        </Button>
      ) : null}

      {paying ? (
        <SidePanel
          title="Record payment"
          subtitle={`${inr(outstanding)} outstanding`}
          onClose={() => setPaying(false)}
          footer={
            <>
              <Button onClick={() => setPaying(false)}>Cancel</Button>
              <Button variant="primary" type="submit" form="payment-form" disabled={pending}>
                {pending ? "Saving" : "Save payment"}
              </Button>
            </>
          }
        >
          <form id="payment-form" onSubmit={pay} className="flex flex-col gap-4 p-4 md:p-5">
            <Field label="Amount received" htmlFor="pay-amount">
              <Input
                id="pay-amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={amount}
                autoFocus
                onChange={(e) => setAmount(e.target.value)}
                className="tabular-nums"
              />
            </Field>
            <Field label="How it was paid" htmlFor="pay-mode">
              <Select id="pay-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                {MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date received" htmlFor="pay-date">
              <Input id="pay-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
            <Field label="Reference" htmlFor="pay-ref" hint="Optional. UTR, cheque number or similar.">
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <ErrorText>{error}</ErrorText>
          </form>
        </SidePanel>
      ) : null}
    </>
  );
}
