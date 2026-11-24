// Tests the user's own bill formats end to end: the GST bill, the Non-GST bill
// and the Proforma Invoice are made on the Bill Generator, then their screen,
// PDF and Word versions are read back and every figure checked; then a
// payment's receipt in the Payment Receipt format, as PDF and Word.
//
// Run against a throwaway database with one login (owner@example.com /
// owner-pass-12345) and the company added by `npm run db:seed`:
//   DATABASE_URL=...hotel_admin_test  node scripts/formats-test.mjs <edge.exe> <shots-dir> <base-url> <today YYYY-MM-DD>

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { Browser, docxText } from "./lib/browser.mjs";

const [EDGE, OUT, BASE, TODAY] = process.argv.slice(2);
if (!process.env.DATABASE_URL?.includes("test")) {
  console.error("Refusing to run: DATABASE_URL must point at a test database.");
  process.exit(2);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async (text, params = []) => (await db.query(text, params)).rows[0];

const results = [];
const record = (step, ok, detail = "") => {
  results.push({ step, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail !== "" ? `  (${detail})` : ""}`);
};
const section = (title) => console.log(`\n--- ${title} ---`);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDate = (iso) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const [y, m] = TODAY.split("-").map(Number);
const fyStart = m >= 4 ? y : y - 1;
const FY = `${String(fyStart % 100).padStart(2, "0")}-${String((fyStart + 1) % 100).padStart(2, "0")}`;

async function pdfText(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return { text: pages.join(" ").replace(/\s+/g, " "), pages: doc.numPages };
}
const missingFrom = (text, wanted) => wanted.filter((w) => !text.includes(w));
const images = (bytes) => (bytes.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;

// ---------------------------------------------------------------------------
const company = await one("select * from companies where name = 'Destinytion Hospitality & Events'");
if (!company) throw new Error("Run npm run db:seed on the test database first.");
const FMT = Object.fromEntries((await db.query("select id, name from formats where company_id = $1", [company.id])).rows.map((r) => [r.name, r.id]));
const CLIENT = { id: randomUUID(), name: "Sage University", address: "Kailod Kartal, Indore", gstin: "23ABCDE1234F1Z5" };
await db.query("insert into clients (id, name, address, registration) values ($1, $2, $3, $4)", [CLIENT.id, CLIENT.name, CLIENT.address, CLIENT.gstin]);
await db.query("insert into client_contacts (client_id, name, phone, is_primary) values ($1, 'Prof. R. Sharma', '98260 11223', true)", [CLIENT.id]);

const me = new Browser({ edge: EDGE, out: OUT, base: BASE, name: "formats", port: 9421 });
const CHECK_IN = addDays(TODAY, 10);
mkdirSync(`${OUT}\\formats`, { recursive: true });

/** Fills a field only if the chosen format shows it. */
const fillIf = async (selector, value) => {
  if (await me.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) await me.setValue(selector, value);
};

/** Makes a bill on the Bill Generator with the same items each time, and finalises it. */
const roomDates = {};

async function makeBill(formatName, { tax = 0, discount = 0, walkIn = null } = {}) {
  await me.goto("/bill-generator");
  await fillIf("#company", company.id);
  await me.setValue("#format", FMT[formatName]);
  if (walkIn) {
    // Someone never billed before: typed in full.
    await me.setValue("#client", walkIn.name);
    await me.setValue("#bt-address", walkIn.address);
    await me.setValue("#bt-phone", walkIn.phone);
  } else {
    // A saved client, typed in other capitals: their details fill in.
    await me.setValue("#client", CLIENT.name.toLowerCase());
  }
  // The booking first; the room added after it takes its dates by itself.
  await fillIf("#d-ref", "Team Alpha");
  if (formatName !== "Proforma Invoice") await fillIf("#d-place", "Madhya Pradesh");
  await me.setValue("#d-hotel", "Radisson Blu");
  await fillIf("#d-haddr", "Ring Road, Indore");
  await me.setValue("#d-in", CHECK_IN);
  await me.setValue("#d-out", addDays(CHECK_IN, 2));
  await fillIf("#d-members", "20");
  await fillIf("#d-rooms", "4 Deluxe Room");
  await fillIf("#d-occ", "Triple sharing");
  await fillIf("#d-meal", "Breakfast and dinner");
  await fillIf("#d-transport", "AC bus, station pick-up");
  // No rooms are held in this test's inventory, so the one room button is for a typed room.
  await me.click("Add room");
  roomDates[formatName] = await me.eval(`[document.getElementById("line-1-in").value, document.getElementById("line-1-nights").value].join(" ")`);
  await me.setValue("#line-1-desc", "Deluxe Room, Radisson Blu, Indore");
  await me.setValue("#line-1-qty", 4);
  await me.setValue("#line-1-rate", 3000);
  await me.click("Add item");
  await me.setValue("#line-2-desc", "Food Expense\nBreakfast and dinner");
  await me.setValue("#line-2-qty", 20);
  await me.setValue("#line-2-days", 2);
  await me.setValue("#line-2-rate", 500);
  await me.click("Add item");
  await me.setValue("#line-3-desc", "Transport");
  await me.setValue("#line-3-qty", 1);
  await me.setValue("#line-3-rate", 8000);
  if (tax) await me.setValue("#tax", tax);
  if (discount) await me.setValue("#discount", discount);
  await me.click("Finalise");
  await me.click("Yes, finalise");
  if (!(await me.waitFor("location.pathname.startsWith('/bills/')"))) throw new Error(`could not finalise the ${formatName}`);
  const id = await me.eval("location.pathname.split('/')[2]");
  const bill = await one("select * from bills where id = $1", [id]);
  await me.waitFor(`document.querySelector('[aria-label="Bill preview"]')?.innerText.includes(${JSON.stringify(bill.number)})`);
  return { id, bill };
}

async function files(name, id) {
  const pdf = await me.fetchFile(`/api/bills/${id}?as=pdf`);
  const word = await me.fetchFile(`/api/bills/${id}?as=docx`);
  writeFileSync(`${OUT}\\formats\\${name}.pdf`, pdf.bytes);
  writeFileSync(`${OUT}\\formats\\${name}.docx`, word.bytes);
  return { pdf, word, pdfText: (await pdfText(pdf.bytes)), wordText: docxText(word.bytes) };
}

try {
  await me.start();
  await me.signIn("owner@example.com", "owner-pass-12345");

  // =====================================================================
  section("The company is there from the start");
  await me.goto("/settings");
  record(
    "Settings lists Destinytion Hospitality & Events with its logo, GSTIN and three formats",
    await me.waitFor("document.body.innerText.includes('Destinytion Hospitality & Events') && document.body.innerText.includes('GSTIN 23AERPU4151P1ZR') && document.body.innerText.includes('GST Bill, Non-GST Bill, Proforma Invoice') && [...document.images].some((i) => i.src.includes('/logo') && i.naturalWidth > 0)"),
  );
  await me.click("Edit");
  record("the company form shows its logo and stamp", await me.waitFor("[...document.querySelectorAll('[data-panel] img')].filter((i) => i.naturalWidth > 0).length === 2"));
  record("and its email and bank details", (await me.eval("document.getElementById('co-email').value")) === "confirmation@destinytionhospitality.in" && (await me.eval("document.getElementById('co-bank').value")).includes("CBIN0281384"));
  await me.shot("formats\\settings");

  // =====================================================================
  section("Typing a client, autosave and the GST check");
  await me.goto("/bill-generator");
  record("with one company there is no Bill from to pick", !(await me.eval("Boolean(document.getElementById('company'))")));
  await me.setValue("#client", "Sage Universty");
  record("a near miss of a saved client's name is caught before it becomes a new client", await me.waitFor("document.querySelector('[data-did-you-mean]')?.innerText.includes('Sage University')"));
  await me.setValue("#format", FMT["GST Bill"]);
  await me.click("Add item");
  await me.setValue("#line-1-desc", "Sightseeing");
  await me.setValue("#line-1-rate", 1000);
  await me.click("Finalise");
  record("finalising a GST bill at 0% GST warns first", await me.waitFor("document.querySelector('[data-gst-warning]')"));
  await me.click("Back");
  await new Promise((r) => setTimeout(r, 900));
  await me.goto("/bill-generator");
  record("coming back after leaving offers the unsaved bill", await me.waitFor("document.querySelector('[data-autosave]')"));
  await me.click("Bring it back");
  record(
    "bringing it back restores what was typed",
    await me.waitFor("document.getElementById('client')?.value === 'Sage Universty' && document.getElementById('line-1-desc')?.value === 'Sightseeing'"),
  );
  await me.eval("localStorage.clear()");

  // =====================================================================
  section("GST bill");
  const gst = await makeBill("GST Bill", { tax: 18 });
  record("a room added after the booking takes its check-in and nights", roomDates["GST Bill"] === `${CHECK_IN} 2`, roomDates["GST Bill"]);
  record("the GST bill is numbered in its series", gst.bill.number === `DHE/${FY}/0001`, gst.bill.number);
  record(
    "items add up: rooms 2 nights x 4 x 3,000, food 20 x 2 days x 500, transport; GST 18%",
    Number(gst.bill.subtotal) === 52000 && Number(gst.bill.tax_total) === 9360 && Number(gst.bill.total) === 61360,
    `${gst.bill.subtotal} + ${gst.bill.tax_total} = ${gst.bill.total}`,
  );
  const screen = await me.eval("document.querySelector('[aria-label=\"Bill preview\"]').innerText.replace(/\\s+/g, ' ')");
  const gstWanted = [
    "TAX INVOICE", gst.bill.number, "Place of Supply", "Madhya Pradesh", "Booking Ref", "Team Alpha",
    "Billed By", "GSTIN: 23AERPU4151P1ZR", "Billed To", "Sage University", "GSTIN: 23ABCDE1234F1Z5",
    "Booking Details", "Radisson Blu", longDate(CHECK_IN), longDate(addDays(CHECK_IN, 2)), "Triple sharing",
    "Accommodation & Charges", "Deluxe Room, Radisson Blu, Indore", "Food Expense", "₹24,000", "₹20,000", "₹8,000",
    "GST Calculation", "CGST", "SGST", "9%", "₹4,680", "Total GST", "₹9,360", "Grand Total (incl. GST)", "₹61,360",
    "Rupees Sixty One Thousand Three Hundred Sixty Only", "This is an electronically generated document; no signature is required.",
  ];
  let miss = missingFrom(screen.toUpperCase(), gstWanted.map((w) => w.toUpperCase()));
  record("the GST bill on screen has every part of the format", miss.length === 0, miss.join(" | "));
  const shown = "[...document.querySelectorAll('[aria-label=\"Bill preview\"] img')]";
  record(
    "the screen shows the logo and the stamp",
    // The Bill Generator stays alive but hidden after leaving it, with its own preview, so at least two.
    await me.waitFor(`${shown}.filter((i) => i.complete && i.naturalWidth > 0).length >= 2`),
    await me.eval(`${shown}.map((i) => i.src.split('/').slice(-1)[0] + ':' + i.naturalWidth).join(', ')`),
  );
  await me.shot("formats\\gst-screen", true);

  let f = await files("gst", gst.id);
  record("the PDF downloads with the bill's name", f.pdf.type === "application/pdf" && f.pdf.disposition.includes(`Tax Invoice DHE-${FY}-0001.pdf`), f.pdf.disposition);
  miss = missingFrom(f.pdfText.text.toUpperCase(), gstWanted.map((w) => w.toUpperCase()));
  record("the GST bill PDF has every part of the format", miss.length === 0, miss.join(" | "));
  record("the PDF fits on one page and carries the logo and stamp", f.pdfText.pages === 1 && images(f.pdf.bytes) >= 2, `${f.pdfText.pages} page(s), ${images(f.pdf.bytes)} images`);
  record("the Word file downloads", f.word.type?.includes("wordprocessingml") && f.word.disposition.includes(".docx") && f.word.bytes.subarray(0, 2).toString() === "PK");
  miss = missingFrom(f.wordText.toUpperCase(), gstWanted.map((w) => w.toUpperCase()));
  record("the Word file has every part of the format", miss.length === 0, miss.join(" | "));
  const media = new Set(f.word.bytes.toString("latin1").match(/word\/media\/[\w.-]+?\.(?:png|jpe?g)/g) ?? []);
  record("the Word file carries the logo and stamp", media.size >= 2, [...media].join(", "));

  // =====================================================================
  section("Non-GST bill");
  const WALK_IN = { name: "Rakesh Jain", address: "12 MG Road, Bhopal", phone: "99260 55443" };
  const non = await makeBill("Non-GST Bill", { walkIn: WALK_IN });
  const added = await one("select c.name, c.address, cc.phone from clients c left join client_contacts cc on cc.client_id = c.id where c.name = $1", [WALK_IN.name]);
  record("a name typed for the first time becomes a client, with the address and phone typed", added?.address === WALK_IN.address && added?.phone === WALK_IN.phone && non.bill.client_id !== null, JSON.stringify(added));
  record("the Non-GST bill has its own series and no tax", non.bill.number === `DHE/N/${FY}/0001` && Number(non.bill.tax_total) === 0 && Number(non.bill.total) === 52000, `${non.bill.number}, ${non.bill.total}`);
  f = await files("non-gst", non.id);
  const nonWanted = ["NON-TAXABLE INVOICE", "Team Alpha", "Rakesh Jain", "12 MG Road, Bhopal", "Booking Details", "Members", "Grand Total", "₹52,000", "Rupees Fifty Two Thousand Only"];
  miss = missingFrom(f.pdfText.text.toUpperCase(), nonWanted.map((w) => w.toUpperCase()));
  record("the Non-GST PDF has every part of its format", miss.length === 0, miss.join(" | "));
  record("the Non-GST bill shows no GSTIN and no GST", !f.pdfText.text.includes("23AERPU4151P1ZR") && !f.pdfText.text.includes("CGST") && !f.wordText.includes("23AERPU4151P1ZR"));
  await me.shot("formats\\non-gst-screen", true);

  // =====================================================================
  section("Proforma Invoice");
  const pro = await makeBill("Proforma Invoice", { tax: 5, discount: 2000 });
  record(
    "the proforma takes GST and the discount: 52,000 + 2,600 - 2,000",
    Number(pro.bill.total) === 52600 && pro.bill.is_sale === false && pro.bill.number === `DHE/P/${FY}/0001`,
    `${pro.bill.number}, ${pro.bill.total}, sale ${pro.bill.is_sale}`,
  );
  f = await files("proforma", pro.id);
  const proWanted = [
    "PROFORMA INVOICE", "Invoice By", "Invoice To", "Meal plan", "Breakfast and dinner",
    "Amount per Day", "Total Days of Stay", "GST @ 5%", "₹2,600", "Discount", "- ₹2,000", "Total Amount", "₹52,600",
    "Rupees Fifty Two Thousand Six Hundred Only", "AMOUNT NOT PAID",
    // The proforma's note from the user's own format, kept as a note.
    "Please proceed with the payment to the account detailed below:", "Kindly Complete Full Amount before Specific Date.", "Current Account Details", "Bank Name- Central Bank of India", "Account number = 5320185694", "Ifsc code- CBIN0281384",
  ];
  miss = missingFrom(f.pdfText.text.toUpperCase(), proWanted.map((w) => w.toUpperCase()));
  record("the proforma PDF has every part of its format", miss.length === 0, miss.join(" | "));
  miss = missingFrom(f.wordText.toUpperCase(), proWanted.map((w) => w.toUpperCase()));
  record("the proforma Word file has every part of its format", miss.length === 0, miss.join(" | "));
  await me.shot("formats\\proforma-screen", true);

  // =====================================================================
  section("Payment receipt");
  await me.goto(`/bills/${gst.id}`);
  await me.click("Record payment");
  await me.waitFor("document.getElementById('pay-amount')");
  await me.setValue("#pay-amount", 20000);
  await me.setValue("#pay-mode", "UPI");
  await me.setValue("#pay-ref", "UTR 5566778899");
  await me.submit("payment-form");
  await me.waitFor("document.querySelector('[data-payments]')");
  const payment = await one("select * from payments where bill_id = $1", [gst.id]);
  const rpdf = await me.fetchFile(`/api/receipts/${payment.id}`);
  const rword = await me.fetchFile(`/api/receipts/${payment.id}?as=docx`);
  writeFileSync(`${OUT}\\formats\\receipt.pdf`, rpdf.bytes);
  writeFileSync(`${OUT}\\formats\\receipt.docx`, rword.bytes);
  const rtext = (await pdfText(rpdf.bytes)).text;
  const rWanted = [
    "PAYMENT RECEIPT", "Receipt No.", payment.receipt_number, "confirmation@destinytionhospitality.in", "Bill To", "Team Alpha", "Sage University",
    "Mode of Payment & Paid To", "Transaction ID", "Payment Amount", "UPI", "Paid to Destinytion Hospitality & Events", "UTR 5566778899",
    "TOTAL AMOUNT", "₹20,000", "Rupees Twenty Thousand Only", `Tax Invoice ${gst.bill.number}`, "Balance due ₹41,360",
    "This is an electronically generated document; no signature is required.",
  ];
  miss = missingFrom(rtext.toUpperCase(), rWanted.map((w) => w.toUpperCase()));
  record("the receipt PDF has every part of the Payment Receipt format", miss.length === 0, miss.join(" | "));
  record("the receipt PDF carries the logo and stamp", images(rpdf.bytes) >= 2);
  miss = missingFrom(docxText(rword.bytes).toUpperCase(), rWanted.map((w) => w.toUpperCase()));
  record("the receipt Word file has every part of the format", rword.disposition?.includes(".docx") && miss.length === 0, miss.join(" | "));
  await me.shot("formats\\gst-paid-screen", true);

  // The PDFs as they look, for a person to check.
  await me.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 1400, deviceScaleFactor: 1, mobile: false });
  for (const name of ["gst", "non-gst", "proforma", "receipt"]) {
    const path = name === "receipt" ? `/api/receipts/${payment.id}?inline=1` : `/api/bills/${{ gst: gst.id, "non-gst": non.id, proforma: pro.id }[name]}?as=pdf&inline=1`;
    await me.goto(`${path}#zoom=page-fit`);
    await me.shot(`formats\\${name}-pdf`);
  }
} catch (error) {
  console.log(`\nscript error: ${error.stack ?? error}`);
  results.push({ step: "script error", ok: false });
} finally {
  me.stop();
  await db.end();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
