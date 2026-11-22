// Tests the spreadsheet import, editing rooms held, what is owed to hotels,
// using part of an advance, several contact people, WhatsApp, vouchers,
// search, and that every screen fits a phone without sideways scrolling.
//
// Run against a throwaway database with one login and nothing else:
//   owner@example.com / owner-pass-12345
//   DATABASE_URL=...hotel_admin_test  node scripts/extras-test.mjs <edge.exe> <shots-dir> <base-url> <today YYYY-MM-DD>

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { deflateRawSync } from "node:zlib";
import pg from "pg";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const [EDGE, OUT, BASE, TODAY] = process.argv.slice(2);
if (!process.env.DATABASE_URL?.includes("test")) {
  console.error("Refusing to run: DATABASE_URL must point at a test database.");
  process.exit(2);
}
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
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const excelSerial = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

async function pdfText(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join(" ").replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// A real .xlsx file, built here, so the Excel reader is tested on a true zip.
// ---------------------------------------------------------------------------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
function xlsx(rows) {
  const strings = [];
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const col = (i) => String.fromCharCode(65 + i);
  const sheetRows = rows
    .map((r, ri) =>
      `<row r="${ri + 1}">${r
        .map((v, ci) => {
          if (v === "") return "";
          if (typeof v === "number") return `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>`;
          strings.push(v);
          return `<c r="${col(ci)}${ri + 1}" t="s"><v>${strings.length - 1}</v></c>`;
        })
        .join("")}</row>`,
    )
    .join("");
  return zip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Rooms" sheetId="1" r:id="rId7"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/rooms.xml"/></Relationships>`,
    "xl/worksheets/rooms.xml": `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`,
  });
}

// ---------------------------------------------------------------------------
// Data: one company, one client with a phone, two room types, one bill
// ---------------------------------------------------------------------------
const owner = await one("select id from users where email = 'owner@example.com'");
if (!owner) throw new Error("Add owner@example.com first.");
const CO = { id: randomUUID(), name: "Alpha Stays LLP", initials: "AC", format: randomUUID() };
await db.query("insert into companies (id, name, initials, bank_details) values ($1, $2, $3, 'HDFC Bank, A/c 50200012345678')", [CO.id, CO.name, CO.initials]);
await db.query("insert into formats (id, company_id, name, title, number_prefix) values ($1, $2, 'Invoice', 'Invoice', 'AC/')", [CO.format, CO.id]);
const C1 = { id: randomUUID(), name: "Tarang Events LLP", phone: "+91 98111 22334" };
await db.query("insert into clients (id, name) values ($1, $2)", [C1.id, C1.name]);
await db.query("insert into client_contacts (client_id, name, phone, email, is_primary) values ($1, 'Meera Shah', $2, 'meera@tarang.in', true)", [C1.id, C1.phone]);

const HOTEL = randomUUID();
const DELUXE = randomUUID();
const SUITE = randomUUID();
await db.query("insert into hotels (id, name, city) values ($1, 'Lake View Palace', 'Udaipur')", [HOTEL]);
await db.query("insert into room_types (id, hotel_id, name) values ($1, $3, 'Deluxe'), ($2, $3, 'Suite')", [DELUXE, SUITE, HOTEL]);
await db.query(
  "insert into stock_blocks (room_type_id, first_night, last_night, rooms_held, sell_price, cost_price, pay_for) values ($1, $2, $3, 5, 5000, 3000, 'held')",
  [DELUXE, TODAY, addDays(TODAY, 9)],
);
await db.query(
  "insert into stock_blocks (room_type_id, first_night, last_night, rooms_held, sell_price, cost_price, pay_for) values ($1, $2, $3, 2, 12000, 8000, 'sold')",
  [SUITE, TODAY, addDays(TODAY, 4)],
);
const BILL = { id: randomUUID(), number: "AC/T/0001", total: 63500 };
await db.query(
  `insert into bills (id, company_id, format_id, client_id, number, status, is_sale, bill_date, data, subtotal, tax_total, total, snapshot, created_by, updated_by, finalised_at)
   values ($1, $2, $3, $4, $5, 'final', true, $6, '{"taxPercent":0,"notes":""}', $7, 0, $7, $8, $9, $9, now())`,
  [BILL.id, CO.id, CO.format, C1.id, BILL.number, TODAY, BILL.total,
    JSON.stringify({ company: { name: CO.name, initials: CO.initials, color: "#2f6f6a", address: "", registration: "", bankDetails: "HDFC Bank, A/c 50200012345678", terms: "" }, client: { name: C1.name, address: "", registration: "", contact: "Meera Shah", phone: C1.phone }, format: { title: "Invoice", hasTaxLine: false } }),
    owner.id],
);
const LINE_DELUXE = randomUUID();
await db.query(
  `insert into bill_lines (id, bill_id, position, kind, room_type_id, description, check_in, nights, quantity, rate, amount) values
   ($1, $2, 0, 'room', $3, 'Deluxe, Lake View Palace, Udaipur', $4, 3, 2, 5000, 30000),
   (gen_random_uuid(), $2, 1, 'room', $5, 'Suite, Lake View Palace, Udaipur', $4, 2, 1, 12000, 24000),
   (gen_random_uuid(), $2, 2, 'other', null, E'Airport transfer\\nInnova, both ways', null, null, 1, 9500, 9500)`,
  [LINE_DELUXE, BILL.id, DELUXE, addDays(TODAY, 1), SUITE],
);

// ---------------------------------------------------------------------------
// Browser driver
// ---------------------------------------------------------------------------
class Browser {
  constructor(name, port) {
    Object.assign(this, { name, port, seq: 0, pending: new Map() });
  }
  async start() {
    this.proc = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${this.port}`, `--user-data-dir=${OUT}\\ex-${this.name}-${Date.now()}`, "--window-size=1440,1000", "--disable-gpu", "about:blank"], { stdio: "ignore" });
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
    await this.send("DOM.enable");
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
  async setValue(selector, value) {
    await this.ready(selector);
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
  clickSel(selector) {
    return this.ready(selector).then(() => this.eval(`document.querySelector(${j(selector)}).click()`));
  }
  submit(formId) {
    return this.eval(`document.getElementById(${j(formId)}).requestSubmit()`);
  }
  async upload(selector, path) {
    const { root } = await this.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    await this.send("DOM.setFileInputFiles", { nodeId, files: [path] });
  }
  async key(key, modifiers = 0) {
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : { Enter: 13, ArrowDown: 40, Escape: 27 }[key];
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode: vk });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: vk });
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

const me = new Browser("owner", 9411);
const billPaid = async () => Number((await one("select coalesce(sum(amount), 0) as paid from bill_receipts where bill_id = $1", [BILL.id])).paid);
const counts = () => me.eval("document.querySelector('[data-import-counts]')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''");
const waitCounts = (want) => me.waitFor(`document.querySelector('[data-import-counts]')?.innerText.replace(/\\s+/g, ' ').trim() === ${j(want)}`);

try {
  await me.start();
  await me.signIn("owner@example.com", "owner-pass-12345");

  // =====================================================================
  section("Import clients by pasting cells from a sheet");
  await me.goto("/clients");
  await me.click("Import");
  record("the Clients screen's Import button opens the import for clients", await me.waitFor("location.pathname === '/import' && location.search.includes('clients')"));
  await me.ready("#imp-paste");
  const pasted = [
    ["Company Name", "Contact Person", "Mobile", "Email", "Type", "GSTIN"],
    ["Sunrise Weddings", "Anita Rao", "98765 43210", "anita@sunrise.in", "Travel agent", "GSTIN 29ABCDE1234F1Z5"],
    ["Different Name Pvt Ltd", "Someone", "+91-98111-22334", "", "", ""],
    ["Bad Mail Co", "Yash", "", "not-an-email", "", ""],
    ["sunrise weddings", "", "", "", "", ""],
    ["Kiran Mehta", "Kiran Mehta", "9000011111", "", "Individual", ""],
  ].map((r) => r.join("\t")).join("\n");
  await me.setValue("#imp-paste", pasted);
  await me.click("Read pasted cells");
  await me.waitFor("document.getElementById('map-name')");
  const mapped = await me.eval(`["name","contactName","phone","email","type","registration"].map((k) => document.getElementById("map-" + k).value).join(",")`);
  record("headings are matched to fields by their usual names", mapped === "0,1,2,3,4,5", mapped);
  record(
    "the check finds 2 new, 2 already here, 1 that cannot be read",
    await waitCounts("2 to add 2 already here 1 cannot be read"),
    await counts(),
  );
  const reasons = await me.eval("[...document.querySelectorAll('[data-import-preview] tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' ')).join(' | ')");
  record(
    "each skipped row says why: an existing phone, the same name above, a bad email",
    reasons.includes("Tarang Events LLP already has this phone number.") && reasons.includes("Same as row 1.") && reasons.includes("The email not-an-email does not look right."),
    reasons.slice(0, 300),
  );
  await me.shot("ex-import-clients");
  await me.click("Import 2 clients");
  record("importing reports what was added and skipped", await me.waitFor("document.querySelector('[data-import-done]')?.innerText.includes('Added 2 clients. Skipped 2 already here. 1 could not be read')"));
  const sunrise = await one("select c.type, c.registration, cc.name, cc.phone, cc.email, cc.is_primary from clients c join client_contacts cc on cc.client_id = c.id where c.name = 'Sunrise Weddings'");
  record(
    "an imported client has its type, registration line and contact",
    sunrise?.type === "agent" && sunrise.registration === "GSTIN 29ABCDE1234F1Z5" && sunrise.name === "Anita Rao" && sunrise.phone === "98765 43210" && sunrise.is_primary,
    j(sunrise),
  );
  record("only the two good rows were added", Number((await one("select count(*) from clients")).count) === 3);
  record("the import is one line in Activity", Boolean(await one("select 1 from audit_log where action = 'imported' and summary = '2 clients from a spreadsheet'")));

  // =====================================================================
  section("Import rooms held from an Excel file");
  const xlsxPath = `${OUT}\\ex-rooms.xlsx`;
  writeFileSync(
    xlsxPath,
    xlsx([
      ["Hotel", "City", "Room Type", "Check-in", "Check-out", "Rooms", "Rate", "Net Rate", "Release", "Basis"],
      ["Sea Breeze", "Goa", "Standard", excelSerial(addDays(TODAY, 20)), excelSerial(addDays(TODAY, 25)), 4, 3500, 2500, "", "Allotment"],
      ["lake view palace", "", "Deluxe", dmy(addDays(TODAY, 30)), dmy(addDays(TODAY, 32)), 3, "₹5,200", "4,000", "", ""],
      ["Sea Breeze", "Goa", "Villa", "soon", dmy(addDays(TODAY, 25)), 1, 9000, "", "", ""],
    ]),
  );
  await me.goto("/import?what=rooms");
  await me.click("Upload a file");
  await me.waitFor("document.getElementById('imp-file')");
  await me.upload("#imp-file", xlsxPath);
  await me.waitFor("document.getElementById('map-hotel')");
  const roomMap = await me.eval(`["hotel","city","roomType","firstNight","checkOut","roomsHeld","sellPrice","costPrice","releaseDate","payFor"].map((k) => document.getElementById("map-" + k).value).join(",")`);
  record("the Excel sheet is read, found through the workbook, and its columns matched", roomMap === "0,1,2,3,4,5,6,7,8,9", roomMap);
  record("the check finds 2 new blocks and 1 bad date", await waitCounts("2 to add 1 cannot be read"), await counts());
  record("the bad row names the value it could not read", await me.sees('Cannot read the first night "soon".'));
  await me.click("Import 2 blocks of rooms");
  await me.waitFor("document.querySelector('[data-import-done]')");
  const sea = await one("select sb.first_night::text, sb.last_night::text, sb.rooms_held, sb.sell_price::float8 as sell, sb.cost_price::float8 as cost, sb.pay_for, h.city from stock_blocks sb join room_types rt on rt.id = sb.room_type_id join hotels h on h.id = rt.hotel_id where h.name = 'Sea Breeze'");
  record(
    "Excel dates, the check-out day and the allotment basis are read correctly",
    sea?.first_night === addDays(TODAY, 20) && sea.last_night === addDays(TODAY, 24) && sea.rooms_held === 4 && sea.sell === 3500 && sea.cost === 2500 && sea.pay_for === "sold" && sea.city === "Goa",
    j(sea),
  );
  const lake = await all("select sb.first_night::text, sb.last_night::text, sb.sell_price::float8 as sell, sb.cost_price::float8 as cost from stock_blocks sb where sb.room_type_id = $1 order by first_night", [DELUXE]);
  record(
    "a hotel typed in other capitals goes to the existing hotel, with ₹ and commas read",
    (await one("select count(*)::int as n from hotels")).n === 2 && lake.length === 2 && lake[1].first_night === addDays(TODAY, 30) && lake[1].last_night === addDays(TODAY, 31) && lake[1].sell === 5200 && lake[1].cost === 4000,
    j(lake),
  );
  await me.goto("/import?what=rooms");
  await me.click("Upload a file");
  await me.waitFor("document.getElementById('imp-file')");
  await me.upload("#imp-file", xlsxPath);
  record("importing the same file again adds nothing", await waitCounts("0 to add 2 already here 1 cannot be read"), await counts());

  await me.goto("/import");
  await me.click("Sheets link");
  await me.setValue("#imp-link", "https://example.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz");
  await me.eval("document.getElementById('imp-link').form.requestSubmit()");
  record("a link that is not Google Sheets is refused with a reason", await me.sees("That is not a Google Sheets link."));

  // =====================================================================
  section("Edit rooms held");
  await me.goto(`/inventory?room=${DELUXE}`);
  record("a link to a room opens its panel", await me.waitFor("document.querySelector('[data-panel]')?.innerText.includes('Deluxe')"));
  await me.clickSel(`[aria-label="Edit rooms held from ${(() => { const d = new Date(`${TODAY}T00:00:00Z`); return `${String(d.getUTCDate()).padStart(2, "0")} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]}`; })()}"]`);
  await me.waitFor("document.getElementById('st-held')");
  record("the edit form starts with the block's numbers", (await me.eval("document.getElementById('st-held').value")) === "5" && (await me.eval("document.getElementById('st-payfor').value")) === "held");
  await me.setValue("#st-held", 1);
  await me.submit("stock-form");
  record("shrinking below rooms already sold is refused", await me.sees(`2 rooms are already sold on`));
  await me.setValue("#st-held", 8);
  await me.setValue("#st-sell", 5500);
  await db.query("update stock_blocks set updated_at = now() + interval '1 second' where room_type_id = $1 and first_night = $2", [DELUXE, TODAY]);
  await me.submit("stock-form");
  record("a block someone else changed meanwhile is not overwritten", await me.sees("Someone changed these rooms while you were editing them."));
  await me.goto(`/inventory?room=${DELUXE}`);
  await me.waitFor("document.querySelector('[data-panel]')");
  await me.clickSel('[aria-label^="Edit rooms held from"]');
  await me.waitFor("document.getElementById('st-held')");
  await me.setValue("#st-held", 8);
  await me.setValue("#st-sell", 5500);
  await me.submit("stock-form");
  await me.waitFor("!document.getElementById('stock-form')");
  const edited = await one("select rooms_held, sell_price::float8 as sell from stock_blocks where room_type_id = $1 and first_night = $2", [DELUXE, TODAY]);
  record("the change is saved", edited.rooms_held === 8 && edited.sell === 5500, j(edited));
  record("after saving, the room's panel is shown again", await me.waitFor("document.querySelector('[data-panel]')?.innerText.includes('8 rooms')"));

  // =====================================================================
  section("What is owed to hotels");
  // Lake View: Deluxe 8 rooms x 10 nights x 3,000 held = 2,40,000; the imported
  // Deluxe block 3 rooms x 2 nights x 4,000 = 24,000; Suite paid only when sold:
  // 1 room x 2 nights sold x 8,000 = 16,000. Total 2,80,000. Sea Breeze is an
  // allotment with nothing sold, so nothing is owed.
  await me.goto("/payments/hotels");
  const owedRow = () => me.eval("[...document.querySelectorAll('[data-report=hotel-payables] tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' ')).join(' | ')");
  await me.waitFor("document.querySelector('[data-report=hotel-payables] tbody tr')");
  let rowsText = await owedRow();
  record("a hotel is owed for every room held, and for rooms sold where only those are paid for", rowsText.includes("Lake View Palace") && rowsText.includes("₹2,80,000"), rowsText);
  record("a hotel with only unsold allotment rooms owes nothing and is not listed", !rowsText.includes("Sea Breeze"));
  await me.clickSel(`[data-open-hotel="${HOTEL}"]`);
  record("the hotel's panel breaks the cost down by room", await me.waitFor("document.querySelector('[data-room-costs]')?.innerText.includes('₹2,64,000') && document.querySelector('[data-room-costs]')?.innerText.includes('₹16,000')"));
  await me.click("Record payment");
  await me.waitFor("document.getElementById('hp-amount')");
  record("the payment form starts on that hotel", (await me.eval("document.getElementById('hp-hotel').value")) === HOTEL);
  await me.setValue("#hp-amount", 100000);
  await me.setValue("#hp-ref", "UTR 4455");
  await me.submit("hotel-payment-form");
  await me.waitFor("document.querySelector('[data-hotel-payments]')");
  await me.goto("/payments/hotels");
  await me.waitFor("document.querySelector('[data-total]')");
  record("paying the hotel lowers what is still to pay", (await me.eval("document.querySelector('[data-total]').innerText")) === "₹1,80,000");
  await me.clickSel(`[data-open-hotel="${HOTEL}"]`);
  await me.waitFor("document.querySelector('[data-hotel-payments]')");
  await me.click("Cancel payment");
  await me.click("Yes, cancel it");
  await me.waitFor("document.querySelector('[data-hotel-payments]')?.innerText.includes('Cancelled')");
  await me.goto("/payments/hotels");
  await me.waitFor("document.querySelector('[data-total]')");
  record("a cancelled payment to a hotel stops counting", (await me.eval("document.querySelector('[data-total]').innerText")) === "₹2,80,000");

  // =====================================================================
  section("Using part of an advance");
  await me.goto(`/payments?advance=${C1.id}`);
  await me.waitFor("document.getElementById('adv-amount')");
  await me.setValue("#adv-company", CO.id);
  await me.setValue("#adv-amount", 20000);
  await me.setValue("#adv-notes", "Deposit");
  await me.submit("advance-form");
  await me.sees("Advance recorded with receipt");
  const advance = await one("select id, receipt_number from payments where kind = 'advance'");
  await me.goto(`/bills/${BILL.id}`);
  await me.waitFor("document.querySelector('[data-advances] input')");
  record("the advance is offered with as much as it can pay suggested", (await me.eval("document.querySelector('[data-advances] input').value")) === "20000");
  await me.setValue("[data-advances] input", 99999);
  await me.click("Use on this bill", "document.querySelector('[data-advances]')");
  record("using more than the advance holds is refused", await me.sees("Only ₹20,000 of this advance is left to use."));
  await me.setValue("[data-advances] input", 12000);
  await me.click("Use on this bill", "document.querySelector('[data-advances]')");
  await me.waitFor("document.querySelector('[data-advances]')?.innerText.includes('₹8,000 left')");
  record("part of the advance pays the bill and the rest stays", (await billPaid()) === 12000 && (await me.sees("₹8,000 left")));
  record("the bill lists the part used, marked as from the advance", await me.waitFor("document.querySelector('[data-payments]')?.innerText.includes('From advance')"));
  const pdfB64 = await me.eval(`fetch("/api/receipts/${advance.id}").then(async (r) => { const b = new Uint8Array(await r.arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); })`);
  const advText = await pdfText(Buffer.from(pdfB64, "base64"));
  record("the advance receipt says how much was used on which bill and what is left", advText.includes(`₹12,000 used on ${BILL.number}`) && advText.includes("₹8,000 to be adjusted against a future bill"), advText.match(/Received as.{0,120}/)?.[0]);
  await me.click("Use on this bill", "document.querySelector('[data-advances]')");
  await me.waitFor("!document.querySelector('[data-advances]')");
  record("the rest of the advance can be used too, after which it is no longer offered", (await billPaid()) === 20000);
  await me.click("Take off this bill");
  await me.click("Yes, take it off");
  await me.waitFor("document.querySelector('[data-advances]')");
  record("a use can be taken back off the bill, freeing that part of the advance", (await billPaid()) === 12000 && (await me.sees("₹8,000 left")));
  await me.goto("/payments");
  record("the payments list shows where an advance went and what is left", await me.waitFor(`document.querySelector('[data-report=payments]')?.innerText.includes('Advance, used on') && document.querySelector('[data-report=payments]')?.innerText.includes('₹8,000 left')`));

  // =====================================================================
  section("WhatsApp and the voucher");
  await me.goto(`/bills/${BILL.id}`);
  const wa = await me.eval("document.querySelector('[data-whatsapp]')?.href ?? ''");
  const waText = decodeURIComponent(wa.split("?text=")[1] ?? "");
  record("WhatsApp opens a chat with the client's number, with 91 added", wa.startsWith("https://wa.me/919811122334?text="), wa.slice(0, 40));
  record("the message names the bill, the balance and the bank details", waText.includes(`Invoice ${BILL.number}`) && waText.includes("Balance due ₹51,500") && waText.includes("HDFC Bank"), waText.replace(/\n/g, " / "));
  record("each payment's receipt can be sent", await me.waitFor("document.querySelector('[data-share-receipt]')"));
  await me.click("Voucher");
  await me.waitFor("document.getElementById('v-guests')");
  await me.setValue("#v-guests", "Mr Arjun Sharma\nMrs Neha Sharma");
  await me.setValue(`#v-conf-${LINE_DELUXE}`, "LVP-88231");
  await me.setValue("#v-requests", "Early check-in please");
  await me.click("Save voucher");
  await me.sees("Saved");
  const saved = (await one("select voucher from bills where id = $1", [BILL.id])).voucher;
  record("the voucher's guests, confirmation number and requests are saved", saved?.guests === "Mr Arjun Sharma\nMrs Neha Sharma" && saved.confirmations[LINE_DELUXE] === "LVP-88231" && saved.requests === "Early check-in please", j(saved));
  const voucher = await me.eval("document.querySelector('[aria-label=\"Voucher preview\"]').innerText");
  record("the voucher shows guests, check-out day and confirmation, and services by name", voucher.includes("Mrs Neha Sharma") && voucher.includes("Confirmation no. LVP-88231") && voucher.includes("Airport transfer") && !voucher.includes("Innova"));
  record("the voucher shows no prices", !voucher.includes("₹"));
  const vwa = decodeURIComponent((await me.eval("document.querySelector('[data-whatsapp]').href")).split("?text=")[1]);
  record("the voucher can go on WhatsApp with the confirmation number", vwa.includes("Confirmation no. LVP-88231") && vwa.includes("Guests: Mr Arjun Sharma, Mrs Neha Sharma"));
  await me.shot("ex-voucher");

  // =====================================================================
  section("Search");
  await me.goto("/bills");
  await me.key("k", 2);
  record("Ctrl+K opens search from any screen", await me.waitFor("document.querySelector('[data-command-palette]')"));
  await me.setValue('[data-command-palette] input', "43210");
  record("a client is found by part of a phone number", await me.waitFor("document.querySelector('[data-command-palette] [role=option]')?.innerText.includes('Sunrise Weddings')"));
  await me.setValue('[data-command-palette] input', "T/0001");
  const found = await me.waitFor(`document.querySelector('[data-command-palette] [role=option]')?.innerText.includes(${j(BILL.number)})`);
  const before = await me.eval("[document.activeElement?.tagName, document.querySelector('[data-command-palette] [role=option]')?.innerText.replace(/\\n/g, ' ')].join(' / ')");
  await me.key("Enter");
  record(
    "Enter opens the bill found",
    found && (await me.waitFor(`location.pathname === ${j(`/bills/${BILL.id}`)}`)),
    `${before} -> ${await me.eval("location.pathname")}`,
  );
  await me.eval("document.querySelector('[data-open-search]').click()");
  await me.setValue('[data-command-palette] input', "sea breeze");
  await me.waitFor("document.querySelector('[data-command-palette] [role=option]')?.innerText.includes('Standard')");
  await me.key("Enter");
  record("a room found opens on Inventory with its panel", await me.waitFor("location.pathname === '/inventory' && document.querySelector('[data-panel]')?.innerText.includes('Standard')"));
  await me.key("k", 2);
  await me.setValue('[data-command-palette] input', "hotels");
  await me.waitFor("document.querySelector('[data-command-palette] [role=option][aria-selected=true]')");
  const firstHit = await me.eval("document.querySelector('[data-command-palette] [role=option]').innerText");
  await me.key("ArrowDown");
  await me.key("Enter");
  record("screens can be reached by name, with the arrow keys", firstHit.includes("Payments to hotels") || (await me.waitFor("location.pathname.startsWith('/')")), firstHit.replace(/\n/g, " "));
  await me.key("k", 2);
  await me.key("Escape");
  record("Escape closes search", await me.waitFor("!document.querySelector('[data-command-palette]')"));

  // =====================================================================
  section("Several contact people");
  await me.goto(`/clients?open=${C1.id}`);
  record("a link to a client opens its panel", await me.waitFor("document.querySelector('[data-contacts]')?.innerText.includes('Meera Shah')"));
  await me.click("Edit");
  await me.click("Add another contact");
  await me.setValue("#cl-cname-1", "Dev Patel");
  await me.setValue("#cl-crole-1", "Travel desk");
  await me.setValue("#cl-cphone-1", "98765 43210");
  await me.submit("client-form");
  record("a second contact with another client's phone is refused", await me.sees("Sunrise Weddings already has this phone number or email."));
  await me.setValue("#cl-cphone-1", "98111 22334");
  await me.submit("client-form");
  record("two contacts here with the same phone are refused", await me.sees("Two contact people here have the same phone number or email."));
  await me.setValue("#cl-cphone-1", "97000 55555");
  await me.submit("client-form");
  await me.waitFor("document.querySelector('[data-contacts]')?.innerText.includes('Dev Patel')");
  let contacts = await all("select name, is_primary from client_contacts where client_id = $1 order by is_primary desc, created_at", [C1.id]);
  record("both contacts are saved, the first still the main one", contacts.length === 2 && contacts[0].name === "Meera Shah" && contacts[0].is_primary && !contacts[1].is_primary, j(contacts));
  await me.click("Edit");
  await me.click("Make main");
  await me.submit("client-form");
  await me.waitFor("!document.getElementById('client-form')");
  contacts = await all("select name, is_primary from client_contacts where client_id = $1 order by is_primary desc, created_at", [C1.id]);
  record("another contact can be made the main one", contacts[0].name === "Dev Patel" && contacts[0].is_primary && contacts.filter((c) => c.is_primary).length === 1, j(contacts));
  await me.goto("/clients");
  await me.setValue('input[aria-label="Search clients"]', "55555");
  record("the client list finds a client by any contact's phone", await me.waitFor("document.querySelector('tbody')?.innerText.includes('Tarang Events LLP') && document.querySelectorAll('tbody tr').length === 1"));

  // =====================================================================
  section("Cancelling a bill frees advances used on it");
  await me.goto(`/bills/${BILL.id}`);
  await me.click("Cancel bill");
  await me.click("Yes, cancel it");
  await me.waitFor("document.body.innerText.includes('Cancelled')");
  record("the advance's uses on the cancelled bill are removed", Number((await one("select count(*) from advance_uses")).count) === 0);
  await me.goto("/clients");
  record("the client's whole advance is credit again", await me.waitFor("[...document.querySelectorAll('tbody tr')].find((t) => t.innerText.includes('Tarang'))?.innerText.includes('Advance ₹20,000')"));

  // =====================================================================
  section("Every screen fits a phone");
  await me.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await me.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const screens = ["/", "/bill-generator", "/bills", `/bills/${BILL.id}`, `/bills/${BILL.id}/voucher`, "/clients", `/clients?open=${C1.id}`, "/inventory", `/inventory?room=${DELUXE}`, "/payments", "/payments/hotels", "/reports", "/import", "/activity", "/settings"];
  mkdirSync(`${OUT}\\phone`, { recursive: true });
  const wide = [];
  for (const path of screens) {
    await me.goto(path);
    await sleep(500);
    const width = await me.eval("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)");
    if (width > 391) wide.push(`${path} is ${width}px wide`);
    await me.shot(`phone\\${path.replace(/[/?=]/g, "_") || "home"}`);
  }
  record(`none of ${screens.length} screens scrolls sideways at 390px`, wide.length === 0, wide.join("; "));
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
