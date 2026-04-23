-- Active Acquisitions Project Financial Manager - Schema
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS qb_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    parent_id INTEGER REFERENCES qb_codes(id) ON DELETE RESTRICT,
    level INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS idx_qb_codes_parent ON qb_codes(parent_id);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(32) NOT NULL DEFAULT 'pm',
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_members (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL DEFAULT 'pm',
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

CREATE TABLE IF NOT EXISTS budget_lines (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    qb_code_id INTEGER NOT NULL REFERENCES qb_codes(id),
    original_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    current_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, qb_code_id)
);
CREATE INDEX IF NOT EXISTS idx_budget_lines_project ON budget_lines(project_id);

CREATE TABLE IF NOT EXISTS budget_line_logs (
    id SERIAL PRIMARY KEY,
    budget_line_id INTEGER NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
    old_amount NUMERIC(14,2) NOT NULL,
    new_amount NUMERIC(14,2) NOT NULL,
    changed_by INTEGER NOT NULL REFERENCES users(id),
    note TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_budget_line_logs_line ON budget_line_logs(budget_line_id);

CREATE TABLE IF NOT EXISTS contracts (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    vendor_name VARCHAR(255) NOT NULL,
    description TEXT,
    total_value NUMERIC(14,2) NOT NULL DEFAULT 0,
    contract_date DATE,
    reference_number VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    file_reference VARCHAR(1024),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);

CREATE TABLE IF NOT EXISTS contract_lines (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    qb_code_id INTEGER NOT NULL REFERENCES qb_codes(id),
    amount NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_lines_contract ON contract_lines(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_lines_code ON contract_lines(qb_code_id);

CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
    invoice_number VARCHAR(128) NOT NULL,
    vendor_name VARCHAR(255) NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    invoice_date DATE,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    paid_date DATE,
    qb_reference_id VARCHAR(128),
    file_reference VARCHAR(1024),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_contract ON invoices(contract_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- Vendors: seeded from a QuickBooks export. Used for smart-search on the
-- contract vendor field. Kept as a separate table rather than free-text so
-- we can link to QB IDs once real QB integration lands.
CREATE TABLE IF NOT EXISTS vendors (
    id SERIAL PRIMARY KEY,
    qb_id VARCHAR(64),
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendors_name ON vendors (LOWER(name));

-- Customers from QuickBooks map to projects in this app. Seeded from a QB
-- export and used for smart-search on the New Project form.
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    qb_id VARCHAR(64),
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (LOWER(name));

-- Session store used by connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
) WITH (OIDS=FALSE);
DO $$ BEGIN
    -- A duplicate PRIMARY KEY raises invalid_table_definition (42P16),
    -- not duplicate_object. Use a presence check instead so re-running the
    -- schema is a no-op.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'session_pkey'
          AND conrelid = '"session"'::regclass
    ) THEN
        ALTER TABLE "session" ADD CONSTRAINT "session_pkey"
            PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- ---------- Migrations for existing databases ----------
-- Make invoices.contract_id nullable (standalone invoices).
DO $$ BEGIN
    ALTER TABLE invoices ALTER COLUMN contract_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;
-- Add project_id directly on invoices so standalone invoices know their project.
DO $$ BEGIN
    ALTER TABLE invoices ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id);
-- Add qb_code_id directly on invoices for filtering (optional, for standalone invoices).
DO $$ BEGIN
    ALTER TABLE invoices ADD COLUMN qb_code_id INTEGER REFERENCES qb_codes(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Audit trail for invoices (who did what, when, and why).
CREATE TABLE IF NOT EXISTS invoice_logs (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    action VARCHAR(32) NOT NULL,
    detail TEXT,
    changed_by INTEGER NOT NULL REFERENCES users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_logs_invoice ON invoice_logs(invoice_id);

-- Audit trail for contracts.
CREATE TABLE IF NOT EXISTS contract_logs (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    action VARCHAR(32) NOT NULL,
    detail TEXT,
    changed_by INTEGER NOT NULL REFERENCES users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_logs_contract ON contract_logs(contract_id);

-- Rejection note on invoices.
DO $$ BEGIN
    ALTER TABLE invoices ADD COLUMN rejection_note TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Invoice-to-contract allocations: allows one invoice to span multiple contracts.
-- Each row says "this invoice allocates $X to this contract."
-- For single-contract invoices, there will be one row matching invoices.contract_id.
CREATE TABLE IF NOT EXISTS invoice_contracts (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL,
    UNIQUE (invoice_id, contract_id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_contracts_invoice ON invoice_contracts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_contracts_contract ON invoice_contracts(contract_id);

-- ---- Phase 1: Cost control additions ----------------------------------------

-- Earmarked amount on contracts (internal budget > contract value).
DO $$ BEGIN
    ALTER TABLE contracts ADD COLUMN earmarked_amount NUMERIC(14,2);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Rename total_value alias: we keep total_value in DB for compat but
-- surface it as "estimated_cost" in the API layer.

-- Change Orders: formal modifications to a contract's scope/cost.
CREATE TABLE IF NOT EXISTS change_orders (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    co_number VARCHAR(64),                      -- e.g. "CO-001"
    description TEXT NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending|approved|rejected
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejection_note TEXT,
    file_reference VARCHAR(1024),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_change_orders_contract ON change_orders(contract_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_status ON change_orders(status);

-- Change order audit log.
CREATE TABLE IF NOT EXISTS change_order_logs (
    id SERIAL PRIMARY KEY,
    change_order_id INTEGER NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
    action VARCHAR(32) NOT NULL,
    detail TEXT,
    changed_by INTEGER NOT NULL REFERENCES users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_co_logs_co ON change_order_logs(change_order_id);

-- Time & Material charges: non-contract billable work linked to a contract.
CREATE TABLE IF NOT EXISTS tm_charges (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    hours NUMERIC(8,2),
    rate NUMERIC(10,2),
    amount NUMERIC(14,2) NOT NULL,
    charge_date DATE,
    qb_code_id INTEGER REFERENCES qb_codes(id),
    file_reference VARCHAR(1024),
    status VARCHAR(32) NOT NULL DEFAULT 'pending',  -- pending|approved|rejected
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tm_charges_contract ON tm_charges(contract_id);

-- Contract Expenses: reimbursable expenses (travel, tolls, hotels, food).
CREATE TABLE IF NOT EXISTS contract_expenses (
    id SERIAL PRIMARY KEY,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    category VARCHAR(64) NOT NULL DEFAULT 'other', -- travel|tolls|food|hotel|copies|other
    description TEXT,
    amount NUMERIC(14,2) NOT NULL,
    expense_date DATE,
    qb_code_id INTEGER REFERENCES qb_codes(id),
    file_reference VARCHAR(1024),
    status VARCHAR(32) NOT NULL DEFAULT 'pending',  -- pending|approved|rejected
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_expenses_contract ON contract_expenses(contract_id);

-- Additional columns for T&M charges and expenses (rejection notes, notes field).
DO $$ BEGIN ALTER TABLE tm_charges ADD COLUMN rejection_note TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tm_charges ADD COLUMN notes TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE contract_expenses ADD COLUMN rejection_note TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE contract_expenses ADD COLUMN notes TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── 3-tier approval chain (PM → Partner → Admin) ─────────────────────────────
-- invoices
DO $$ BEGIN ALTER TABLE invoices ADD COLUMN pm_approved_by INTEGER REFERENCES users(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE invoices ADD COLUMN pm_approved_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE invoices ADD COLUMN partner_approved_by INTEGER REFERENCES users(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE invoices ADD COLUMN partner_approved_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- change_orders
DO $$ BEGIN ALTER TABLE change_orders ADD COLUMN pm_approved_by INTEGER REFERENCES users(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE change_orders ADD COLUMN pm_approved_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE change_orders ADD COLUMN partner_approved_by INTEGER REFERENCES users(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE change_orders ADD COLUMN partner_approved_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
-- Change orders: T&M authorization fields
DO $$ BEGIN ALTER TABLE change_orders ADD COLUMN tm_authorized BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE change_orders ADD COLUMN tm_not_to_exceed NUMERIC(14,2); EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- tm_charges
DO $$ BEGIN ALTER TABLE tm_charges ADD COLUMN pm_approved_by INTEGER REFERENCES users(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tm_charges ADD COLUMN pm_approved_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tm_charges ADD COLUMN partner_approved_by INTEGER REFERENCES users(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tm_charges ADD COLUMN partner_approved_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
-- Link T&M charges to a specific change order (when they bill against CO scope).
DO $$ BEGIN ALTER TABLE tm_charges ADD COLUMN change_order_id INTEGER REFERENCES change_orders(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Invoice type: 'fixed' invoices count against contract value; 'tm' and 'expense' invoices
-- represent additional costs (T&M hours billed, reimbursables) and do NOT erode the fixed commitment.
DO $$ BEGIN ALTER TABLE invoices ADD COLUMN invoice_type VARCHAR(16) NOT NULL DEFAULT 'fixed'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Budget tree view additions
DO $$ BEGIN ALTER TABLE budget_lines ADD COLUMN uncommitted_estimate NUMERIC(14,2) NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE change_orders ADD COLUMN qb_code_id INTEGER REFERENCES qb_codes(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- contract_expenses
DO $$ BEGIN ALTER TABLE contract_expenses ADD COLUMN pm_approved_by INTEGER REFERENCES users(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE contract_expenses ADD COLUMN pm_approved_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE contract_expenses ADD COLUMN partner_approved_by INTEGER REFERENCES users(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE contract_expenses ADD COLUMN partner_approved_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- File storage in Postgres (replaces ephemeral local disk).
CREATE TABLE IF NOT EXISTS files (
    id VARCHAR(36) PRIMARY KEY,
    filename VARCHAR(512) NOT NULL DEFAULT 'upload',
    mime_type VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
    data BYTEA NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Vendor knowledge base ─────────────────────────────────────────────────────

-- Confirmed extractions stored as few-shot examples for future Claude calls.
-- Every time a PM confirms and saves a contract or invoice, the verified fields
-- land here. Next time a doc from the same vendor arrives, these feed into the
-- extraction prompt so Claude already "knows" the vendor's document format.
CREATE TABLE IF NOT EXISTS extraction_examples (
    id           SERIAL PRIMARY KEY,
    vendor_name  VARCHAR(255) NOT NULL,
    document_type VARCHAR(16) NOT NULL CHECK (document_type IN ('contract','invoice','tm_charge','expense')),
    fields_json  JSONB NOT NULL,
    confirmed_by INTEGER NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Extend document_type constraint to include tm_charge and expense.
DO $$ BEGIN
    ALTER TABLE extraction_examples DROP CONSTRAINT IF EXISTS extraction_examples_document_type_check;
    ALTER TABLE extraction_examples ADD CONSTRAINT extraction_examples_document_type_check
        CHECK (document_type IN ('contract','invoice','tm_charge','expense'));
EXCEPTION WHEN others THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_extraction_examples_vendor ON extraction_examples(LOWER(vendor_name));
CREATE INDEX IF NOT EXISTS idx_extraction_examples_type   ON extraction_examples(document_type);

-- Human-readable vendor notes injected as context into every extraction call
-- for that vendor. Admins can add rate cards, invoice format quirks, etc.
CREATE TABLE IF NOT EXISTS vendor_profiles (
    id          SERIAL PRIMARY KEY,
    vendor_name VARCHAR(255) NOT NULL UNIQUE,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_vendor ON vendor_profiles(LOWER(vendor_name));
