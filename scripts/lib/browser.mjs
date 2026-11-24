// A headless Edge driven over its debugging port, for the browser tests.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { inflateRawSync } from "node:zlib";

const j = (v) => JSON.stringify(v);

export class Browser {
  constructor({ edge, out, base, name, port }) {
    Object.assign(this, { edge, out, base, name, port, seq: 0, pending: new Map() });
  }
  async start() {
    this.proc = spawn(this.edge, ["--headless=new", `--remote-debugging-port=${this.port}`, `--user-data-dir=${this.out}\\${this.name}-${Date.now()}`, "--window-size=1440,1000", "--disable-gpu", "about:blank"], { stdio: "ignore" });
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
    await this.send("Page.navigate", { url: this.base + path });
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
  async clickSel(selector) {
    await this.ready(selector);
    return this.eval(`document.querySelector(${j(selector)}).click()`);
  }
  submit(formId) {
    return this.eval(`document.getElementById(${j(formId)}).requestSubmit()`);
  }
  async upload(selector, path) {
    const { root } = await this.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    await this.send("DOM.setFileInputFiles", { nodeId, files: [path] });
  }
  /** Fetches a file with this browser's sign-in. */
  async fetchFile(path) {
    const got = await this.eval(`fetch(${j(path)}).then(async (r) => {
      const bytes = new Uint8Array(await r.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { status: r.status, type: r.headers.get("content-type"), disposition: r.headers.get("content-disposition"), b64: btoa(s) };
    })`);
    return { ...got, bytes: Buffer.from(got.b64, "base64") };
  }
  async signIn(email, password) {
    await this.goto("/login");
    await this.ready("form");
    await this.eval(`document.getElementById("email").value = ${j(email)}; document.getElementById("password").value = ${j(password)}; document.querySelector("form").requestSubmit()`);
    if (!(await this.waitFor("location.pathname === '/'"))) throw new Error(`${this.name}: could not sign in`);
  }
  async shot(name, full = false) {
    const params = { format: "png" };
    if (full) {
      const { contentSize } = await this.send("Page.getLayoutMetrics");
      params.clip = { x: 0, y: 0, width: contentSize.width, height: Math.min(contentSize.height, 6000), scale: 1 };
      params.captureBeyondViewport = true;
    }
    const r = await this.send("Page.captureScreenshot", params);
    writeFileSync(`${this.out}\\${name}.png`, Buffer.from(r.data, "base64"));
  }
  stop() {
    try {
      this.ws?.close();
    } catch {}
    this.proc?.kill();
  }
}

/** The text of every w:t in a .docx, joined, read without any library. */
export function docxText(bytes) {
  const view = bytes;
  let end = -1;
  for (let i = view.length - 22; i >= 0; i--) {
    if (view.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return "";
  const count = view.readUInt16LE(end + 10);
  let at = view.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    const method = view.readUInt16LE(at + 10);
    const size = view.readUInt32LE(at + 20);
    const nameLen = view.readUInt16LE(at + 28);
    const extraLen = view.readUInt16LE(at + 30);
    const commentLen = view.readUInt16LE(at + 32);
    const offset = view.readUInt32LE(at + 42);
    const name = view.subarray(at + 46, at + 46 + nameLen).toString();
    if (name === "word/document.xml") {
      const lnl = view.readUInt16LE(offset + 26);
      const lel = view.readUInt16LE(offset + 28);
      const data = view.subarray(offset + 30 + lnl + lel, offset + 30 + lnl + lel + size);
      const xml = (method === 8 ? inflateRawSync(data) : data).toString("utf8");
      return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return "";
}
