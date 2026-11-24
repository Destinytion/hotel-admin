import { Document, Packer, Paragraph, type Table } from "docx";
import {
  detailRows,
  gstTable,
  gstinLine,
  itemColumns,
  paymentState,
  splitDescription,
  totalRows,
  type BillDoc,
} from "@/lib/bill-document";
import { fmtDateLong, inr } from "@/lib/format";
import { amountInWords } from "@/lib/words";
import type { CompanyPictures } from "./doc-assets";
import { CONTENT, FONT, MUTED, PAGE, SOFT, cell, hex, para, picture, run, table } from "./docx-kit";

const money = (n: number) => (n < 0 ? `- ${inr(-n)}` : inr(n));

/*
  The bill as an editable Word file, in the same order as the PDF: letterhead,
  number and date, billed by and to, booking details, items, GST, totals,
  amount in words, payment details, stamp.
*/
export function renderBillDocx(doc: BillDoc, pictures: CompanyPictures) {
  const { company, client, details, layout } = doc;
  const accent = hex(company.color);
  const proforma = layout === "proforma";
  const cols = itemColumns(layout);
  const blocks: (Paragraph | Table)[] = [];
  const gap = (twips = 200) => new Paragraph({ spacing: { before: 0, after: twips }, children: [] });

  // Letterhead: logo, company, title.
  const companyLines = [
    para(company.name, { bold: true, size: 13 }),
    ...(company.address ? [para(company.address, { color: MUTED })] : []),
    ...(layout !== "non-gst" && company.registration ? [para(gstinLine(company.registration), { color: MUTED })] : []),
    ...(company.email || company.phone ? [para([company.email, company.phone].filter(Boolean).join("  |  "), { color: MUTED })] : []),
  ];
  blocks.push(
    table(
      [1700, CONTENT - 1700 - 3000, 3000],
      [[
        cell([pictures.logo ? new Paragraph({ children: [picture(pictures.logo, 105, 70)] }) : para(company.initials, { bold: true, size: 16, color: accent })], 1700),
        cell(companyLines, CONTENT - 1700 - 3000),
        cell([para(doc.title, { bold: true, size: 14, color: accent, caps: true, align: "right" })], 3000),
      ]],
    ),
    para("", { borderBottom: { color: accent, size: 18 }, after: 160 }),
  );

  // Number, date, place of supply, booking ref.
  const meta: [string, string][] = proforma
    ? [["Proforma No.", doc.number ?? "Draft"], ["Date", fmtDateLong(doc.billDate)], ["Booking Ref", details.bookingRef], ["Pay by", details.payBy ? fmtDateLong(details.payBy) : ""]]
    : [["Invoice No.", doc.number ?? "Draft"], ["Invoice Date", fmtDateLong(doc.billDate)], ["Place of Supply", details.placeOfSupply], ["Booking Ref", details.bookingRef]];
  const quarter = CONTENT / 4;
  blocks.push(
    table(
      [quarter, quarter, quarter, quarter],
      [meta.map(([label, value]) => cell([para(label, { size: 7, color: MUTED, caps: true }), para(value || "-", { bold: true })], quarter, { borders: "all" }))],
    ),
    gap(),
  );

  // Billed by and to.
  const half = CONTENT / 2;
  const toLines = client
    ? [
        ...(layout === "non-gst" && details.bookingRef ? [para(details.bookingRef, { bold: true })] : []),
        para(client.name, { bold: !(layout === "non-gst" && details.bookingRef) }),
        ...(client.address ? [para(client.address, { color: MUTED })] : []),
        ...(layout !== "non-gst" && client.registration ? [para(gstinLine(client.registration), { color: MUTED })] : []),
        ...(client.contact || client.phone ? [para([client.contact, client.phone].filter(Boolean).join(", "), { color: MUTED })] : []),
      ]
    : [para("")];
  blocks.push(
    table(
      [half, half],
      [[
        cell(
          [
            para(proforma ? "Invoice By" : "Billed By", { bold: true, size: 7.5, color: accent, caps: true }),
            para(company.name, { bold: true }),
            ...(company.address ? [para(company.address, { color: MUTED })] : []),
            ...(layout !== "non-gst" && company.registration ? [para(gstinLine(company.registration), { color: MUTED })] : []),
          ],
          half,
        ),
        cell([para(proforma ? "Invoice To" : "Billed To", { bold: true, size: 7.5, color: accent, caps: true }), ...toLines], half),
      ]],
    ),
    gap(),
  );

  // Booking details, two pairs a row.
  const rows = detailRows(doc);
  if (rows.length) {
    blocks.push(para("Booking Details", { bold: true, size: 10, color: accent, after: 80 }));
    const w = [1700, half - 1700, 1700, half - 1700];
    const pairs: [string, string][][] = [];
    for (let i = 0; i < rows.length; i += 2) pairs.push(rows.slice(i, i + 2));
    blocks.push(
      table(
        w,
        pairs.map((pair) => [
          cell([para(pair[0][0], { color: MUTED })], w[0], { shade: SOFT, padding: 40 }),
          cell([para(pair[0][1], { bold: true })], w[1], { shade: SOFT, padding: 40 }),
          cell([para(pair[1]?.[0] ?? "", { color: MUTED })], w[2], { shade: SOFT, padding: 40 }),
          cell([para(pair[1]?.[1] ?? "", { bold: true })], w[3], { shade: SOFT, padding: 40 }),
        ]),
      ),
      gap(),
    );
  }

  // Items.
  blocks.push(para(proforma ? "Charges" : "Accommodation & Charges", { bold: true, size: 10, color: accent, after: 80 }));
  const widths = proforma ? [4100, 1720, 1320, 1320, 1718] : [700, 3500, 1300, 1300, 1660, 1718];
  const head = proforma ? [cols.item, cols.rate, cols.qty, cols.days, cols.amount] : ["S. No", cols.item, cols.qty, cols.days, cols.rate, cols.amount];
  const headerRow = head.map((h, i) =>
    cell([para(h, { bold: true, size: 8, color: "FFFFFF", align: i >= (proforma ? 1 : 2) ? "right" : "left" })], widths[i], { shade: accent }),
  );
  const itemRows = doc.lines.map((l, i) => {
    const d = splitDescription(l);
    const item = [para(d.name, { bold: true }), ...(d.details ? [para(d.details, { color: MUTED })] : []), ...(d.stay ? [para(d.stay, { color: MUTED })] : [])];
    const num = (v: string, bold = false) => [para(v, { align: "right", bold })];
    const cells = proforma
      ? [item, num(inr(l.rate)), num(String(l.quantity)), num(String(l.nights || 1)), num(inr(l.amount), true)]
      : [[para(String(i + 1), { color: MUTED })], item, num(String(l.quantity)), num(String(l.nights || 1)), num(inr(l.rate)), num(inr(l.amount), true)];
    return cells.map((c, j) => cell(c, widths[j], { borders: "bottom" }));
  });
  blocks.push(table(widths, [headerRow, ...itemRows]), gap(160));

  // GST table on the GST bill.
  if (layout === "gst") {
    blocks.push(para("GST Calculation", { bold: true, size: 10, color: accent, after: 80 }));
    const gw = [1500, 1300, 1700, 1500];
    blocks.push(
      table(gw, [
        ["Tax Type", "Rate (%)", "Taxable (₹)", "GST (₹)"].map((h, i) => cell([para(h, { color: MUTED, size: 8, align: i ? "right" : "left" })], gw[i], { borders: "bottom" })),
        ...gstTable(doc).map((g) =>
          [g.type, g.rate, g.taxable === null ? "" : inr(g.taxable), inr(g.amount)].map((v, i) =>
            cell([para(v, { bold: g.taxable === null, align: i ? "right" : "left" })], gw[i], { borders: g.taxable === null ? "none" : "bottom" }),
          ),
        ),
      ]),
      gap(120),
    );
  }

  // Totals, on the right.
  const tw = [2900, 1800];
  blocks.push(
    table(
      tw,
      totalRows(doc).map((r) =>
        r.strong
          ? [
              cell([para(r.label, { bold: true, size: 10.5, color: "FFFFFF" })], tw[0], { shade: accent }),
              cell([para(money(r.value), { bold: true, size: 10.5, color: "FFFFFF", align: "right" })], tw[1], { shade: accent }),
            ]
          : [cell([para(r.label, { color: MUTED })], tw[0], { padding: 30 }), cell([para(money(r.value), { align: "right" })], tw[1], { padding: 30 })],
      ),
      { align: "right" },
    ),
    para([run("Total in words: ", { color: MUTED }), run(amountInWords(Math.max(doc.total, 0)), { bold: true })], {
      before: 200,
      after: 200,
    }),
  );

  // How to pay on the left, the stamp on the right.
  const left: Paragraph[] = [];
  if (proforma) {
    const state = paymentState(doc);
    left.push(
      para([
        run("Please proceed with the payment to the account below.", { bold: true }),
        ...(state ? [run(`    ${state}`, { bold: true, size: 8, caps: true, color: state === "Amount Paid" ? "1F7A4D" : "AD2A21" })] : []),
      ]),
      ...(details.payBy ? [para([run("Kindly pay the full amount before "), run(fmtDateLong(details.payBy), { bold: true }), run(".")])] : []),
      ...(company.bankDetails ? [para(company.bankDetails, { before: 100 })] : []),
    );
  } else if (company.bankDetails) {
    left.push(para("Bank details", { color: MUTED }), para(company.bankDetails));
  }
  const stampWidth = 2200;
  const stamp = pictures.stamp
    ? new Paragraph({ alignment: "center", children: [picture(pictures.stamp, 105, 105)] })
    : para(`For ${company.name}`, { align: "center", color: MUTED });
  blocks.push(
    table(
      [CONTENT - stampWidth, stampWidth],
      [[
        cell(left.length ? left : [para("")], CONTENT - stampWidth, { borders: proforma ? "all" : "none", padding: proforma ? 140 : 0 }),
        cell([stamp], stampWidth, { middle: true }),
      ]],
    ),
    gap(120),
  );
  if (doc.notes) blocks.push(para(doc.notes, { color: MUTED, after: 120 }));
  if (company.terms) blocks.push(para(company.terms, { color: MUTED, after: 120 }));
  blocks.push(
    para("This is an electronically generated document; no signature is required.", { align: "center", size: 7, bold: true, color: MUTED, before: 160 }),
  );
  if (doc.cancelled) blocks.unshift(para("CANCELLED", { bold: true, size: 16, color: "AD2A21", align: "right", after: 120 }));

  const file = new Document({
    creator: company.name,
    title: `${doc.title} ${doc.number ?? ""}`.trim(),
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
