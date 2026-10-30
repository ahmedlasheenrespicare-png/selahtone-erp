-- Fictional disposable fixture based on the audited Prisma table shape.
-- Counts and names here are not production data.
CREATE TABLE public.expense_categories (
  id SERIAL PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name_ar VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE public.expenses (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES public.expense_categories(id),
  amount NUMERIC(14,2) NOT NULL,
  expense_date DATE NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  requested_by BIGINT NOT NULL,
  approved_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.journal_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_no VARCHAR(24) NOT NULL UNIQUE,
  entry_date DATE NOT NULL,
  source_type VARCHAR(20) NOT NULL,
  source_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_type,source_id)
);
INSERT INTO public.expense_categories(code,name_ar,is_active) VALUES
 ('OLD-1','بند افتراضي ألف',TRUE),('OLD-2','بند افتراضي باء',TRUE),
 ('OLD-3','بند افتراضي جيم',TRUE),('OLD-4','بند افتراضي دال',TRUE),
 ('OLD-5','بند افتراضي هاء',TRUE),('OLD-6','بند افتراضي واو',FALSE),
 ('OLD-7','بند افتراضي زاي',TRUE);
