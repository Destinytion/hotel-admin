// Tests who can get in: the setup code, adding and removing people, passwords,
// and the refresh going quiet on an idle tab.
//
// Run it against a throwaway database with NO logins, with the app started in
// production mode and SETUP_CODE set:
//   DATABASE_URL=...hotel_admin_test  node scripts/access-test.mjs <edge.exe> <shots-dir> <base-url> <setup-code>

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

const [EDGE, OUT, BASE, SETUP_CODE] = process.argv.slice(2);

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
const j = (v) => JSON.stringify(v);

class Browser {
  constructor(name, port) {
    this.name = name;
    this.port = port;
    this.seq = 0;
    this.pending = new Map();
  }

  async start() {
    this.proc = spawn(
      EDGE,
      ["--headless=new", `--remote-debugging-port=${this.port}`, `--user-data-dir=${OUT}\\ac-${this.name}-${Date.now()}`, "--window-size=1440,900", "--disable-gpu", "about:blank"],
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
    await this.send("Page.navigate", { url: BASE + path });
    await sleep(400);
    await this.waitFor("document.readyState === 'complete'");
    await sleep(900);
  }

  path() {
    return this.eval("location.pathname");
  }

  sees(text, ms) {
    return this.waitFor(`document.body.innerText.includes(${j(text)})`, ms);
  }

  ready(selector) {
    return this.waitFor(`(() => { const el = document.querySelector(${j(selector)}); return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`);
  }

  setInput(selector, value) {
    return this.eval(`(() => {
      const el = document.querySelector(${j(selector)});
      if (!el) throw new Error("missing " + ${j(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${j(String(value))});
      el.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
  }

  async click(text, within = "document") {
    const find = `[...${within}.querySelectorAll("button, a")].find((b) => b.textContent.trim() === ${j(text)} && !b.disabled)`;
    const there = await this.waitFor(`(() => { const el = ${find}; return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`);
    if (!there) throw new Error(`${this.name}: no button or link "${text}"`);
    await this.eval(`(${find}).click()`);
  }

  submit(formSelector) {
    return this.eval(`document.querySelector(${j(formSelector)}).requestSubmit()`);
  }

  alertText() {
    return this.eval(`[...document.querySelectorAll('[role=alert]')].map((e) => e.innerText).join(' | ')`);
  }

  /** Fills the login page and submits. Does not wait for the result. */
  async signIn(email, password) {
    await this.goto("/login");
    await this.ready("form");
    await this.eval(`document.getElementById("email").value = ${j(email)}; document.getElementById("password").value = ${j(password)}; document.querySelector("form").requestSubmit()`);
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

const owner = new Browser("owner", 9351);
const second = new Browser("second", 9352);
const OWNER = { name: "Owner One", email: "owner@example.com", password: "owner-pass-12345" };
const SECOND = { name: "Second Owner", email: "second@example.com" };
const row = (name) => `[...document.querySelectorAll('[data-people] li')].find((li) => li.innerText.includes(${j(name)}))`;

try {
  await Promise.all([owner.start(), second.start()]);

  // =====================================================================
  section("First login on a hosted install needs the setup code");
  await owner.goto("/");
  await owner.waitFor("location.pathname === '/setup'");
  record("a new install sends the first visitor to setup", (await owner.path()) === "/setup");
  await owner.ready("form");
  record("the setup page asks for a setup code", await owner.waitFor("document.getElementById('code')"));

  const fill = async (code) => {
    await owner.eval(`(() => { const v = ${j({ name: OWNER.name, email: OWNER.email, password: OWNER.password, confirm: OWNER.password })}; for (const [id, value] of Object.entries(v)) document.getElementById(id).value = value; document.getElementById("code").value = ${j(code)}; document.querySelector("form").requestSubmit(); })()`);
  };
  await fill("definitely-the-wrong-code");
  const refused = await owner.sees("That setup code is not right.");
  record("a wrong setup code is refused and no login is created", refused && (await one("select count(*)::int as n from users")).n === 0);
  await owner.shot("ac-setup-code");

  await owner.waitFor("document.getElementById('code')");
  await fill(SETUP_CODE);
  await owner.waitFor("location.pathname === '/'");
  record("the right setup code creates the first login and signs in", (await owner.path()) === "/" && (await one("select count(*)::int as n from users")).n === 1);
  await owner.goto("/setup");
  await owner.waitFor("location.pathname !== '/setup'");
  record("setup is closed once a login exists", (await owner.path()) !== "/setup", await owner.path());

  // =====================================================================
  section("Adding a person from Settings");
  await owner.goto("/settings");
  await owner.waitFor("document.querySelector('[data-people] li')");
  record("your own row offers Change my password, not Remove", await owner.eval(`(() => { const li = ${row(OWNER.name)}; return li.innerText.includes("Change my password") && !li.innerText.includes("Remove"); })()`));

  await owner.click("Add person");
  await owner.waitFor("document.getElementById('pp-name')");
  await owner.setInput("#pp-name", SECOND.name);
  await owner.setInput("#pp-email", SECOND.email);
  await owner.setInput("#pp-password", "short");
  await owner.submit("#people-form");
  record("a short password is refused", await owner.sees("Use a password of at least 10 characters."));
  await owner.setInput("#pp-password", "second-pass-12345");
  await owner.submit("#people-form");
  record("the new person appears in the list", (await owner.sees("Second Owner can now sign in with that password.")) && (await owner.waitFor(row(SECOND.name))));
  await owner.shot("ac-people");

  await owner.click("Add person");
  await owner.waitFor("document.getElementById('pp-name')");
  await owner.setInput("#pp-name", "Copy Cat");
  await owner.setInput("#pp-email", SECOND.email.toUpperCase());
  await owner.setInput("#pp-password", "another-pass-12345");
  await owner.submit("#people-form");
  record("the same email cannot be added twice", (await owner.sees("already has a login.")) && (await one("select count(*)::int as n from users")).n === 2);
  await owner.click("Cancel");

  await second.signIn(SECOND.email, "second-pass-12345");
  await second.waitFor("location.pathname === '/'");
  record("the new person can sign in", (await second.path()) === "/" && (await second.sees(SECOND.name)));

  // =====================================================================
  section("Resetting someone's password");
  await owner.click("Reset password", row(SECOND.name));
  await owner.waitFor("document.getElementById('pp-password')");
  await owner.setInput("#pp-password", "reset-pass-67890");
  await owner.submit("#people-form");
  record("the owner sees it worked", await owner.sees("Second Owner has a new password and has been signed out."));
  await second.goto("/clients");
  await second.waitFor("location.pathname === '/login'");
  record("the other person is signed out straight away", (await second.path()) === "/login");
  await second.signIn(SECOND.email, "second-pass-12345");
  record("their old password no longer works", (await second.sees("The email or password is not right.")) && (await second.path()) === "/login");
  await second.signIn(SECOND.email, "reset-pass-67890");
  await second.waitFor("location.pathname === '/'");
  record("the new password works", (await second.path()) === "/");

  // =====================================================================
  section("Changing your own password");
  await second.goto("/settings");
  await second.waitFor("document.querySelector('[data-people] li')");
  await second.click("Change my password");
  await second.waitFor("document.getElementById('pp-current')");
  await second.setInput("#pp-current", "not-my-password-000");
  await second.setInput("#pp-password", "my-own-pass-24680");
  await second.submit("#people-form");
  record("a wrong current password is refused", await second.sees("Your current password is not right."));
  await second.setInput("#pp-current", "reset-pass-67890");
  await second.submit("#people-form");
  record("the right current password changes it", await second.sees("Your password is changed."));
  await second.eval(`document.querySelector('aside button[aria-label="Sign out"]').click()`);
  await second.waitFor("location.pathname === '/login'");
  await second.signIn(SECOND.email, "my-own-pass-24680");
  await second.waitFor("location.pathname === '/'");
  record("they can sign in with the password they chose", (await second.path()) === "/");
  const stored = (await one("select password from accounts a join users u on u.id = a.user_id where u.email = $1", [SECOND.email])).password;
  record("passwords are stored scrambled, never as typed", !stored.includes("my-own-pass-24680") && stored.length > 40);

  // =====================================================================
  section("Removing a person");
  await owner.goto("/settings");
  await owner.waitFor(row(SECOND.name));
  await owner.click("Remove", row(SECOND.name));
  await owner.click("Yes, remove", row(SECOND.name));
  record("the owner sees they are gone", (await owner.sees("Second Owner no longer has a login.")) && (await one("select count(*)::int as n from users")).n === 1);
  await second.goto("/bills");
  await second.waitFor("location.pathname === '/login'");
  record("the removed person is signed out", (await second.path()) === "/login");
  await second.signIn(SECOND.email, "my-own-pass-24680");
  record("and can no longer sign in", (await second.sees("The email or password is not right.")) && (await second.path()) === "/login");

  await owner.goto("/activity");
  await owner.waitFor("document.querySelector('[data-activity] li')");
  const activity = await owner.eval("document.querySelector('[data-activity]').innerText");
  record(
    "every one of these changes is on the Activity screen with a name",
    /Owner One added a login for Second Owner/.test(activity) && /Owner One reset the password for Second Owner/.test(activity) && /Owner One removed the login for Second Owner/.test(activity) && /Second Owner changed their own password|Someone changed their own password/.test(activity),
  );

  // =====================================================================
  section("The refresh goes quiet on an idle tab");
  await owner.goto("/clients");
  await owner.ready("button");
  const refreshes = () => owner.eval("performance.getEntriesByType('resource').filter((e) => e.name.includes('_rsc')).length");
  const start = await refreshes();
  await owner.eval("window.dispatchEvent(new PointerEvent('pointermove'))");
  await sleep(35000);
  const whileActive = await refreshes();
  record("while someone is using the tab, it refreshes on its own", whileActive > start, `${whileActive - start} requests in 35 seconds`);
  // Two or three refreshes fit in 35 seconds. More means something is fetching in the background again.
  record("each refresh is one request, not a burst", whileActive - start <= 4, `${whileActive - start} requests in 35 seconds`);

  // Move this tab's clock 11 minutes on, as if nobody had touched it for that long.
  await owner.eval("(() => { const real = Date.now.bind(Date); Date.now = () => real() + 11 * 60 * 1000; })()");
  const atIdle = await refreshes();
  await sleep(35000);
  const afterIdle = await refreshes();
  record("after 10 minutes without anyone touching it, the refreshing stops", afterIdle === atIdle, `${afterIdle - atIdle} refreshes in 35 idle seconds`);
  await owner.eval("window.dispatchEvent(new PointerEvent('pointerdown'))");
  record("it catches up the moment the person comes back", await owner.waitFor(`performance.getEntriesByType('resource').filter((e) => e.name.includes('_rsc')).length > ${afterIdle}`, 10000));

  // =====================================================================
  section("What the server sends to every visitor");
  const login = await fetch(`${BASE}/login`);
  record(
    "security headers are set",
    login.headers.get("x-frame-options") === "DENY" && login.headers.get("x-content-type-options") === "nosniff" && (login.headers.get("strict-transport-security") ?? "").includes("max-age"),
    `x-frame-options ${login.headers.get("x-frame-options")}`,
  );
  const loginPage = await login.text();
  record("with Zoho not set up, the login page still has the password form", loginPage.includes('name="password"'));
  // The Zoho button is shown even before Zoho is set up. Pressing it must explain, not leave the page.
  await second.goto("/login");
  await second.click("Sign in with Zoho");
  await sleep(1500);
  record(
    "the Zoho button is there before Zoho is set up, and says what is missing instead of going anywhere",
    (await second.sees("Zoho sign-in is not switched on yet.")) && (await second.path()) === "/login",
  );
  await second.shot("ac-zoho-not-set-up");
  const robots = await fetch(`${BASE}/robots.txt`);
  record("search engines are told not to list the app", robots.status === 200 && (await robots.text()).includes("Disallow: /"));
  const guarded = await fetch(`${BASE}/clients`, { redirect: "manual" });
  record("a page asked for without signing in is redirected to login", guarded.status === 307 && (guarded.headers.get("location") ?? "").endsWith("/login"), `${guarded.status}`);
} catch (error) {
  record(`script error: ${error.message}`, false);
  for (const b of [owner, second]) {
    try {
      await b.shot(`ac-error-${b.name}`);
    } catch {}
  }
} finally {
  owner.stop();
  second.stop();
  await db.end();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
