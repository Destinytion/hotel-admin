// Tests the Payments and Reports screens against a known set of bills.
//
// The script puts its own bills, payments and rooms into the database, works
// out every expected figure itself in plain JavaScript, then reads the figures
// off the screens and the Excel downloads and compares. It also checks the
// Reports "Owed" figures agree with the Clients screen.
//
// Run against a throwaway database that has one login, owner@example.com /
// owner-pass-12345, and nothing else:
//   DATABASE_URL=...hotel_admin_test  node scripts/reports-test.mjs <edge.exe> <shots-dir> <base-url> <today YYYY-MM-DD>

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

const [EDGE, OUT, BASE, TODAY] = process.argv.slice(2);
if (!process.env.DATABASE_URL?.includes("test")) {
  console.error("Refusing to run: DATABASE_URL must point at a test database.");
  process.exit(2);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const results = [];
const record = (step, ok, detail = "") => {
  results.push({ step, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail !== "" ? `  (${detail})` : ""}`);
};
const section = (title) => console.log(`\n--- ${title} ---`);
const j = (v) => JSON.stringify(v);
const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.01;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const day = (n) => addDays(TODAY, n);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const fyOf = (iso) => {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
};
const FY = fyOf(TODAY);
const LAST_FY = fyOf(addDays(FY.from, -1));
const inRange = (iso, r) => iso >= r.from && iso <= r.to;

// ---------------------------------------------------------------------------
// The data this test puts in
// ---------------------------------------------------------------------------

const COMPANIES = { A: { name: "Alpha Co", initials: "AC" }, B: { name: "Beta Co", initials: "BC" } };
const CLIENTS = { C1: "Client One", C2: "Client Two", C3: "Client Three", C4: "=SUM(1,2)" };
const ROOMS = {
  Deluxe: { first: day(-10), last: day(20), held: 5, sell: 5000, cost: 4000 },
  Suite: { first: day(0), last: day(10), held: 2, sell: 9000, cost: null },
};
const BILLS = [
  { key: "b1", co: "A", client: "C1", date: day(-40), status: "final", sale: true, tax: 1000, lines: [{ room: "Deluxe", checkIn: day(-5), nights: 2, qty: 2, rate: 5000 }] },
  { key: "b2", co: "A", client: "C2", date: day(-5), status: "final", sale: true, tax: 0, lines: [{ text: "Airport transfer", qty: 1, rate: 3000 }] },
  { key: "b3", co: "B", client: "C1", date: day(-100), status: "final", sale: true, tax: 0, lines: [{ room: "Suite", checkIn: day(1), nights: 3, qty: 1, rate: 9000 }] },
  { key: "b4", co: "B", client: "C3", date: day(-2), status: "cancelled", sale: true, tax: 0, lines: [{ text: "Sightseeing", qty: 1, rate: 5000 }] },
  { key: "b5", co: "A", client: "C3", date: day(-1), status: "final", sale: false, tax: 0, lines: [{ room: "Deluxe", checkIn: day(2), nights: 1, qty: 1, rate: 7000 }] },
  { key: "b6", co: "A", client: "C2", date: TODAY, status: "draft", sale: true, tax: 0, lines: [{ room: "Deluxe", checkIn: day(3), nights: 1, qty: 1, rate: 4000 }] },
  { key: "b7", co: "A", client: "C1", date: addDays(FY.from, -17), status: "final", sale: true, tax: 0, lines: [{ text: "Old booking fee", qty: 1, rate: 1000 }] },
  { key: "b8", co: "A", client: "C4", date: day(-1), status: "final", sale: true, tax: 25, lines: [{ room: "Deluxe", checkIn: day(4), nights: 1, qty: 1, rate: 500 }] },
];
const PAYMENTS = [
  { bill: "b1", amount: 10000, paidOn: day(-35), mode: "Bank transfer" },
  { bill: "b3", amount: 27000, paidOn: day(-90), mode: "UPI" },
  { bill: "b4", amount: 2000, paidOn: day(-3), mode: "Cash" },
];

const lineAmount = (l) => (l.room ? l.nights * l.qty * l.rate : l.qty * l.rate);
for (const b of BILLS) {
  b.subtotal = b.lines.reduce((s, l) => s + lineAmount(l), 0);
  b.total = b.subtotal + b.tax;
}
const bill = (key) => BILLS.find((b) => b.key === key);
const paidOn = (key) => PAYMENTS.filter((p) => p.bill === key).reduce((s, p) => s + p.amount, 0);

// ---------------------------------------------------------------------------
// Expected figures, worked out independently of the app
// ---------------------------------------------------------------------------

const isSale = (b) => b.status === "final" && b.sale;
function expectSales(range, co) {
  const rows = BILLS.filter((b) => isSale(b) && inRange(b.date, range) && (!co || b.co === co));
  const group = (key) => {
    const map = new Map();
    for (const b of rows) {
      const k = key(b);
      const g = map.get(k) ?? { bills: 0, subtotal: 0, tax: 0, total: 0, received: 0 };
      g.bills++;
      g.subtotal += b.subtotal;
      g.tax += b.tax;
      g.total += b.total;
      g.received += paidOn(b.key);
      map.set(k, g);
    }
    return map;
  };
  return {
    bills: rows.length,
    subtotal: rows.reduce((s, b) => s + b.subtotal, 0),
    tax: rows.reduce((s, b) => s + b.tax, 0),
    total: rows.reduce((s, b) => s + b.total, 0),
    received: rows.reduce((s, b) => s + paidOn(b.key), 0),
    byMonth: group((b) => b.date.slice(0, 7)),
    byClient: group((b) => CLIENTS[b.client]),
    byCompany: group((b) => COMPANIES[b.co].name),
  };
}
function expectOwed(co) {
  const map = new Map();
  const get = (c) => map.get(c) ?? { d0: 0, d31: 0, d61: 0, d90: 0, credit: 0 };
  for (const b of BILLS.filter((x) => isSale(x) && (!co || x.co === co))) {
    const due = b.total - paidOn(b.key);
    if (due <= 0) continue;
    const age = daysBetween(b.date, TODAY);
    const g = get(CLIENTS[b.client]);
    g[age <= 30 ? "d0" : age <= 60 ? "d31" : age <= 90 ? "d61" : "d90"] += due;
    map.set(CLIENTS[b.client], g);
  }
  for (const p of PAYMENTS) {
    const b = bill(p.bill);
    if (isSale(b) || (co && b.co !== co)) continue;
    const g = get(CLIENTS[b.client]);
    g.credit += p.amount;
    map.set(CLIENTS[b.client], g);
  }
  for (const g of map.values()) g.net = g.d0 + g.d31 + g.d61 + g.d90 - g.credit;
  return map;
}
function expectInventory(range, co) {
  const out = new Map();
  for (const [name, r] of Object.entries(ROOMS)) {
    let held = 0;
    for (let n = r.first; n <= r.last; n = addDays(n, 1)) if (inRange(n, range)) held += r.held;
    let soldAll = 0;
    let sold = 0;
    let revenue = 0;
    for (const b of BILLS.filter(isSale)) {
      for (const l of b.lines.filter((x) => x.room === name)) {
        for (let i = 0; i < l.nights; i++) {
          if (!inRange(addDays(l.checkIn, i), range)) continue;
          soldAll += l.qty;
          if (!co || b.co === co) {
            sold += l.qty;
            revenue += l.qty * l.rate;
          }
        }
      }
    }
    out.set(name, { held, soldAll, sold, revenue, margin: r.cost === null ? null : sold > 0 ? revenue - sold * r.cost : null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Put the data in
// ---------------------------------------------------------------------------

const owner = (await db.query("select id from users where email = 'owner@example.com'")).rows[0];
if (!owner) throw new Error("Add the login owner@example.com first.");
const ids = { co: {}, fmt: {}, quote: {}, client: {}, room: {}, bill: {} };
for (const [k, c] of Object.entries(COMPANIES)) {
  ids.co[k] = randomUUID();
  await db.query("insert into companies (id, name, initials) values ($1, $2, $3)", [ids.co[k], c.name, c.initials]);
  ids.fmt[k] = randomUUID();
  ids.quote[k] = randomUUID();
  await db.query("insert into formats (id, company_id, name, title, number_prefix, has_tax_line, counts_as_sale) values ($1, $2, 'Invoice', 'Tax Invoice', $3, true, true), ($4, $2, 'Quotation', 'Quotation', $5, true, false)", [ids.fmt[k], ids.co[k], `${c.initials}/`, ids.quote[k], `${c.initials}/Q/`]);
}
for (const [k, name] of Object.entries(CLIENTS)) {
  ids.client[k] = randomUUID();
  await db.query("insert into clients (id, name) values ($1, $2)", [ids.client[k], name]);
}
const hotelId = randomUUID();
await db.query("insert into hotels (id, name, city) values ($1, 'Sea Hotel', 'Goa')", [hotelId]);
for (const [name, r] of Object.entries(ROOMS)) {
  ids.room[name] = randomUUID();
  await db.query("insert into room_types (id, hotel_id, name) values ($1, $2, $3)", [ids.room[name], hotelId, name]);
  await db.query("insert into stock_blocks (room_type_id, first_night, last_night, rooms_held, sell_price, cost_price) values ($1, $2, $3, $4, $5, $6)", [ids.room[name], r.first, r.last, r.held, r.sell, r.cost]);
}
let serial = 0;
for (const b of BILLS) {
  ids.bill[b.key] = randomUUID();
  const number = b.status === "draft" ? null : `${COMPANIES[b.co].initials}/${b.sale ? "" : "Q/"}T/${String(++serial).padStart(4, "0")}`;
  b.number = number;
  await db.query(
    `insert into bills (id, company_id, format_id, client_id, number, status, is_sale, bill_date, data, subtotal, tax_total, total, snapshot, created_by, updated_by, finalised_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15)`,
    [
      ids.bill[b.key], ids.co[b.co], b.sale ? ids.fmt[b.co] : ids.quote[b.co], ids.client[b.client], number, b.status, b.sale, b.date,
      JSON.stringify({ taxPercent: b.subtotal ? (b.tax / b.subtotal) * 100 : 0, notes: "" }), b.subtotal, b.tax, b.total,
      JSON.stringify({ company: { name: COMPANIES[b.co].name, initials: COMPANIES[b.co].initials, color: "#2f6f6a", address: "", registration: "", bankDetails: "", terms: "" }, client: { name: CLIENTS[b.client], address: "", registration: "", contact: "", phone: "" }, format: { title: b.sale ? "Tax Invoice" : "Quotation", hasTaxLine: true } }),
      owner.id,
      b.status === "draft" ? null : new Date(),
    ],
  );
  for (const [i, l] of b.lines.entries()) {
    await db.query(
      "insert into bill_lines (bill_id, position, kind, room_type_id, description, check_in, nights, quantity, rate, amount) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [ids.bill[b.key], i, l.room ? "room" : "other", l.room ? ids.room[l.room] : null, l.room ?? l.text, l.checkIn ?? null, l.nights ?? null, l.qty, l.rate, lineAmount(l)],
    );
  }
}
for (const p of PAYMENTS) {
  const b = bill(p.bill);
  await db.query("insert into payments (company_id, client_id, bill_id, amount, mode, reference, paid_on, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)", [ids.co[b.co], ids.client[b.client], ids.bill[p.bill], p.amount, p.mode, `REF-${p.bill}`, p.paidOn, owner.id]);
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

const PORT = 9391;
const proc = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}\\rp-${Date.now()}`, "--window-size=1440,1000", "--disable-gpu", "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) {
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
  if (!wsUrl) await sleep(250);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const w = pending.get(m.id);
  if (!w) return;
  pending.delete(m.id);
  if (m.error) w.reject(new Error(m.error.message));
  else w.resolve(m.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expr, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await ev(`Boolean(${expr})`)) return true;
    } catch {}
    await sleep(150);
  }
  return false;
};
const goto = async (path) => {
  await send("Page.navigate", { url: BASE + path });
  await sleep(400);
  await waitFor("document.readyState === 'complete'");
  await sleep(900);
};
const ready = (selector) => waitFor(`(() => { const el = document.querySelector(${j(selector)}); return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`);
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}\\${name}.png`, Buffer.from(r.data, "base64"));
};
const click = async (text, within = "document") => {
  const find = `[...${within}.querySelectorAll("button, a")].find((b) => b.textContent.trim() === ${j(text)} && !b.disabled)`;
  if (!(await waitFor(`(() => { const el = ${find}; return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`))) throw new Error(`no button or link "${text}"`);
  await ev(`(${find}).click()`);
};
const setSelect = (selector, value) => ev(`(() => { const el = document.querySelector(${j(selector)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, ${j(value)}); el.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const setInput = (selector, value) => ev(`(() => { const el = document.querySelector(${j(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${j(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const readTable = (id) =>
  ev(`(() => { const s = document.querySelector('[data-report=${j(id)}]'); if (!s) return null; return {
    head: [...s.querySelectorAll('thead th')].map((t) => t.innerText.trim()),
    rows: [...s.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((c) => c.innerText.trim())),
    foot: [...s.querySelectorAll('tfoot td')].map((t) => t.innerText.trim()) }; })()`);
const money = (s) => (s === undefined || s === null || s === "" ? null : Number(String(s).replace(/[₹,\s]/g, "")));
const col = (table, label) => table.head.indexOf(label);
const rowFor = (table, first) => table.rows.find((r) => r[0] === first);
const figure = (label) => ev(`(() => { const d = [...document.querySelectorAll('[data-figures] div')].find((x) => x.querySelector('dt')?.innerText.trim() === ${j(label)}); return d ? d.querySelector('dd').innerText.trim() : null; })()`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Compares one grouped table against the expected map. */
function checkGroups(name, table, expected, label, columns) {
  const problems = [];
  if (!table) return record(name, false, "table missing");
  if (table.rows.length !== expected.size) problems.push(`${table.rows.length} rows, expected ${expected.size}`);
  for (const [key, want] of expected) {
    const row = rowFor(table, label(key));
    if (!row) {
      problems.push(`no row for ${label(key)}`);
      continue;
    }
    for (const [colLabel, field] of columns) {
      const got = money(row[col(table, colLabel)]);
      if (!near(got, want[field])) problems.push(`${label(key)} ${colLabel}: ${got} vs ${want[field]}`);
    }
  }
  record(name, problems.length === 0, problems.join("; "));
}

const downloads = `${OUT}\\rp-downloads`;
rmSync(downloads, { recursive: true, force: true });
mkdirSync(downloads, { recursive: true });

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });

  await goto("/login");
  await ready("form");
  await ev(`document.getElementById("email").value = "owner@example.com"; document.getElementById("password").value = "owner-pass-12345"; document.querySelector("form").requestSubmit()`);
  await waitFor("location.pathname === '/'");
  record("signed in", (await ev("location.pathname")) === "/");
  const nav = await ev("document.querySelector('aside nav')?.innerText ?? ''");
  record("Payments and Reports are in the menu and no longer marked Later", /Payments/.test(nav) && /Reports/.test(nav) && !/Later/.test(nav));

  // =====================================================================
  section("Sales, this financial year, both companies");
  const sales = expectSales(FY);
  await goto("/reports");
  await waitFor("document.querySelector('[data-report=sales-month]')");
  record(
    "the headline figures match",
    near(money(await figure("Total billed")), sales.total) && near(money(await figure("Before tax")), sales.subtotal) && near(money(await figure("Tax")), sales.tax) && Number(await figure("Bills")) === sales.bills && near(money(await figure("Received on these bills")), sales.received),
    `total ${await figure("Total billed")}, expected ${sales.total}`,
  );
  const month = await readTable("sales-month");
  checkGroups("by month matches", month, sales.byMonth, monthName, [["Bills", "bills"], ["Before tax", "subtotal"], ["Tax", "tax"], ["Total", "total"]]);
  record("by month total row matches", near(money(month.foot[col(month, "Total")]), sales.total));
  checkGroups("by company matches", await readTable("sales-company"), sales.byCompany, (k) => k, [["Bills", "bills"], ["Total", "total"]]);
  const byClient = await readTable("sales-client");
  checkGroups("by client matches, including what was received", byClient, sales.byClient, (k) => k, [["Billed", "total"], ["Received", "received"]]);
  record("drafts, quotations, cancelled bills and last year's bills are left out", !byClient.rows.some((r) => r[0] === "Client Three") && near(money(rowFor(byClient, "Client One")?.[col(byClient, "Billed")]), bill("b1").total + bill("b3").total));
  record("the cancelled bill is mentioned as not counted", await ev(`document.body.innerText.includes("Not counted: 1 cancelled bill worth ₹5,000")`));
  await shot("rp-sales");

  // =====================================================================
  section("Excel downloads");
  await ev(`document.querySelector('[aria-label="Download By client for Excel"]').click()`);
  const file = `${downloads}\\sales-by-client-${FY.from}-to-${FY.to}.csv`;
  for (let i = 0; i < 40 && !existsSync(file); i++) await sleep(250);
  const csv = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = csv.replace(/^﻿/, "").trim().split(/\r\n/);
  record("the download arrives with the right name", existsSync(file), file.split("\\").pop());
  record("it opens in Excel with names and the rupee sign intact (UTF-8 mark)", csv.startsWith("﻿"));
  record("it has the same columns as the screen", lines[0] === "Client,Bills,Billed,Received,Still owed", lines[0]);
  record("figures are plain numbers a spreadsheet can add up", lines.some((l) => l === `Client One,2,${bill("b1").total + bill("b3").total},37000,${bill("b1").total + bill("b3").total - 37000}`), lines.find((l) => l.startsWith("Client One")));
  record("it ends with the totals row", lines.at(-1) === `Total,${sales.bills},${sales.total},${sales.received},${sales.total - sales.received}`, lines.at(-1));
  record("a client name that looks like a formula is written as plain text", lines.some((l) => l.startsWith("'=SUM(1,2)") || l.startsWith(`"'=SUM(1,2)"`)), lines.find((l) => l.includes("SUM")));

  // =====================================================================
  section("Owed, as of today");
  await click("Owed", "document.querySelector('[role=tablist]')");
  await waitFor("document.querySelector('[data-report=owed]')");
  const owed = expectOwed();
  const owedTable = await readTable("owed");
  checkGroups(
    "each client's amount by age matches",
    owedTable,
    owed,
    (k) => k,
    [["0 to 30 days", "d0"], ["31 to 60", "d31"], ["61 to 90", "d61"], ["Over 90", "d90"], ["Less credit", "credit"], ["Owed", "net"]],
  );
  const owedTotal = [...owed.values()].reduce((s, g) => s + g.net, 0);
  record("the headline Owed to you matches", near(money(await figure("Owed to you")), owedTotal), `${await figure("Owed to you")} vs ${owedTotal}`);
  record("a payment on a cancelled bill shows as credit, not lost", near(money(rowFor(owedTable, "Client Three")?.[col(owedTable, "Owed")]), -2000), rowFor(owedTable, "Client Three")?.join(" | "));
  record("last year's unpaid bill still counts, in the over 90 days column", near(money(rowFor(owedTable, "Client One")?.[col(owedTable, "Over 90")]), bill("b7").total));
  await shot("rp-owed");

  await goto("/clients");
  await waitFor("document.querySelector('tbody tr')");
  const clientsScreen = await ev(`[...document.querySelectorAll('tbody tr')].map((tr) => [tr.cells[0].innerText.trim(), tr.cells[tr.cells.length - 1].innerText.trim()])`);
  const mismatched = clientsScreen.filter(([name, shown]) => {
    const value = shown === "Settled" ? 0 : shown.startsWith("Advance") ? -money(shown.replace("Advance", "")) : money(shown);
    return !near(value, owed.get(name)?.net ?? 0);
  });
  record("every client's Owed figure agrees with the Clients screen", mismatched.length === 0, mismatched.map((m) => m.join(": ")).join("; "));

  // =====================================================================
  section("Inventory, this financial year");
  await goto("/reports");
  await click("Inventory", "document.querySelector('[role=tablist]')");
  await waitFor("document.querySelector('[data-report=inventory]')");
  const inv = await readTable("inventory");
  const want = expectInventory(FY);
  const problems = [];
  for (const [room, w] of want) {
    const row = rowFor(inv, room);
    if (!row) {
      problems.push(`no row for ${room}`);
      continue;
    }
    if (money(row[col(inv, "Nights held")]) !== w.held) problems.push(`${room} held ${row[col(inv, "Nights held")]} vs ${w.held}`);
    if (money(row[col(inv, "Sold")]) !== w.soldAll) problems.push(`${room} sold ${row[col(inv, "Sold")]} vs ${w.soldAll}`);
    if (money(row[col(inv, "Unsold")]) !== w.held - w.soldAll) problems.push(`${room} unsold ${row[col(inv, "Unsold")]}`);
    if (!near(money(row[col(inv, "Room revenue")]), w.revenue)) problems.push(`${room} revenue ${row[col(inv, "Room revenue")]} vs ${w.revenue}`);
  }
  record("held, sold, unsold and revenue match for each room", problems.length === 0, problems.join("; "));
  record("the quotation's room was not counted as sold", near(money(rowFor(inv, "Deluxe")?.[col(inv, "Sold")]), want.get("Deluxe").soldAll));
  record("margin is worked out where a cost was entered", near(money(rowFor(inv, "Deluxe")?.[col(inv, "Margin")]), want.get("Deluxe").margin), `${rowFor(inv, "Deluxe")?.[col(inv, "Margin")]} vs ${want.get("Deluxe").margin}`);
  record("and says so where no cost was entered, instead of guessing", rowFor(inv, "Suite")?.[col(inv, "Margin")] === "No cost entered" && (await figure("Margin")) === "Some costs missing");
  await shot("rp-inventory");

  // =====================================================================
  section("Filtering by company and by dates");
  await setSelect("#rf-company", ids.co.B);
  await waitFor(`location.search.includes(${j(ids.co.B)})`);
  // Changing the company keeps whichever tab was open.
  record("changing the company keeps the tab you were on", await waitFor("document.querySelector('[data-report=inventory]')"));
  await click("Sales", "document.querySelector('[role=tablist]')");
  await waitFor("document.querySelector('[data-report=sales-month]')");
  const salesB = expectSales(FY, "B");
  record("picking Beta Co shows only Beta Co's sales", near(money(await figure("Total billed")), salesB.total), `${await figure("Total billed")} vs ${salesB.total}`);
  await click("Inventory", "document.querySelector('[role=tablist]')");
  await waitFor("document.querySelector('[data-report=inventory]')");
  const invB = await readTable("inventory");
  const wantB = expectInventory(FY, "B");
  record(
    "inventory then shows rooms sold by anyone next to rooms sold by Beta Co",
    col(invB, "Sold by Beta Co") > 0 && money(rowFor(invB, "Deluxe")[col(invB, "Sold by Beta Co")]) === wantB.get("Deluxe").sold && money(rowFor(invB, "Deluxe")[col(invB, "Sold by anyone")]) === wantB.get("Deluxe").soldAll && money(rowFor(invB, "Suite")[col(invB, "Sold by Beta Co")]) === wantB.get("Suite").sold,
  );
  const url = await ev("location.href");
  await goto(url.replace(BASE, ""));
  record("a filtered report opens the same from its address (can be bookmarked)", (await ev("document.getElementById('rf-company').value")) === ids.co.B);

  await setSelect("#rf-company", "");
  await waitFor(`!location.search.includes("company")`);
  await setSelect("#rf-range", "last-fy");
  await waitFor(`location.search.includes("last-fy")`);
  await waitFor("document.querySelector('[data-report=sales-month]')");
  const salesLast = expectSales(LAST_FY);
  record("last financial year shows only last year's bills", near(money(await figure("Total billed")), salesLast.total) && Number(await figure("Bills")) === salesLast.bills, `${await figure("Total billed")} vs ${salesLast.total}`);

  // =====================================================================
  section("Payments");
  await goto("/payments");
  await waitFor("document.querySelector('[data-total]')");
  const payFy = PAYMENTS.filter((p) => inRange(p.paidOn, FY));
  const sumOf = (list) => list.reduce((s, p) => s + p.amount, 0);
  record("this financial year's payments add up", near(money(await ev("document.querySelector('[data-total]').innerText")), sumOf(payFy)));
  const payTable = await readTable("payments");
  record("each payment is listed once", payTable.rows.length === payFy.length, `${payTable.rows.length} rows`);
  record("a payment on a cancelled bill is marked", payTable.rows.some((r) => r.join(" ").includes("Bill cancelled")));
  await shot("rp-payments");

  await setSelect('select[aria-label="Client"]', "Client One");
  await sleep(300);
  record("filtering by client updates the total", near(money(await ev("document.querySelector('[data-total]').innerText")), sumOf(payFy.filter((p) => bill(p.bill).client === "C1"))));
  await setSelect('select[aria-label="Client"]', "");

  await setSelect("#rf-company", ids.co.B);
  await waitFor(`location.search.includes(${j(ids.co.B)})`);
  await waitFor("document.querySelector('[data-total]')");
  record("filtering by company shows only that company's payments", near(money(await ev("document.querySelector('[data-total]').innerText")), sumOf(payFy.filter((p) => bill(p.bill).co === "B"))));

  await goto("/payments");
  await ready("#rf-range");
  await setSelect("#rf-range", "custom");
  await waitFor("document.getElementById('rf-from')");
  await setInput("#rf-from", day(-7));
  await setInput("#rf-to", TODAY);
  await click("Show");
  await waitFor(`location.search.includes("from=")`);
  await waitFor("document.querySelector('[data-total]')");
  const lastWeek = PAYMENTS.filter((p) => inRange(p.paidOn, { from: day(-7), to: TODAY }));
  record("picking your own dates works", near(money(await ev("document.querySelector('[data-total]').innerText")), sumOf(lastWeek)), `${sumOf(lastWeek)} expected`);

  await goto(`/payments?from=${addDays(TODAY, 1)}&to=${addDays(TODAY, 5)}`);
  record("dates with no payments say so plainly", await waitFor(`document.body.innerText.includes("No payments in these dates")`));
  await goto("/reports?from=not-a-date&to=junk&company=nonsense");
  record("a broken address falls back to this financial year instead of failing", (await waitFor("document.querySelector('[data-report=sales-month]')")) && near(money(await figure("Total billed")), sales.total));
} catch (error) {
  record(`script error: ${error.message}`, false);
  try {
    await shot("rp-error");
  } catch {}
} finally {
  ws.close();
  proc.kill();
  await db.end();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
