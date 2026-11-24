import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { gstinLine } from "@/lib/bill-document";
import { fmtDateLong, inr, round2 } from "@/lib/format";
import { amountInWords } from "@/lib/words";
import { pdfImage, registerPdfFonts, type CompanyPictures } from "./doc-assets";
import type { ReceiptSnapshot } from "./receipts";

export type ReceiptData = {
  number: string;
  kind: "payment" | "advance";
  paidOn: string;
  amount: number;
  mode: string;
  reference: string;
  notes: string;
  /** Set when the payment was cancelled after the receipt was issued. */
  cancelledOn: string | null;
  recordedBy: string;
  snapshot: ReceiptSnapshot;
  /** Today's email and phone of the company, which older receipts did not keep. */
  contact: { email: string; phone: string };
  /** The team or person the booking was for, from the bill. */
  teamName: string;
  /** For an advance: the bills it has paid so far, and how much of it on each. */
  uses: { number: string; amount: number }[];
  /** The bill this money is for. Empty for an advance. */
  bill: {
    title: string;
    number: string;
    date: string;
    total: number;
    /** Received on the bill up to and including this payment. */
    receivedToDate: number;
  } | null;
};

/** How an advance has been used, in words. */
export function advanceUse(data: Pick<ReceiptData, "uses" | "amount">) {
  const used = round2(data.uses.reduce((sum, u) => sum + u.amount, 0));
  if (!data.uses.length) return "Advance, to be adjusted against a future bill";
  if (data.uses.length === 1 && used >= data.amount) return `Advance, used on ${data.uses[0].number}`;
  const parts = data.uses.map((u) => `${inr(u.amount)} used on ${u.number}`).join(", ");
  const left = round2(data.amount - used);
  return `Advance, ${parts}${left > 0 ? `; ${inr(left)} to be adjusted against a future bill` : ""}`;
}

const INK = "#1a1c20";
const MUTED = "#5b616b";
const LINE = "#d9dce1";
const RED = "#ad2a21";

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 36, paddingHorizontal: 40, fontFamily: "Inter", fontSize: 9, color: INK, lineHeight: 1.45 },
  row: { flexDirection: "row" },
  muted: { color: MUTED },
  strong: { fontWeight: 600 },
  label: { fontSize: 7.5, fontWeight: 600, textTransform: "uppercase", marginBottom: 2 },
  cell: { paddingVertical: 6, paddingHorizontal: 7 },
  right: { textAlign: "right" },
  infoRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 4 },
});

function Info({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.infoRow}>
      <Text style={[s.muted, { width: "42%" }]}>{label}</Text>
      <Text style={[{ width: "58%", textAlign: "right" }, strong ? s.strong : {}]}>{value}</Text>
    </View>
  );
}

function Receipt({ data, pictures }: { data: ReceiptData; pictures: CompanyPictures }) {
  const { company, client } = data.snapshot;
  // Kept plain: black and grey only.
  const accent = INK;
  const advance = data.kind === "advance";
  const heading = advance ? "Advance Receipt" : "Payment Receipt";
  const showBalance = data.bill && !data.cancelledOn && !advance;
  const email = data.contact.email;
  const phone = data.contact.phone;

  return (
    <Document title={`${heading} ${data.number}`} author={company.name} creator="Hotel Admin">
      <Page size="A4" style={s.page}>
        {/* Logo and title */}
        <View style={[s.row, { justifyContent: "space-between", alignItems: "center" }]}>
          {pictures.logo ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={pdfImage(pictures.logo)} style={{ height: 90, maxWidth: 160, objectFit: "contain" }} />
          ) : (
            <View style={{ width: 36, height: 36, borderRadius: 4, backgroundColor: accent, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fefefe", fontWeight: 600, fontSize: 12 }}>{company.initials}</Text>
            </View>
          )}
          <Text style={{ fontSize: 20, fontWeight: 600, color: "#7f7f7f", textTransform: "uppercase" }}>{heading}</Text>
        </View>

        {/* Company, receipt number and date */}
        <View style={[s.row, { marginTop: 14, justifyContent: "space-between" }]}>
          <View style={{ maxWidth: "62%" }}>
            <Text style={[s.strong, { fontSize: 11, lineHeight: 1.25, marginBottom: 2 }]}>{company.name}</Text>
            {company.address ? <Text style={s.muted}>{company.address}</Text> : null}
            {company.registration ? <Text style={s.muted}>{gstinLine(company.registration)}</Text> : null}
            {email || phone ? <Text style={s.muted}>{[email, phone].filter(Boolean).join("  |  ")}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.label, { color: accent }]}>Receipt No.</Text>
            <Text style={s.strong}>{data.number}</Text>
            <Text style={[s.label, { color: accent, marginTop: 6 }]}>Date</Text>
            <Text style={s.strong}>{fmtDateLong(data.paidOn)}</Text>
          </View>
        </View>

        {/* Bill to */}
        <View style={{ marginTop: 14 }}>
          <Text style={[s.label, { color: accent }]}>Bill To</Text>
          {data.teamName ? <Text style={s.strong}>{data.teamName}</Text> : null}
          <Text style={data.teamName ? {} : s.strong}>{client.name}</Text>
          {client.address ? <Text style={s.muted}>{client.address}</Text> : null}
          {client.registration ? <Text style={s.muted}>{gstinLine(client.registration)}</Text> : null}
        </View>

        {/* Payment table */}
        <View style={{ marginTop: 16 }}>
          <View style={[s.row, { backgroundColor: "#f1f2f4", borderTopWidth: 1, borderBottomWidth: 1, borderColor: INK, fontWeight: 600, fontSize: 8 }]}>
            <Text style={[s.cell, { width: "40%" }]}>Mode of Payment & Paid To</Text>
            <Text style={[s.cell, { width: "18%" }]}>Date</Text>
            <Text style={[s.cell, { width: "24%" }]}>Transaction ID</Text>
            <Text style={[s.cell, s.right, { width: "18%" }]}>Payment Amount</Text>
          </View>
          <View style={s.row}>
            <View style={[s.cell, { width: "40%" }]}>
              <Text style={s.strong}>{data.mode || "Not recorded"}</Text>
              <Text style={s.muted}>Paid to {company.name}</Text>
            </View>
            <Text style={[s.cell, { width: "18%" }]}>{fmtDateLong(data.paidOn)}</Text>
            <Text style={[s.cell, { width: "24%" }]}>{data.reference || "-"}</Text>
            <Text style={[s.cell, s.right, s.strong, { width: "18%" }]}>{inr(data.amount)}</Text>
          </View>
          <View style={[s.row, { borderTopWidth: 1, borderBottomWidth: 1.5, borderColor: INK }]}>
            <Text style={[s.cell, s.right, { width: "82%", color: accent, fontWeight: 600 }]}>TOTAL AMOUNT</Text>
            <Text style={[s.cell, s.right, { width: "18%", fontWeight: 600 }]}>{inr(data.amount)}</Text>
          </View>
        </View>

        <View style={[s.row, { marginTop: 10 }]}>
          <Text style={s.muted}>Amount paid (in words): </Text>
          <Text style={[s.strong, { flex: 1 }]}>{amountInWords(data.amount)}</Text>
        </View>

        {/* What the money is for */}
        <View style={{ marginTop: 12 }}>
          {advance ? (
            <Info label="Received as" value={advanceUse(data)} />
          ) : data.bill ? (
            <Info label="Against" value={`${data.bill.title} ${data.bill.number} dated ${fmtDateLong(data.bill.date)}`} />
          ) : null}
          {data.notes ? <Info label={advance ? "For" : "Note"} value={data.notes} /> : null}
          {showBalance && data.bill ? (
            <>
              <Info label="Bill total" value={inr(data.bill.total)} />
              <Info label="Received so far, including this" value={inr(data.bill.receivedToDate)} />
              <Info label="Balance due" value={inr(Math.max(data.bill.total - data.bill.receivedToDate, 0))} strong />
            </>
          ) : null}
        </View>

        {data.cancelledOn ? (
          <Text style={{ marginTop: 12, color: RED }}>
            This receipt was cancelled on {fmtDateLong(data.cancelledOn)} and is no longer valid.
          </Text>
        ) : null}

        <View style={{ marginTop: "auto" }} wrap={false}>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.muted}>For {company.name}</Text>
            {pictures.stamp ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={pdfImage(pictures.stamp)} style={{ width: 80, height: 80, objectFit: "contain", marginTop: 4 }} />
            ) : null}
          </View>
          <Text style={{ textAlign: "center", fontSize: 7, fontWeight: 600, color: MUTED, marginTop: 10 }}>
            This is an electronically generated document; no signature is required.
          </Text>
        </View>

        {data.cancelledOn ? (
          <Text
            style={{ position: "absolute", top: 210, right: 48, borderWidth: 2, borderColor: RED, color: RED, paddingVertical: 4, paddingHorizontal: 10, fontSize: 18, fontWeight: 600, transform: "rotate(-10deg)" }}
          >
            CANCELLED
          </Text>
        ) : null}
      </Page>
    </Document>
  );
}

export function renderReceiptPdf(data: ReceiptData, pictures: CompanyPictures) {
  registerPdfFonts();
  return renderToBuffer(<Receipt data={data} pictures={pictures} />);
}
