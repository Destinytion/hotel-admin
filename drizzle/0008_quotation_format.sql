ALTER TABLE "formats" DROP CONSTRAINT "formats_layout_check";--> statement-breakpoint
ALTER TABLE "formats" ADD CONSTRAINT "formats_layout_check" CHECK ("formats"."layout" in ('gst', 'non-gst', 'proforma', 'quotation'));--> statement-breakpoint
-- Every existing company gets the Quotation format, numbered <initials>/Q/.
-- It is not a sale: it takes no rooms and nothing is owed on it.
INSERT INTO "formats" ("company_id", "name", "title", "number_prefix", "layout", "has_tax_line", "counts_as_sale")
SELECT c."id", 'Quotation', 'Quotation', c."initials" || '/Q/', 'quotation', true, false
FROM "companies" c
WHERE NOT EXISTS (SELECT 1 FROM "formats" f WHERE f."company_id" = c."id" AND f."layout" = 'quotation');
