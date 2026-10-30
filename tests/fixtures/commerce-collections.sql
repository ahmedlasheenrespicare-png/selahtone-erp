-- Fictional disposable fixture: the minimum of the real commerce tables the
-- settlement period total reads. Not production data.
CREATE TABLE IF NOT EXISTS public.commerce_sales (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public.commerce_collections (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES public.commerce_sales(id),
  amount NUMERIC(14,2) NOT NULL,
  method VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
