CREATE TABLE "company_images" (
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_images_kind_check" CHECK ("company_images"."kind" in ('logo', 'stamp'))
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "formats" ADD COLUMN "layout" text DEFAULT 'gst' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_images" ADD CONSTRAINT "company_images_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_images_company_kind_idx" ON "company_images" USING btree ("company_id","kind");--> statement-breakpoint
ALTER TABLE "formats" ADD CONSTRAINT "formats_layout_check" CHECK ("formats"."layout" in ('gst', 'non-gst', 'proforma'));--> statement-breakpoint
-- Formats made before layouts existed get the nearest one.
UPDATE "formats" SET "layout" = CASE
  WHEN NOT "counts_as_sale" THEN 'proforma'
  WHEN "has_tax_line" THEN 'gst'
  ELSE 'non-gst'
END;