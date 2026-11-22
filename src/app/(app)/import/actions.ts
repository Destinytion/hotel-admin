"use server";

import { refresh } from "next/cache";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { addDays } from "@/lib/format";
import { IMPORT_MAX_ROWS, type ImportKind } from "@/lib/import-fields";
import { run, text, UserError } from "@/lib/result";
import { parseAmount, parseDate, parseDelimited, type DateOrder } from "@/lib/sheet";
import { logActivity } from "@/server/activity";
import type { Executor } from "@/server/availability";
import { addBlock, checkBlock, type CheckedBlock } from "@/server/stock";

/** One row of the sheet, by field, as text. */
export type ImportRow = Record<string, string>;

export type RowResult = {
  status: "new" | "skip" | "error";
  /** Why a row is skipped or cannot be imported. */
  message: string;
};

/*
  Fetches a Google Sheet as CSV. The sheet must be shared as "anyone with the
  link can view": the app has no Google login of its own. Only Google's own
  address is ever fetched.
*/
export async function fetchGoogleSheet(link: string) {
  return run(async () => {
    await requireUser();
    let url: URL;
    try {
      url = new URL(String(link ?? "").trim());
    } catch {
      throw new UserError("Paste the link from the address bar of the Google Sheet.");
    }
    const id = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/)?.[1];
    if (url.hostname !== "docs.google.com" || !id) {
      throw new UserError("That is not a Google Sheets link. It should start with docs.google.com/spreadsheets.");
    }
    // The tab open when the link was copied, if the link says.
    const gid = (url.hash.match(/gid=(\d+)/) ?? url.search.match(/gid=(\d+)/))?.[1];
    const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
    let response: Response;
    try {
      response = await fetch(exportUrl, { redirect: "follow", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    } catch {
      throw new UserError("Google Sheets did not answer. Try again in a moment.");
    }
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("text/csv")) {
      throw new UserError(
        'This sheet is private. In Google Sheets, click Share and set General access to "Anyone with the link", then try again. Or copy the cells and paste them here instead.',
      );
    }
    const body = await response.text();
    if (body.length > 5_000_000) throw new UserError("This sheet is too big to import in one go.");
    return { rows: parseDelimited(body) };
  });
}

/** Last 10 digits, so +91 98111 22334 and 98111 22334 count as the same number. */
const digits = (phone: string) => phone.replace(/\D/g, "").slice(-10);

function clientType(value: string) {
  const v = value.toLowerCase();
  if (/agent|agency|travel|tour|dmc|b2b/.test(v)) return "agent" as const;
  if (/individual|guest|person|retail|walk|b2c|direct/.test(v)) return "individual" as const;
  return "company" as const;
}

type ClientPlan = RowResult & {
  value?: {
    name: string;
    type: "company" | "agent" | "individual";
    address: string;
    registration: string;
    tags: string[];
    contact: { name: string; role: string; phone: string; email: string } | null;
  };
};

/** Checks each client row against the database and the rows above it. */
async function planClients(ex: Executor, rows: ImportRow[]): Promise<ClientPlan[]> {
  const existing = await ex.execute<{ name: string; phone: string | null; email: string | null }>(sql`
    select c.name, cc.phone, cc.email
    from clients c left join client_contacts cc on cc.client_id = c.id
  `);
  const names = new Map<string, string>();
  const phones = new Map<string, string>();
  const emails = new Map<string, string>();
  for (const r of existing.rows) {
    names.set(r.name.toLowerCase(), `${r.name} is already a client.`);
    if (r.phone && digits(r.phone).length >= 8) phones.set(digits(r.phone), `${r.name} already has this phone number.`);
    if (r.email) emails.set(r.email.toLowerCase(), `${r.name} already has this email.`);
  }

  return rows.map((row, i) => {
    const name = text(row.name ?? "", 200);
    if (!name) return { status: "error", message: "No client name." };
    const email = text(row.email ?? "", 200).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { status: "error", message: `The email ${email} does not look right.` };
    }
    const phone = text(row.phone ?? "", 40);
    const clash =
      names.get(name.toLowerCase()) ??
      (digits(phone).length >= 8 ? phones.get(digits(phone)) : undefined) ??
      (email ? emails.get(email) : undefined);
    if (clash) return { status: "skip", message: clash };

    // Later rows are checked against this one.
    const same = `Same as row ${i + 1}.`;
    names.set(name.toLowerCase(), same);
    if (digits(phone).length >= 8) phones.set(digits(phone), same);
    if (email) emails.set(email, same);

    const contact = {
      name: text(row.contactName ?? "", 200),
      role: text(row.contactRole ?? "", 100),
      phone,
      email,
    };
    return {
      status: "new",
      message: "",
      value: {
        name,
        type: clientType(row.type ?? ""),
        address: text(row.address ?? ""),
        registration: text(row.registration ?? "", 200),
        tags: [...new Set(text(row.tags ?? "", 400).split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 12),
        contact: contact.name || contact.phone || contact.email ? contact : null,
      },
    };
  });
}

type RoomPlan = RowResult & { value?: { hotel: string; city: string; roomType: string; block: CheckedBlock } };

/** Checks each room row: dates and numbers readable, and not already in inventory. */
async function planRooms(ex: Executor, rows: ImportRow[], order: DateOrder): Promise<RoomPlan[]> {
  const existing = await ex.execute<{ key: string }>(sql`
    select lower(h.name) || '|' || lower(rt.name) || '|' || sb.first_night::text || '|' || sb.last_night::text
      || '|' || sb.rooms_held::text || '|' || (sb.sell_price::numeric)::text as key
    from stock_blocks sb join room_types rt on rt.id = sb.room_type_id join hotels h on h.id = rt.hotel_id
  `);
  const seen = new Map(existing.rows.map((r) => [r.key, "These rooms are already in inventory."]));

  return rows.map((row, i) => {
    const hotel = text(row.hotel ?? "", 200);
    const roomType = text(row.roomType ?? "", 200);
    if (!hotel) return { status: "error", message: "No hotel." };
    if (!roomType) return { status: "error", message: "No room type." };
    const firstNight = parseDate(row.firstNight ?? "", order);
    if (!firstNight) return { status: "error", message: `Cannot read the first night "${row.firstNight ?? ""}".` };
    let lastNight: string | null = null;
    if (row.lastNight) {
      lastNight = parseDate(row.lastNight, order);
      if (!lastNight) return { status: "error", message: `Cannot read the last night "${row.lastNight}".` };
    } else if (row.checkOut) {
      const out = parseDate(row.checkOut, order);
      if (!out) return { status: "error", message: `Cannot read the check-out day "${row.checkOut}".` };
      lastNight = addDays(out, -1);
    } else {
      return { status: "error", message: "No last night or check-out day." };
    }
    const roomsHeld = parseAmount(row.roomsHeld ?? "");
    const sellPrice = parseAmount(row.sellPrice ?? "");
    const costPrice = row.costPrice ? parseAmount(row.costPrice) : null;
    if (row.costPrice && costPrice === null) return { status: "error", message: `Cannot read the cost "${row.costPrice}".` };
    let releaseDate = "";
    if (row.releaseDate) {
      const parsed = parseDate(row.releaseDate, order);
      if (!parsed) return { status: "error", message: `Cannot read the release date "${row.releaseDate}".` };
      releaseDate = parsed;
    }
    let block: CheckedBlock;
    try {
      block = checkBlock({
        firstNight,
        lastNight,
        roomsHeld: roomsHeld ?? NaN,
        sellPrice: sellPrice ?? NaN,
        costPrice,
        releaseDate,
        payFor: /sold|allot|release|actual/i.test(row.payFor ?? "") ? "sold" : "held",
      });
    } catch (error) {
      return { status: "error", message: error instanceof UserError ? error.message : "This row could not be read." };
    }
    const key = [hotel.toLowerCase(), roomType.toLowerCase(), block.firstNight, block.lastNight, block.roomsHeld, block.sellPrice].join("|");
    const clash = seen.get(key);
    if (clash) return { status: "skip", message: clash };
    seen.set(key, `Same as row ${i + 1}.`);
    return { status: "new", message: "", value: { hotel, city: text(row.city ?? "", 100), roomType, block } };
  });
}

function checkInput(kind: ImportKind, rows: ImportRow[], order: DateOrder) {
  if (kind !== "clients" && kind !== "rooms") throw new UserError("Pick what to import.");
  if (!Array.isArray(rows) || rows.length === 0) throw new UserError("There is nothing to import.");
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new UserError(`Import up to ${IMPORT_MAX_ROWS} rows at a time. Split the sheet and import it in parts.`);
  }
  if (order !== "dmy" && order !== "mdy") throw new UserError("Pick how dates are written.");
  return rows.map((r) => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, String(v ?? "").slice(0, 2000)])));
}

/** What would happen to each row, without saving anything. */
export async function checkImport(kind: ImportKind, rows: ImportRow[], order: DateOrder) {
  return run(async (): Promise<RowResult[]> => {
    await requireUser();
    const clean = checkInput(kind, rows, order);
    const plans = kind === "clients" ? await planClients(db, clean) : await planRooms(db, clean, order);
    return plans.map(({ status, message }) => ({ status, message }));
  });
}

/*
  Saves every row that can be saved, all in one go: either all of them are
  added or, if anything goes wrong, none are. Rows that are duplicates or
  cannot be read are left out, and the result says how many.
*/
export async function runImport(kind: ImportKind, rows: ImportRow[], order: DateOrder) {
  return run(async () => {
    const user = await requireUser();
    const clean = checkInput(kind, rows, order);

    const result = await db.transaction(async (tx) => {
      if (kind === "clients") {
        // The same lock as saving one client, so nobody adds a duplicate meanwhile.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('client-save'))`);
        const plans = await planClients(tx, clean);
        let added = 0;
        for (const plan of plans) {
          if (plan.status !== "new" || !plan.value) continue;
          const { contact, ...client } = plan.value;
          const [created] = await tx
            .insert(schema.clients)
            .values({ ...client, createdBy: user.id, updatedBy: user.id })
            .returning({ id: schema.clients.id });
          if (contact) await tx.insert(schema.clientContacts).values({ ...contact, clientId: created.id, isPrimary: true });
          added++;
        }
        return { added, plans };
      }
      const plans = await planRooms(tx, clean, order);
      let added = 0;
      for (const plan of plans) {
        if (plan.status !== "new" || !plan.value) continue;
        await addBlock(tx, user.id, plan.value, { log: false });
        added++;
      }
      return { added, plans };
    });

    const skipped = result.plans.filter((p) => p.status === "skip").length;
    const failed = result.plans.filter((p) => p.status === "error").length;
    if (result.added) {
      await logActivity(db, {
        userId: user.id,
        action: "imported",
        entity: kind === "clients" ? "client" : "stock_block",
        summary:
          kind === "clients"
            ? `${result.added} client${result.added === 1 ? "" : "s"} from a spreadsheet`
            : `${result.added} block${result.added === 1 ? "" : "s"} of rooms from a spreadsheet`,
      });
    }
    refresh();
    return {
      added: result.added,
      skipped,
      failed,
      results: result.plans.map(({ status, message }) => ({ status, message })),
    };
  });
}
