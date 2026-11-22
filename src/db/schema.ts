import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

// ---------------------------------------------------------------------------
// Login. These four tables are the shape the auth library expects.
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Everyone is an admin today. The column exists for a restricted login later.
  role: text("role").notNull().default("admin"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    // Hashed. The plain password is never stored.
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Companies: the names a bill can be issued from.
// ---------------------------------------------------------------------------

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  color: text("color").notNull().default("#2f6f6a"),
  address: text("address").notNull().default(""),
  registration: text("registration").notNull().default(""),
  bankDetails: text("bank_details").notNull().default(""),
  terms: text("terms").notNull().default(""),
  logoPath: text("logo_path"),
  signaturePath: text("signature_path"),
  active: boolean("active").notNull().default(true),
  // Goes up by one on every save. A save that carries an old number is refused,
  // so two people editing at once cannot silently overwrite each other.
  version: integer("version").notNull().default(1),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Clients. Shared by all companies.
// ---------------------------------------------------------------------------

export const clientType = pgEnum("client_type", ["company", "agent", "individual"]);

export const clients = pgTable(
  "clients",
  {
    id: id(),
    name: text("name").notNull(),
    type: clientType("type").notNull().default("company"),
    address: text("address").notNull().default(""),
    registration: text("registration").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_name_idx").on(t.name)],
);

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("client_contacts_client_idx").on(t.clientId),
    index("client_contacts_phone_idx").on(t.phone),
  ],
);

/** Notes and follow-ups on a client's timeline. */
export const clientNotes = pgTable(
  "client_notes",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    followUpOn: date("follow_up_on", { mode: "string" }),
    done: boolean("done").notNull().default(false),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("client_notes_client_idx").on(t.clientId)],
);

// ---------------------------------------------------------------------------
// Inventory: rooms held at hotels. Shared by all companies.
// "Sold" is never stored here. It is counted from finalised bill lines.
// ---------------------------------------------------------------------------

export const hotels = pgTable(
  "hotels",
  {
    id: id(),
    name: text("name").notNull(),
    city: text("city").notNull().default(""),
    contact: text("contact").notNull().default(""),
    notes: text("notes").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // One hotel per name, whatever the capitals, even if two people add it at once.
  (t) => [uniqueIndex("hotels_name_unique_idx").on(sql`lower(${t.name})`)],
);

export const roomTypes = pgTable(
  "room_types",
  {
    id: id(),
    hotelId: uuid("hotel_id")
      .notNull()
      .references(() => hotels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("room_types_hotel_name_idx").on(t.hotelId, t.name)],
);

/** A number of rooms held for a run of nights, with its price. */
export const stockBlocks = pgTable(
  "stock_blocks",
  {
    id: id(),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id, { onDelete: "cascade" }),
    firstNight: date("first_night", { mode: "string" }).notNull(),
    lastNight: date("last_night", { mode: "string" }).notNull(),
    roomsHeld: integer("rooms_held").notNull(),
    sellPrice: money("sell_price").notNull(),
    costPrice: money("cost_price"),
    // Date unsold rooms go back to the hotel, if the block has one.
    releaseDate: date("release_date", { mode: "string" }),
    // What the hotel is paid for: "held" = every room held, whether sold or
    // not (a guaranteed block); "sold" = only the rooms actually sold (an
    // allotment where unsold rooms go back free).
    payFor: text("pay_for").notNull().default("held"),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("stock_blocks_room_dates_idx").on(t.roomTypeId, t.firstNight, t.lastNight),
    check("stock_blocks_dates_check", sql`${t.lastNight} >= ${t.firstNight}`),
    check("stock_blocks_rooms_check", sql`${t.roomsHeld} >= 0`),
    check("stock_blocks_pay_for_check", sql`${t.payFor} in ('held', 'sold')`),
  ],
);

/** Nights that cannot be sold, without changing how many rooms are held. */
export const stopSales = pgTable(
  "stop_sales",
  {
    id: id(),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id, { onDelete: "cascade" }),
    firstNight: date("first_night", { mode: "string" }).notNull(),
    lastNight: date("last_night", { mode: "string" }).notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("stop_sales_room_dates_idx").on(t.roomTypeId, t.firstNight, t.lastNight),
    check("stop_sales_dates_check", sql`${t.lastNight} >= ${t.firstNight}`),
  ],
);

// ---------------------------------------------------------------------------
// Formats and bills. The format decides what a bill contains.
// ---------------------------------------------------------------------------

export const formats = pgTable(
  "formats",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Printed heading, for example "Quotation" or "Invoice".
    title: text("title").notNull().default(""),
    // Start of the bill number, for example "SR/".
    numberPrefix: text("number_prefix").notNull().default(""),
    // Word template for this format, once uploaded.
    templatePath: text("template_path"),
    // Whether this format prints a tax line. The rate is typed on each bill.
    hasTaxLine: boolean("has_tax_line").notNull().default(false),
    // Off for quotations and the like: they do not use up rooms or add to
    // what a client owes.
    countsAsSale: boolean("counts_as_sale").notNull().default(true),
    // The fields this format asks for and how its totals are worked out.
    fields: jsonb("fields").notNull().default(sql`'{}'::jsonb`),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("formats_company_idx").on(t.companyId)],
);

/** The next running number for a company and format in a financial year. */
export const numberSeries = pgTable(
  "number_series",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    formatId: uuid("format_id")
      .notNull()
      .references(() => formats.id, { onDelete: "cascade" }),
    fiscalYear: text("fiscal_year").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => [
    uniqueIndex("number_series_unique_idx").on(t.companyId, t.formatId, t.fiscalYear),
  ],
);

export const billStatus = pgEnum("bill_status", ["draft", "final", "cancelled"]);

export const bills = pgTable(
  "bills",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    formatId: uuid("format_id")
      .notNull()
      .references(() => formats.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    // Empty while a draft. Assigned when the bill is finalised.
    number: text("number"),
    status: billStatus("status").notNull().default("draft"),
    // Copied from the format when saved. See formats.countsAsSale.
    isSale: boolean("is_sale").notNull().default(true),
    billDate: date("bill_date", { mode: "string" }).notNull(),
    // Values for the fields the format defines.
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    subtotal: money("subtotal").notNull().default("0"),
    taxTotal: money("tax_total").notNull().default("0"),
    total: money("total").notNull().default("0"),
    // Company and client details exactly as they were when finalised.
    snapshot: jsonb("snapshot"),
    // The quotation or bill this one was made from.
    sourceBillId: uuid("source_bill_id"),
    // What the hotel voucher adds to the bill: guest names, the hotel's
    // confirmation numbers and requests. Typed on the voucher page.
    voucher: jsonb("voucher"),
    docxPath: text("docx_path"),
    pdfPath: text("pdf_path"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finalisedAt: timestamp("finalised_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("bills_company_number_idx").on(t.companyId, t.number),
    index("bills_client_idx").on(t.clientId),
    index("bills_status_idx").on(t.status),
    index("bills_date_idx").on(t.billDate),
  ],
);

export const billLineKind = pgEnum("bill_line_kind", ["room", "other"]);

export const billLines = pgTable(
  "bill_lines",
  {
    id: id(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    kind: billLineKind("kind").notNull().default("other"),
    // Set on room lines sold from inventory. Empty for "on request" rooms.
    roomTypeId: uuid("room_type_id").references(() => roomTypes.id, { onDelete: "restrict" }),
    description: text("description").notNull().default(""),
    checkIn: date("check_in", { mode: "string" }),
    nights: integer("nights"),
    // Rooms on a room line, quantity on any other line.
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
    rate: money("rate").notNull().default("0"),
    amount: money("amount").notNull().default("0"),
  },
  (t) => [
    index("bill_lines_bill_idx").on(t.billId),
    index("bill_lines_room_idx").on(t.roomTypeId, t.checkIn),
  ],
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** "payment" was taken against a bill. "advance" was taken before any bill. */
export const paymentKind = pgEnum("payment_kind", ["payment", "advance"]);
/** A cancelled payment keeps its receipt number but no longer counts anywhere. */
export const paymentStatus = pgEnum("payment_status", ["active", "cancelled"]);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    // Empty for an advance not yet applied to a bill.
    billId: uuid("bill_id").references(() => bills.id, { onDelete: "set null" }),
    kind: paymentKind("kind").notNull().default("payment"),
    status: paymentStatus("status").notNull().default("active"),
    amount: money("amount").notNull(),
    mode: text("mode").notNull().default(""),
    reference: text("reference").notNull().default(""),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    // Printed on the receipt, for example what an advance is for.
    notes: text("notes").notNull().default(""),
    // Running number per company per financial year, for example SR/R/26-27/0001.
    receiptNumber: text("receipt_number"),
    // Company and client details exactly as they were when the money came in.
    snapshot: jsonb("snapshot"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    // When an advance was applied to a bill.
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("payments_client_idx").on(t.clientId),
    index("payments_bill_idx").on(t.billId),
    uniqueIndex("payments_company_receipt_idx").on(t.companyId, t.receiptNumber),
  ],
);

/*
  Part or all of an advance used to pay a bill. The advance itself keeps its
  full amount and receipt; what a bill has been paid is its own payments plus
  these. The view bill_receipts (migration 0005) adds the two up.
*/
export const advanceUses = pgTable(
  "advance_uses",
  {
    id: id(),
    advanceId: uuid("advance_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    amount: money("amount").notNull(),
    usedOn: date("used_on", { mode: "string" }).notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("advance_uses_advance_idx").on(t.advanceId),
    index("advance_uses_bill_idx").on(t.billId),
    check("advance_uses_amount_check", sql`${t.amount} > 0`),
  ],
);

/** Money paid out to a hotel for rooms held. */
export const hotelPayments = pgTable(
  "hotel_payments",
  {
    id: id(),
    hotelId: uuid("hotel_id")
      .notNull()
      .references(() => hotels.id, { onDelete: "restrict" }),
    // Which of your companies paid, if recorded.
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    amount: money("amount").notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    mode: text("mode").notNull().default(""),
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    status: paymentStatus("status").notNull().default("active"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("hotel_payments_hotel_idx").on(t.hotelId),
    check("hotel_payments_amount_check", sql`${t.amount} > 0`),
  ],
);

/** The next receipt number for a company in a financial year. */
export const receiptSeries = pgTable(
  "receipt_series",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    fiscalYear: text("fiscal_year").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => [uniqueIndex("receipt_series_unique_idx").on(t.companyId, t.fiscalYear)],
);

// ---------------------------------------------------------------------------
// Services you sell besides rooms, picked from a list when making a bill.
// A bill copies the wording and rate, so changing or removing a service
// never alters bills already made.
// ---------------------------------------------------------------------------

export const services = pgTable(
  "services",
  {
    id: id(),
    name: text("name").notNull(),
    // Printed under the name on the bill line, for example "Innova, both ways".
    details: text("details").notNull().default(""),
    rate: money("rate").notNull().default("0"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("services_name_unique_idx").on(sql`lower(${t.name})`)],
);

// ---------------------------------------------------------------------------
// Who did what
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    // What was acted on, in words, kept even if the record is later deleted.
    summary: text("summary").notNull().default(""),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_created_idx").on(t.createdAt),
  ],
);
