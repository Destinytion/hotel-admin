// Tests "Sign in with Zoho" end to end against a stand-in Zoho server that
// this script runs itself. It speaks the same sign-in protocol as Zoho
// (OpenID Connect), so everything on the app's side is exercised for real.
// What it cannot prove is how the real Zoho behaves; that needs real credentials.
//
// Run against a throwaway database that has one login, owner@example.com,
// with the app started in production mode and:
//   ZOHO_CLIENT_ID=test-client  ZOHO_CLIENT_SECRET=test-secret  ZOHO_ACCOUNTS_URL=http://localhost:3200
//
//   DATABASE_URL=...hotel_admin_test  node scripts/zoho-test.mjs <edge.exe> <shots-dir> <base-url>

import { spawn } from "node:child_process";
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

const [EDGE, OUT, BASE] = process.argv.slice(2);
const MOCK_PORT = 3200;
const ISSUER = `http://localhost:${MOCK_PORT}`;

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

// ---------------------------------------------------------------------------
// The stand-in Zoho. `mock.person` is who "signs in" next.
// ---------------------------------------------------------------------------

const realKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const forgedKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const signToken = (claims, key) => {
  const body = `${b64({ alg: "RS256", typ: "JWT", kid: "test-key" })}.${b64(claims)}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(key.privateKey).toString("base64url")}`;
};

const mock = {
  person: null,
  forge: false,
  lastAuthRequest: null,
  lastTokenRequest: null,
  /** How many sign-ins actually reached the stand-in Zoho. */
  authRequests: 0,
  codes: new Map(),
};

const zoho = createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);
  const json = (status, data) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };

  if (url.pathname === "/.well-known/openid-configuration") {
    return json(200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/v2/auth`,
      token_endpoint: `${ISSUER}/oauth/v2/token`,
      userinfo_endpoint: `${ISSUER}/oauth/v2/userinfo`,
      jwks_uri: `${ISSUER}/oauth/v2/keys`,
      scopes_supported: ["email", "profile", "openid"],
      response_types_supported: ["code"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    });
  }
  if (url.pathname === "/oauth/v2/keys") {
    return json(200, { keys: [{ ...realKey.publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" }] });
  }
  if (url.pathname === "/oauth/v2/auth") {
    // The real Zoho shows its own sign-in page here. The stand-in approves at once.
    mock.lastAuthRequest = Object.fromEntries(url.searchParams);
    mock.authRequests++;
    const code = randomBytes(12).toString("hex");
    mock.codes.set(code, { person: mock.person, nonce: url.searchParams.get("nonce"), clientId: url.searchParams.get("client_id"), forge: mock.forge });
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", url.searchParams.get("state"));
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (url.pathname === "/oauth/v2/token" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const form = Object.fromEntries(new URLSearchParams(raw));
    mock.lastTokenRequest = form;
    const grant = mock.codes.get(form.code);
    if (!grant) return json(400, { error: "invalid_code" });
    mock.codes.delete(form.code);
    const now = Math.floor(Date.now() / 1000);
    const idToken = signToken(
      { iss: ISSUER, aud: grant.clientId, sub: grant.person.sub, email: grant.person.email, email_verified: grant.person.email_verified, name: grant.person.name, nonce: grant.nonce ?? undefined, iat: now, exp: now + 600 },
      grant.forge ? forgedKey : realKey,
    );
    return json(200, { access_token: `access-${form.code}`, token_type: "Bearer", expires_in: 3600, id_token: idToken });
  }
  if (url.pathname === "/oauth/v2/userinfo") {
    return json(200, mock.person ?? {});
  }
  json(404, { error: "not_found" });
});
await new Promise((resolve) => zoho.listen(MOCK_PORT, "127.0.0.1", resolve));

// ---------------------------------------------------------------------------
// Browser driver
// ---------------------------------------------------------------------------

class Browser {
  constructor(name, port) {
    this.name = name;
    this.port = port;
    this.seq = 0;
    this.pending = new Map();
  }
  async start() {
    this.proc = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${this.port}`, `--user-data-dir=${OUT}\\zo-${this.name}-${Date.now()}`, "--window-size=1440,900", "--disable-gpu", "about:blank"], { stdio: "ignore" });
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
  setInput(selector, value) {
    return this.eval(`(() => { const el = document.querySelector(${j(selector)}); if (!el) throw new Error("missing " + ${j(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${j(String(value))}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
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
  async passwordSignIn(email, password) {
    await this.goto("/login");
    await this.waitFor(`(() => { const f = document.querySelector("form"); return f && Object.keys(f).some((k) => k.startsWith("__reactProps")); })()`);
    await this.eval(`document.getElementById("email").value = ${j(email)}; document.getElementById("password").value = ${j(password)}; document.querySelector("form").requestSubmit()`);
  }
  /** Opens the app as the given Zoho person and presses "Sign in with Zoho". */
  async zohoSignIn(person, { forge = false, via = "/login" } = {}) {
    mock.person = person;
    mock.forge = forge;
    await this.goto(via);
    await this.waitFor("location.pathname === '/login'");
    await this.click("Sign in with Zoho");
    await sleep(1500);
    await this.waitFor("document.readyState === 'complete' && (location.pathname === '/' || location.pathname === '/login') && !location.host.includes('3200')", 30000);
    await sleep(800);
    return this.path();
  }
  async signOut() {
    const button = `document.querySelector('aside button[aria-label="Sign out"]')`;
    await this.waitFor(`(() => { const el = ${button}; return el && Object.keys(el).some((k) => k.startsWith("__reactProps")); })()`);
    await this.eval(`${button}.click()`);
    await this.waitFor("location.pathname === '/login'");
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

const owner = new Browser("owner", 9371);
const visitor = new Browser("visitor", 9372);
const INVITED = { sub: "zoho-1001", email: "person@agency.example", email_verified: true, name: "Name Held By Zoho" };
const STRANGER = { sub: "zoho-2002", email: "stranger@elsewhere.example", email_verified: true, name: "A Stranger" };
const UNVERIFIED = { sub: "zoho-3003", email: "unverified@agency.example", email_verified: false, name: "Not Verified" };
const users = async () => (await one("select count(*)::int as n from users")).n;
const sessionsFor = async (email) => (await one("select count(*)::int as n from sessions s join users u on u.id = s.user_id where u.email = $1", [email])).n;

async function addPerson(name, email) {
  await owner.click("Add person");
  await owner.waitFor("document.getElementById('pp-name')?.value === ''");
  await owner.setInput("#pp-name", name);
  await owner.setInput("#pp-email", email);
  await owner.submit("#people-form");
}

try {
  await Promise.all([owner.start(), visitor.start()]);

  // =====================================================================
  section("Inviting someone by email, with no password");
  await owner.passwordSignIn("owner@example.com", "owner-pass-12345");
  await owner.waitFor("location.pathname === '/'");
  record("the owner can still sign in with a password", (await owner.path()) === "/");
  await owner.goto("/settings");
  await owner.waitFor("document.querySelector('[data-people] li')");
  await addPerson("Zoho Person", INVITED.email);
  record("a person can be added by email alone", (await owner.sees("Zoho Person can now sign in with Zoho.")) && (await one("select count(*)::int as n from accounts a join users u on u.id = a.user_id where u.email = $1", [INVITED.email])).n === 0);
  await owner.shot("zo-add-person");

  // =====================================================================
  section("Signing in with Zoho as an invited person");
  const before = await users();
  const landed = await visitor.zohoSignIn(INVITED, { via: "/" });
  record(
    "opening the app and pressing Sign in with Zoho comes back signed in",
    landed === "/" && (await sessionsFor(INVITED.email)) === 1 && mock.authRequests === 1,
    `landed on ${landed}`,
  );
  record("they appear under the name set in Settings, not whatever Zoho holds", await visitor.sees("Zoho Person"));
  const linked = await one("select a.provider_id, a.account_id from accounts a join users u on u.id = a.user_id where u.email = $1", [INVITED.email]);
  record("their Zoho identity is tied to the login that was added, and no extra person is created", linked?.provider_id === "zoho" && linked?.account_id === INVITED.sub && (await users()) === before, `${await users()} logins`);

  const ask = mock.lastAuthRequest;
  record(
    "the request sent to Zoho is well formed",
    ask.client_id === "test-client" && ask.redirect_uri === `${BASE}/api/auth/callback/zoho` && ["openid", "email", "profile"].every((s) => ask.scope.split(/[ +]/).includes(s)) && Boolean(ask.state) && Boolean(ask.nonce) && Boolean(ask.code_challenge),
    `redirect ${ask.redirect_uri}, scope "${ask.scope}"`,
  );
  record("the secret goes to Zoho's server directly, never through the browser", mock.lastTokenRequest?.client_secret === "test-secret" && Boolean(mock.lastTokenRequest?.code_verifier) && !JSON.stringify(ask).includes("test-secret"));

  await visitor.signOut();
  await sleep(3000);
  record(
    "after signing out, the app stays signed out instead of bouncing back in through Zoho",
    (await visitor.path()) === "/login" && (await visitor.sees("You are signed out.")) && (await sessionsFor(INVITED.email)) === 0 && mock.authRequests === 1,
    `${mock.authRequests} trip(s) to Zoho so far`,
  );
  await visitor.shot("zo-signed-out");
  await visitor.click("Sign in with Zoho");
  await visitor.waitFor("location.pathname === '/'", 30000);
  record("the Sign in with Zoho button on that page signs back in", (await visitor.path()) === "/" && mock.authRequests === 2);
  await visitor.signOut();

  const beforePassword = mock.authRequests;
  await visitor.goto("/");
  await sleep(2500);
  record(
    "opening the app shows the password form and does not leave for Zoho on its own",
    (await visitor.path()) === "/login" && (await visitor.eval("Boolean(document.getElementById('password'))")) && mock.authRequests === beforePassword,
  );

  // =====================================================================
  section("People who should not get in");
  // Each refusal below must happen after Zoho was actually asked, so a block
  // somewhere earlier (such as a rate limit) cannot pass for the real check.
  let reached = false;
  const attempt = async (person, options) => {
    const asked = mock.authRequests;
    const landed = await visitor.zohoSignIn(person, options);
    reached = mock.authRequests === asked + 1;
    return landed;
  };
  const reachedZoho = () => reached;
  const alert = () => visitor.eval("[...document.querySelectorAll('[role=alert]')].map((e) => e.innerText).join(' | ')");

  const strangerLanded = await attempt(STRANGER);
  record("a Zoho account that was never added is refused", reachedZoho() && strangerLanded === "/login" && (await visitor.sees("not on the list of people who can use this app")) && (await users()) === before, strangerLanded);
  await visitor.shot("zo-refused");
  const afterRefusal = mock.authRequests;
  await sleep(4000);
  record("a refusal stays on the page with the reason, and does not loop back to Zoho", mock.authRequests === afterRefusal && (await visitor.path()) === "/login");
  record("and gets no session", (await one("select count(*)::int as n from sessions s join users u on u.id = s.user_id where u.email = $1", [STRANGER.email])).n === 0);
  await visitor.goto("/clients");
  record("so the app stays closed to them", (await visitor.path()) === "/login");

  await addPerson("Unverified Person", UNVERIFIED.email);
  await owner.sees("Unverified Person can now sign in with Zoho.");
  const unverifiedLanded = await attempt(UNVERIFIED);
  record(
    "an address Zoho has not verified is refused, even if it was added",
    reachedZoho() && unverifiedLanded === "/login" && (await visitor.sees("Zoho has not verified that email address")) && (await sessionsFor(UNVERIFIED.email)) === 0,
    `${unverifiedLanded}: ${await alert()}`,
  );

  const forgedLanded = await attempt({ ...INVITED, sub: "zoho-forged" }, { forge: true });
  record(
    "an identity not signed by Zoho's own key is refused",
    reachedZoho() && forgedLanded === "/login" && (await visitor.sees("Sign-in with Zoho did not work")) && (await sessionsFor(INVITED.email)) === 0,
    `${forgedLanded}: ${await alert()}`,
  );
  record("several Zoho sign-ins in a row are not mistaken for password guessing", mock.authRequests >= 5, `${mock.authRequests} reached Zoho`);

  // =====================================================================
  section("Passwords alongside Zoho");
  await visitor.passwordSignIn(INVITED.email, "guess-a-password-1");
  record("a Zoho-only person has no password to guess", (await visitor.sees("The email or password is not right.")) && (await visitor.path()) === "/login");

  await owner.goto("/settings");
  await owner.waitFor("document.querySelector('[data-people] li')");
  const row = `[...document.querySelectorAll('[data-people] li')].find((li) => li.innerText.includes("Zoho Person"))`;
  await owner.click("Reset password", row);
  await owner.waitFor("document.getElementById('pp-password')");
  await owner.setInput("#pp-password", "backup-pass-13579");
  await owner.submit("#people-form");
  await owner.sees("Zoho Person has a new password");
  await visitor.passwordSignIn(INVITED.email, "backup-pass-13579");
  await visitor.waitFor("location.pathname === '/'");
  record("an owner can give them a backup password, and it works", (await visitor.path()) === "/");
  await visitor.signOut();
  record("Zoho sign-in still works for them afterwards", (await visitor.zohoSignIn(INVITED)) === "/");

  await owner.goto("/activity");
  await owner.waitFor("document.querySelector('[data-activity] li')");
  record("adding a Zoho person is on the Activity screen", await owner.sees("added a login for Zoho Person, with Zoho sign-in"));
} catch (error) {
  record(`script error: ${error.message}`, false);
  for (const b of [owner, visitor]) {
    try {
      await b.shot(`zo-error-${b.name}`);
    } catch {}
  }
} finally {
  owner.stop();
  visitor.stop();
  zoho.close();
  await db.end();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
