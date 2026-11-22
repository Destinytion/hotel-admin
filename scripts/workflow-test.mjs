// End-to-end test of the real workflow against a test database.
// Usage: node smoke2.mjs <path-to-edge> <output-dir> <base-url> <email> <password> <today YYYY-MM-DD>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const [EDGE, OUT, BASE, EMAIL, PASSWORD, TODAY] = process.argv.slice(2);
const PORT = 9334;

const edge = spawn(
  EDGE,
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}\\smoke2-profile-${Date.now()}`, "--window-size=1440,900", "--disable-gpu", "about:blank"],
  { stdio: "ignore" },
);

const results = [];
const record = (step, ok, detail = "") => {
  results.push({ step, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail !== "" ? `  (${detail})` : ""}`);
};

let ws;
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expr, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await evaluate(`Boolean(${expr})`)) return true;
    } catch {}
    await sleep(150);
  }
  return false;
};
const goto = async (path) => {
  await send("Page.navigate", { url: BASE + path });
  await sleep(500);
  await waitFor("document.readyState === 'complete'");
  await sleep(900);
};
const pathname = () => evaluate("location.pathname");
const q = (s) => JSON.stringify(s);
const hasText = (text) => `document.body.innerText.includes(${q(text)})`;
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}\\${name}.png`, Buffer.from(r.data, "base64"));
};
// Sets a value the way typing would, so React sees it.
const setInput = (selector, value) =>
  evaluate(`(() => {
    const el = document.querySelector(${q(selector)});
    if (!el) throw new Error("missing " + ${q(selector)});
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${q(String(value))});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  })()`);
const selectByText = (selector, text) =>
  evaluate(`(() => {
    const el = document.querySelector(${q(selector)});
    if (!el) throw new Error("missing " + ${q(selector)});
    const option = [...el.options].find((o) => o.textContent.trim() === ${q(text)});
    if (!option) throw new Error("no option " + ${q(text)} + " in " + [...el.options].map((o) => o.textContent.trim()).join(" | "));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, option.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
// Waits for the button or link to exist and be wired up, then clicks it.
const clickText = async (text) => {
  const find = `[...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === ${q(text)} && !b.disabled)`;
  const there = await waitFor(`(() => { const el = ${find}; return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`);
  if (!there) throw new Error("no button or link: " + text);
  await evaluate(`(${find}).click()`);
};
const submitForm = (id) => evaluate(`document.getElementById(${q(id)}).requestSubmit()`);
const ready = (selector) =>
  waitFor(`(() => { const el = document.querySelector(${q(selector)}); return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`);
const panelGone = () => waitFor("!document.querySelector('aside[data-panel]')");
const firstCell = () => evaluate("document.querySelector('tbody tr:nth-child(2) td')?.textContent.trim()");

try {
  let url;
  for (let i = 0; i < 60 && !url; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      url = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {}
    if (!url) await sleep(250);
  }
  if (!url) throw new Error("Could not reach the browser");
  ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("WebSocket failed"));
  });
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (!m.id || !pending.has(m.id)) return;
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  };
  await send("Page.enable");
  await send("Runtime.enable");

  // ---- sign in ----
  await goto("/login");
  await ready("form");
  await evaluate(`document.getElementById("email").value = ${q(EMAIL)}; document.getElementById("password").value = ${q(PASSWORD)}; document.querySelector("form").requestSubmit()`);
  await waitFor("location.pathname === '/'");
  record("sign in", (await pathname()) === "/");
  record("home shows empty states on a new database", await waitFor(hasText("Nothing is waiting for payment.")));
  await shot("db-home-empty");

  // ---- settings: companies ----
  await goto("/settings");
  await ready("section button");
  record("settings shows the empty company state", await waitFor(hasText("No companies yet")));
  for (const name of ["Test Company One", "Second Co"]) {
    await clickText("Add company");
    await waitFor("document.getElementById('co-name')");
    await setInput("#co-name", name);
    await setInput("#co-address", "12 Test Street\nGoa 403001");
    await setInput("#co-reg", "REG 123");
    await submitForm("company-form");
    await panelGone();
    record(`add company "${name}"`, await waitFor(hasText(name)));
  }
  record("initials are suggested from the name", await waitFor(hasText("TC")));
  await shot("db-settings");

  // ---- clients ----
  await goto("/clients");
  await ready("button");
  record("clients shows its empty state", await waitFor(hasText("No clients yet")));
  await clickText("Add client");
  await waitFor("document.getElementById('cl-name')");
  await setInput("#cl-name", "Alpha Events");
  await setInput("#cl-address", "4 Beach Road, Panaji");
  await setInput("#cl-tags", "Weddings, Repeat");
  await setInput("#cl-cname", "Asha Rao");
  await setInput("#cl-cphone", "+91 98111 22334");
  await submitForm("client-form");
  record("add client opens its panel", await waitFor("document.querySelector('aside[data-panel][aria-label=\"Alpha Events\"]')"));
  record("client appears in the table", await waitFor("document.querySelector('tbody')?.innerText.includes('Alpha Events')"));

  await setInput("#note", "Call about December block");
  await setInput("#followUp", TODAY);
  await clickText("Add note");
  record("note with follow-up appears on the timeline", await waitFor("document.querySelector('aside[data-panel] ol')?.innerText.includes('Call about December block')"));
  await shot("db-client-panel");

  await clickText("Add client");
  await waitFor("document.getElementById('cl-name')?.value === ''");
  await setInput("#cl-name", "Beta Travel");
  await setInput("#cl-type", "agent");
  await setInput("#cl-cphone", "98111 22334");
  await submitForm("client-form");
  record("duplicate phone number is refused", await waitFor(hasText("already has this phone number or email")));
  await setInput("#cl-cphone", "+91 90000 11111");
  await submitForm("client-form");
  record("second client saves once the phone differs", await waitFor("document.querySelector('aside[data-panel][aria-label=\"Beta Travel\"]')"));

  // ---- inventory ----
  await goto("/inventory");
  await ready("button");
  record("inventory shows its empty state", await waitFor(hasText("No rooms yet")));
  await clickText("Add rooms");
  await waitFor("document.getElementById('st-hotel')");
  await setInput("#st-hotel", "Test Hotel");
  await setInput("#st-city", "Goa");
  await setInput("#st-room", "Deluxe");
  await setInput("#st-held", "3");
  await setInput("#st-sell", "5000");
  await setInput("#st-cost", "3800");
  await submitForm("stock-form");
  await panelGone();
  record("add rooms shows the room in the grid", await waitFor("document.querySelector('tbody')?.innerText.includes('Deluxe')"));
  record("grid shows 3 rooms left tonight", (await firstCell()) === "3", await firstCell());
  await shot("db-inventory");

  // ---- bill: draft, finalise, number ----
  await goto("/bill-generator");
  await ready("#company");
  await selectByText("#company", "Test Company One");
  record("changing company swaps the letterhead", await waitFor("document.querySelector('article').innerText.includes('Test Company One')"));
  await selectByText("#client", "Alpha Events");
  await clickText("Room from inventory");
  await waitFor("document.querySelector('#line-1-room')");
  await selectByText("#line-1-room", "Deluxe, Test Hotel, Goa");
  record("room line shows what is left", await waitFor(hasText("3 of 3 left for these nights.")));
  record("rate is filled from the inventory price", await waitFor("document.querySelector('#line-1-rate').value === '5000'"), await evaluate("document.querySelector('#line-1-rate').value"));
  await setInput("#line-1-qty", "2");
  await setInput("#line-1-nights", "2");
  await setInput("#tax", "5");
  record("total is 2 rooms x 2 nights x 5,000 plus 5%", await waitFor(hasText("₹21,000")));
  await shot("db-generator");

  await clickText("Save draft");
  await waitFor("location.search.includes('bill=')");
  record("save draft keeps the bill and reloads it", (await waitFor(hasText("Edit draft"))) && (await waitFor("document.querySelector('#line-1-qty')?.value === '2'")));

  await ready("#company");
  await clickText("Finalise");
  await clickText("Yes, finalise");
  await waitFor("location.pathname.startsWith('/bills/')");
  await waitFor("/\\d{4}$/.test(document.querySelector('h1')?.textContent.trim() ?? '')");
  const number1 = await evaluate("document.querySelector('h1').textContent.trim()");
  record("finalised bill gets the first number in its series", /^TC\/\d\d-\d\d\/0001$/.test(number1), number1);
  const firstBillPath = await pathname();
  record("new bill shows as unpaid", await waitFor(hasText("Unpaid")));

  await ready("button");
  await clickText("Record payment");
  await waitFor("document.getElementById('pay-amount')");
  await setInput("#pay-amount", "10000");
  await setInput("#pay-ref", "UTR 778899");
  await submitForm("payment-form");
  await panelGone();
  record("part payment changes the status", await waitFor(hasText("Part paid")));
  record("outstanding drops to 11,000", await waitFor(hasText("₹11,000")));
  await shot("db-bill");

  await goto("/inventory");
  record("finalising took 2 rooms out of inventory", (await firstCell()) === "1", await firstCell());

  // ---- overselling is refused; a quotation is not ----
  await goto("/bill-generator");
  await ready("#company");
  await selectByText("#company", "Test Company One");
  await selectByText("#client", "Beta Travel");
  await clickText("Room from inventory");
  await waitFor("document.querySelector('[id$=\"-room\"]')");
  const roomSel = await evaluate("'#' + document.querySelector('[id$=\"-room\"]').id");
  const qtySel = roomSel.replace("-room", "-qty");
  await selectByText(roomSel, "Deluxe, Test Hotel, Goa");
  await waitFor(hasText("1 of 3 left for these nights."));
  await setInput(qtySel, "2");
  record("generator warns when asking for more than is left", await waitFor(hasText("Only 1 left for these nights.")));
  await clickText("Finalise");
  await clickText("Yes, finalise");
  record("finalising an oversell is refused", (await waitFor(hasText("Only 1 left for Deluxe, Test Hotel, Goa"))) && (await pathname()) === "/bill-generator");

  await selectByText("#format", "Quotation");
  await clickText("Finalise");
  await clickText("Yes, finalise");
  await waitFor("location.pathname.startsWith('/bills/')");
  await waitFor("/\\d{4}$/.test(document.querySelector('h1')?.textContent.trim() ?? '')");
  const number2 = await evaluate("document.querySelector('h1').textContent.trim()");
  record("quotation gets its own number series", /^TC\/Q\/\d\d-\d\d\/0001$/.test(number2), number2);

  await goto("/inventory");
  record("quotation did not take rooms", (await firstCell()) === "1", await firstCell());

  // ---- quotation to bill draft, then delete the draft ----
  await send("Page.navigate", { url: BASE + "/bills" });
  await sleep(1200);
  await ready("tbody a");
  record("bills list shows both documents", (await waitFor(hasText(number1))) && (await waitFor(hasText(number2))));
  await shot("db-bills");
  await evaluate(`[...document.querySelectorAll("tbody a")].find((a) => a.textContent.includes(${q(number2)})).click()`);
  await waitFor("location.pathname.startsWith('/bills/')");
  await ready("button");
  await clickText("Make a bill from this");
  await waitFor("location.pathname === '/bill-generator' && location.search.includes('bill=')");
  record("quotation can be turned into a bill draft", await waitFor(hasText("Edit draft")));
  await ready("#company");
  await clickText("Delete draft");
  record("draft can be deleted", await waitFor("location.pathname === '/bill-generator' && !location.search.includes('bill=')"));

  // ---- cancel puts rooms back ----
  await goto(firstBillPath);
  await ready("button");
  await clickText("Cancel bill");
  await clickText("Yes, cancel it");
  record("bill can be cancelled", await waitFor(hasText("Cancelled")));
  await goto("/inventory");
  record("cancelling put the rooms back", (await firstCell()) === "3", await firstCell());

  // ---- stop sale ----
  await ready("tbody button");
  await evaluate("document.querySelector('tbody button').click()");
  await waitFor("document.getElementById('ss-first')");
  await setInput("#ss-first", TODAY);
  await clickText("Stop");
  record("stop sale shows in the grid", await waitFor("document.querySelector('tbody tr:nth-child(2) td')?.textContent.trim() === 'Stop'"));

  // ---- clients and home reflect all of it ----
  await goto("/clients");
  record("client shows the payment as an advance after the cancel", await waitFor(hasText("Advance ₹10,000")));
  await goto("/");
  record("home lists the follow-up", await waitFor(hasText("Call about December block")));
  await shot("db-home");
  await ready("li button");
  await clickText("Done");
  record("marking a follow-up done removes it from home", await waitFor(`!${hasText("Call about December block")}`));
} catch (error) {
  record(`script error: ${error.message}`, false);
  try {
    await shot("db-error");
  } catch {}
} finally {
  try {
    ws?.close();
  } catch {}
  edge.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
