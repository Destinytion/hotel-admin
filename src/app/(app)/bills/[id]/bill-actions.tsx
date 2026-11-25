"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText, Field, Input, Select, cx } from "@/components/ui";
import Link from "@/components/link";
import { Menu, menuItem } from "@/components/menu";
import { SidePanel } from "@/components/side-panel";
import { ShareFile, whatsappUrl } from "@/components/share";
import { DownloadSimple, FileDoc, Printer, ShareNetwork, WhatsappLogo } from "@phosphor-icons/react";
import { inr } from "@/lib/format";
import { cancelBill, copyToDraft, recordPayment, reviseDocument } from "../actions";

const MODES = ["Bank transfer", "UPI", "Cash", "Card", "Cheque"];

export function BillActions({
  billId,
  canPay,
  canCancel,
  outstanding,
  today,
  phone,
  message,
  voucherHref,
  pdfName,
  formats,
  formatId,
  isSale,
  canRevise,
}: {
  billId: string;
  /** A bill (a sale) is cancelled; a quotation or proforma is declined or revised. */
  isSale: boolean;
  /** An issued quotation or proforma: a new version can replace it. */
  canRevise: boolean;
  /** The company's formats, to make the next document from this one. */
  formats: { id: string; name: string }[];
  /** This bill's own format. */
  formatId: string;
  canPay: boolean;
  canCancel: boolean;
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

  async function revise() {
    setPending(true);
    setError("");
    const result = await reviseDocument(billId);
    setPending(false);
    if (!result.ok) return setError(result.error);
    router.push(`/bill-generator?bill=${result.data.id}`);
  }

  async function copy(toFormatId: string) {
    setPending(true);
    setError("");
    const result = await copyToDraft(billId, toFormatId);
    setPending(false);
    if (!result.ok) return setError(result.error);
    router.push(`/bill-generator?bill=${result.data.id}`);
  }

  if (confirmCancel) {
    return (
      <>
        <span className="text-ui text-fg-2">
          {isSale ? "Cancel this bill? Its rooms go back on sale." : "Mark this as declined by the client? It stays on record."}
        </span>
        <Button onClick={() => setConfirmCancel(false)} disabled={pending}>
          Keep
        </Button>
        <Button variant="primary" onClick={cancel} disabled={pending}>
          {pending ? "Saving" : isSale ? "Yes, cancel it" : "Yes, declined"}
        </Button>
      </>
    );
  }

  return (
    <>
      <ErrorText>{paying ? "" : error}</ErrorText>
      {/* Everything that sends the bill out, in one place. */}
      <Menu label="Share" icon={<ShareNetwork size={16} />}>
        <ShareFile
          url={`/api/bills/${billId}?as=pdf`}
          filename={pdfName}
          phone={phone}
          text={message}
          variant="menu"
          label="Send PDF on WhatsApp"
        />
        <a href={whatsappUrl(phone, message)} target="_blank" rel="noreferrer" data-whatsapp role="menuitem" className={menuItem}>
          <WhatsappLogo size={16} />
          WhatsApp message only
        </a>
        <a href={`/api/bills/${billId}?as=pdf`} download data-download="pdf" role="menuitem" className={menuItem}>
          <DownloadSimple size={16} />
          Download PDF
        </a>
        <a href={`/api/bills/${billId}?as=docx`} download data-download="docx" role="menuitem" className={menuItem}>
          <FileDoc size={16} />
          Download Word
        </a>
        <button type="button" role="menuitem" onClick={() => window.print()} className={menuItem}>
          <Printer size={16} />
          Print
        </button>
      </Menu>
      <Menu label="More">
        {voucherHref ? (
          <Link href={voucherHref} role="menuitem" className={menuItem}>
            Voucher
          </Link>
        ) : null}
        {/* The next step in one click: a quotation becomes a proforma or a bill, everything filled in. */}
        {formats.map((f) => (
          <button
            key={f.id}
            type="button"
            role="menuitem"
            data-make-format={f.id}
            onClick={() => copy(f.id)}
            disabled={pending}
            className={menuItem}
          >
            {f.id === formatId ? "Copy to new draft" : `Make ${f.name} from this`}
          </button>
        ))}
        {canCancel ? (
          <button type="button" role="menuitem" onClick={() => setConfirmCancel(true)} disabled={pending} className={cx(menuItem, "text-bad")}>
            {isSale ? "Cancel bill" : "Mark as declined"}
          </button>
        ) : null}
      </Menu>
      {/* The client asked for changes: a new version, and this one is marked Revised once it is issued. */}
      {canRevise ? (
        <Button onClick={revise} disabled={pending}>
          Revise
        </Button>
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
