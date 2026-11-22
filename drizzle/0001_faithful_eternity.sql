ALTER TABLE "bills" ADD COLUMN "is_sale" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "formats" ADD COLUMN "has_tax_line" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "formats" ADD COLUMN "counts_as_sale" boolean DEFAULT true NOT NULL;