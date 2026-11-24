// Adds the business's own company, Destinytion Hospitality & Events, with its
// three bill formats, logo and stamp, so nobody has to type it in. Safe to run
// again: an existing company of that name is left as it is, and only a missing
// logo or stamp is added.
//
//   npm run db:seed            (uses DATABASE_URL from .env.local or the environment)

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL ?? readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
if (!url) {
  console.error("Set DATABASE_URL first.");
  process.exit(2);
}

const COMPANY = {
  name: "Destinytion Hospitality & Events",
  initials: "DHE",
  color: "#3f4a5a",
  address: "Indore, Madhya Pradesh 452009",
  registration: "23AERPU4151P1ZR",
  email: "confirmation@destinytionhospitality.in",
  phone: "",
  bankDetails: [
    "Bank: Central Bank of India",
    "Account type: Current",
    "Account name: Destinytion Hospitality and Events",
    "Account number: 5320185694",
    "IFSC: CBIN0281384",
  ].join("\n"),
  terms: "",
};

// The same three formats a company added in Settings gets.
const FORMATS = [
  { name: "GST Bill", title: "Tax Invoice", prefix: "/", layout: "gst", tax: true, sale: true },
  { name: "Non-GST Bill", title: "Non-Taxable Invoice", prefix: "/N/", layout: "non-gst", tax: false, sale: true },
  { name: "Proforma Invoice", title: "Proforma Invoice", prefix: "/P/", layout: "proforma", tax: true, sale: false },
];

const PICTURES = [
  { kind: "logo", file: "destinytion-logo.png", mime: "image/png" },
  { kind: "stamp", file: "destinytion-stamp.png", mime: "image/png" },
];

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query("begin");
  let { rows } = await db.query("select id from companies where lower(name) = lower($1)", [COMPANY.name]);
  let companyId = rows[0]?.id;
  if (companyId) {
    console.log(`${COMPANY.name} is already there; left as it is.`);
  } else {
    ({ rows } = await db.query(
      `insert into companies (name, initials, color, address, registration, email, phone, bank_details, terms)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [COMPANY.name, COMPANY.initials, COMPANY.color, COMPANY.address, COMPANY.registration, COMPANY.email, COMPANY.phone, COMPANY.bankDetails, COMPANY.terms],
    ));
    companyId = rows[0].id;
    for (const f of FORMATS) {
      await db.query(
        `insert into formats (company_id, name, title, number_prefix, layout, has_tax_line, counts_as_sale)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [companyId, f.name, f.title, `${COMPANY.initials}${f.prefix}`, f.layout, f.tax, f.sale],
      );
    }
    await db.query(
      "insert into audit_log (action, entity, entity_id, summary) values ('added', 'company', $1, $2)",
      [companyId, `company ${COMPANY.name}, with its formats, logo and stamp`],
    );
    console.log(`Added ${COMPANY.name} with ${FORMATS.length} formats.`);
  }
  for (const p of PICTURES) {
    const data = readFileSync(path.join(import.meta.dirname, "..", "seed", p.file));
    const added = await db.query(
      `insert into company_images (company_id, kind, mime, data) values ($1, $2, $3, $4)
       on conflict (company_id, kind) do nothing`,
      [companyId, p.kind, p.mime, data],
    );
    if (added.rowCount) console.log(`Added the ${p.kind}.`);
  }
  await db.query("commit");
} catch (error) {
  await db.query("rollback");
  throw error;
} finally {
  await db.end();
}
