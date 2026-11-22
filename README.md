# Hotel Admin

A private admin app for a hospitality agency: bills, clients and room inventory, shared by a few owners who each have their own login.

## What it does

- **Bill Generator.** Pick the company to bill from and a format, add rooms from inventory or any other line, save a draft, finalise to get a number.
- **Inventory.** Rooms held at each hotel by night, with a price. What is sold is counted from finalised bills, so "rooms left" is always current. Selling more than is left is refused.
- **Clients.** Contact person, notes with follow-up dates, and a timeline of bills and payments with the outstanding balance.
- **Bills.** Every bill from every company in one list. Each bill can be printed, paid, cancelled or copied.
- **Several people at once.** Screens refresh on their own, a save never silently overwrites someone else's, and the Activity screen shows who did what.

There are no tax rules in the app. A format decides what a bill contains.

## Run it on your computer

Needs Node.js 20.9 or newer and PostgreSQL.

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run db:migrate             # creates the tables
npm run dev                    # http://localhost:3000
```

The first visit asks you to create the first account. More people are added in Settings.

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

Both suites drive a real browser (Microsoft Edge) against a running copy of the app. Run them against a throwaway database, never the real one.

- `scripts/workflow-test.mjs`: one person through the whole workflow.
- `scripts/multi-user-test.mjs`: four people in four browsers acting at the same instant, followed by checks on the database itself. It refuses to run unless the database name contains "test".
- `scripts/access-test.mjs`: the setup code, adding and removing people, and passwords.
- `scripts/zoho-test.mjs`: "Sign in with Zoho", against a stand-in Zoho server the script runs itself.
- `scripts/receipts-test.mjs`: PDF receipts and advances, including numbering when two people record at once. It opens every PDF and reads its text.
- `scripts/reports-test.mjs`: Payments and Reports. It adds its own bills, works out every figure itself, and compares them with the screens and the Excel downloads.

## Sign in with Zoho

Optional. Register the app once in the Zoho API Console as a server-based application, with the redirect address `<your app address>/api/auth/callback/zoho`, and set `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` (see `.env.example`). Opening the app then goes straight to Zoho's sign-in page and comes back signed in.

Only people whose email was added in Settings get in; a Zoho account that was never added is refused. Passwords keep working as a backup at `/login?password`.

The top of each script says how to run it.

## Where things are

| Path | What is there |
|---|---|
| `src/app/(app)` | The screens. Each folder has `page.tsx` (loads data), a `*-client.tsx` (the screen) and `actions.ts` (saves) |
| `src/app/(auth)` | Login and first-time setup |
| `src/db/schema.ts` | Every table |
| `src/server` | Room availability and the activity record |
| `src/components` | Shared pieces, including the design tokens' components |
| `src/app/globals.css` | Design tokens: every colour, text size and corner radius |
| `drizzle/` | Database migrations |

## Hosting

`Dockerfile` builds a small container for a host such as Google Cloud Run. Set the variables listed in `.env.example` on the host, including `SETUP_CODE`, and run `npm run db:migrate` once against the hosted database before the first visit.
