# Hotel Admin

A private admin app for a hospitality agency: bills, clients and room inventory, shared by a few owners who each have their own login.

## What it does

- **Bill Generator.** Pick the company to bill from and a format, add rooms from inventory or any other line, fill in the booking details, save a draft, finalise to get a number.
- **Your formats.** Bills come out in the business's own layouts: the GST bill (with CGST and SGST) and the Non-GST bill, both titled "Invoice", the Proforma Invoice (with the payment note and bank details), and the Quotation (a letter with the event, cost summary, payment schedule and the booking manager's sign-off; not a sale, and "Make a bill from this" turns it into a bill); any of them can have a discount in rupees or %; receipts in its Payment Receipt layout. Each has the company's logo and stamp, and downloads as PDF or Word.
- **Inventory.** Rooms held at each hotel by night, with a price. What is sold is counted from finalised bills, so "rooms left" is always current. Selling more than is left is refused. A block can be edited, but never shrunk below rooms already sold.
- **Clients.** Any number of contact people, notes with follow-up dates, and a timeline of bills and payments with the outstanding balance.
- **Bills.** Every bill from every company in one list. Each bill can be printed, paid, cancelled, copied, sent on WhatsApp, or turned into a hotel voucher (guest names, confirmation numbers, no prices).
- **Payments.** Receipts as PDF, advances that can be used whole or in parts across bills, and what you owe each hotel (Payments, To hotels), worked out from your blocks: every room held, or only rooms sold, as set on each block.
- **Import.** Clients or rooms held from Google Sheets (pasted cells or a shared link), Excel (.xlsx) or CSV, with a check of every row before anything is saved.
- **Search.** Ctrl+K anywhere finds clients, bills, rooms and receipts.
- **Several people at once.** Screens refresh on their own, a save never silently overwrites someone else's, and the Activity screen shows who did what.

There are no tax rules in the app. A format decides what a bill contains.

## Run it on your computer

Needs Node.js 20.9 or newer and PostgreSQL.

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run db:migrate             # creates the tables
npm run db:seed                # adds Destinytion Hospitality & Events with its formats, logo and stamp
npm run dev                    # http://localhost:3000
```

The first visit asks you to create the first account. More people are added in Settings. `db:seed` is safe to run again; it never changes a company that is already there. The logo and stamp it uses are in `seed/`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run locally with live reload |
| `npm run build` then `npm start` | Run the production build |
| `npm run typecheck` / `npm run lint` | Check the code |
| `npm run db:generate` | Write a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the database in `DATABASE_URL` |
| `npm run user -- list` | List logins (also `add "Name" email`, `remove email`) |

## Tests

The suites drive a real browser (Microsoft Edge) against a running copy of the app. Run them against a throwaway database, never the real one.

- `scripts/workflow-test.mjs`: one person through the whole workflow.
- `scripts/multi-user-test.mjs`: four people in four browsers acting at the same instant, followed by checks on the database itself. It refuses to run unless the database name contains "test".
- `scripts/access-test.mjs`: the setup code, adding and removing people, and passwords.
- `scripts/zoho-test.mjs`: "Sign in with Zoho", against a stand-in Zoho server the script runs itself.
- `scripts/items-test.mjs`: bills for services rather than rooms: saved services, items over several lines, and rooms typed by hand that never touch inventory.
- `scripts/receipts-test.mjs`: PDF receipts and advances, including numbering when two people record at once. It opens every PDF and reads its text.
- `scripts/reports-test.mjs`: Payments and Reports. It adds its own bills, works out every figure itself, and compares them with the screens and the Excel downloads.
- `scripts/formats-test.mjs`: the three bill formats and the receipt, made on the Bill Generator and read back from the screen, the PDF and the Word file. Needs `npm run db:seed` on the test database first.
- `scripts/extras-test.mjs`: importing from pasted cells and a real Excel file, editing rooms held, what is owed to hotels, using part of an advance, several contacts, WhatsApp, vouchers, search, and every screen at phone width.

## Sign in with Zoho

Optional. Register the app once in the Zoho API Console as a server-based application, with the redirect address `<your app address>/api/auth/callback/zoho`, and set `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` (see `.env.example`). The login page then shows "Sign in with Zoho" above the password form; pressing it goes to Zoho's sign-in page and comes back signed in.

Only people whose email was added in Settings get in; a Zoho account that was never added is refused. Passwords keep working on the same page.

The top of each script says how to run it.

## Where things are

| Path | What is there |
|---|---|
| `src/app/(app)` | The screens. Each folder has `page.tsx` (loads data), a `*-client.tsx` (the screen) and `actions.ts` (saves) |
| `src/app/(auth)` | Login and first-time setup |
| `src/db/schema.ts` | Every table |
| `src/server` | Room availability, block rules, what hotels are owed, receipts and the activity record |
| `src/lib/sheet.ts`, `src/lib/xlsx.ts` | Reading pasted cells, CSV and Excel files, dates and amounts |
| `src/lib/bill-document.ts` | One description of a bill, shared by the screen (`components/bill-paper.tsx`), the PDF (`server/bill-pdf.tsx`) and Word (`server/bill-docx.ts`) |
| `src/components` | Shared pieces, including the design tokens' components |
| `src/app/globals.css` | Design tokens: every colour, text size and corner radius |
| `drizzle/` | Database migrations |

## Hosting

The app runs on Vercel with its database on Supabase, both in Mumbai (`vercel.json` pins the region so the app sits next to the database).

1. On Supabase, make a project in South Asia (Mumbai) with **Data API turned off**. The app connects to Postgres directly; the Data API would otherwise offer the tables over the web to anyone holding the project's public key.
2. From Connect, copy the **transaction pooler** address (port 6543) for the app, and the **session pooler** address (port 5432) for migrations from a computer.
3. Run `npm run db:migrate` (and `npm run db:seed` on an empty database) once with `DATABASE_URL` set to the session pooler address. Add `uselibpqcompat=true&` before `sslmode=require` in addresses the app uses: the connection stays encrypted and Supabase's own certificate is accepted.
4. Once, and again after migrations that add tables: `psql <session pooler address> -f scripts/supabase-lockdown.sql` (takes every right away from Supabase's public API roles), and `alter database postgres set timezone to 'Asia/Kolkata'` so dates match India.
5. On Vercel, import the GitHub repository and set the variables from `.env.example`: `DATABASE_URL` (transaction pooler), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (the app's https address), `SETUP_CODE`, `CRON_SECRET` and `DB_POOL_MAX=3`.
6. Add the domain in Vercel and the CNAME it shows at the domain's DNS.

Staying inside the free limits:

- Open screens ask `/api/changes` every 15 seconds and only reload when something was saved, and stop asking after 10 minutes without use.
- A free Supabase database is paused after a week without use. Vercel calls `/api/keep-awake` once a day so a holiday never pauses it.
- `.github/workflows/uptime.yml` checks `/api/health` every hour (it answers without touching the database). A failed check makes GitHub email the repository owner.
- Supabase keeps no backups on the free plan. `.github/workflows/backup.yml` copies the database every night and keeps each copy for 90 days under Actions → Backup. It needs the repository secret `SUPABASE_DB_URL` (the session pooler address). How to restore is at the top of that file.

`Dockerfile` still builds a container for any host that runs one.
