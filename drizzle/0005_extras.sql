CREATE TABLE "advance_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advance_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"used_on" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advance_uses_amount_check" CHECK ("advance_uses"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "hotel_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"company_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"mode" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" "payment_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	CONSTRAINT "hotel_payments_amount_check" CHECK ("hotel_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "voucher" jsonb;--> statement-breakpoint
ALTER TABLE "stock_blocks" ADD COLUMN "pay_for" text DEFAULT 'held' NOT NULL;--> statement-breakpoint
ALTER TABLE "advance_uses" ADD CONSTRAINT "advance_uses_advance_id_payments_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_uses" ADD CONSTRAINT "advance_uses_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advance_uses" ADD CONSTRAINT "advance_uses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_payments" ADD CONSTRAINT "hotel_payments_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_payments" ADD CONSTRAINT "hotel_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_payments" ADD CONSTRAINT "hotel_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_payments" ADD CONSTRAINT "hotel_payments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advance_uses_advance_idx" ON "advance_uses" USING btree ("advance_id");--> statement-breakpoint
CREATE INDEX "advance_uses_bill_idx" ON "advance_uses" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "hotel_payments_hotel_idx" ON "hotel_payments" USING btree ("hotel_id");--> statement-breakpoint
ALTER TABLE "stock_blocks" ADD CONSTRAINT "stock_blocks_pay_for_check" CHECK ("stock_blocks"."pay_for" in ('held', 'sold'));