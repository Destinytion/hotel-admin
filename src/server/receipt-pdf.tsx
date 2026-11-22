import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { fmtDateLong, inr, round2 } from "@/lib/format";
import { amountInWords } from "@/lib/words";
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

/*
  Inter, the app's own typeface, is embedded so the receipt looks the same on
  every device and the rupee sign prints. The files live in public/fonts so the
  hosted container carries them.
*/
const fonts = path.join(process.cwd(), "public", "fonts");
Font.register({
  family: "Inter",
  fonts: [
    { src: path.join(fonts, "Inter-Regular.ttf"), fontWeight: 400 },
    { src: path.join(fonts, "Inter-SemiBold.ttf"), fontWeight: 600 },
  ],
});
// Names and addresses are never broken across lines with a hyphen.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#1a1c20";
const MUTED = "#5b616b";
const LINE = "#d9dce1";
const SOFT = "#f4f5f7";
const RED = "#ad2a21";

const s = StyleSheet.create({
  page: { paddingVertical: 34, paddingHorizontal: 34, fontFamily: "Inter", fontSize: 9, color: INK, lineHeight: 1.45 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingBottom: 14,
  },
  company: { flexDirection: "row", maxWidth: "62%" },
  chip: { width: 26, height: 26, borderRadius: 4, marginRight: 9, alignItems: "center", justifyContent: "center" },
  chipText: { color: "#fefefe", fontSize: 10, fontWeight: 600 },
  companyName: { fontSize: 12, fontWeight: 600, lineHeight: 1.3 },
  muted: { color: MUTED },
  titleBlock: { alignItems: "flex-end" },
  // No letter-spacing: spaced letters copy out of a PDF as "P A Y M E N T".
  title: { fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" },
  section: { marginTop: 16 },
  label: { color: MUTED, fontSize: 8, marginBottom: 2 },
  clientName: { fontSize: 11, fontWeight: 600 },
  amountBox: { marginTop: 16, padding: 12, backgroundColor: SOFT, borderRadius: 4 },
  amount: { fontSize: 20, fontWeight: 600, lineHeight: 1.2 },
  words: { marginTop: 3 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5 },
  rowLabel: { width: "42%", color: MUTED },
  rowValue: { width: "58%", textAlign: "right" },
  strong: { fontWeight: 600 },
  footer: { marginTop: "auto", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  sign: { alignItems: "flex-end" },
  signLine: { marginTop: 26, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 3, color: MUTED },
  stamp: {
    position: "absolute",
    top: 150,
    right: 34,
    borderWidth: 2,
    borderColor: RED,
    color: RED,
    paddingVertical: 4,
    paddingHorizontal: 10,
    fontSize: 18,
    fontWeight: 600,
    transform: "rotate(-10deg)",
  },
});

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={strong ? [s.rowValue, s.strong] : s.rowValue}>{value}</Text>
    </View>
  );
}

/** How an advance has been used, in words. */
function advanceUse(data: ReceiptData) {
  const used = round2(data.uses.reduce((sum, u) => sum + u.amount, 0));
  if (!data.uses.length) return "Advance, to be adjusted against a future bill";
  if (data.uses.length === 1 && used >= data.amount) return `Advance, used on ${data.uses[0].number}`;
  const parts = data.uses.map((u) => `${inr(u.amount)} used on ${u.number}`).join(", ");
  const left = round2(data.amount - used);
  return `Advance, ${parts}${left > 0 ? `; ${inr(left)} to be adjusted against a future bill` : ""}`;
}

function Receipt({ data }: { data: ReceiptData }) {
  const { company, client } = data.snapshot;
  const advance = data.kind === "advance";
  const heading = advance ? "Advance Receipt" : "Payment Receipt";
  const showBalance = data.bill && !data.cancelledOn && !advance;

  return (
    <Document title={`${heading} ${data.number}`} author={company.name} creator="Hotel Admin">
      <Page size="A5" style={s.page}>
        <View style={s.header}>
          <View style={s.company}>
            <View style={[s.chip, { backgroundColor: company.color }]}>
              <Text style={s.chipText}>{company.initials}</Text>
            </View>
            <View>
              <Text style={s.companyName}>{company.name}</Text>
              {company.address ? <Text style={s.muted}>{company.address}</Text> : null}
              {company.registration ? <Text style={s.muted}>{company.registration}</Text> : null}
            </View>
          </View>
          <View style={s.titleBlock}>
            <Text style={s.title}>{heading}</Text>
            <Text style={s.muted}>No. {data.number}</Text>
            <Text style={s.muted}>{fmtDateLong(data.paidOn)}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.label}>Received from</Text>
          <Text style={s.clientName}>{client.name}</Text>
          {client.address ? <Text style={s.muted}>{client.address}</Text> : null}
          {client.registration ? <Text style={s.muted}>{client.registration}</Text> : null}
        </View>

        <View style={s.amountBox}>
          <Text style={s.label}>Amount received</Text>
          <Text style={s.amount}>{inr(data.amount)}</Text>
          <Text style={s.words}>{amountInWords(data.amount)}</Text>
        </View>

        <View style={s.section}>
          <Row label="Paid by" value={data.mode || "Not recorded"} />
          {data.reference ? <Row label="Reference" value={data.reference} /> : null}
          {advance ? (
            <Row label="Received as" value={advanceUse(data)} />
          ) : data.bill ? (
            <Row label="Against" value={`${data.bill.title} ${data.bill.number} dated ${fmtDateLong(data.bill.date)}`} />
          ) : null}
          {data.notes ? <Row label={advance ? "For" : "Note"} value={data.notes} /> : null}
          {showBalance && data.bill ? (
            <>
              <Row label="Bill total" value={inr(data.bill.total)} />
              <Row label="Received so far, including this" value={inr(data.bill.receivedToDate)} />
              <Row label="Balance due" value={inr(Math.max(data.bill.total - data.bill.receivedToDate, 0))} strong />
            </>
          ) : null}
        </View>

        {data.cancelledOn ? (
          <Text style={[s.section, { color: RED }]}>
            This receipt was cancelled on {fmtDateLong(data.cancelledOn)} and is no longer valid.
          </Text>
        ) : null}

        <View style={s.footer}>
          <Text style={s.muted}>{data.recordedBy ? `Recorded by ${data.recordedBy}` : ""}</Text>
          <View style={s.sign}>
            <Text>For {company.name}</Text>
            <Text style={s.signLine}>Authorised signatory</Text>
          </View>
        </View>

        {data.cancelledOn ? <Text style={s.stamp}>CANCELLED</Text> : null}
      </Page>
    </Document>
  );
}

export function renderReceiptPdf(data: ReceiptData) {
  return renderToBuffer(<Receipt data={data} />);
}
