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
