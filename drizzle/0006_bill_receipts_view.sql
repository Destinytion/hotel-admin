-- Advances used on a bill become advance_uses rows; the advance itself no
-- longer points at the bill, so one advance can be split across several bills.
INSERT INTO "advance_uses" ("advance_id", "bill_id", "amount", "used_on", "created_by", "created_at")
SELECT p."id", p."bill_id", p."amount",
  coalesce((p."applied_at" AT TIME ZONE 'Asia/Kolkata')::date, p."paid_on"),
  p."created_by", coalesce(p."applied_at", p."created_at")
FROM "payments" p
WHERE p."kind" = 'advance' AND p."bill_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "payments" SET "bill_id" = NULL WHERE "kind" = 'advance' AND "bill_id" IS NOT NULL;
--> statement-breakpoint
-- Everything that counts as paid on a bill: its own active payments, plus the
-- parts of active advances used on it. One row each.
CREATE VIEW "bill_receipts" AS
  SELECT p."bill_id", p."amount", p."paid_on", p."created_at", p."id" AS "payment_id", NULL::uuid AS "use_id"
  FROM "payments" p
  WHERE p."status" = 'active' AND p."bill_id" IS NOT NULL
  UNION ALL
  SELECT u."bill_id", u."amount", u."used_on", u."created_at", u."advance_id", u."id"
  FROM "advance_uses" u
  JOIN "payments" a ON a."id" = u."advance_id"
  WHERE a."status" = 'active';
