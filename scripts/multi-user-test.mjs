// Four people, four separate browsers, acting at the same instant.
// Checks what each of them sees on screen and what ends up in the database.
//
// Run it against a throwaway database, never the real one:
//   DATABASE_URL=...hotel_admin_test  node scripts/multi-user-test.mjs <edge.exe> <shots-dir> <base-url> [--only=rooms] [--rounds=4]
//
// The four logins below must already exist in that database.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

const [EDGE, OUT, BASE, ...flags] = process.argv.slice(2);
const flag = (name, fallback) => flags.find((f) => f.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const ONLY = flag("only", "");
const ROUNDS = Number(flag("rounds", "4"));
const PASSWORD = "multi-user-pass-123";
const PEOPLE = ["Asha", "Bilal", "Chitra", "Dev"];

if (!process.env.DATABASE_URL?.includes("test")) {
  console.error("Refusing to run: DATABASE_URL must point at a test database.");
  process.exit(2);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const rows = async (text, params = []) => (await db.query(text, params)).rows;
const one = async (text, params = []) => (await rows(text, params))[0];

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const plusDays = (n) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const results = [];
const record = (step, ok, detail = "") => {
  results.push({ step, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail !== "" ? `  (${detail})` : ""}`);
};
const section = (title) => console.log(`\n--- ${title} ---`);
const j = (v) => JSON.stringify(v);

class Person {
  constructor(name, port) {
    this.name = name;
    this.email = `${name.toLowerCase()}@example.com`;
    this.port = port;
    this.seq = 0;
    this.pending = new Map();
  }

  async start() {
    this.proc = spawn(
      EDGE,
      ["--headless=new", `--remote-debugging-port=${this.port}`, `--user-data-dir=${OUT}\\mu-${this.name}-${Date.now()}`, "--window-size=1440,900", "--disable-gpu", "about:blank"],
      { stdio: "ignore" },
    );
    let url;
    for (let i = 0; i < 80 && !url; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
        url = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
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
      const m = JSON.parse(event.data);
      const waiting = this.pending.get(m.id);
      if (!waiting) return;
      this.pending.delete(m.id);
      if (m.error) waiting.reject(new Error(m.error.message));
      else waiting.resolve(m.result);
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
    await this.send("Page.navigate", { url: path.startsWith("http") ? path : BASE + path });
    await sleep(400);
    await this.waitFor("document.readyState === 'complete'");
    await sleep(700);
  }

  path() {
    return this.eval("location.pathname");
  }

  /** Waits until the element exists and the page's script is attached to it. */
  ready(selector) {
    return this.waitFor(`(() => { const el = document.querySelector(${j(selector)}); return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`);
  }

  sees(text, ms) {
    return this.waitFor(`document.body.innerText.includes(${j(text)})`, ms);
  }

  alertText() {
    return this.eval(`[...document.querySelectorAll('[role=alert]')].map((e) => e.innerText).join(' | ')`);
  }

  setInput(selector, value) {
    return this.eval(`(() => {
      const el = document.querySelector(${j(selector)});
      if (!el) throw new Error("missing " + ${j(selector)});
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${j(String(value))});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    })()`);
  }

  value(selector) {
    return this.eval(`document.querySelector(${j(selector)})?.value`);
  }

  selectByText(selector, text) {
    return this.eval(`(() => {
      const el = document.querySelector(${j(selector)});
      if (!el) throw new Error("missing " + ${j(selector)});
      const option = [...el.options].find((o) => o.textContent.trim() === ${j(text)});
      if (!option) throw new Error("no option " + ${j(text)});
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, option.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
  }

  static finder = (text) => `[...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === ${j(text)} && !b.disabled)`;

  /** Waits until the button exists and is wired up. */
  async waitButton(text, ms) {
    const ok = await this.waitFor(`(() => { const el = ${Person.finder(text)}; return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`, ms);
    if (!ok) throw new Error(`${this.name}: no button or link "${text}"`);
  }

  /** Clicks immediately. Call waitButton first when timing matters. */
  clickNow(text) {
    return this.eval(`(${Person.finder(text)}).click()`);
  }

  async click(text) {
    await this.waitButton(text);
    await this.clickNow(text);
  }

  submit(formId) {
    return this.eval(`document.getElementById(${j(formId)}).requestSubmit()`);
  }

  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT}\\${name}.png`, Buffer.from(r.data, "base64"));
  }

  async login() {
    await this.goto("/login");
    await this.waitFor(`(() => { const f = document.querySelector("form"); return f && Object.keys(f).some((k) => k.startsWith("__reactProps")); })()`);
    await this.eval(`document.getElementById("email").value = ${j(this.email)}; document.getElementById("password").value = ${j(PASSWORD)}; document.querySelector("form").requestSubmit()`);
    if (!(await this.waitFor("location.pathname === '/'"))) throw new Error(`${this.name}: could not sign in`);
  }

  stop() {
    try {
      this.ws?.close();
    } catch {}
    this.proc?.kill();
  }
}

const people = PEOPLE.map((name, i) => new Person(name, 9341 + i));
const [asha, bilal, chitra, dev] = people;
const together = (fn) => Promise.all(people.map(fn));

// ---------- shared steps ----------

async function openClientEdit(p, clientName) {
  await p.goto("/clients");
  await p.waitFor(`document.querySelector('tbody')?.innerText.includes(${j(clientName)})`);
  await p.eval(`[...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes(${j(clientName)})).click()`);
  await p.waitFor(`document.querySelector('aside[data-panel][aria-label=${j(clientName)}]')`);
  await p.click("Edit");
  await p.waitFor("document.getElementById('cl-address')");
}

/** Fills a bill and stops on the "Yes, finalise" question. */
async function prepareBill(p, { client, room, night, rooms, other }) {
  await p.goto("/bill-generator");
  await p.waitFor(`(() => { const el = document.querySelector("#company"); return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`);
  await p.selectByText("#client", client);
  if (room) {
    await p.click("Room from inventory");
    await p.waitFor("document.querySelector('#line-1-room')");
    await p.selectByText("#line-1-room", room);
    await p.setInput("#line-1-in", night);
    await p.setInput("#line-1-qty", rooms);
    await p.waitFor(`document.querySelector('#line-1-rate').value !== '0'`);
  } else {
    await p.click("Add item");
    await p.waitFor("document.querySelector('#line-1-desc')");
    await p.setInput("#line-1-desc", other);
    await p.setInput("#line-1-rate", "100");
  }
  await p.click("Finalise");
  await p.waitButton("Yes, finalise");
}

/** After a simultaneous finalise: who got a bill, and what the others were told. */
async function finaliseOutcome(p) {
  await p.waitFor("location.pathname.startsWith('/bills/') || document.querySelector('[role=alert]')", 30000);
  const path = await p.path();
  return { name: p.name, won: path.startsWith("/bills/"), message: path.startsWith("/bills/") ? "" : await p.alertText() };
}

const soldOn = async (night) =>
  Number(
    (
      await one(
        `select coalesce(sum(l.quantity), 0) as sold from bill_lines l join bills b on b.id = l.bill_id
         where l.kind = 'room' and b.status = 'final' and b.is_sale and $1::date >= l.check_in and $1::date < l.check_in + l.nights`,
        [night],
      )
    ).sold,
  );

const ROOM = "Deluxe, Race Hotel, Goa";
const CLIENTS = ["Client A", "Client B", "Client C", "Client D"];

try {
  section("Sign in as four different people");
  await Promise.all(people.map((p) => p.start()));
  for (const p of people) await p.login();
  record("four people are signed in at once, each with their own account", (await together((p) => p.sees(p.name))).every(Boolean));

  section("Set up shared data (Asha)");
  await asha.goto("/settings");
  await asha.click("Add company");
  await asha.waitFor("document.getElementById('co-name')");
  await asha.setInput("#co-name", "Test Company One");
  await asha.submit("company-form");
  await asha.sees("TC");
  await asha.goto("/clients");
  for (const [i, name] of CLIENTS.entries()) {
    await asha.click("Add client");
    await asha.waitFor("document.getElementById('cl-name')?.value === ''");
    await asha.setInput("#cl-name", name);
    await asha.setInput("#cl-address", "Original address");
    await asha.setInput("#cl-cphone", `+91 98000 0000${i}`);
    await asha.submit("client-form");
    await asha.waitFor(`document.querySelector('aside[data-panel][aria-label=${j(name)}]')`);
  }
  await asha.goto("/inventory");
  await asha.click("Add rooms");
  await asha.waitFor("document.getElementById('st-hotel')");
  await asha.setInput("#st-hotel", "Race Hotel");
  await asha.setInput("#st-city", "Goa");
  await asha.setInput("#st-room", "Deluxe");
  await asha.setInput("#st-last", plusDays(40));
  await asha.setInput("#st-held", "5");
  await asha.setInput("#st-sell", "5000");
  await asha.submit("stock-form");
  await asha.waitFor("document.querySelector('tbody')?.innerText.includes('Deluxe')");
  record("setup data exists", (await one("select count(*)::int as n from clients")).n === 4 && (await one("select count(*)::int as n from stock_blocks")).n === 1);

  // =====================================================================
  section(`Last rooms: 4 people each try to sell 2 of the 5 rooms, at the same instant (${ROUNDS} rounds)`);
  let oversold = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    const night = plusDays(round);
    await together((p, i) => prepareBill(p, { client: CLIENTS[i], room: ROOM, night, rooms: 2 }));
    await together((p) => p.clickNow("Yes, finalise"));
    const outcomes = await together(finaliseOutcome);
    const winners = outcomes.filter((o) => o.won);
    const losers = outcomes.filter((o) => !o.won);
    const sold = await soldOn(night);
    if (sold > 5) oversold++;
    record(
      `round ${round}: exactly 2 of 4 bills go through and 4 rooms are sold, never more than the 5 held`,
      winners.length === 2 && sold === 4,
      `winners ${winners.map((w) => w.name).join("+") || "none"}, sold ${sold} of 5`,
    );
    record(
      `round ${round}: the other 2 people are told why on their screen`,
      losers.length === 2 && losers.every((l) => /Only 1 left|sold out/i.test(l.message)),
      losers.map((l) => `${l.name}: ${l.message}`).join(" / "),
    );
    if (round === 1) await people.find((p) => p.name === losers[0]?.name)?.shot("mu-oversell-refused");
  }
  record("no night was ever oversold", oversold === 0, `${oversold} oversold nights`);
  record("a refused bill leaves nothing behind (no stray drafts)", (await one("select count(*)::int as n from bills where status = 'draft'")).n === 0);
  // The test fills the form far faster than a person, which once made the price get lost.
  const wrongPrice = (await one("select count(*)::int as n from bill_lines where kind = 'room' and rate <> 5000")).n;
  const wrongTotal = (await one("select count(*)::int as n from bills where status = 'final' and total <> 10000")).n;
  record("every bill sold in the rush carries the inventory price (2 rooms x 5,000 = 10,000)", wrongPrice === 0 && wrongTotal === 0, `${wrongPrice} lines with a wrong rate, ${wrongTotal} bills with a wrong total`);

  if (ONLY !== "rooms") {
    // ===================================================================
    section(`Bill numbers: 4 people finalise at the same instant (${ROUNDS} rounds)`);
    for (let round = 1; round <= ROUNDS; round++) {
      await together((p, i) => prepareBill(p, { client: CLIENTS[i], other: `Service ${round}` }));
      await together((p) => p.clickNow("Yes, finalise"));
      const outcomes = await together(finaliseOutcome);
      record(`round ${round}: all 4 bills are finalised`, outcomes.every((o) => o.won), outcomes.filter((o) => !o.won).map((o) => `${o.name}: ${o.message}`).join(" / "));
    }
    const numbers = (await rows("select number from bills where status = 'final' order by number")).map((r) => r.number);
    const suffixes = numbers.map((n) => Number(n.split("/").pop())).sort((a, b) => a - b);
    record(
      "every bill number is different, and they run 1, 2, 3... with no gap",
      new Set(numbers).size === numbers.length && suffixes.every((n, i) => n === i + 1),
      `${numbers.length} bills, ${numbers[0]} to ${numbers[numbers.length - 1]}`,
    );

    // ===================================================================
    section("Screens update on their own");
    await bilal.goto("/clients");
    await bilal.setInput('input[type="search"]', "Client");
    // Count any loading placeholder that flashes up while the list refreshes.
    await bilal.eval(`window.__flashes = 0; new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches?.('div[aria-hidden].space-y-2') || n.querySelector?.('div[aria-hidden].space-y-2'))) window.__flashes++; }).observe(document.body, { childList: true, subtree: true })`);
    await asha.goto("/clients");
    await asha.click("Add client");
    await asha.waitFor("document.getElementById('cl-name')?.value === ''");
    await asha.setInput("#cl-name", "Client E");
    await asha.setInput("#cl-cphone", "+91 98000 00009");
    await asha.submit("client-form");
    await asha.waitFor(`document.querySelector('aside[data-panel][aria-label="Client E"]')`);
    record("a client added by Asha appears on Bilal's list without him reloading", await bilal.waitFor(`document.querySelector('tbody')?.innerText.includes('Client E')`, 40000));
    record("what Bilal had typed in the search box is still there", (await bilal.value('input[type="search"]')) === "Client");
    record("the list did not flash a loading placeholder while it refreshed", (await bilal.eval("window.__flashes")) === 0, `${await bilal.eval("window.__flashes")} flashes`);

    await bilal.goto("/inventory");
    const cellFor = (night) => `(() => { const i = [...document.querySelectorAll('thead th')].findIndex((th) => th.innerText.includes(${j(new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${night}T00:00:00Z`)))})); return document.querySelector('tbody tr:nth-child(2)').children[i]?.innerText.trim(); })()`;
    const liveNight = plusDays(6);
    const before = await bilal.eval(cellFor(liveNight));
    await prepareBill(asha, { client: "Client A", room: ROOM, night: liveNight, rooms: 1 });
    await asha.clickNow("Yes, finalise");
    await asha.waitFor("location.pathname.startsWith('/bills/')");
    record("rooms sold by Asha come off Bilal's inventory grid without him reloading", before === "5" && (await bilal.waitFor(`${cellFor(liveNight)} === "4"`, 40000)), `${before} -> ${await bilal.eval(cellFor(liveNight))}`);

    const watchNight = plusDays(7);
    await chitra.goto("/bill-generator");
    await chitra.ready("#company");
    await chitra.selectByText("#client", "Client C");
    await chitra.click("Room from inventory");
    await chitra.waitFor("document.querySelector('#line-1-room')");
    await chitra.selectByText("#line-1-room", ROOM);
    await chitra.setInput("#line-1-in", watchNight);
    const sawFive = await chitra.sees("5 of 5 left for these nights.");
    await prepareBill(dev, { client: "Client D", room: ROOM, night: watchNight, rooms: 3 });
    await dev.clickNow("Yes, finalise");
    await dev.waitFor("location.pathname.startsWith('/bills/')");
    record("the rooms-left count on Chitra's open bill drops when Dev sells, without her touching it", sawFive && (await chitra.sees("2 of 5 left for these nights.", 40000)));

    // ===================================================================
    section("Two people edit the same client");
    await openClientEdit(asha, "Client A");
    await openClientEdit(bilal, "Client A");
    await bilal.setInput("#cl-address", "Bilal is still typing this");
    await asha.setInput("#cl-address", "Address saved by Asha");
    await asha.submit("client-form");
    await asha.waitFor("!document.getElementById('client-form')");
    const warned = await bilal.waitFor("document.querySelector('[data-conflict]')", 40000);
    record("Bilal is warned that Asha changed the client, before he saves", warned && (await bilal.sees("Asha changed this client while you had it open.")), await bilal.alertText());
    record("Bilal's own typing is not wiped by the update", (await bilal.value("#cl-address")) === "Bilal is still typing this");
    await bilal.shot("mu-conflict-notice");
    await bilal.click("Load their version");
    record("'Load their version' shows Asha's saved address", await bilal.waitFor(`document.querySelector('#cl-address').value === "Address saved by Asha"`));
    await bilal.click("Cancel");

    await openClientEdit(asha, "Client B");
    await openClientEdit(bilal, "Client B");
    await asha.setInput("#cl-address", "Race address from Asha");
    await bilal.setInput("#cl-address", "Race address from Bilal");
    await Promise.all([asha.submit("client-form"), bilal.submit("client-form")]);
    await Promise.all([asha, bilal].map((p) => p.waitFor("!document.getElementById('client-form') || document.querySelector('[data-conflict]')", 40000)));
    const savedA = await asha.eval("!document.getElementById('client-form')");
    const savedB = await bilal.eval("!document.getElementById('client-form')");
    const winner = savedA ? asha : bilal;
    const loser = savedA ? bilal : asha;
    const afterRace = (await one("select address, version from clients where name = 'Client B'"));
    record("both press Save at the same instant: one save goes through, the other is stopped", savedA !== savedB && afterRace.address === `Race address from ${winner.name}` && afterRace.version === 2, `${winner.name} saved, ${loser.name} stopped`);
    record("the person who was stopped is told who changed it", await loser.sees(`${winner.name} changed this client while you had it open.`), await loser.alertText());
    await loser.click("Keep mine");
    await loser.submit("client-form");
    await loser.waitFor("!document.getElementById('client-form')");
    record("'Keep mine' then saves their version on purpose", (await one("select address from clients where name = 'Client B'")).address === `Race address from ${loser.name}`);

    await openClientEdit(chitra, "Client E");
    await dev.goto("/clients");
    await dev.eval(`[...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes("Client E")).click()`);
    await dev.waitFor(`document.querySelector('aside[data-panel][aria-label="Client E"]')`);
    await dev.click("Delete");
    await dev.waitButton("Keep");
    await dev.eval(`[...document.querySelectorAll('aside[data-panel] button')].filter((b) => b.textContent.trim() === "Delete").at(-1).click()`);
    await dev.waitFor(`!document.querySelector('aside[data-panel]')`);
    await chitra.setInput("#cl-address", "Editing a client that is gone");
    record("Chitra is told the client she is editing was deleted by someone else", await chitra.sees("This client was deleted by someone else while you had it open.", 40000));
    await chitra.submit("client-form");
    record("saving it is refused, not recreated", (await chitra.sees("This client was deleted by someone else.")) && (await one("select count(*)::int as n from clients where name = 'Client E'")).n === 0);

    // ===================================================================
    section("Two people work on the same draft bill");
    await asha.goto("/bill-generator");
    await asha.ready("#company");
    await asha.selectByText("#client", "Client A");
    await asha.click("Add item");
    await asha.waitFor("document.querySelector('#line-1-desc')");
    await asha.setInput("#line-1-desc", "Consulting");
    await asha.setInput("#line-1-rate", "1000");
    await asha.click("Save draft");
    await asha.waitFor("location.search.includes('bill=')");
    await asha.sees("Edit draft");
    const draftUrl = await asha.eval("location.pathname + location.search");
    const draftId = draftUrl.split("bill=")[1];
    await bilal.goto(draftUrl);
    await bilal.sees("Edit draft");
    await asha.waitFor(`document.querySelector("#notes")`);
    await asha.setInput("#notes", "Note written by Asha");
    await asha.click("Save draft");
    await asha.sees("Draft saved.");
    await bilal.setInput("#line-1-rate", "2000");
    await bilal.click("Save draft");
    record("Bilal's save over Asha's newer draft is stopped", await bilal.waitFor("document.querySelector('[data-conflict]')", 40000), await bilal.alertText());
    record("Asha's draft is untouched in the database", Number((await one("select rate from bill_lines where bill_id = $1", [draftId])).rate) === 1000);
    await bilal.click("Load their version");
    record("Bilal can load Asha's version of the draft", await bilal.waitFor(`document.querySelector('#notes')?.value === "Note written by Asha" && document.querySelector('#line-1-rate')?.value === "1000"`));

    const finalBefore = (await one("select count(*)::int as n from bills where status = 'final'")).n;
    await Promise.all([asha, bilal].map(async (p) => { await p.click("Finalise"); await p.waitButton("Yes, finalise"); }));
    await Promise.all([asha.clickNow("Yes, finalise"), bilal.clickNow("Yes, finalise")]);
    await Promise.all([asha, bilal].map((p) => p.waitFor("location.pathname.startsWith('/bills/')", 40000)));
    const finalAfter = (await one("select count(*)::int as n from bills where status = 'final'")).n;
    const finalisedLog = (await one("select count(*)::int as n from audit_log where entity = 'bill' and entity_id = $1 and action = 'finalised'", [draftId])).n;
    record("both press Finalise on the same draft at once: it is finalised exactly once, with one number", finalAfter === finalBefore + 1 && finalisedLog === 1, `finalised ${finalisedLog} time(s)`);
    record("both end up looking at the same finalised bill", (await asha.path()) === `/bills/${draftId}` && (await bilal.path()) === `/bills/${draftId}`);

    // ===================================================================
    section("Two people record the same payment");
    await Promise.all([asha, bilal].map(async (p) => { await p.goto(`/bills/${draftId}`); await p.click("Record payment"); await p.waitFor("document.getElementById('pay-amount')"); }));
    await Promise.all([asha.submit("payment-form"), bilal.submit("payment-form")]);
    await Promise.all([asha, bilal].map((p) => p.waitFor("!document.getElementById('payment-form') || document.querySelector('aside[data-panel] [role=alert]')", 30000)));
    const pay = await one("select count(*)::int as n, coalesce(sum(amount), 0)::float8 as paid from payments where bill_id = $1", [draftId]);
    const billTotal = Number((await one("select total from bills where id = $1", [draftId])).total);
    record("the payment is recorded once, not twice", pay.n === 1 && pay.paid === billTotal, `${pay.n} payment(s), ${pay.paid} of ${billTotal}`);
    const payMessages = `${await asha.alertText()} ${await bilal.alertText()}`;
    record("the second person is told nothing is outstanding", /Only ₹0 is outstanding/.test(payMessages), payMessages.trim());

    // ===================================================================
    section("Two people cancel the same bill");
    const victim = (await one("select b.id from bills b join bill_lines l on l.bill_id = b.id where b.status = 'final' and l.kind = 'room' order by b.number limit 1")).id;
    await Promise.all([chitra, dev].map(async (p) => { await p.goto(`/bills/${victim}`); await p.click("Cancel bill"); await p.waitButton("Yes, cancel it"); }));
    await Promise.all([chitra.clickNow("Yes, cancel it"), dev.clickNow("Yes, cancel it")]);
    await Promise.all([chitra, dev].map((p) => p.sees("Cancelled", 30000)));
    const cancelLog = (await one("select count(*)::int as n from audit_log where entity = 'bill' and entity_id = $1 and action = 'cancelled'", [victim])).n;
    record("the bill is cancelled once and both screens show it as cancelled", cancelLog === 1 && (await one("select status from bills where id = $1", [victim])).status === "cancelled", `cancelled ${cancelLog} time(s)`);

    // ===================================================================
    section("Two people add the same new thing at once");
    await Promise.all([asha, bilal].map(async (p) => {
      await p.goto("/inventory");
      await p.click("Add rooms");
      await p.waitFor("document.getElementById('st-hotel')");
      await p.setInput("#st-hotel", p === asha ? "Twin Hotel" : "twin hotel");
      await p.setInput("#st-city", "Jaipur");
      await p.setInput("#st-room", "Suite");
      await p.setInput("#st-held", "2");
      await p.setInput("#st-sell", "9000");
    }));
    await Promise.all([asha.submit("stock-form"), bilal.submit("stock-form")]);
    await Promise.all([asha, bilal].map((p) => p.waitFor("!document.getElementById('stock-form') || document.querySelector('aside[data-panel] [role=alert]')", 30000)));
    const twin = await one("select (select count(*) from hotels where lower(name) = 'twin hotel')::int as hotels, (select count(*) from room_types rt join hotels h on h.id = rt.hotel_id where lower(h.name) = 'twin hotel')::int as rooms, (select count(*) from stock_blocks sb join room_types rt on rt.id = sb.room_type_id join hotels h on h.id = rt.hotel_id where lower(h.name) = 'twin hotel')::int as blocks");
    record("the same new hotel typed by two people becomes one hotel, not two", twin.hotels === 1 && twin.rooms === 1, `${twin.hotels} hotel, ${twin.rooms} room type, ${twin.blocks} blocks of rooms`);

    await Promise.all([chitra, dev].map(async (p) => {
      await p.goto("/clients");
      await p.click("Add client");
      await p.waitFor("document.getElementById('cl-name')");
      await p.setInput("#cl-name", `Same Phone ${p.name}`);
      await p.setInput("#cl-cphone", "+91 97000 12345");
    }));
    await Promise.all([chitra.submit("client-form"), dev.submit("client-form")]);
    await Promise.all([chitra, dev].map((p) => p.waitFor("!document.getElementById('client-form') || document.querySelector('aside[data-panel] [role=alert]')", 30000)));
    const samePhone = (await one("select count(*)::int as n from client_contacts where phone = '+91 97000 12345'")).n;
    const dupMessages = `${await chitra.alertText()} ${await dev.alertText()}`;
    record("the same phone number entered by two people at once is saved under one client only", samePhone === 1 && /already has this phone number or email/.test(dupMessages), `${samePhone} client with that phone`);

    // ===================================================================
    section("Who did what is visible");
    await dev.goto(`/bills/${draftId}`);
    const history = await dev.eval("document.querySelector('[data-history]')?.innerText ?? ''");
    record("a bill's page shows its history with names", /Asha saved a draft of/.test(history) && /(Asha|Bilal) finalised/.test(history) && /(Asha|Bilal) recorded a payment/.test(history), history.replace(/\n+/g, " | ").slice(0, 220));
    await dev.shot("mu-bill-history");
    await dev.goto("/bills");
    await dev.waitFor("document.querySelector('tbody tr')");
    const makers = await dev.eval("[...new Set([...document.querySelectorAll('tbody tr')].map((r) => r.children[4].innerText.trim()))].sort().join(', ')");
    record("the bills list shows who made each bill", makers === "Asha, Bilal, Chitra, Dev", makers);
    await dev.goto("/activity");
    await dev.waitFor("document.querySelector('[data-activity] li')");
    const activity = await dev.eval("document.querySelector('[data-activity]').innerText");
    record("the Activity screen lists actions by all four people", PEOPLE.every((n) => activity.includes(n)) && /cancelled/.test(activity) && /deleted client Client E/.test(activity) && /added company Test Company One/.test(activity));
    await dev.shot("mu-activity");
    await dev.setInput('select[aria-label="Show activity by"]', "Bilal");
    const onlyBilal = await dev.eval("[...document.querySelectorAll('[data-activity] li p')].every((p) => p.innerText.startsWith('Bilal '))");
    record("Activity can be narrowed to one person", onlyBilal);
    await asha.goto("/clients");
    await asha.eval(`[...document.querySelectorAll("tbody tr")].find((r) => r.innerText.includes("Client B")).click()`);
    record("a client's panel shows who added it and who changed it last", await asha.waitFor(`/Added by Asha on .*Last changed by (Asha|Bilal) on/.test(document.querySelector('[data-record-history]')?.innerText ?? '')`), await asha.eval("document.querySelector('[data-record-history]')?.innerText"));

    // ===================================================================
    section("One person signing out does not disturb the others");
    await asha.eval(`document.querySelector('button[aria-label="Sign out"]').click()`);
    await asha.waitFor("location.pathname === '/login'");
    await asha.goto("/clients");
    await bilal.goto("/clients");
    record("Asha is signed out; Bilal, Chitra and Dev carry on", (await asha.path()) === "/login" && (await bilal.waitFor("document.querySelector('tbody tr')")) && (await one("select count(*)::int as n from sessions")).n === 3);
  }

  // =====================================================================
  section("Database checks after everything");
  const over = await rows(`
    select d::date::text as night, rt.id,
      coalesce((select sum(b.rooms_held) from stock_blocks b where b.room_type_id = rt.id and d::date between b.first_night and b.last_night), 0) as held,
      coalesce((select sum(l.quantity) from bill_lines l join bills bl on bl.id = l.bill_id where l.room_type_id = rt.id and l.kind = 'room' and bl.status = 'final' and bl.is_sale and d::date >= l.check_in and d::date < l.check_in + l.nights), 0) as sold
    from room_types rt cross join generate_series($1::date, $2::date, interval '1 day') d`, [today, plusDays(45)]);
  const bad = over.filter((r) => Number(r.sold) > Number(r.held));
  record("no room type is sold beyond what is held on any night", bad.length === 0, `${over.length} room-nights checked`);
  const dupNumbers = await rows("select number from bills where number is not null group by company_id, number having count(*) > 1");
  record("no bill number is used twice", dupNumbers.length === 0);
  const gaps = await rows(`
    select format_id, count(*)::int as bills, max(split_part(number, '/', array_length(string_to_array(number, '/'), 1))::int) as highest
    from bills where number is not null group by company_id, format_id having count(*) <> max(split_part(number, '/', array_length(string_to_array(number, '/'), 1))::int)`);
  record("no series has a gap in its numbers", gaps.length === 0);
  const overpaid = await rows("select b.id from bills b join payments p on p.bill_id = b.id group by b.id, b.total having sum(p.amount) > b.total");
  record("no bill has more received than its total", overpaid.length === 0);
  const odd = await one("select (select count(*) from bills where status <> 'draft' and number is null)::int as unnumbered, (select count(*) from bills where status = 'draft' and number is not null)::int as numbered_drafts");
  record("every finalised bill has a number and no draft has one", odd.unnumbered === 0 && odd.numbered_drafts === 0);
} catch (error) {
  record(`script error: ${error.message}`, false);
  for (const p of people) {
    try {
      await p.shot(`mu-error-${p.name}`);
    } catch {}
  }
} finally {
  for (const p of people) p.stop();
  await db.end();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
