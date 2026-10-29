-- DRAFT FOR ISOLATED TESTS ONLY — NOT APPROVED OR VERIFIED FOR PRODUCTION.
-- This changes an existing table. Do not run on any real database without a
-- fresh backup, a read-only schema/data audit, rollback planning and explicit
-- separate approval. Existing serials retain their original opening_id.
-- The transaction fails on any collision; no seed or example data is inserted.
DO $receiving_upgrade$
BEGIN
PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

CREATE TABLE public."inventory_receipts" (
  "id" BIGSERIAL NOT NULL,
  "request_id" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "product_id" BIGINT NOT NULL,
  "quantity" DECIMAL(12,2) NOT NULL,
  "unit_cost" DECIMAL(14,4) NOT NULL,
  "source_reference" VARCHAR(180),
  "created_by_id" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_receipts_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_receipts_unit_cost_check" CHECK ("unit_cost" >= 0),
  CONSTRAINT "inventory_receipts_reference_check" CHECK ("source_reference" IS NULL OR length(btrim("source_reference")) > 0),
  CONSTRAINT "inventory_receipts_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "inventory_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES public."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_receipts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES public."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_receipts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "inventory_receipts_request_id_key" ON public."inventory_receipts"("request_id");
CREATE INDEX "inventory_receipts_warehouse_id_product_id_created_at_idx" ON public."inventory_receipts"("warehouse_id", "product_id", "created_at");
CREATE INDEX "inventory_receipts_created_by_id_created_at_idx" ON public."inventory_receipts"("created_by_id", "created_at");

ALTER TABLE public."inventory_serials" ALTER COLUMN "opening_id" DROP NOT NULL;
ALTER TABLE public."inventory_serials" ADD COLUMN "receipt_id" BIGINT;
ALTER TABLE public."inventory_serials" ADD CONSTRAINT "inventory_serials_receipt_id_fkey"
  FOREIGN KEY ("receipt_id") REFERENCES public."inventory_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public."inventory_serials" ADD CONSTRAINT "inventory_serials_one_source_check"
  CHECK (("opening_id" IS NOT NULL) <> ("receipt_id" IS NOT NULL));
CREATE INDEX "inventory_serials_receipt_id_idx" ON public."inventory_serials"("receipt_id");

END;
$receiving_upgrade$;
