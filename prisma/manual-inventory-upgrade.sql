-- إضافة جداول الإدخال اليدوي فقط. لا يُشغّل على الإنتاج دون مراجعة وموافقة صريحة.
-- يفشل التنفيذ ويتراجع عند تعارض الأسماء أو تعذر إنشاء المراجع المطلوبة.
-- لا يفحص كامل المخطط الحالي أو هوية قاعدة التطبيق؛ تجب مراجعتهما قبل التشغيل.
-- أمر DO واحد حتى يتراجع الإنشاء كله عند فشل أي خطوة، حتى في محرر يقسم الأوامر.
DO $inventory_upgrade$
BEGIN
PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

CREATE TABLE public."inventory_openings" (
  "id" BIGSERIAL NOT NULL,
  "request_id" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "warehouse_id" BIGINT NOT NULL,
  "product_id" BIGINT NOT NULL,
  "quantity" DECIMAL(12,2) NOT NULL,
  "unit_cost" DECIMAL(14,4) NOT NULL,
  "created_by_id" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_openings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_openings_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_openings_unit_cost_check" CHECK ("unit_cost" >= 0),
  CONSTRAINT "inventory_openings_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "inventory_openings_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES public."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_openings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES public."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_openings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "inventory_openings_request_id_key" ON public."inventory_openings"("request_id");
CREATE UNIQUE INDEX "inventory_openings_warehouse_id_product_id_key" ON public."inventory_openings"("warehouse_id", "product_id");
CREATE INDEX "inventory_openings_created_by_id_created_at_idx" ON public."inventory_openings"("created_by_id", "created_at");

CREATE TABLE public."inventory_serials" (
  "id" BIGSERIAL NOT NULL,
  "opening_id" BIGINT NOT NULL,
  "serial_number" VARCHAR(80) NOT NULL,
  "serial_key" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_serials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_serials_number_check" CHECK (length(btrim("serial_number")) > 0),
  CONSTRAINT "inventory_serials_key_check" CHECK (length(btrim("serial_key")) > 0),
  CONSTRAINT "inventory_serials_opening_id_fkey" FOREIGN KEY ("opening_id") REFERENCES public."inventory_openings"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "inventory_serials_serial_key_key" ON public."inventory_serials"("serial_key");
CREATE INDEX "inventory_serials_opening_id_idx" ON public."inventory_serials"("opening_id");

CREATE TABLE public."inventory_product_creations" (
  "id" BIGSERIAL NOT NULL,
  "request_id" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "product_id" BIGINT NOT NULL,
  "created_by_id" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_product_creations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_product_creations_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "inventory_product_creations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES public."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_product_creations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES public."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "inventory_product_creations_request_id_key" ON public."inventory_product_creations"("request_id");
CREATE UNIQUE INDEX "inventory_product_creations_product_id_key" ON public."inventory_product_creations"("product_id");
CREATE INDEX "inventory_product_creations_created_by_id_created_at_idx" ON public."inventory_product_creations"("created_by_id", "created_at");

END;
$inventory_upgrade$;
