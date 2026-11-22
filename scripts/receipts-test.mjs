// Tests payment receipts and advances: numbering, the PDF's contents, using an
// advance on a bill, cancelling, two people recording at once, and who can
// download a receipt. Every PDF is opened and its text read back.
//
// Run against a throwaway database with two logins and nothing else:
//   owner@example.com / owner-pass-12345 and second@example.com / second-pass-12345
//   DATABASE_URL=...hotel_admin_test  node scripts/receipts-test.mjs <edge.exe> <shots-dir> <base-url> <today YYYY-MM-DD>

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const [EDGE, OUT, BASE, TODAY] = process.argv.slice(2);
if (!process.env.DATABASE_URL?.includes("test")) {
  console.error("Refusing to run: DATABASE_URL must point at a test database.");
  process.exit(2);
}
const { amountInWords } = await import(pathToFileURL(`${process.cwd()}/src/lib/words.ts`).href);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async (text, params = []) => (await db.query(text, params)).rows[0];
const all = async (text, params = []) => (await db.query(text, params)).rows;

const results = [];
const record = (step, ok, detail = "") => {
  results.push({ step, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail !== "" ? `  (${detail})` : ""}`);
};
const section = (title) => console.log(`\n--- ${title} ---`);
const j = (v) => JSON.stringify(v);

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const [y, m] = TODAY.split("-").map(Number);
const fyStart = m >= 4 ? y : y - 1;
const FY = `${String(fyStart % 100).padStart(2, "0")}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
const receiptNo = (initials, n) => `${initials}/R/${FY}/${String(n).padStart(4, "0")}`;

/** All the text in a PDF, one string per page joined by spaces. */
async function pdfText(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return { text: pages.join(" ").replace(/\s+/g, " "), pages: doc.numPages };
}

// ---------------------------------------------------------------------------
section("Amount in words");
// ---------------------------------------------------------------------------
const WORDS = [
  [0, "Rupees Zero Only"],
  [1, "Rupees One Only"],
  [15, "Rupees Fifteen Only"],
  [40, "Rupees Forty Only"],
  [99, "Rupees Ninety Nine Only"],
  [100, "Rupees One Hundred Only"],
  [101, "Rupees One Hundred One Only"],
  [1000, "Rupees One Thousand Only"],
  [21000, "Rupees Twenty One Thousand Only"],
  [100000, "Rupees One Lakh Only"],
  [125000.5, "Rupees One Lakh Twenty Five Thousand and Fifty Paise Only"],
  [999999, "Rupees Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Only"],
  [10000000, "Rupees One Crore Only"],
  [1234567890, "Rupees One Hundred Twenty Three Crore Forty Five Lakh Sixty Seven Thousand Eight Hundred Ninety Only"],
  [0.1 + 0.2, "Rupees Zero and Thirty Paise Only"],
  [99.999, "Rupees One Hundred Only"],
  [10.05, "Rupees Ten and Five Paise Only"],
];
const wrongWords = WORDS.filter(([n, want]) => amountInWords(n) !== want).map(([n, want]) => `${n}: "${amountInWords(n)}" not "${want}"`);
record(`${WORDS.length} amounts read correctly in lakh and crore`, wrongWords.length === 0, wrongWords.join("; "));

// ---------------------------------------------------------------------------
// Data: two companies, two clients, five finalised bills
// ---------------------------------------------------------------------------
const owner = await one("select id from users where email = 'owner@example.com'");
const second = await one("select id from users where email = 'second@example.com'");
if (!owner || !second) throw new Error("Add owner@example.com and second@example.com first.");

const CO = {
  A: { id: randomUUID(), name: "Alpha Stays LLP", initials: "AC", address: "214 Lake Road, Udaipur", registration: "REG-ALPHA" },
  B: { id: randomUUID(), name: "Beta Travels", initials: "BC", address: "3 Beach Road, Goa", registration: "" },
};
const CL = {
  C1: { id: randomUUID(), name: "Tarang Events LLP", address: "41 Residency Road, Jodhpur" },
  C2: { id: randomUUID(), name: "Orbit Holidays", address: "7 MG Road, Indore" },
};
for (const c of Object.values(CO)) {
  await db.query("insert into companies (id, name, initials, address, registration) values ($1, $2, $3, $4, $5)", [c.id, c.name, c.initials, c.address, c.registration]);
  c.format = randomUUID();
  await db.query("insert into formats (id, company_id, name, title, number_prefix, has_tax_line) values ($1, $2, 'Invoice', 'Tax Invoice', $3, true)", [c.format, c.id, `${c.initials}/`]);
}
for (const c of Object.values(CL)) {
  await db.query("insert into clients (id, name, address) values ($1, $2, $3)", [c.id, c.name, c.address]);
}
const BILLS = {};
async function addBill(key, co, client, total, number) {
  const id = randomUUID();
  BILLS[key] = { id, total, number };
  await db.query(
    `insert into bills (id, company_id, format_id, client_id, number, status, is_sale, bill_date, data, subtotal, tax_total, total, snapshot, created_by, updated_by, finalised_at)
     values ($1, $2, $3, $4, $5, 'final', true, $6, '{"taxPercent":0,"notes":""}', $7, 0, $7, $8, $9, $9, now())`,
    [id, CO[co].id, CO[co].format, CL[client].id, number, addDays(TODAY, -2), total,
      JSON.stringify({ company: { name: CO[co].name, initials: CO[co].initials, color: "#2f6f6a", address: CO[co].address, registration: CO[co].registration, bankDetails: "", terms: "" }, client: { name: CL[client].name, address: CL[client].address, registration: "", contact: "", phone: "" }, format: { title: "Tax Invoice", hasTaxLine: true } }),
      owner.id],
  );
  await db.query("insert into bill_lines (bill_id, position, kind, description, quantity, rate, amount) values ($1, 0, 'other', 'Rooms', 1, $2, $2)", [id, total]);
}
await addBill("b1", "A", "C1", 21000, "AC/T/0001");
await addBill("b2", "A", "C1", 5000, "AC/T/0002");
await addBill("b3", "B", "C1", 8000, "BC/T/0001");
await addBill("b5", "A", "C1", 9000, "AC/T/0005");

// ---------------------------------------------------------------------------
// Browser driver
// ---------------------------------------------------------------------------
class Browser {
  constructor(name, port) {
    Object.assign(this, { name, port, seq: 0, pending: new Map() });
  }
  async start() {
    this.proc = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${this.port}`, `--user-data-dir=${OUT}\\rc-${this.name}-${Date.now()}`, "--window-size=1440,1000", "--disable-gpu", "about:blank"], { stdio: "ignore" });
    let url;
    for (let i = 0; i < 80 && !url; i++) {
      try {
        url = (await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
      } catch {}
      if (!url) await sleep(250);
    }
    if (!url) throw new Error(`${this.name}: could not reach the browser`);
    this.ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error("WebSocket failed"));
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const waiting = this.pending.get(msg.id);
      if (!waiting) return;
      this.pending.delete(msg.id);
      if (msg.error) waiting.reject(new Error(msg.error.message));
      else waiting.resolve(msg.result);
    };
    await this.send("Page.enable");
    await this.send("Runtime.enable");
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${this.name}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }
  async waitFor(expr, ms = 20000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await this.eval(`Boolean(${expr})`)) return true;
      } catch {}
      await sleep(150);
    }
    return false;
  }
  async goto(path) {
    await this.send("Page.navigate", { url: BASE + path });
    await sleep(400);
    await this.waitFor("document.readyState === 'complete'");
    await sleep(900);
  }
  sees(text, ms) {
    return this.waitFor(`document.body.innerText.includes(${j(text)})`, ms);
  }
  ready(selector) {
    return this.waitFor(`(() => { const el = document.querySelector(${j(selector)}); return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`);
  }
  setValue(selector, value) {
    return this.eval(`(() => {
      const el = document.querySelector(${j(selector)});
      if (!el) throw new Error("missing " + ${j(selector)});
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${j(String(value))});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    })()`);
  }
  async click(text, within = "document") {
    const find = `[...${within}.querySelectorAll("button, a")].find((b) => b.textContent.trim() === ${j(text)} && !b.disabled)`;
    if (!(await this.waitFor(`(() => { const el = ${find}; return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`))) {
      throw new Error(`${this.name}: no button or link "${text}"`);
    }
    await this.eval(`(${find}).click()`);
  }
  submit(formId) {
    return this.eval(`document.getElementById(${j(formId)}).requestSubmit()`);
  }
  /** Downloads a receipt with this browser's sign-in, and reads the PDF. */
  async receipt(paymentId, path = `/api/receipts/${paymentId}`) {
    const got = await this.eval(`fetch(${j(path)}).then(async (r) => {
      const bytes = new Uint8Array(await r.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { status: r.status, type: r.headers.get("content-type"), disposition: r.headers.get("content-disposition"), b64: btoa(s) };
    })`);
    const bytes = Buffer.from(got.b64, "base64");
    return { ...got, bytes, ...(got.status === 200 && got.type === "application/pdf" ? await pdfText(bytes) : { text: "", pages: 0 }) };
  }
  async signIn(email, password) {
    await this.goto("/login");
    await this.ready("form");
    await this.eval(`document.getElementById("email").value = ${j(email)}; document.getElementById("password").value = ${j(password)}; document.querySelector("form").requestSubmit()`);
    if (!(await this.waitFor("location.pathname === '/'"))) throw new Error(`${this.name}: could not sign in`);
  }
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT}\\${name}.png`, Buffer.from(r.data, "base64"));
  }
  stop() {
    try {
      this.ws?.close();
    } catch {}
    this.proc?.kill();
  }
}

const me = new Browser("owner", 9401);
const other = new Browser("second", 9402);
const paymentByReceipt = async (number) => one("select * from payments where receipt_number = $1", [number]);
// Payments on the bill plus any advances used on it.
const billPaid = async (key) => Number((await one("select coalesce(sum(amount), 0) as paid from bill_receipts where bill_id = $1", [BILLS[key].id])).paid);
const clientOwes = async () => {
  await me.goto("/clients");
  await me.waitFor("document.querySelector('tbody tr')");
  return me.eval(`(() => { const tr = [...document.querySelectorAll('tbody tr')].find((t) => t.innerText.includes(${j(CL.C1.name)})); return tr ? tr.cells[tr.cells.length - 1].innerText.trim() : null; })()`);
};

async function recordOnBill(b, key, amount, reference) {
  await b.goto(`/bills/${BILLS[key].id}`);
  await b.click("Record payment");
  await b.waitFor("document.getElementById('pay-amount')");
  await b.setValue("#pay-amount", amount);
  await b.setValue("#pay-ref", reference);
  await b.submit("payment-form");
  await b.waitFor("!document.getElementById('payment-form')");
}

async function openAdvanceForm(b) {
  await b.goto("/payments");
  await b.click("Record advance");
  await b.waitFor("document.getElementById('adv-amount')");
}
async function fillAdvance(b, { company, client, amount, mode = "UPI", notes = "" }) {
  await b.setValue("#adv-company", CO[company].id);
  await b.setValue("#adv-client", CL[client].id);
  await b.setValue("#adv-amount", amount);
  await b.setValue("#adv-mode", mode);
  await b.setValue("#adv-notes", notes);
}

const downloads = `${OUT}\\rc-downloads`;
rmSync(downloads, { recursive: true, force: true });
mkdirSync(downloads, { recursive: true });

try {
  await Promise.all([me.start(), other.start()]);
  await me.signIn("owner@example.com", "owner-pass-12345");
  await other.signIn("second@example.com", "second-pass-12345");

  // =====================================================================
  section("A payment on a bill gets a numbered receipt");
  await recordOnBill(me, "b1", 10000, "UTR 778899");
  const r1 = await paymentByReceipt(receiptNo("AC", 1));
  record("the first payment gets the first receipt number of the year", Boolean(r1), receiptNo("AC", 1));
  record("the bill page lists it with its receipt number", await me.sees(receiptNo("AC", 1)));
  await me.shot("rc-bill");

  await me.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await me.eval(`document.querySelector('[data-receipt=${j(r1.id)}]').click()`);
  const expectedFile = `Receipt ${receiptNo("AC", 1).replace(/\//g, "-")}.pdf`;
  for (let i = 0; i < 60 && !existsSync(`${downloads}\\${expectedFile}`); i++) await sleep(250);
  const clicked = existsSync(`${downloads}\\${expectedFile}`) ? readFileSync(`${downloads}\\${expectedFile}`) : null;
  record("clicking the receipt number downloads a PDF file named after the receipt", Boolean(clicked) && clicked.subarray(0, 5).toString() === "%PDF-", readdirSync(downloads).join(", "));

  const p1 = await pdfText(clicked ?? Buffer.alloc(0));
  const mustHave = [
    "PAYMENT RECEIPT",
    `No. ${receiptNo("AC", 1)}`,
    CO.A.name,
    CO.A.address,
    CO.A.registration,
    "Received from",
    CL.C1.name,
    CL.C1.address,
    "₹10,000",
    "Rupees Ten Thousand Only",
    "Bank transfer",
    "UTR 778899",
    `Tax Invoice ${BILLS.b1.number}`,
    "₹21,000",
    "Balance due ₹11,000",
    `For ${CO.A.name}`,
    "Authorised signatory",
    "Recorded by Owner One",
  ];
  const missing = mustHave.filter((s) => !p1.text.includes(s));
  record("the receipt shows company, client, amount in figures and words, method, reference, bill and balance", missing.length === 0, missing.length ? `missing: ${missing.join(" | ")}` : `${p1.pages} page`);
  record("the receipt fits on one page", p1.pages === 1);

  await recordOnBill(me, "b1", 11000, "UTR 112233");
  const r2rec = await me.receipt((await paymentByReceipt(receiptNo("AC", 2))).id);
  record("the second payment's receipt shows the bill now fully paid", r2rec.text.includes("Received so far, including this ₹21,000") && r2rec.text.includes("Balance due ₹0"), r2rec.text.match(/Received so far[^B]*Balance due ₹[\d,]+/)?.[0]);

  await db.query("update clients set address = 'NEW ADDRESS 99' where id = $1", [CL.C1.id]);
  const again = await me.receipt(r1.id);
  record("an old receipt keeps the client's address as it was when paid", again.text.includes(CL.C1.address) && !again.text.includes("NEW ADDRESS 99"));
  record("the same receipt downloaded twice reads the same", again.text === p1.text);

  // =====================================================================
  section("Advances");
  await openAdvanceForm(me);
  await fillAdvance(me, { company: "A", client: "C1", amount: 5000, notes: "Deposit for December booking" });
  await me.submit("advance-form");
  record("recording an advance confirms its receipt number", await me.sees(`Advance recorded with receipt ${receiptNo("AC", 3)}.`));
  await me.shot("rc-advance-saved");
  const adv = await paymentByReceipt(receiptNo("AC", 3));
  record("advances share the company's receipt series", adv?.kind === "advance" && adv.bill_id === null);
  const advPdf = await me.receipt(adv.id);
  const advMissing = ["ADVANCE RECEIPT", "Rupees Five Thousand Only", "Deposit for December booking", "to be adjusted against a future bill", CL.C1.name].filter((s) => !advPdf.text.includes(s));
  record("the advance receipt says it is an advance and what it is for", advMissing.length === 0, advMissing.join(" | "));
  // Owed = bills (21,000 + 5,000 + 8,000 + 9,000) - payments (10,000 + 11,000) - the 5,000 advance.
  const owesNow = await clientOwes();
  record("the client's balance counts the advance as credit", owesNow === "₹17,000", owesNow);

  await me.goto(`/bills/${BILLS.b3.id}`);
  await me.waitFor("document.querySelector('[data-payments]') || document.body.innerText.includes('None recorded yet')");
  record("an advance taken by one company is not offered on the other company's bill", !(await me.eval("Boolean(document.querySelector('[data-advances]'))")));

  await me.goto(`/bills/${BILLS.b2.id}`);
  record("the same company's bill offers the advance", await me.waitFor("document.querySelector('[data-advances]')"));
  await me.click("Use on this bill", "document.querySelector('[data-advances]')");
  await me.waitFor("!document.querySelector('[data-advances]')");
  record("using the advance pays the bill", (await billPaid("b2")) === 5000 && (await me.sees("Paid")));
  const usedPdf = await me.receipt(adv.id);
  record("the advance receipt now says which bill it was used on", usedPdf.text.includes(`Advance, used on ${BILLS.b2.number}`) && usedPdf.text.includes(receiptNo("AC", 3)));
  const owesAfter = await clientOwes();
  record("the client's balance is unchanged, the credit just moved onto the bill", owesAfter === "₹17,000", owesAfter);

  await openAdvanceForm(me);
  await fillAdvance(me, { company: "A", client: "C1", amount: 9000, notes: "Second deposit" });
  await me.submit("advance-form");
  await me.sees(`Advance recorded with receipt ${receiptNo("AC", 4)}.`);
  const adv2 = await paymentByReceipt(receiptNo("AC", 4));
  record("a second advance gets the next number", adv2?.kind === "advance" && Number(adv2.amount) === 9000);
  await me.goto(`/bills/${BILLS.b5.id}`);
  await me.waitFor("document.querySelector('[data-advances]')");
  await db.query(
    "insert into payments (company_id, client_id, bill_id, kind, amount, mode, paid_on, receipt_number, created_by) values ($1, $2, $3, 'payment', 1000, 'Cash', $4, 'AC/R/TEST/0001', $5)",
    [CO.A.id, CL.C1.id, BILLS.b5.id, TODAY, second.id],
  );
  await me.click("Use on this bill", "document.querySelector('[data-advances]')");
  record(
    "if someone pays part of the bill first, using more than is now due is refused with the reason",
    (await me.sees("Only ₹8,000 is still due on this bill.")) &&
      Number((await one("select count(*) from advance_uses where advance_id = $1", [adv2.id])).count) === 0,
  );
  await db.query("delete from payments where receipt_number = 'AC/R/TEST/0001'");

  // =====================================================================
  section("Cancelling a payment");
  await me.goto(`/bills/${BILLS.b1.id}`);
  const p2 = await paymentByReceipt(receiptNo("AC", 2));
  await me.waitFor(`document.querySelector('[data-payment=${j(p2.id)}]')`);
  await me.click("Cancel payment", `document.querySelector('[data-payment=${j(p2.id)}]')`);
  await me.click("Yes, cancel it", `document.querySelector('[data-payment=${j(p2.id)}]')`);
  await me.waitFor(`document.querySelector('[data-payment=${j(p2.id)}]')?.innerText.includes('Cancelled')`);
  record("a cancelled payment no longer counts on the bill", (await billPaid("b1")) === 10000 && (await me.sees("Part paid")));
  const cancelledPdf = await me.receipt(p2.id);
  record("its receipt keeps its number and is marked CANCELLED", cancelledPdf.text.includes(receiptNo("AC", 2)) && cancelledPdf.text.includes("CANCELLED") && cancelledPdf.text.includes("cancelled on"));
  record("the cancelled receipt no longer shows a balance", !cancelledPdf.text.includes("Balance due"));
  await me.shot("rc-cancelled");

  await other.goto(`/bills/${BILLS.b1.id}`);
  await other.waitFor(`document.querySelector('[data-payment=${j(r1.id)}]')`);
  await me.goto(`/bills/${BILLS.b1.id}`);
  await me.waitFor(`document.querySelector('[data-payment=${j(r1.id)}]')`);
  await other.click("Cancel payment", `document.querySelector('[data-payment=${j(r1.id)}]')`);
  await me.click("Cancel payment", `document.querySelector('[data-payment=${j(r1.id)}]')`);
  await Promise.all([
    other.click("Yes, cancel it", `document.querySelector('[data-payment=${j(r1.id)}]')`),
    me.click("Yes, cancel it", `document.querySelector('[data-payment=${j(r1.id)}]')`),
  ]);
  await sleep(2500);
  const cancelLogs = Number((await one("select count(*) as n from audit_log where entity = 'payment' and entity_id = $1 and action = 'cancelled'", [r1.id])).n);
  const told = `${await me.eval("document.body.innerText")} ${await other.eval("document.body.innerText")}`;
  record("two people cancelling the same payment at once: it is cancelled once, and the second is told", cancelLogs === 1 && /already cancelled this payment/.test(told), `cancelled ${cancelLogs} time(s)`);

  await recordOnBill(me, "b1", 21000, "UTR 445566");
  record("numbers are never reused: the next payment gets the next number", Boolean(await paymentByReceipt(receiptNo("AC", 5))));

  // =====================================================================
  section("Two people recording at the same instant");
  for (let round = 1; round <= 3; round++) {
    await Promise.all([openAdvanceForm(me), openAdvanceForm(other)]);
    await Promise.all([
      fillAdvance(me, { company: "A", client: "C2", amount: 100 * round, notes: `me ${round}` }),
      fillAdvance(other, { company: "A", client: "C2", amount: 100 * round, notes: `other ${round}` }),
    ]);
    await Promise.all([me.submit("advance-form"), other.submit("advance-form")]);
    await Promise.all([me.sees("Advance recorded with receipt"), other.sees("Advance recorded with receipt")]);
  }
  const series = (await all("select receipt_number from payments where company_id = $1 and receipt_number like $2 order by receipt_number", [CO.A.id, `AC/R/${FY}/%`])).map((r) => r.receipt_number);
  const numbers = series.map((s) => Number(s.split("/").pop()));
  record(
    "six advances at once get six different receipt numbers, with no gap anywhere in the series",
    numbers.length === 11 && numbers.every((n, i) => n === i + 1),
    `${series[0]} to ${series.at(-1)}, ${numbers.length} receipts`,
  );
  const bc = await all("select receipt_number from payments where company_id = $1", [CO.B.id]);
  record("the other company's series is separate and untouched", bc.length === 0);

  // =====================================================================
  section("Payments screen and who can see receipts");
  await me.goto("/payments");
  await me.waitFor("document.querySelector('[data-total]')");
  const activeTotal = Number((await one("select sum(amount) as s from payments where status = 'active' and paid_on between $1 and $2", [`${fyStart}-04-01`, `${fyStart + 1}-03-31`])).s);
  const shown = Number((await me.eval("document.querySelector('[data-total]').innerText")).replace(/[₹,]/g, ""));
  record("the Payments total leaves out cancelled payments", shown === activeTotal, `${shown} vs ${activeTotal}`);
  record("cancelled payments are still listed, marked Cancelled", (await me.eval("[...document.querySelectorAll('[data-report=payments] tbody tr')].filter((tr) => tr.innerText.includes('Cancelled')).length")) === 2);
  await me.setValue('select[aria-label="Type"]', "advance");
  await sleep(300);
  record("the list can show only advances", (await me.eval("[...document.querySelectorAll('[data-report=payments] tbody tr')].length")) === 8);
  await me.setValue('select[aria-label="Type"]', "");
  await me.shot("rc-payments");

  await me.goto(`/clients`);
  await me.eval(`[...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes(${j(CL.C2.name)})).click()`);
  await me.waitFor("document.querySelector('[data-timeline]')");
  record("a client's timeline has a receipt link on each payment", (await me.eval("document.querySelectorAll('[data-timeline] [data-receipt]').length")) === 6);
  await me.click("Advance");
  record("the client panel's Advance button opens the advance form for that client", (await me.waitFor("document.getElementById('adv-client')")) && (await me.eval("document.getElementById('adv-client').value")) === CL.C2.id);

  const anonymous = await fetch(`${BASE}/api/receipts/${r1.id}`, { redirect: "manual" });
  record("someone not signed in cannot download a receipt", anonymous.status === 307 || anonymous.status === 401, `${anonymous.status}`);
  const missingReceipt = await me.receipt(null, `/api/receipts/${randomUUID()}`);
  const junk = await me.receipt(null, "/api/receipts/not-an-id");
  record("an unknown receipt address gives not found, not an error", missingReceipt.status === 404 && junk.status === 404);
  const inline = await me.receipt(null, `/api/receipts/${r1.id}?inline=1`);
  record("receipts can also open in the browser instead of downloading", inline.disposition?.startsWith("inline") && inline.type === "application/pdf");

  await me.goto("/activity");
  await me.waitFor("document.querySelector('[data-activity] li')");
  const activity = await me.eval("document.querySelector('[data-activity]').innerText");
  record(
    "the Activity screen records receipts, advances, using an advance and cancelling",
    /recorded a payment of ₹10,000 on AC\/T\/0001, receipt/.test(activity) && /recorded an advance of ₹5,000 from Tarang Events LLP/.test(activity) && /applied advance .* to AC\/T\/0002/.test(activity) && /cancelled receipt/.test(activity),
  );
} catch (error) {
  record(`script error: ${error.message}`, false);
  for (const b of [me, other]) {
    try {
      await b.shot(`rc-error-${b.name}`);
    } catch {}
  }
} finally {
  me.stop();
  other.stop();
  await db.end();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
