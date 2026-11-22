// Add, remove or list logins from the command line. Run from the project folder.
//
//   npm run user -- list
//   npm run user -- add "Full Name" person@example.com
//   npm run user -- remove person@example.com
//
// "add" asks for the password. Sign-up from the login page is switched off,
// so this is how people are added until the Settings screen exists.

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

const MIN_PASSWORD_LENGTH = 10;

process.loadEnvFile(".env.local");
const [command, ...args] = process.argv.slice(2);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function add(name, emailInput, passwordInput) {
  const email = (emailInput ?? "").trim().toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail('Usage: npm run user -- add "Full Name" person@example.com');
  }

  let password = passwordInput;
  if (!password) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    password = await prompt.question(`Password for ${email} (at least ${MIN_PASSWORD_LENGTH} characters): `);
    prompt.close();
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    return fail(`The password must be ${MIN_PASSWORD_LENGTH} to 128 characters.`);
  }

  const existing = await client.query("select 1 from users where email = $1", [email]);
  if (existing.rowCount) return fail(`${email} already has a login.`);

  const userId = randomUUID();
  const hash = await hashPassword(password);
  await client.query("begin");
  try {
    await client.query(
      "insert into users (id, name, email, email_verified, role) values ($1, $2, $3, true, 'admin')",
      [userId, name.trim(), email],
    );
    await client.query(
      "insert into accounts (id, account_id, provider_id, user_id, password) values ($1, $2, 'credential', $2, $3)",
      [randomUUID(), userId, hash],
    );
    // Shows on the Activity screen as "Someone added a login for ...".
    await client.query(
      "insert into audit_log (action, entity, entity_id, summary, detail) values ('added', 'user', $1, $2, $3)",
      [userId, `a login for ${name.trim()}, from the command line`, JSON.stringify({ via: "command line" })],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  console.log(`Added ${name.trim()} <${email}>.`);
}

async function remove(emailInput) {
  const email = (emailInput ?? "").trim().toLowerCase();
  if (!email) return fail("Usage: npm run user -- remove person@example.com");

  const total = await client.query("select count(*)::int as n from users");
  const found = await client.query("select id, name from users where email = $1", [email]);
  if (!found.rowCount) return fail(`No login found for ${email}.`);
  if (total.rows[0].n === 1) {
    return fail("This is the only login. Add another one before removing it.");
  }

  // Their sessions and password go with them. Records they created are kept.
  await client.query("delete from users where id = $1", [found.rows[0].id]);
  await client.query(
    "insert into audit_log (action, entity, summary, detail) values ('removed', 'user', $1, $2)",
    [`the login for ${found.rows[0].name}, from the command line`, JSON.stringify({ via: "command line" })],
  );
  console.log(`Removed ${found.rows[0].name} <${email}>.`);
}

async function list() {
  const { rows } = await client.query("select name, email, created_at from users order by created_at");
  if (!rows.length) return console.log("No logins yet. Open the app to create the first one.");
  for (const row of rows) {
    console.log(`${row.name} <${row.email}>, added ${row.created_at.toISOString().slice(0, 10)}`);
  }
}

await client.connect();
try {
  if (command === "add") await add(...args);
  else if (command === "remove") await remove(...args);
  else if (command === "list") await list();
  else fail("Commands: list, add, remove. See the top of scripts/users.mjs.");
} finally {
  await client.end();
}
