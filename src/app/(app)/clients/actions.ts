"use server";

import { refresh } from "next/cache";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { inr, isISODate, toISODate } from "@/lib/format";
import { isUuid, run, text, UserError } from "@/lib/result";
import { conflict, logActivity, userName } from "@/server/activity";

const TYPES = ["company", "agent", "individual"] as const;
export type ClientType = (typeof TYPES)[number];

export type ContactInput = {
  /** Missing for a contact added in this edit. */
  id?: string;
  name: string;
  role: string;
  phone: string;
  email: string;
};

export type ClientInput = {
  id?: string;
  /** The version this edit started from. Missing for a new client. */
  version?: number;
  name: string;
  type: ClientType;
  address: string;
  registration: string;
  /** Comma separated. */
  tags: string;
  /** The first is the main contact: the one printed on bills and called first. */
  contacts: ContactInput[];
};

export type TimelineItem = {
  id: string;
  date: string;
  kind: "Bill" | "Quotation" | "Payment" | "Note";
  text: string;
  amount: number | null;
  /** Bills link to their page. */
  href: string | null;
  cancelled: boolean;
  /** Notes only. */
  followUpOn: string | null;
  done: boolean;
};

export type ClientDetail = {
  timeline: TimelineItem[];
  addedBy: string;
  addedOn: string;
  changedBy: string;
  changedOn: string;
};

/** The last 10 digits, so +91 98111 22334 and 98111 22334 count as the same number. */
const digits = (phone: string) => phone.replace(/\D/g, "").slice(-10);

export async function saveClient(input: ClientInput) {
  return run(async () => {
    const user = await requireUser();

    const name = text(input.name, 200);
    if (!name) throw new UserError("Enter the client's name.");
    if (!TYPES.includes(input.type)) throw new UserError("Pick a client type.");
    if (!Array.isArray(input.contacts) || input.contacts.length > 20) {
      throw new UserError("A client can have up to 20 contact people.");
    }
    const tags = [...new Set(text(input.tags, 400).split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 12);
    const client = {
      name,
      type: input.type,
      address: text(input.address),
      registration: text(input.registration, 200),
      tags,
    };
    // Blank rows are dropped; the first contact left is the main one.
    const contacts = input.contacts
      .map((c) => ({
        id: c.id && isUuid(c.id) ? c.id : undefined,
        name: text(c.name, 200),
        role: text(c.role, 100),
        phone: text(c.phone, 40),
        email: text(c.email, 200).toLowerCase(),
      }))
      .filter((c) => c.name || c.phone || c.email);
    for (const c of contacts) {
      if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
        throw new UserError(`The email address ${c.email} does not look right.`);
      }
    }
    const phones = contacts.map((c) => digits(c.phone)).filter((d) => d.length >= 8);
    const emails = contacts.map((c) => c.email).filter(Boolean);
    if (new Set(phones).size < phones.length || new Set(emails).size < emails.length) {
      throw new UserError("Two contact people here have the same phone number or email.");
    }
    if (input.id && !isUuid(input.id)) throw new UserError("That client could not be found.");

    const id = await db.transaction(async (tx) => {
      // One client save at a time, so two people cannot enter the same
      // phone number at the same instant and both pass the check below.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('client-save'))`);

      // Stop the same person being entered twice under two clients.
      if (phones.length || emails.length) {
        const others = await tx
          .select({ clientName: schema.clients.name, phone: schema.clientContacts.phone, email: schema.clientContacts.email })
          .from(schema.clientContacts)
          .innerJoin(schema.clients, eq(schema.clients.id, schema.clientContacts.clientId))
          .where(input.id ? ne(schema.clients.id, input.id) : undefined);
        const clash = others.find(
          (o) => phones.includes(digits(o.phone)) || (o.email !== "" && emails.includes(o.email)),
        );
        if (clash) {
          throw new UserError(`${clash.clientName} already has this phone number or email.`);
        }
      }

      let clientId = input.id;
      if (clientId) {
        // Only saves if nobody else has saved since this edit was opened.
        const updated = await tx
          .update(schema.clients)
          .set({ ...client, version: sql`${schema.clients.version} + 1`, updatedBy: user.id })
          .where(and(eq(schema.clients.id, clientId), eq(schema.clients.version, Number(input.version))))
          .returning({ id: schema.clients.id });
        if (!updated.length) {
          const [current] = await tx
            .select({ updatedBy: schema.clients.updatedBy, updatedAt: schema.clients.updatedAt })
            .from(schema.clients)
            .where(eq(schema.clients.id, clientId));
          if (!current) throw new UserError("This client was deleted by someone else.");
          throw await conflict(tx, "client", current);
        }
      } else {
        const [created] = await tx
          .insert(schema.clients)
          .values({ ...client, createdBy: user.id, updatedBy: user.id })
          .returning({ id: schema.clients.id });
        clientId = created.id;
      }

      // Contacts kept from before are updated in place, so their order holds;
      // removed ones are deleted and new ones added.
      const existing = await tx
        .select({ id: schema.clientContacts.id })
        .from(schema.clientContacts)
        .where(eq(schema.clientContacts.clientId, clientId));
      const known = new Set(existing.map((e) => e.id));
      const keep = new Set(contacts.map((c) => c.id).filter((cid): cid is string => Boolean(cid && known.has(cid))));
      const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
      if (removed.length) {
        await tx.delete(schema.clientContacts).where(inArray(schema.clientContacts.id, removed));
      }
      for (const [index, c] of contacts.entries()) {
        const values = { name: c.name, role: c.role, phone: c.phone, email: c.email, isPrimary: index === 0 };
        if (c.id && keep.has(c.id)) {
          await tx.update(schema.clientContacts).set(values).where(eq(schema.clientContacts.id, c.id));
        } else {
          await tx.insert(schema.clientContacts).values({ ...values, clientId });
        }
      }

      await logActivity(tx, {
        userId: user.id,
        action: input.id ? "changed" : "added",
        entity: "client",
        entityId: clientId,
        summary: `client ${name}`,
      });
      return clientId;
    });

    refresh();
    return { id };
  });
}

export async function deleteClient(id: string) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(id)) throw new UserError("That client could not be found.");

    const [used] = await db
      .select({
        bills: sql<number>`(select count(*) from bills where client_id = ${id})::int`,
        payments: sql<number>`(select count(*) from payments where client_id = ${id})::int`,
      })
      .from(sql`(select 1) as one`);
    if (used.bills || used.payments) {
      throw new UserError("This client has bills or payments, so it cannot be deleted.");
    }

    await db.transaction(async (tx) => {
      const gone = await tx
        .delete(schema.clients)
        .where(eq(schema.clients.id, id))
        .returning({ name: schema.clients.name });
      if (!gone.length) throw new UserError("That client could not be found.");
      await logActivity(tx, {
        userId: user.id,
        action: "deleted",
        entity: "client",
        entityId: id,
        summary: `client ${gone[0].name}`,
      });
    });

    refresh();
    return null;
  });
}

export async function getClientDetail(id: string) {
  return run(async (): Promise<ClientDetail> => {
    await requireUser();
    if (!isUuid(id)) throw new UserError("That client could not be found.");

    const [client] = await db
      .select({
        createdBy: schema.clients.createdBy,
        createdAt: schema.clients.createdAt,
        updatedBy: schema.clients.updatedBy,
        updatedAt: schema.clients.updatedAt,
      })
      .from(schema.clients)
      .where(eq(schema.clients.id, id));
    if (!client) throw new UserError("This client no longer exists.");

    const [bills, payments, notes, uses] = await Promise.all([
      db
        .select({
          id: schema.bills.id,
          number: schema.bills.number,
          status: schema.bills.status,
          isSale: schema.bills.isSale,
          billDate: schema.bills.billDate,
          total: schema.bills.total,
          title: schema.formats.title,
        })
        .from(schema.bills)
        .innerJoin(schema.formats, eq(schema.formats.id, schema.bills.formatId))
        .where(and(eq(schema.bills.clientId, id), ne(schema.bills.status, "draft"))),
      db.select().from(schema.payments).where(eq(schema.payments.clientId, id)),
      db.select().from(schema.clientNotes).where(eq(schema.clientNotes.clientId, id)),
      db
        .select({ advanceId: schema.advanceUses.advanceId, amount: schema.advanceUses.amount })
        .from(schema.advanceUses)
        .innerJoin(schema.payments, eq(schema.payments.id, schema.advanceUses.advanceId))
        .where(eq(schema.payments.clientId, id)),
    ]);
    const usedOf = (advanceId: string) =>
      uses.filter((u) => u.advanceId === advanceId).reduce((sum, u) => sum + Number(u.amount), 0);
    const advanceText = (p: (typeof payments)[number]) => {
      const used = usedOf(p.id);
      if (used <= 0) return "Advance, not yet used";
      if (used >= Number(p.amount) - 0.004) return "Advance, used on bills";
      return `Advance, ${inr(Number(p.amount) - used)} not yet used`;
    };

    const timeline: TimelineItem[] = [
      ...bills.map((b) => ({
        id: b.id,
        date: b.billDate,
        kind: b.isSale ? ("Bill" as const) : ("Quotation" as const),
        text: `${b.title} ${b.number ?? ""}`.trim() + (b.status === "cancelled" ? ", cancelled" : ""),
        amount: Number(b.total),
        href: `/bills/${b.id}`,
        cancelled: b.status === "cancelled",
        followUpOn: null,
        done: false,
      })),
      ...payments.map((p) => ({
        id: p.id,
        date: p.paidOn,
        kind: "Payment" as const,
        text:
          [
            p.kind === "advance" ? advanceText(p) : "Payment",
            p.mode && `by ${p.mode}`,
            p.receiptNumber && `receipt ${p.receiptNumber}`,
          ]
            .filter(Boolean)
            .join(", ") + (p.status === "cancelled" ? ", cancelled" : ""),
        amount: Number(p.amount),
        href: p.billId ? `/bills/${p.billId}` : null,
        cancelled: p.status === "cancelled",
        followUpOn: null,
        done: false,
      })),
      ...notes.map((n) => ({
        id: n.id,
        date: toISODate(n.createdAt),
        kind: "Note" as const,
        text: n.body,
        amount: null,
        href: null,
        cancelled: false,
        followUpOn: n.followUpOn,
        done: n.done,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date));

    return {
      timeline,
      addedBy: await userName(db, client.createdBy),
      addedOn: toISODate(client.createdAt),
      changedBy: await userName(db, client.updatedBy),
      changedOn: toISODate(client.updatedAt),
    };
  });
}

export async function addClientNote(input: { clientId: string; body: string; followUpOn: string }) {
  return run(async () => {
    const user = await requireUser();
    if (!isUuid(input.clientId)) throw new UserError("That client could not be found.");
    const body = text(input.body);
    if (!body) throw new UserError("Write the note first.");
    if (input.followUpOn && !isISODate(input.followUpOn)) {
      throw new UserError("Pick a valid follow-up date.");
    }
    const [client] = await db
      .select({ name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.id, input.clientId));
    if (!client) throw new UserError("This client no longer exists.");
    await db.insert(schema.clientNotes).values({
      clientId: input.clientId,
      body,
      followUpOn: input.followUpOn || null,
      createdBy: user.id,
    });
    await logActivity(db, {
      userId: user.id,
      action: "added a note on",
      entity: "client",
      entityId: input.clientId,
      summary: `client ${client.name}`,
    });
    refresh();
    return null;
  });
}

export async function setNoteDone(id: string, done: boolean) {
  return run(async () => {
    await requireUser();
    if (!isUuid(id)) throw new UserError("That note could not be found.");
    await db.update(schema.clientNotes).set({ done }).where(eq(schema.clientNotes.id, id));
    refresh();
    return null;
  });
}
