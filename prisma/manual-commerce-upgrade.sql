-- DRAFT FOR ISOLATED TESTS ONLY — NOT APPROVED OR VERIFIED FOR PRODUCTION.
-- Depends on manual-receiving-upgrade.sql. Adds new tables and alters an existing
-- serials table. Never run on a real database without separate explicit approval,
-- a fresh verified backup, schema/data audit, tax review and rollback plan.
-- A single DO statement makes all DDL and the default 5% setting atomic.
DO $commerce_upgrade$
BEGIN
PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

CREATE TABLE public."commerce_settings" (
  "id" SMALLINT PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "staff_discount_bps" INTEGER NOT NULL DEFAULT 500 CHECK ("staff_discount_bps" BETWEEN 0 AND 10000),
  "updated_by_id" BIGINT REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO public."commerce_settings"("id", "staff_discount_bps") VALUES (1, 500);
CREATE TABLE public."commerce_settings_changes" (
  "id" BIGSERIAL PRIMARY KEY, "request_id" UUID NOT NULL, "request_hash" CHAR(64) NOT NULL,
  "staff_discount_bps" INTEGER NOT NULL CHECK ("staff_discount_bps" BETWEEN 0 AND 10000),
  "created_by_id" BIGINT NOT NULL REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commerce_settings_changes_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "commerce_settings_changes_request_id_key" ON public."commerce_settings_changes"("request_id");
CREATE INDEX "commerce_settings_changes_created_at_idx" ON public."commerce_settings_changes"("created_at");

CREATE TABLE public."commerce_sales" (
  "id" BIGSERIAL PRIMARY KEY, "request_id" UUID NOT NULL, "request_hash" CHAR(64) NOT NULL,
  "branch_id" BIGINT NOT NULL REFERENCES public."branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "warehouse_id" BIGINT NOT NULL REFERENCES public."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "customer_name" VARCHAR(180) NOT NULL, "customer_phone" VARCHAR(30) NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL, "discount" DECIMAL(14,2) NOT NULL,
  "taxable_base" DECIMAL(14,2) NOT NULL, "tax_total" DECIMAL(14,2) NOT NULL, "total" DECIMAL(14,2) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "cancelled_at" TIMESTAMPTZ,
  "created_by_id" BIGINT NOT NULL REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commerce_sales_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "commerce_sales_customer_check" CHECK (length(btrim("customer_name")) > 0 AND length(btrim("customer_phone")) > 0),
  CONSTRAINT "commerce_sales_amounts_check" CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "taxable_base" >= 0 AND "tax_total" >= 0 AND "total" > 0 AND "subtotal" = "discount" + "total" AND "taxable_base" + "tax_total" = "total")
);
CREATE UNIQUE INDEX "commerce_sales_request_id_key" ON public."commerce_sales"("request_id");
CREATE INDEX "commerce_sales_branch_id_created_at_idx" ON public."commerce_sales"("branch_id", "created_at");
CREATE INDEX "commerce_sales_created_by_id_created_at_idx" ON public."commerce_sales"("created_by_id", "created_at");

CREATE TABLE public."commerce_sale_lines" (
  "id" BIGSERIAL PRIMARY KEY,
  "sale_id" BIGINT NOT NULL REFERENCES public."commerce_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "product_id" BIGINT NOT NULL REFERENCES public."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sku_snapshot" VARCHAR(40) NOT NULL, "name_snapshot" VARCHAR(180) NOT NULL,
  "quantity" DECIMAL(12,2) NOT NULL, "unit_price" DECIMAL(14,2) NOT NULL,
  "tax_rate_id" INTEGER NOT NULL REFERENCES public."tax_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tax_code_snapshot" VARCHAR(20) NOT NULL, "tax_kind_snapshot" VARCHAR(12) NOT NULL, "tax_rate_snapshot" DECIMAL(6,3) NOT NULL,
  "gross" DECIMAL(14,2) NOT NULL, "discount" DECIMAL(14,2) NOT NULL,
  "taxable_base" DECIMAL(14,2) NOT NULL, "tax_amount" DECIMAL(14,2) NOT NULL, "total" DECIMAL(14,2) NOT NULL,
  "unit_cost" DECIMAL(14,4), "is_stock" BOOLEAN NOT NULL, "is_serialized" BOOLEAN NOT NULL,
  CONSTRAINT "commerce_sale_lines_quantity_check" CHECK ("quantity" > 0 AND (NOT "is_serialized" OR ("is_stock" AND "quantity" = trunc("quantity")))),
  CONSTRAINT "commerce_sale_lines_cost_check" CHECK ("is_stock" = ("unit_cost" IS NOT NULL) AND ("unit_cost" IS NULL OR "unit_cost" >= 0)),
  CONSTRAINT "commerce_sale_lines_tax_check" CHECK ("tax_kind_snapshot" IN ('VAT','SCHEDULE','EXEMPT') AND "tax_rate_snapshot" BETWEEN 0 AND 100 AND ("tax_kind_snapshot" <> 'EXEMPT' OR "tax_rate_snapshot" = 0)),
  CONSTRAINT "commerce_sale_lines_amounts_check" CHECK ("unit_price" >= 0 AND "gross" >= 0 AND "discount" >= 0 AND "taxable_base" >= 0 AND "tax_amount" >= 0 AND "total" >= 0 AND "gross" = "discount" + "total" AND "taxable_base" + "tax_amount" = "total")
);
CREATE UNIQUE INDEX "commerce_sale_lines_sale_id_product_id_key" ON public."commerce_sale_lines"("sale_id", "product_id");

ALTER TABLE public."inventory_serials" ADD COLUMN "current_sale_line_id" BIGINT;
ALTER TABLE public."inventory_serials" ADD CONSTRAINT "inventory_serials_current_sale_line_id_fkey"
  FOREIGN KEY ("current_sale_line_id") REFERENCES public."commerce_sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "inventory_serials_current_sale_line_id_idx" ON public."inventory_serials"("current_sale_line_id");
CREATE TABLE public."commerce_sale_line_serials" (
  "id" BIGSERIAL PRIMARY KEY,
  "sale_line_id" BIGINT NOT NULL REFERENCES public."commerce_sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "serial_id" BIGINT NOT NULL REFERENCES public."inventory_serials"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "commerce_sale_line_serials_sale_line_id_serial_id_key" ON public."commerce_sale_line_serials"("sale_line_id", "serial_id");
CREATE INDEX "commerce_sale_line_serials_serial_id_idx" ON public."commerce_sale_line_serials"("serial_id");

CREATE TABLE public."commerce_collections" (
  "id" BIGSERIAL PRIMARY KEY, "request_id" UUID NOT NULL, "request_hash" CHAR(64) NOT NULL,
  "sale_id" BIGINT NOT NULL REFERENCES public."commerce_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" > 0), "method" VARCHAR(16) NOT NULL CHECK ("method" IN ('CASH','CARD','BANK_TRANSFER','WALLET')),
  "is_initial" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_by_id" BIGINT NOT NULL REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commerce_collections_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "commerce_collections_request_id_key" ON public."commerce_collections"("request_id");
CREATE UNIQUE INDEX "commerce_collections_initial_per_sale_key" ON public."commerce_collections"("sale_id") WHERE "is_initial";
CREATE INDEX "commerce_collections_sale_id_created_at_idx" ON public."commerce_collections"("sale_id", "created_at");

CREATE TABLE public."commerce_returns" (
  "id" BIGSERIAL PRIMARY KEY, "request_id" UUID NOT NULL, "request_hash" CHAR(64) NOT NULL,
  "sale_id" BIGINT NOT NULL REFERENCES public."commerce_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "is_cancellation" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_by_id" BIGINT NOT NULL REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commerce_returns_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "commerce_returns_request_id_key" ON public."commerce_returns"("request_id");
CREATE INDEX "commerce_returns_sale_id_created_at_idx" ON public."commerce_returns"("sale_id", "created_at");
CREATE TABLE public."commerce_return_lines" (
  "id" BIGSERIAL PRIMARY KEY,
  "return_id" BIGINT NOT NULL REFERENCES public."commerce_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sale_line_id" BIGINT NOT NULL REFERENCES public."commerce_sale_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "quantity" DECIMAL(12,2) NOT NULL CHECK ("quantity" > 0),
  "total" DECIMAL(14,2) NOT NULL CHECK ("total" >= 0),
  "tax_amount" DECIMAL(14,2) NOT NULL CHECK ("tax_amount" >= 0 AND "tax_amount" <= "total")
);
CREATE UNIQUE INDEX "commerce_return_lines_return_id_sale_line_id_key" ON public."commerce_return_lines"("return_id", "sale_line_id");
CREATE INDEX "commerce_return_lines_sale_line_id_idx" ON public."commerce_return_lines"("sale_line_id");
CREATE TABLE public."commerce_return_serials" (
  "id" BIGSERIAL PRIMARY KEY,
  "return_line_id" BIGINT NOT NULL REFERENCES public."commerce_return_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sale_line_serial_id" BIGINT NOT NULL REFERENCES public."commerce_sale_line_serials"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "commerce_return_serials_sale_line_serial_id_key" ON public."commerce_return_serials"("sale_line_serial_id");
CREATE INDEX "commerce_return_serials_return_line_id_idx" ON public."commerce_return_serials"("return_line_id");

CREATE TABLE public."commerce_refunds" (
  "id" BIGSERIAL PRIMARY KEY, "request_id" UUID NOT NULL, "request_hash" CHAR(64) NOT NULL,
  "sale_id" BIGINT NOT NULL REFERENCES public."commerce_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" > 0), "method" VARCHAR(16) NOT NULL CHECK ("method" IN ('CASH','CARD','BANK_TRANSFER','WALLET')),
  "created_by_id" BIGINT NOT NULL REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commerce_refunds_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "commerce_refunds_request_id_key" ON public."commerce_refunds"("request_id");
CREATE INDEX "commerce_refunds_sale_id_created_at_idx" ON public."commerce_refunds"("sale_id", "created_at");
END;
$commerce_upgrade$;
