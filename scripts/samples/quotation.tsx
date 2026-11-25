// Writes a sample Quotation as PDF and Word, to look at the layout without
// the app running. Uses the logo and stamp in seed/.
//
//   npx tsx --tsconfig scripts/samples/tsconfig.json scripts/samples/quotation.tsx <out folder>

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { billTotals, defaultSchedule, emptyDetails, QUOTATION_NOTE, type BillDoc } from "@/lib/bill-document";
import { renderBillPdf } from "@/server/bill-pdf";
import { renderBillDocx } from "@/server/bill-docx";

const out = process.argv[2] ?? ".";
const picture = (file: string) => ({ data: readFileSync(path.join("seed", file)), mime: "image/png" });
const pictures = { logo: picture("destinytion-logo.png"), stamp: picture("destinytion-stamp.png") };

const lines = [
  { key: 1, kind: "room" as const, description: "Deluxe Room\ntriple sharing, breakfast and dinner", checkIn: "2027-01-10", nights: 3, quantity: 12, rate: 3200, amount: 115200 },
  { key: 2, kind: "other" as const, description: "Airport transfer\nTempo Traveller, both ways", checkIn: "", nights: 1, quantity: 2, rate: 4500, amount: 9000 },
];
const t = billTotals(lines, "quotation", true, 5, 0);
const schedule = defaultSchedule();
schedule[0].amount = Math.round(t.total * 0.3);
schedule[1].amount = Math.round(t.total * 0.4);
schedule[2].amount = Math.round(t.total - schedule[0].amount - schedule[1].amount);

const doc: BillDoc = {
  layout: "quotation",
  title: "Quotation",
  number: "DHE/Q/2026-27/0001",
  billDate: "2026-11-26",
  company: {
    name: "Destinytion Hospitality & Events",
    initials: "DHE",
    color: "#3f4a5a",
    address: "Indore, Madhya Pradesh 452009",
    registration: "23AERPU4151P1ZR",
    email: "destinytionhospitalityandevent@gmail.com",
    phone: "",
    bankDetails: "Bank Name- Central Bank of India",
    terms: "",
  },
  client: { name: "IIT Indore Cultural Team", address: "Simrol, Indore", registration: "", contact: "", phone: "" },
  details: {
    ...emptyDetails(),
    eventName: "Fluxus 2027",
    hotelName: "Sea View Resort, Goa",
    checkIn: "2027-01-10",
    checkOut: "2027-01-13",
    members: "36",
    signName: "Rahul Verma",
    signPhone: "+91 98765 43210",
  },
  lines,
  subtotal: t.subtotal,
  taxPercent: 5,
  tax: t.tax,
  discount: 0,
  total: t.total,
  notes: QUOTATION_NOTE.replace("your enquiry", "your enquiry for Fluxus 2027"),
  paid: null,
  schedule,
};

void (async () => {
  writeFileSync(path.join(out, "sample-quotation.pdf"), await renderBillPdf(doc, pictures));
  writeFileSync(path.join(out, "sample-quotation.docx"), await renderBillDocx(doc, pictures));
  console.log(`Wrote sample-quotation.pdf and .docx to ${out}, total ${t.total}`);
})();
