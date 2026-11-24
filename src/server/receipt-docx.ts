import { Document, Packer, Paragraph, type Table } from "docx";
import { gstinLine } from "@/lib/bill-document";
import { fmtDateLong, inr } from "@/lib/format";
import { amountInWords } from "@/lib/words";
import type { CompanyPictures } from "./doc-assets";
import { CONTENT, FONT, MUTED, PAGE, cell, para, picture, run, table } from "./docx-kit";
import { advanceUse, type ReceiptData } from "./receipt-pdf";

/** The receipt as an editable Word file, in the same order as its PDF. */
export function renderReceiptDocx(data: ReceiptData, pictures: CompanyPictures) {
  const { company, client } = data.snapshot;
  // Kept plain: black and grey only.
  const accent = "1A1C20";
  const advance = data.kind === "advance";
  const heading = advance ? "Advance Receipt" : "Payment Receipt";
  const blocks: (Paragraph | Table)[] = [];
  const gap = (twips = 240) => new Paragraph({ spacing: { before: 0, after: twips }, children: [] });
  const half = CONTENT / 2;

  if (data.cancelledOn) blocks.push(para("CANCELLED", { bold: true, size: 16, color: "AD2A21", align: "right", after: 120 }));
  blocks.push(
    table(
      [half, half],
      [[
        cell([pictures.logo ? new Paragraph({ children: [picture(pictures.logo, 120, 80)] }) : para(company.initials, { bold: true, size: 16, color: accent })], half),
        cell([para(heading, { bold: true, size: 20, color: "7F7F7F", caps: true, align: "right" })], half, { middle: true }),
      ]],
    ),
    gap(),
    table(
      [half + 1500, half - 1500],
      [[
        cell(
          [
            para(company.name, { bold: true, size: 11 }),
            ...(company.address ? [para(company.address, { color: MUTED })] : []),
            ...(company.registration ? [para(gstinLine(company.registration), { color: MUTED })] : []),
            ...(data.contact.email || data.contact.phone ? [para([data.contact.email, data.contact.phone].filter(Boolean).join("  |  "), { color: MUTED })] : []),
          ],
          half + 1500,
        ),
        cell(
          [
            para("Receipt No.", { bold: true, size: 7.5, color: accent, caps: true, align: "right" }),
            para(data.number, { bold: true, align: "right" }),
            para("Date", { bold: true, size: 7.5, color: accent, caps: true, align: "right", before: 100 }),
            para(fmtDateLong(data.paidOn), { bold: true, align: "right" }),
          ],
          half - 1500,
        ),
      ]],
    ),
    gap(),
    para("Bill To", { bold: true, size: 7.5, color: accent, caps: true }),
    ...(data.teamName ? [para(data.teamName, { bold: true })] : []),
    para(client.name, { bold: !data.teamName }),
    ...(client.address ? [para(client.address, { color: MUTED })] : []),
    ...(client.registration ? [para(gstinLine(client.registration), { color: MUTED })] : []),
    gap(),
  );

  const w = [4078, 1800, 2500, 1800];
  const head = ["Mode of Payment & Paid To", "Date", "Transaction ID", "Payment Amount"];
  blocks.push(
    table(w, [
      head.map((h, i) => cell([para(h, { bold: true, size: 8, color: accent, align: i === 3 ? "right" : "left" })], w[i], { shade: "F1F2F4", borders: "bottom", borderColor: accent })),
      [
        cell([para(data.mode || "Not recorded", { bold: true }), para(`Paid to ${company.name}`, { color: MUTED })], w[0], { borders: "bottom" }),
        cell([para(fmtDateLong(data.paidOn))], w[1], { borders: "bottom" }),
        cell([para(data.reference || "-")], w[2], { borders: "bottom" }),
        cell([para(inr(data.amount), { bold: true, align: "right" })], w[3], { borders: "bottom" }),
      ],
      [
        cell([para("TOTAL AMOUNT", { bold: true, color: accent, align: "right" })], w[0] + w[1] + w[2], { borders: "bottom", borderColor: accent, span: 3 }),
        cell([para(inr(data.amount), { bold: true, align: "right" })], w[3], { borders: "bottom", borderColor: accent }),
      ],
    ]),
    para([run("Amount paid (in words): ", { color: MUTED }), run(amountInWords(data.amount), { bold: true })], { before: 160, after: 200 }),
  );

  const info: [string, string, boolean?][] = [];
  if (advance) info.push(["Received as", advanceUse(data)]);
  else if (data.bill) info.push(["Against", `${data.bill.title} ${data.bill.number} dated ${fmtDateLong(data.bill.date)}`]);
  if (data.notes) info.push([advance ? "For" : "Note", data.notes]);
  if (data.bill && !advance && !data.cancelledOn) {
    info.push(
      ["Bill total", inr(data.bill.total)],
      ["Received so far, including this", inr(data.bill.receivedToDate)],
      ["Balance due", inr(Math.max(data.bill.total - data.bill.receivedToDate, 0)), true],
    );
  }
  if (info.length) {
    const iw = [3800, CONTENT - 3800];
    blocks.push(
      table(
        iw,
        info.map(([label, value, strong]) => [
          cell([para(label, { color: MUTED })], iw[0], { borders: "bottom" }),
          cell([para(value, { bold: strong, align: "right" })], iw[1], { borders: "bottom" }),
        ]),
      ),
    );
  }
  if (data.cancelledOn) {
    blocks.push(para(`This receipt was cancelled on ${fmtDateLong(data.cancelledOn)} and is no longer valid.`, { color: "AD2A21", before: 200 }));
  }
  blocks.push(
    para(`For ${company.name}`, { align: "right", color: MUTED, before: 400 }),
    ...(pictures.stamp ? [new Paragraph({ alignment: "right", children: [picture(pictures.stamp, 105, 105)] })] : []),
    para("This is an electronically generated document; no signature is required.", { align: "center", size: 7, bold: true, color: MUTED, before: 200 }),
  );

  const file = new Document({
    creator: company.name,
    title: `${heading} ${data.number}`,
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    sections: [
      {
        properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: { top: 720, bottom: 720, left: PAGE.margin, right: PAGE.margin } } },
        children: blocks,
      },
    ],
  });
  return Packer.toBuffer(file);
}
