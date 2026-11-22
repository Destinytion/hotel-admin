"use client";

import { useState } from "react";
import { ShareNetwork, WhatsappLogo } from "@phosphor-icons/react";
import { cx } from "@/components/ui";
import { fmtDateLong, inr } from "@/lib/format";

/** Digits only, with India's 91 in front of a 10-digit number, as WhatsApp needs. */
export function waNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}

/**
 * A WhatsApp link that opens a chat with the message typed in. Without a
 * number, WhatsApp asks who to send it to.
 */
export function whatsappUrl(phone: string, text: string) {
  const number = waNumber(phone);
  return `https://wa.me/${number.length >= 8 ? number : ""}?text=${encodeURIComponent(text)}`;
}

/** The message sent with a receipt. */
export function receiptMessage(
  who: { client: string; company: string },
  payment: { amount: number; paidOn: string; receiptNumber: string | null },
) {
  return [
    `Dear ${who.client},`,
    "",
    `Thank you. We have received ${inr(payment.amount)} on ${fmtDateLong(payment.paidOn)}.` +
      (payment.receiptNumber ? ` Receipt ${payment.receiptNumber} is attached.` : ""),
    "",
    who.company,
  ].join("\n");
}

const buttonClass =
  "inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-3 text-body font-medium text-fg transition-colors duration-150 hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:h-9";

/** Opens WhatsApp with a message ready to send. */
export function WhatsAppButton({
  phone,
  text,
  label = "WhatsApp",
  className,
}: {
  phone: string;
  text: string;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={whatsappUrl(phone, text)}
      target="_blank"
      rel="noreferrer"
      data-whatsapp
      className={cx(buttonClass, className)}
      title={phone ? `Send on WhatsApp to ${phone}` : "Send on WhatsApp"}
    >
      <WhatsappLogo size={16} />
      {label}
    </a>
  );
}

/*
  Sends a receipt PDF. On a phone this opens the share sheet with the PDF
  attached, so it can go to WhatsApp, email or anything else. Where a browser
  cannot share files (most computers), it downloads the PDF and opens
  WhatsApp with the message, ready for the file to be attached.
*/
export function ShareReceipt({
  paymentId,
  receiptNumber,
  phone,
  text,
  className,
}: {
  paymentId: string;
  receiptNumber: string | null;
  phone: string;
  text: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    const url = `/api/receipts/${paymentId}`;
    const name = `Receipt ${(receiptNumber ?? "").replace(/\//g, "-")}.pdf`;
    try {
      if (typeof navigator.canShare === "function") {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], name, { type: "application/pdf" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text });
          return;
        }
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      window.open(whatsappUrl(phone, text), "_blank", "noopener");
    } catch {
      // The person closed the share sheet. Nothing to do.
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      disabled={busy}
      data-share-receipt={paymentId}
      className={cx("inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-60", className)}
      title="Send this receipt, for example on WhatsApp"
    >
      <ShareNetwork size={14} />
      Send
    </button>
  );
}
