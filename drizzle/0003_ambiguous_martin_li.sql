CREATE TYPE "public"."payment_kind" AS ENUM('payment', 'advance');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TABLE "receipt_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"fiscal_year" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "kind" "payment_kind" DEFAULT 'payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "status" "payment_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_number" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "receipt_series" ADD CONSTRAINT "receipt_series_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_series_unique_idx" ON "receipt_series" USING btree ("company_id","fiscal_year");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_company_receipt_idx" ON "payments" USING btree ("company_id","receipt_number");--> statement-breakpoint
-- Existing payments get receipt numbers in the order the money came in, per company per financial year (April to March).
WITH numbered AS (
	SELECT p.id, co.initials,
		CASE WHEN extract(month FROM p.paid_on) >= 4 THEN extract(year FROM p.paid_on)::int ELSE extract(year FROM p.paid_on)::int - 1 END AS fy_start,
		row_number() OVER (
			PARTITION BY p.company_id, CASE WHEN extract(month FROM p.paid_on) >= 4 THEN extract(year FROM p.paid_on)::int ELSE extract(year FROM p.paid_on)::int - 1 END
			ORDER BY p.paid_on, p.created_at, p.id
		) AS n
	FROM "payments" p JOIN "companies" co ON co.id = p.company_id
)
UPDATE "payments" p
SET "receipt_number" = nb.initials || '/R/' || lpad((nb.fy_start % 100)::text, 2, '0') || '-' || lpad(((nb.fy_start + 1) % 100)::text, 2, '0') || '/' || lpad(nb.n::text, 4, '0')
FROM numbered nb WHERE nb.id = p.id;--> statement-breakpoint
-- The next number to issue in each series continues after the backfilled ones.
INSERT INTO "receipt_series" ("company_id", "fiscal_year", "next_number")
SELECT p.company_id, split_part(p.receipt_number, '/', 3), max(split_part(p.receipt_number, '/', 4)::int) + 1
FROM "payments" p WHERE p.receipt_number IS NOT NULL
GROUP BY p.company_id, split_part(p.receipt_number, '/', 3);--> statement-breakpoint
-- Existing payments keep today's company and client details on their receipts.
UPDATE "payments" p
SET "snapshot" = jsonb_build_object(
	'company', jsonb_build_object('name', co.name, 'initials', co.initials, 'color', co.color, 'address', co.address, 'registration', co.registration, 'bankDetails', co.bank_details, 'terms', co.terms),
	'client', jsonb_build_object('name', c.name, 'address', c.address, 'registration', c.registration)
)
FROM "companies" co, "clients" c
WHERE co.id = p.company_id AND c.id = p.client_id AND p.snapshot IS NULL;