// Tests bills that are not about rooms: saved services, free-text items with
// several lines, and rooms typed by hand that must never touch inventory.
//
// Run against a throwaway database with one login, owner@example.com /
// owner-pass-12345, and nothing else:
//   DATABASE_URL=...hotel_admin_test  node scripts/items-test.mjs <edge.exe> <shots-dir> <base-url> <today YYYY-MM-DD>

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

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

// ---------------------------------------------------------------------------
// A company, a client, and rooms in stock at Sea Hotel
// ---------------------------------------------------------------------------
const companyId = randomUUID();
await db.query("insert into companies (id, name, initials) values ($1, 'Alpha Stays LLP', 'AS')", [companyId]);
await db.query(
  `insert into formats (company_id, name, title, number_prefix, has_tax_line, counts_as_sale) values
   ($1, 'Invoice with tax line', 'Tax Invoice', 'AS/', true, true),
   ($1, 'Invoice without tax line', 'Invoice', 'AS/N/', false, true)`,
  [companyId],
);
const clientId = randomUUID();
await db.query("insert into clients (id, name, address) values ($1, 'Orbit Holidays', '7 MG Road, Indore')", [clientId]);
const hotelId = randomUUID();
const roomTypeId = randomUUID();
await db.query("insert into hotels (id, name, city) values ($1, 'Sea Hotel', 'Goa')", [hotelId]);
await db.query("insert into room_types (id, hotel_id, name) values ($1, $2, 'Deluxe')", [roomTypeId, hotelId]);
await db.query(
  "insert into stock_blocks (room_type_id, first_night, last_night, rooms_held, sell_price) values ($1, $2, $3, 3, 5000)",
  [roomTypeId, TODAY, addDays(TODAY, 10)],
);
const soldDeluxe = async () =>
  Number(
    (
      await one(
        `select coalesce(sum(l.quantity), 0) as sold from bill_lines l join bills b on b.id = l.bill_id
         where l.room_type_id = $1 and b.status = 'final' and b.is_sale`,
        [roomTypeId],
      )
    ).sold,
  );

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
const PORT = 9431;
const proc = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}\\it-${Date.now()}`, "--window-size=1440,1100", "--disable-gpu", "about:blank"], { stdio: "ignore" });
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
const sees = (text, ms) => waitFor(`document.body.innerText.includes(${j(text)})`, ms);
const value = (selector) => ev(`document.querySelector(${j(selector)})?.value`);
const setValue = (selector, v) =>
  ev(`(() => {
    const el = document.querySelector(${j(selector)});
    if (!el) throw new Error("missing " + ${j(selector)});
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${j(String(v))});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  })()`);
const selectByText = (selector, text) =>
  ev(`(() => {
    const el = document.querySelector(${j(selector)});
    const option = [...el.options].find((o) => o.textContent.trim() === ${j(text)});
    if (!option) throw new Error("no option " + ${j(text)} + " in " + [...el.options].map((o) => o.textContent.trim()).join(" | "));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, option.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
const optionTexts = (selector) => ev(`[...(document.querySelector(${j(selector)})?.options ?? [])].map((o) => o.textContent.trim())`);
const click = async (text, within = "document") => {
  const find = `[...${within}.querySelectorAll("button, a")].find((b) => b.textContent.trim() === ${j(text)} && !b.disabled)`;
  if (!(await waitFor(`(() => { const el = ${find}; return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`))) throw new Error(`no button or link "${text}"`);
  await ev(`(${find}).click()`);
};
const submit = (id) => ev(`document.getElementById(${j(id)}).requestSubmit()`);
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}\\${name}.png`, Buffer.from(r.data, "base64"));
};
const paperRows = () => ev(`[...document.querySelectorAll('article tbody tr')].map((tr) => [...tr.cells].map((c) => c.innerText.trim()))`);
const alertText = () => ev(`[...document.querySelectorAll('[role=alert]')].map((e) => e.innerText).join(' | ')`);

async function addService(name, details, rate) {
  await click("Add service");
  await waitFor("document.getElementById('sv-name')?.value === ''");
  await setValue("#sv-name", name);
  await setValue("#sv-details", details);
  await setValue("#sv-rate", rate);
  await submit("service-form");
}

async function newBill() {
  await goto("/bill-generator");
  await ready("#company");
  await selectByText("#format", "Invoice without tax line");
  await selectByText("#client", "Orbit Holidays");
}

async function finalise() {
  await click("Finalise");
  await click("Yes, finalise");
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await goto("/login");
  await ready("form");
  await ev(`document.getElementById("email").value = "owner@example.com"; document.getElementById("password").value = "owner-pass-12345"; document.querySelector("form").requestSubmit()`);
  await waitFor("location.pathname === '/'");

  // =====================================================================
  section("Services in Settings");
  await goto("/settings");
  await ready("button");
  record("Settings has a Services section, empty to start", await sees("No services yet."));
  await addService("Airport transfer", "Innova, both ways", 2500);
  await waitFor("!document.getElementById('service-form')");
  await addService("Sightseeing tour", "", "");
  await waitFor("!document.getElementById('service-form')");
  const listed = await ev("document.querySelector('[data-services]')?.innerText ?? ''");
  record("services are listed with their rate, or Rate varies", /Airport transfer[\s\S]*Innova, both ways[\s\S]*₹2,500/.test(listed) && /Sightseeing tour[\s\S]*Rate varies/.test(listed), listed.replace(/\n+/g, " | "));
  await addService("airport TRANSFER", "", 100);
  record("the same name twice is refused, whatever the capitals", await sees("There is already a service called airport TRANSFER."));
  await click("Cancel");
  await ev(`[...document.querySelectorAll('[data-services] li')].find((li) => li.innerText.includes("Sightseeing tour")).querySelector("button").click()`);
  await waitFor("document.getElementById('sv-rate')");
  await setValue("#sv-rate", 4000);
  await submit("service-form");
  await waitFor("!document.getElementById('service-form')");
  record("a service's rate can be changed", await sees("₹4,000"));
  await shot("it-settings");

  // =====================================================================
  section("A bill made only of services and a typed room");
  await newBill();
  const buttons = await ev("[...document.querySelectorAll('section[aria-labelledby=lines-heading] > div:last-child button')].map((b) => b.textContent.trim())");
  record("Add item is the first choice, before any room", buttons[0] === "Add item" && buttons.includes("Room from inventory") && buttons.includes("Room, not from stock"), buttons.join(" | "));

  await click("Add item");
  await waitFor("document.getElementById('line-1-service')");
  const offered = await optionTexts("#line-1-service");
  record("saved services are offered with their rate", offered.includes("Airport transfer, ₹2,500") && offered.includes("Sightseeing tour, ₹4,000"), offered.join(" | "));
  await setValue("#line-1-service", (await one("select id from services where name = 'Airport transfer'")).id);
  record(
    "picking a service fills in its name, details and rate",
    (await waitFor(`document.getElementById('line-1-desc').value === "Airport transfer\\nInnova, both ways"`)) && (await value("#line-1-rate")) === "2500",
    j(await value("#line-1-desc")),
  );
  await setValue("#line-1-qty", 2);
  await setValue("#line-1-rate", 2750);
  record("the rate can still be changed on this bill", (await value("#line-1-rate")) === "2750");

  await click("Add item");
  await waitFor("document.getElementById('line-2-desc')");
  await setValue("#line-2-desc", "Visa assistance\nUAE tourist visa, 30 days\nIncludes insurance");
  await setValue("#line-2-rate", 6000);
  record("an item can run over several lines", (await value("#line-2-desc")).split("\n").length === 3);

  await click("Room, not from stock");
  await waitFor("document.getElementById('line-3-desc')");
  record("a typed room says it does not touch inventory", await sees("Typed by hand. Not taken from your inventory."));
  await setValue("#line-3-desc", "Deluxe, Sea Hotel, Goa");
  await setValue("#line-3-in", addDays(TODAY, 1));
  await setValue("#line-3-nights", 2);
  await setValue("#line-3-qty", 2);
  await setValue("#line-3-rate", 6000);
  const expectedTotal = 2 * 2750 + 6000 + 2 * 2 * 6000;
  record("the total adds up services and the typed room", await sees("₹35,500"), `expected ${expectedTotal}`);

  const rows = await paperRows();
  record(
    "the preview prints each item's first line as the item and the rest as details",
    /^Airport transfer\n+Innova, both ways$/.test(rows[0]?.[0] ?? "") && /^Visa assistance\n+UAE tourist visa, 30 days\nIncludes insurance$/.test(rows[1]?.[0] ?? "") && /^Deluxe, Sea Hotel, Goa\n+\d\d \w{3} to \d\d \w{3}$/.test(rows[2]?.[0] ?? ""),
    j(rows.map((r) => r[0])),
  );
  await shot("it-generator");

  await click("Save draft");
  await waitFor("location.search.includes('bill=')");
  await sees("Edit draft");
  await ready("#company");
  await waitFor("document.getElementById('line-3-desc')");
  record(
    "a saved draft reopens with the services, the multi-line item and the typed room intact",
    (await value("#line-1-desc")) === "Airport transfer\nInnova, both ways" &&
      (await value("#line-2-desc")) === "Visa assistance\nUAE tourist visa, 30 days\nIncludes insurance" &&
      (await value("#line-3-desc")) === "Deluxe, Sea Hotel, Goa" &&
      (await value("#line-3-nights")) === "2" &&
      (await ev("[...document.querySelectorAll('[data-line-kind]')].map((l) => l.dataset.lineKind).join(',')")) === "item,item,typed-room",
  );

  const stockBefore = await soldDeluxe();
  await finalise();
  await waitFor("/\\d{4}$/.test(document.querySelector('h1')?.textContent.trim() ?? '')", 30000);
  const billNumber = await ev("document.querySelector('h1').textContent.trim()");
  record("a bill with no rooms from stock finalises and gets a number", /^AS\/N\/\d\d-\d\d\/0001$/.test(billNumber), billNumber);
  const stored = await all("select kind, room_type_id, description, nights, quantity, amount from bill_lines l join bills b on b.id = l.bill_id where b.number = $1 order by position", [billNumber]);
  record(
    "the typed room is kept as a room with dates but no link to inventory",
    stored[2]?.kind === "room" && stored[2].room_type_id === null && stored[2].nights === 2 && Number(stored[2].amount) === 24000,
  );
  record("typing the same hotel and room as one in stock takes nothing from inventory", (await soldDeluxe()) === stockBefore && stockBefore === 0);
  await goto("/inventory");
  await waitFor("document.querySelector('tbody')?.innerText.includes('Deluxe')");
  const tomorrowCell = await ev(`(() => { const i = [...document.querySelectorAll('thead th')].findIndex((th) => th.innerText.includes(${j(new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${addDays(TODAY, 1)}T00:00:00Z`)))})); return document.querySelector('tbody tr:nth-child(2)').children[i]?.innerText.trim(); })()`);
  record("the inventory grid still shows all 3 rooms left", tomorrowCell === "3", tomorrowCell);

  // =====================================================================
  section("Mistakes are caught");
  await newBill();
  await click("Room, not from stock");
  await waitFor("document.getElementById('line-1-desc')");
  await setValue("#line-1-rate", 1000);
  await finalise();
  record("a typed room with no name is refused", await sees("Item 1: type the room and hotel."), await alertText());
  await click("Add item");
  await waitFor("document.getElementById('line-2-desc')");
  await setValue("#line-1-desc", "Suite, Hill Resort");
  await setValue("#line-2-rate", 500);
  await finalise();
  record("an item with no description is refused", await sees("Item 2: describe what this item is."), await alertText());

  // =====================================================================
  section("Reports and removing services");
  await goto("/reports");
  await waitFor("document.querySelector('[data-report=sales-month]')");
  record("the bill counts in sales", await sees("₹35,500"));
  await click("Inventory", "document.querySelector('[role=tablist]')");
  await waitFor("document.querySelector('[data-report=inventory]')");
  const deluxeSold = await ev(`(() => { const t = document.querySelector('[data-report=inventory]'); const head = [...t.querySelectorAll('thead th')].map((th) => th.innerText.trim()); const row = [...t.querySelectorAll('tbody tr')].find((tr) => tr.cells[0].innerText.trim() === 'Deluxe'); return row ? row.cells[head.indexOf('Sold')].innerText.trim() : null; })()`);
  record("the inventory report does not count the typed room as sold", deluxeSold === "0", deluxeSold);

  await goto("/settings");
  await waitFor("document.querySelector('[data-services]')");
  for (const name of ["Airport transfer", "Sightseeing tour"]) {
    await ev(`[...document.querySelectorAll('[data-services] li')].find((li) => li.innerText.includes(${j(name)})).querySelectorAll("button")[1].click()`);
    await click("Yes, remove");
    await waitFor(`!(document.querySelector('[data-services]')?.innerText ?? '').includes(${j(name)})`);
  }
  record("services can be removed", await sees("No services yet."));
  await goto("/bill-generator");
  await ready("#company");
  await click("Add item");
  await waitFor("document.getElementById('line-1-desc')");
  record("with no services saved, an item is just typed in", !(await ev("Boolean(document.getElementById('line-1-service'))")));
  const kept = await one("select description from bill_lines l join bills b on b.id = l.bill_id where b.number = $1 and position = 0", [billNumber]);
  record("bills that used a removed service keep their wording", kept?.description === "Airport transfer\nInnova, both ways");

  await goto("/activity");
  await waitFor("document.querySelector('[data-activity] li')");
  const activity = await ev("document.querySelector('[data-activity]').innerText");
  record("adding, changing and removing services is on the Activity screen", /added service Airport transfer at ₹2,500/.test(activity) && /changed service Sightseeing tour at ₹4,000/.test(activity) && /removed service Airport transfer/.test(activity));
} catch (error) {
  record(`script error: ${error.message}`, false);
  try {
    await shot("it-error");
  } catch {}
} finally {
  ws.close();
  proc.kill();
  await db.end();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
