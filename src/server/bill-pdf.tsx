import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
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
import { pdfImage, registerPdfFonts, type CompanyPictures } from "./doc-assets";

const INK = "#1a1c20";
const MUTED = "#5b616b";
const LINE = "#d9dce1";
const SOFT = "#f6f7f9";
const HEAD = "#f1f2f4";

const s = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 36, paddingHorizontal: 36, fontFamily: "Inter", fontSize: 8.5, color: INK, lineHeight: 1.4 },
  row: { flexDirection: "row" },
  muted: { color: MUTED },
  strong: { fontWeight: 600 },
  label: { fontSize: 7, color: MUTED, textTransform: "uppercase" },
  section: { marginTop: 12 },
  heading: { fontSize: 9, fontWeight: 600, marginBottom: 4 },
  cell: { paddingVertical: 4, paddingHorizontal: 4 },
  right: { textAlign: "right" },
});

const money = (n: number) => (n < 0 ? `- ${inr(-n)}` : inr(n));

function BillDocument({ doc, pictures }: { doc: BillDoc; pictures: CompanyPictures }) {
  const { company, client, details, layout } = doc;
  // Bills are kept plain: black and grey only, whatever the company's app colour.
  const accent = INK;
  const cols = itemColumns(layout);
  const rows = detailRows(doc);
  const state = layout === "proforma" ? paymentState(doc) : null;
  const proforma = layout === "proforma";
  const meta: [string, string][] = proforma
    ? [
        ["Proforma No.", doc.number ?? "Draft"],
        ["Date", fmtDateLong(doc.billDate)],
        ["Booking Ref", details.bookingRef],
        ["Pay by", details.payBy ? fmtDateLong(details.payBy) : ""],
      ]
    : [
        ["Invoice No.", doc.number ?? "Draft"],
        ["Invoice Date", fmtDateLong(doc.billDate)],
        ["Place of Supply", details.placeOfSupply],
        ["Booking Ref", details.bookingRef],
      ];
  // Column widths of the items table, out of 100.
  const widths = proforma
    ? { sno: 0, item: 40, rate: 17, qty: 13, days: 13, amount: 17 }
    : { sno: 7, item: 36, rate: 16, qty: 12, days: 12, amount: 17 };

  return (
    <Document title={`${doc.title} ${doc.number ?? ""}`.trim()} author={company.name} creator="Hotel Admin">
      <Page size="A4" style={s.page}>
        {doc.cancelled ? (
          <Text
            style={{ position: "absolute", top: 150, right: 40, borderWidth: 2, borderColor: "#ad2a21", color: "#ad2a21", paddingVertical: 4, paddingHorizontal: 10, fontSize: 18, fontWeight: 600, transform: "rotate(-8deg)" }}
          >
            CANCELLED
          </Text>
        ) : null}

        {/* Letterhead */}
        <View style={[s.row, { justifyContent: "space-between", paddingBottom: 10 }]}>
          <View style={[s.row, { maxWidth: "68%" }]}>
            {pictures.logo ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={pdfImage(pictures.logo)} style={{ height: 58, maxWidth: 110, objectFit: "contain", marginRight: 10 }} />
            ) : (
              <View style={{ width: 34, height: 34, borderRadius: 4, backgroundColor: accent, alignItems: "center", justifyContent: "center", marginRight: 10 }}>
                <Text style={{ color: "#fefefe", fontWeight: 600, fontSize: 12 }}>{company.initials}</Text>
              </View>
            )}
            <View style={{ flexShrink: 1 }}>
              <Text style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25, marginBottom: 2 }}>{company.name}</Text>
              {company.address ? <Text style={s.muted}>{company.address}</Text> : null}
              {layout !== "non-gst" && company.registration ? <Text style={s.muted}>{gstinLine(company.registration)}</Text> : null}
              {company.email || company.phone ? (
                <Text style={s.muted}>{[company.email, company.phone].filter(Boolean).join("  |  ")}</Text>
              ) : null}
            </View>
          </View>
          <Text style={{ fontSize: 13.5, fontWeight: 600, color: accent, textTransform: "uppercase", paddingTop: 2 }}>{doc.title}</Text>
        </View>
        <View style={{ height: 1, backgroundColor: INK }} />

        {/* Number, date, place of supply, booking ref */}
        <View style={[s.row, { marginTop: 10, borderWidth: 1, borderColor: LINE, borderRadius: 4 }]}>
          {meta.map(([label, value], i) => (
            <View key={label} style={{ flex: 1, paddingVertical: 5, paddingHorizontal: 7, borderLeftWidth: i ? 1 : 0, borderLeftColor: LINE }}>
              <Text style={s.label}>{label}</Text>
              <Text style={s.strong}>{value || "-"}</Text>
            </View>
          ))}
        </View>

        {/* Billed by and to */}
        <View style={[s.row, s.section]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={[s.label, { color: accent, fontWeight: 600, marginBottom: 2 }]}>{proforma ? "Invoice By" : "Billed By"}</Text>
            <Text style={s.strong}>{company.name}</Text>
            {company.address ? <Text style={s.muted}>{company.address}</Text> : null}
            {layout !== "non-gst" && company.registration ? <Text style={s.muted}>{gstinLine(company.registration)}</Text> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: accent, fontWeight: 600, marginBottom: 2 }]}>{proforma ? "Invoice To" : "Billed To"}</Text>
            {client ? (
              <>
                {layout === "non-gst" && details.bookingRef ? <Text style={s.strong}>{details.bookingRef}</Text> : null}
                <Text style={layout === "non-gst" && details.bookingRef ? {} : s.strong}>{client.name}</Text>
                {client.address ? <Text style={s.muted}>{client.address}</Text> : null}
                {layout !== "non-gst" && client.registration ? <Text style={s.muted}>{gstinLine(client.registration)}</Text> : null}
                {client.contact || client.phone ? <Text style={s.muted}>{[client.contact, client.phone].filter(Boolean).join(", ")}</Text> : null}
              </>
            ) : null}
          </View>
        </View>

        {/* Booking details */}
        {rows.length ? (
          <View style={s.section} wrap={false}>
            <Text style={[s.heading, { color: accent }]}>Booking Details</Text>
            <View style={{ backgroundColor: SOFT, borderRadius: 4, paddingVertical: 6, paddingHorizontal: 8, flexDirection: "row", flexWrap: "wrap" }}>
              {rows.map(([label, value]) => (
                <View key={label} style={[s.row, { width: "50%", paddingVertical: 1.5 }]}>
                  <Text style={[s.muted, { width: 82 }]}>{label}</Text>
                  <Text style={[s.strong, { flex: 1, paddingRight: 6 }]}>{value}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Items */}
        <View style={s.section}>
          <Text style={[s.heading, { color: accent }]}>{proforma ? "Charges" : "Accommodation & Charges"}</Text>
          <View style={[s.row, { backgroundColor: HEAD, borderTopWidth: 1, borderBottomWidth: 1, borderColor: INK, fontWeight: 600, fontSize: 7.5 }]}>
            {proforma ? null : <Text style={[s.cell, { width: `${widths.sno}%` }]}>S. No</Text>}
            <Text style={[s.cell, { width: `${widths.item}%` }]}>{cols.item}</Text>
            {proforma ? <Text style={[s.cell, s.right, { width: `${widths.rate}%` }]}>{cols.rate}</Text> : null}
            <Text style={[s.cell, s.right, { width: `${widths.qty}%` }]}>{cols.qty}</Text>
            <Text style={[s.cell, s.right, { width: `${widths.days}%` }]}>{cols.days}</Text>
            {proforma ? null : <Text style={[s.cell, s.right, { width: `${widths.rate}%` }]}>{cols.rate}</Text>}
            <Text style={[s.cell, s.right, { width: `${widths.amount}%` }]}>{cols.amount}</Text>
          </View>
          {doc.lines.map((l, i) => {
            const d = splitDescription(l);
            return (
              <View key={l.key} style={[s.row, { borderBottomWidth: 1, borderBottomColor: LINE }]} wrap={false}>
                {proforma ? null : <Text style={[s.cell, s.muted, { width: `${widths.sno}%` }]}>{i + 1}</Text>}
                <View style={[s.cell, { width: `${widths.item}%` }]}>
                  <Text style={s.strong}>{d.name}</Text>
                  {d.details ? <Text style={s.muted}>{d.details}</Text> : null}
                  {d.stay ? <Text style={s.muted}>{d.stay}</Text> : null}
                </View>
                {proforma ? <Text style={[s.cell, s.right, { width: `${widths.rate}%` }]}>{inr(l.rate)}</Text> : null}
                <Text style={[s.cell, s.right, { width: `${widths.qty}%` }]}>{String(l.quantity)}</Text>
                <Text style={[s.cell, s.right, { width: `${widths.days}%` }]}>{String(l.nights || 1)}</Text>
                {proforma ? null : <Text style={[s.cell, s.right, { width: `${widths.rate}%` }]}>{inr(l.rate)}</Text>}
                <Text style={[s.cell, s.right, s.strong, { width: `${widths.amount}%` }]}>{inr(l.amount)}</Text>
              </View>
            );
          })}
        </View>

        {/* GST table and totals */}
        <View style={[s.row, { marginTop: 10, justifyContent: "space-between", alignItems: "flex-start" }]} wrap={false}>
          {layout === "gst" ? (
            <View style={{ width: "54%" }}>
              <Text style={[s.heading, { color: accent }]}>GST Calculation</Text>
              <View style={[s.row, { borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE }]}>
                {["Tax Type", "Rate (%)", "Taxable (₹)", "GST (₹)"].map((h, i) => (
                  <Text key={h} style={[s.cell, s.muted, { width: "25%", fontSize: 7.5 }, i ? s.right : {}]}>
                    {h}
                  </Text>
                ))}
              </View>
              {gstTable(doc).map((g) => (
                <View key={g.type} style={[s.row, g.taxable === null ? { fontWeight: 600 } : { borderBottomWidth: 1, borderBottomColor: LINE }]}>
                  <Text style={[s.cell, { width: "25%" }]}>{g.type}</Text>
                  <Text style={[s.cell, s.right, { width: "25%" }]}>{g.rate}</Text>
                  <Text style={[s.cell, s.right, { width: "25%" }]}>{g.taxable === null ? "" : inr(g.taxable)}</Text>
                  <Text style={[s.cell, s.right, { width: "25%" }]}>{inr(g.amount)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View />
          )}
          <View style={{ width: 190 }}>
            {totalRows(doc).map((r) =>
              r.strong ? (
                <View key={r.label} style={[s.row, { borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: INK, paddingVertical: 5, paddingHorizontal: 7, marginTop: 4 }]}>
                  <Text style={{ flex: 1, fontWeight: 600, fontSize: 10 }}>{r.label}</Text>
                  <Text style={{ fontWeight: 600, fontSize: 10 }}>{money(r.value)}</Text>
                </View>
              ) : (
                <View key={r.label} style={[s.row, { paddingVertical: 1.5, paddingHorizontal: 7 }]}>
                  <Text style={[s.muted, { flex: 1 }]}>{r.label}</Text>
                  <Text>{money(r.value)}</Text>
                </View>
              ),
            )}
          </View>
        </View>

        <View style={[s.row, { marginTop: 10, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 }]}>
          <Text style={s.muted}>Total in words: </Text>
          <Text style={[s.strong, { flex: 1 }]}>{amountInWords(Math.max(doc.total, 0))}</Text>
        </View>

        {/* How to pay and notes on the left, the stamp on the right. */}
        <View style={[s.row, { marginTop: 12, alignItems: "flex-end" }]} wrap={false}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            {proforma ? (
              <View style={{ borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 9 }}>
                <View style={[s.row, { justifyContent: "space-between" }]}>
                  <Text style={s.strong}>Please proceed with the payment to the account below.</Text>
                  {state ? (
                    <Text style={{ fontSize: 7.5, fontWeight: 600, textTransform: "uppercase", borderWidth: 1, borderColor: INK, borderRadius: 2, paddingHorizontal: 4, paddingVertical: 1 }}>{state}</Text>
                  ) : null}
                </View>
                {details.payBy ? <Text>Kindly pay the full amount before {fmtDateLong(details.payBy)}.</Text> : null}
                {company.bankDetails ? <Text style={{ marginTop: 5 }}>{company.bankDetails}</Text> : null}
              </View>
            ) : company.bankDetails ? (
              <View>
                <Text style={s.muted}>Bank details</Text>
                <Text>{company.bankDetails}</Text>
              </View>
            ) : null}
            {doc.notes ? <Text style={[s.muted, { marginTop: 6 }]}>{doc.notes}</Text> : null}
            {company.terms ? <Text style={[s.muted, { marginTop: 4 }]}>{company.terms}</Text> : null}
          </View>
          <View style={{ width: 92, alignItems: "center" }}>
            {pictures.stamp ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={pdfImage(pictures.stamp)} style={{ width: 80, height: 80, objectFit: "contain" }} />
            ) : (
              <Text style={[s.muted, { textAlign: "center" }]}>For {company.name}</Text>
            )}
          </View>
        </View>

        {/* Always at the foot of the page. */}
        <Text fixed style={{ position: "absolute", bottom: 16, left: 36, right: 36, textAlign: "center", fontSize: 7, fontWeight: 600, color: MUTED }}>
          This is an electronically generated document; no signature is required.
        </Text>
      </Page>
    </Document>
  );
}

export function renderBillPdf(doc: BillDoc, pictures: CompanyPictures) {
  registerPdfFonts();
  return renderToBuffer(<BillDocument doc={doc} pictures={pictures} />);
}
