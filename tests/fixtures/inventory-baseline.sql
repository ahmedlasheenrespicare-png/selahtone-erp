CREATE TYPE "RoleCode" AS ENUM ('MANAGER', 'ACCOUNTANT', 'CS_AGENT');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "ProductCategory" AS ENUM ('HEARING_AID', 'ACCESSORY', 'SPARE_PART', 'SERVICE');
CREATE TYPE "TaxKind" AS ENUM ('VAT', 'SCHEDULE', 'WITHHOLDING', 'COMPOSITE', 'EXEMPT');
CREATE TABLE "branches" (
 "id" BIGSERIAL PRIMARY KEY, "code" VARCHAR(8) NOT NULL UNIQUE, "name_ar" VARCHAR(120) NOT NULL,
 "city" VARCHAR(80), "phone" VARCHAR(30), "invoice_prefix" VARCHAR(6) NOT NULL,
 "opening_date" DATE, "is_active" BOOLEAN NOT NULL DEFAULT TRUE, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "users" (
 "id" BIGSERIAL PRIMARY KEY, "branch_id" BIGINT REFERENCES "branches"("id"), "role_code" "RoleCode" NOT NULL,
 "full_name" VARCHAR(120) NOT NULL, "email" VARCHAR(160) NOT NULL UNIQUE, "phone" VARCHAR(30), "password_hash" TEXT NOT NULL,
 "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE', "must_change_password" BOOLEAN NOT NULL DEFAULT TRUE,
 "last_login_at" TIMESTAMPTZ, "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "tax_rates" (
 "id" SERIAL PRIMARY KEY, "code" VARCHAR(20) NOT NULL UNIQUE, "name_ar" VARCHAR(140) NOT NULL,
 "rate" DECIMAL(6,3) NOT NULL, "kind" "TaxKind" NOT NULL DEFAULT 'VAT', "effective_from" DATE NOT NULL DEFAULT CURRENT_DATE,
 "effective_to" DATE, "is_default" BOOLEAN NOT NULL DEFAULT FALSE, "is_active" BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE "warehouses" (
 "id" BIGSERIAL PRIMARY KEY, "branch_id" BIGINT NOT NULL REFERENCES "branches"("id"), "code" VARCHAR(12) NOT NULL UNIQUE,
 "name_ar" VARCHAR(100) NOT NULL, "is_default" BOOLEAN NOT NULL DEFAULT FALSE, "holds_stock" BOOLEAN NOT NULL DEFAULT TRUE,
 "is_active" BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE("branch_id", "name_ar")
);
CREATE TABLE "products" (
 "id" BIGSERIAL PRIMARY KEY, "sku" VARCHAR(40) NOT NULL UNIQUE, "name_ar" VARCHAR(180) NOT NULL, "category" "ProductCategory" NOT NULL,
 "brand" VARCHAR(80), "model" VARCHAR(80), "purchase_cost" DECIMAL(14,2) NOT NULL DEFAULT 0, "sale_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
 "tax_rate_id" INTEGER REFERENCES "tax_rates"("id"), "is_serialized" BOOLEAN NOT NULL DEFAULT FALSE, "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
 "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "stock_levels" (
 "id" BIGSERIAL PRIMARY KEY, "warehouse_id" BIGINT NOT NULL REFERENCES "warehouses"("id"), "product_id" BIGINT NOT NULL,
 "qty_on_hand" DECIMAL(12,2) NOT NULL DEFAULT 0, "avg_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
 "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("warehouse_id", "product_id")
);
INSERT INTO branches(code,name_ar,invoice_prefix) VALUES ('B1','فرع تجريبي 1','B1'), ('B2','فرع تجريبي 2','B2');
INSERT INTO warehouses(branch_id,code,name_ar,is_active) VALUES (1,'W1','تجريبي 1',TRUE),(2,'W2','تجريبي 2',TRUE),(1,'WX','موقوف',FALSE);
INSERT INTO users(branch_id,role_code,full_name,email,password_hash,status,must_change_password) VALUES
 (NULL,'MANAGER','مدير تجريبي','manager@example.test','fixture','ACTIVE',FALSE),
 (NULL,'ACCOUNTANT','محاسب تجريبي','accountant@example.test','fixture','ACTIVE',FALSE),
 (1,'CS_AGENT','موظف تجريبي','staff@example.test','fixture','ACTIVE',FALSE),
 (NULL,'MANAGER','مدير موقوف','blocked@example.test','fixture','SUSPENDED',FALSE);
INSERT INTO tax_rates(code,name_ar,rate,is_active) VALUES ('T5','اختبار',5,TRUE),('OFF','غير نشط',14,FALSE);
INSERT INTO products(sku,name_ar,category,is_serialized,is_active) VALUES
 ('EXIST-HA','سماعة موجودة','HEARING_AID',TRUE,TRUE),
 ('EXIST-ACC','مستلزم','ACCESSORY',FALSE,TRUE),
 ('SERVICE','خدمة','SERVICE',FALSE,TRUE),
 ('DISABLED','موقوف','ACCESSORY',FALSE,FALSE),
 ('PRE-EXIST','لديه رصيد','ACCESSORY',FALSE,TRUE);
INSERT INTO stock_levels(warehouse_id,product_id,qty_on_hand,avg_cost) VALUES (1,5,0,0);
