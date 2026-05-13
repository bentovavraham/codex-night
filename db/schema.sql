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

DO $$ BEGIN ALTER TABLE projects ADD COLUMN project_type TEXT DEFAULT 'industrial'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE projects ADD COLUMN address TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE projects ADD COLUMN notes TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Phases are the primary unit of budget and reconciliation work inside a project.
CREATE TABLE IF NOT EXISTS phases (
    id           SERIAL PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    phase_number INTEGER,
    status       TEXT    NOT NULL DEFAULT 'active',
    start_date   DATE,
    end_date     DATE,
    notes        TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phases_project ON phases(project_id);
DO $$ BEGIN ALTER TABLE phases ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(); EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- QuickBooks Chart of Accounts. This is the GL spine used by budgets,
-- contract line items, invoice line items, allocations, and reconciliation.
CREATE TABLE IF NOT EXISTS qb_accounts (
    id             SERIAL PRIMARY KEY,
    account_number TEXT    NOT NULL UNIQUE,
    full_name      TEXT    NOT NULL,
    short_name     TEXT    NOT NULL,
    parent_id      INTEGER REFERENCES qb_accounts(id),
    category       TEXT,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_leaf        BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qb_accounts_parent ON qb_accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_qb_accounts_number ON qb_accounts(account_number);

-- Phase budget lines. A phase can intentionally have multiple PM tasks under
-- one GL account; writes must therefore store both qb_account_id and the exact
-- phase_budget_line_id when allocating dollars.
CREATE TABLE IF NOT EXISTS phase_budget_lines (
    id                  SERIAL PRIMARY KEY,
    phase_id            INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
    task_name           TEXT NOT NULL DEFAULT '',
    discipline          TEXT,
    section             TEXT,
    sub_group           TEXT,
    calculation_method  TEXT,
    calc_hint           TEXT,
    budgeted_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
    consultant          TEXT,
    notes               TEXT,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    source              VARCHAR(16) NOT NULL DEFAULT 'template',
    amount_modified     BOOLEAN NOT NULL DEFAULT FALSE,
    qb_account_id       INTEGER REFERENCES qb_accounts(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phase_budget_phase ON phase_budget_lines(phase_id);
CREATE INDEX IF NOT EXISTS idx_phase_budget_qba ON phase_budget_lines(qb_account_id);

DO $$ BEGIN ALTER TABLE phase_budget_lines ADD COLUMN task_name TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE phase_budget_lines ADD COLUMN discipline TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE phase_budget_lines ADD COLUMN section TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE phase_budget_lines ADD COLUMN sub_group TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE phase_budget_lines ADD COLUMN calc_hint TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE phase_budget_lines ADD COLUMN qb_account_id INTEGER REFERENCES qb_accounts(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE phase_budget_lines ALTER COLUMN qb_account_id DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;

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

DO $$ BEGIN ALTER TABLE contracts ADD COLUMN phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE contracts ADD COLUMN phase_budget_line_id INTEGER REFERENCES phase_budget_lines(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE contracts ADD COLUMN source_batch TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_contracts_phase ON contracts(phase_id);
CREATE INDEX IF NOT EXISTS idx_contracts_pbl ON contracts(phase_budget_line_id);

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

-- AIA G703 pay-application line items: each invoice broken down by QB code.
-- current_amount = what is being billed on THIS invoice for this code.
-- previous_billed is computed at query time (sum of prior invoice_lines for same contract+code).
CREATE TABLE IF NOT EXISTS invoice_lines (
    id             SERIAL PRIMARY KEY,
    invoice_id     INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    qb_code_id     INTEGER NOT NULL REFERENCES qb_codes(id),
    current_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_code    ON invoice_lines(qb_code_id);

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

DO $$ BEGIN ALTER TABLE invoices ADD COLUMN phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE invoices ADD COLUMN qb_account_id INTEGER REFERENCES qb_accounts(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE invoices ADD COLUMN source_batch TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_invoices_phase ON invoices(phase_id);

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

DO $$ BEGIN ALTER TABLE projects ADD COLUMN gla_sf NUMERIC(12,0); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE projects ADD COLUMN gla_ac NUMERIC(8,3); EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── Contract line items (tasks within a contract: Fixed / T&M / Expense) ──────
-- Mirrors real contract scope: e.g. Task 1 Fixed $4,800 | Task 2 T&M NTE $X
CREATE TABLE IF NOT EXISTS contract_line_items (
    id              SERIAL PRIMARY KEY,
    contract_id     INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    code            TEXT,
    description     TEXT NOT NULL,
    billing_type    VARCHAR(16) NOT NULL DEFAULT 'fixed'
                        CHECK (billing_type IN ('fixed','tm','expense')),
    budgeted_amount NUMERIC(14,2),          -- NULL = open T&M (no NTE set)
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cli_contract ON contract_line_items(contract_id);

-- ── Invoice line items (rich T&M detail per invoice) ─────────────────────────
-- Replaces invoice_qb_lines for new invoices; old table kept for compat.
-- Each line has its own billing_type + QB code so aggregation into
-- fixed_charges / tm_charges / expense_charges is per line, not per invoice.
CREATE TABLE IF NOT EXISTS invoice_line_items (
    id                    SERIAL PRIMARY KEY,
    invoice_id            INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    contract_line_item_id INTEGER REFERENCES contract_line_items(id) ON DELETE SET NULL,
    billing_type          VARCHAR(16) NOT NULL DEFAULT 'fixed'
                              CHECK (billing_type IN ('fixed','tm','expense')),
    description           TEXT,
    line_date             DATE,
    person                TEXT,
    hours                 NUMERIC(8,2),
    rate                  NUMERIC(10,2),
    amount                NUMERIC(14,2) NOT NULL,
    qb_account_id         INTEGER REFERENCES qb_accounts(id) ON DELETE SET NULL,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ili_invoice      ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ili_contract_line ON invoice_line_items(contract_line_item_id);

-- Legacy invoice-to-GL split table kept for old endpoints/data. New writes use
-- invoice_line_items + financial_allocations.
CREATE TABLE IF NOT EXISTS invoice_qb_lines (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    qb_account_id INTEGER NOT NULL REFERENCES qb_accounts(id) ON DELETE RESTRICT,
    amount NUMERIC(14,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_iql_invoice ON invoice_qb_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_iql_qba ON invoice_qb_lines(qb_account_id);

-- Per-line budget line on invoice_line_items (mirrors contract_line_items.phase_budget_line_id)
DO $$ BEGIN ALTER TABLE invoice_line_items ADD COLUMN phase_budget_line_id INTEGER REFERENCES phase_budget_lines(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_ili_pbl ON invoice_line_items(phase_budget_line_id);

-- Direct budget line link on invoices: allows standalone invoices (no contract)
-- to still roll up into the correct budget line row.
DO $$ BEGIN ALTER TABLE invoices ADD COLUMN phase_budget_line_id INTEGER REFERENCES phase_budget_lines(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_invoices_pbl ON invoices(phase_budget_line_id);

-- Audit log for phase_budget_line changes (amount edits, renames, etc.)
CREATE TABLE IF NOT EXISTS phase_budget_line_logs (
    id             SERIAL PRIMARY KEY,
    line_id        INTEGER NOT NULL REFERENCES phase_budget_lines(id) ON DELETE CASCADE,
    changed_by     INTEGER REFERENCES users(id),
    field          VARCHAR(64) NOT NULL,
    old_value      TEXT,
    new_value      TEXT,
    note           TEXT,
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pbll_line ON phase_budget_line_logs(line_id);

-- Track whether a row came from the template or was added by the user,
-- and whether the budgeted_amount has been manually changed from the template default.
DO $$ BEGIN ALTER TABLE phase_budget_lines ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'template'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE phase_budget_lines ADD COLUMN amount_modified BOOLEAN NOT NULL DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── Bulk import queue ──────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS import_queue (
    id SERIAL PRIMARY KEY,
    phase_id INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
    original_filename VARCHAR(512) NOT NULL,
    file_reference VARCHAR(1024),
    doc_type VARCHAR(16),
    doc_type_confidence VARCHAR(16),
    extracted_data JSONB,
    suggested_budget_line_id INTEGER REFERENCES phase_budget_lines(id) ON DELETE SET NULL,
    match_confidence VARCHAR(16),
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    confirmed_contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
    confirmed_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    error_message TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_import_queue_phase ON import_queue(phase_id);

-- Per-line budget line allocation: allows one contract to span multiple budget lines.
DO $$ BEGIN
  ALTER TABLE contract_line_items
    ADD COLUMN phase_budget_line_id INT REFERENCES phase_budget_lines(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_cli_pbl ON contract_line_items(phase_budget_line_id);

-- QB account per contract line item (mirrors invoice_line_items.qb_account_id)
DO $$ BEGIN
  ALTER TABLE contract_line_items
    ADD COLUMN qb_account_id INT REFERENCES qb_accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Allow multiple tasks per (phase, qb_account): hybrid model where tasks keep
-- granularity but roll up to the GL code for QB reconciliation.
DO $$ BEGIN
  ALTER TABLE phase_budget_lines DROP CONSTRAINT IF EXISTS phase_budget_lines_phase_id_qb_account_id_key;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ── Audit Mode ────────────────────────────────────────────────────────────────

-- Project aliases: one project can be known by multiple names
-- (e.g. "Richwood" = "Madison Marquette" = "Madison").
-- Used when matching imported invoices to a project.
CREATE TABLE IF NOT EXISTS project_aliases (
    id         SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    alias      VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (alias)
);
CREATE INDEX IF NOT EXISTS idx_project_aliases_project ON project_aliases(project_id);

-- Raw QuickBooks transactions imported from an Excel export.
-- One row per QB bill/expense line. Multiple imports are additive;
-- re-importing the same ref_number + vendor is ignored (ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS qb_transactions (
    id              SERIAL PRIMARY KEY,
    phase_id        INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
    txn_date        DATE,
    vendor_name     VARCHAR(255),
    ref_number      VARCHAR(128),          -- QB invoice/bill number
    memo            TEXT,
    qb_gl_code      VARCHAR(32),           -- GL code as entered in QB
    qb_gl_name      VARCHAR(255),          -- GL account name from QB
    qb_project      VARCHAR(255),          -- Customer/Job field from QB
    amount          NUMERIC(14,2),
    paid_amount     NUMERIC(14,2) DEFAULT 0,
    open_balance    NUMERIC(14,2),
    is_paid         BOOLEAN NOT NULL DEFAULT FALSE,
    raw_row         JSONB,                 -- original Excel row for reference
    imported_by     INTEGER REFERENCES users(id),
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (phase_id, vendor_name, ref_number, amount)
);
CREATE INDEX IF NOT EXISTS idx_qb_txn_phase   ON qb_transactions(phase_id);
CREATE INDEX IF NOT EXISTS idx_qb_txn_vendor  ON qb_transactions(LOWER(vendor_name));
CREATE INDEX IF NOT EXISTS idx_qb_txn_ref     ON qb_transactions(ref_number);

-- Link each invoice to a matched QB transaction (set during auto-match or manual link).
DO $$ BEGIN
  ALTER TABLE invoices ADD COLUMN qb_transaction_id INTEGER REFERENCES qb_transactions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- PM-validated correct GL account for this invoice (may differ from what QB has).
DO $$ BEGIN
  ALTER TABLE invoices ADD COLUMN pm_validated_gl_id INTEGER REFERENCES qb_accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Reconciliation status computed (or overridden) per invoice.
-- matched | amount_mismatch | gl_mismatch | missing_in_qb | missing_source | duplicate
DO $$ BEGIN
  ALTER TABLE invoices ADD COLUMN recon_status VARCHAR(32);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Project keyword aliases for import matching (e.g. "Richwood,North Harrison,24117")
DO $$ BEGIN
  ALTER TABLE projects ADD COLUMN keywords TEXT[];
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Learned mapping: vendor internal job number → project
-- Populated automatically when invoices are confirmed.
CREATE TABLE IF NOT EXISTS vendor_project_map (
  id              SERIAL PRIMARY KEY,
  vendor_name     TEXT    NOT NULL,
  vendor_job_number TEXT  NOT NULL,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  confirmed_count INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_name, vendor_job_number)
);

-- Change Order line items — mirror of contract_line_items so a CO can be
-- multi-line with per-line GL code (qb_account_id) and per-line task
-- (phase_budget_line_id). Budget grid's COS column rolls up from these.
CREATE TABLE IF NOT EXISTS change_order_line_items (
  id                    SERIAL PRIMARY KEY,
  change_order_id       INTEGER NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  billing_type          VARCHAR(16) NOT NULL DEFAULT 'fixed', -- fixed|tm|expense
  description           TEXT,
  budgeted_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  qb_account_id         INTEGER REFERENCES qb_accounts(id) ON DELETE SET NULL,
  phase_budget_line_id  INTEGER REFERENCES phase_budget_lines(id) ON DELETE SET NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_co_lines_co  ON change_order_line_items(change_order_id);
CREATE INDEX IF NOT EXISTS idx_co_lines_pbl ON change_order_line_items(phase_budget_line_id);
CREATE INDEX IF NOT EXISTS idx_co_lines_qba ON change_order_line_items(qb_account_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- FINANCIAL ALLOCATION LEDGER
-- Architecture decision: 2026-05-09
-- Three layers: source record → allocation splits → reporting grid
-- The database enforces that allocation splits always sum to the source total.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ALLOCATION LAYER
--
-- financial_allocations is the single source of truth for all dollar amounts
-- in the budget grid. Every contract line, invoice line, and CO line that has
-- been confirmed through the import flow has a corresponding row here.
--
-- The budget grid query, drillthrough, and snapshots all aggregate from this
-- table — never directly from contracts or invoices. See ALLOCATION_LAYER.md.
--
-- Introduced: May 2026 (backfill migration run against existing Richwood data)
-- ─────────────────────────────────────────────────────────────────────────────
-- Layer 2: Allocation table — one row per slice of a source line.
-- Amounts are stored here explicitly (not inferred from source records).
-- SUM(amount) for a source line MUST equal the source line's amount.
-- This is enforced by the reconciliation trigger below.
CREATE TABLE IF NOT EXISTS financial_allocations (
  id                    SERIAL PRIMARY KEY,

  -- Source reference — which document and line this allocation belongs to
  source_type           VARCHAR(20) NOT NULL,
  -- 'invoice_line' | 'contract_line' | 'co_line' | 'payment'
  source_document_id    INTEGER NOT NULL,
  -- invoice_id | contract_id | change_order_id | payment_id
  source_line_id        INTEGER,
  -- invoice_line_item_id | contract_line_item_id | change_order_line_item_id

  -- Routing — set explicitly by a human, never inferred at query time
  phase_id              INTEGER NOT NULL REFERENCES phases(id) ON DELETE RESTRICT,
  qb_account_id         INTEGER NOT NULL REFERENCES qb_accounts(id) ON DELETE RESTRICT,
  -- GL code is always required — enforced by NOT NULL
  phase_budget_line_id  INTEGER REFERENCES phase_budget_lines(id) ON DELETE RESTRICT,
  -- Task — null is allowed (lands in needs_review), required for confirmed status
  billing_type          VARCHAR(20),
  -- 'fixed' | 'tm' | 'expense' | 'contract' | 'co' | 'payment'

  -- The allocated slice amount — explicit, never computed
  amount                NUMERIC(14,2) NOT NULL,

  -- Status lifecycle
  allocation_status     VARCHAR(20) NOT NULL DEFAULT 'draft',
  -- draft | confirmed | approved | out_of_balance | needs_review | voided | rejected

  -- Provenance
  allocation_source     VARCHAR(20) NOT NULL DEFAULT 'explicit',
  -- 'explicit' → human set it in the import/edit flow
  -- 'migrated' → backfilled from legacy data, flagged for review

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ,
  updated_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- A source line cannot have two allocation rows for the exact same
  -- GL code + task + billing type combination (prevents accidental duplicates)
  CONSTRAINT uq_allocation_slice
    UNIQUE NULLS NOT DISTINCT (source_type, source_line_id, qb_account_id, phase_budget_line_id, billing_type)
);

CREATE INDEX IF NOT EXISTS idx_fa_source      ON financial_allocations(source_type, source_document_id);
CREATE INDEX IF NOT EXISTS idx_fa_source_line  ON financial_allocations(source_type, source_line_id);
CREATE INDEX IF NOT EXISTS idx_fa_phase        ON financial_allocations(phase_id);
CREATE INDEX IF NOT EXISTS idx_fa_pbl          ON financial_allocations(phase_budget_line_id);
CREATE INDEX IF NOT EXISTS idx_fa_status       ON financial_allocations(allocation_status);

-- Audit log — every change to an allocation is a permanent record
CREATE TABLE IF NOT EXISTS allocation_audit_log (
  id                 SERIAL PRIMARY KEY,
  allocation_id      INTEGER NOT NULL REFERENCES financial_allocations(id) ON DELETE RESTRICT,
  changed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  field_changed      VARCHAR(50),
  old_value          TEXT,
  new_value          TEXT,
  reason             TEXT
);

CREATE INDEX IF NOT EXISTS idx_aal_allocation ON allocation_audit_log(allocation_id);
CREATE INDEX IF NOT EXISTS idx_aal_changed_at ON allocation_audit_log(changed_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- RECONCILIATION TRIGGER
-- After any allocation insert/update/delete, check whether the allocation
-- rows for that source line sum to the source line's amount.
-- If they don't balance: mark the source document out_of_balance.
-- If they do balance:    clear out_of_balance back to its prior status.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_allocation_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_source_type       VARCHAR(20);
  v_source_line_id    INTEGER;
  v_source_amount     NUMERIC(14,2);
  v_allocated_total   NUMERIC(14,2);
  v_diff              NUMERIC(14,2);
BEGIN
  -- Determine which row was affected
  IF TG_OP = 'DELETE' THEN
    v_source_type    := OLD.source_type;
    v_source_line_id := OLD.source_line_id;
  ELSE
    v_source_type    := NEW.source_type;
    v_source_line_id := NEW.source_line_id;
  END IF;

  -- Only check line-level allocations (document-level has no line to sum against)
  IF v_source_line_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Sum all non-voided/non-rejected allocations for this source line
  SELECT COALESCE(SUM(amount), 0)
    INTO v_allocated_total
    FROM financial_allocations
   WHERE source_type    = v_source_type
     AND source_line_id = v_source_line_id
     AND allocation_status NOT IN ('voided', 'rejected');

  -- Look up the official source line amount
  IF v_source_type = 'invoice_line' THEN
    SELECT amount INTO v_source_amount
      FROM invoice_line_items WHERE id = v_source_line_id;
  ELSIF v_source_type = 'contract_line' THEN
    SELECT budgeted_amount INTO v_source_amount
      FROM contract_line_items WHERE id = v_source_line_id;
  ELSIF v_source_type = 'co_line' THEN
    SELECT budgeted_amount INTO v_source_amount
      FROM change_order_line_items WHERE id = v_source_line_id;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_diff := COALESCE(v_source_amount, 0) - v_allocated_total;

  -- Update all allocations for this line with current balance status
  IF ABS(v_diff) > 0.01 THEN
    -- Out of balance — flag every allocation row for this line
    UPDATE financial_allocations
       SET allocation_status = 'out_of_balance',
           updated_at        = NOW()
     WHERE source_type    = v_source_type
       AND source_line_id = v_source_line_id
       AND allocation_status NOT IN ('voided', 'rejected', 'out_of_balance');
  ELSE
    -- Balanced — restore draft status so a human can confirm
    UPDATE financial_allocations
       SET allocation_status = 'draft',
           updated_at        = NOW()
     WHERE source_type    = v_source_type
       AND source_line_id = v_source_line_id
       AND allocation_status = 'out_of_balance';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_check_allocation_balance ON financial_allocations;
CREATE TRIGGER trg_check_allocation_balance
  AFTER INSERT OR UPDATE OR DELETE ON financial_allocations
  FOR EACH ROW EXECUTE FUNCTION check_allocation_balance();

-- ─────────────────────────────────────────────────────────────────────────────
-- NO HARD DELETE TRIGGER
-- Blocks DELETE on financial tables. Records must be voided, not deleted.
-- Applies to: financial_allocations, invoices, contracts, change_orders.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION block_financial_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Hard delete is not permitted on financial records. Set status = ''voided'' instead. Table: %, ID: %',
    TG_TABLE_NAME, OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_no_delete_allocations ON financial_allocations;
CREATE TRIGGER trg_no_delete_allocations
  BEFORE DELETE ON financial_allocations
  FOR EACH ROW EXECUTE FUNCTION block_financial_delete();

DROP TRIGGER IF EXISTS trg_no_delete_invoices ON invoices;
CREATE TRIGGER trg_no_delete_invoices
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION block_financial_delete();

DROP TRIGGER IF EXISTS trg_no_delete_contracts ON contracts;
CREATE TRIGGER trg_no_delete_contracts
  BEFORE DELETE ON contracts
  FOR EACH ROW EXECUTE FUNCTION block_financial_delete();

DROP TRIGGER IF EXISTS trg_no_delete_change_orders ON change_orders;
CREATE TRIGGER trg_no_delete_change_orders
  BEFORE DELETE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION block_financial_delete();

-- ─────────────────────────────────────────────────────────────────────────────
-- CONFIRM GUARD
-- Blocks setting allocation_status = 'confirmed' if the line is out of balance.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION block_confirm_if_unbalanced()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_source_amount   NUMERIC(14,2);
  v_allocated_total NUMERIC(14,2);
BEGIN
  -- Only fire when status is being set to confirmed or approved
  IF NEW.allocation_status NOT IN ('confirmed', 'approved') THEN
    RETURN NEW;
  END IF;

  IF NEW.source_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get source line total
  IF NEW.source_type = 'invoice_line' THEN
    SELECT amount INTO v_source_amount FROM invoice_line_items WHERE id = NEW.source_line_id;
  ELSIF NEW.source_type = 'contract_line' THEN
    SELECT budgeted_amount INTO v_source_amount FROM contract_line_items WHERE id = NEW.source_line_id;
  ELSIF NEW.source_type = 'co_line' THEN
    SELECT budgeted_amount INTO v_source_amount FROM change_order_line_items WHERE id = NEW.source_line_id;
  ELSE
    RETURN NEW;
  END IF;

  -- Sum all non-voided allocations for this line
  SELECT COALESCE(SUM(amount), 0)
    INTO v_allocated_total
    FROM financial_allocations
   WHERE source_type    = NEW.source_type
     AND source_line_id = NEW.source_line_id
     AND allocation_status NOT IN ('voided', 'rejected')
     AND id != NEW.id;

  v_allocated_total := v_allocated_total + NEW.amount;

  IF ABS(COALESCE(v_source_amount, 0) - v_allocated_total) > 0.01 THEN
    RAISE EXCEPTION
      'Cannot confirm: allocation total ($%) does not equal source line amount ($%). Difference: $%',
      v_allocated_total, v_source_amount, (v_source_amount - v_allocated_total);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_confirm_unbalanced ON financial_allocations;
CREATE TRIGGER trg_block_confirm_unbalanced
  BEFORE INSERT OR UPDATE ON financial_allocations
  FOR EACH ROW EXECUTE FUNCTION block_confirm_if_unbalanced();

-- Budget snapshots — full grid state frozen at a point in time
CREATE TABLE IF NOT EXISTS budget_snapshots (
  id             SERIAL PRIMARY KEY,
  phase_id       INTEGER NOT NULL REFERENCES phases(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  note           TEXT,
  snapshot_type  VARCHAR(10) NOT NULL DEFAULT 'manual', -- 'manual' | 'auto'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS budget_snapshot_lines (
  id                    SERIAL PRIMARY KEY,
  snapshot_id           INTEGER NOT NULL REFERENCES budget_snapshots(id) ON DELETE CASCADE,
  phase_budget_line_id  INTEGER,
  task_name             TEXT,
  qb_account_number     TEXT,
  qb_short_name         TEXT,
  budgeted_amount       NUMERIC(14,2),
  contracted            NUMERIC(14,2),
  co_value              NUMERIC(14,2),
  total_commitment      NUMERIC(14,2),
  remaining_budget      NUMERIC(14,2),
  fixed_charges         NUMERIC(14,2),
  tm_charges            NUMERIC(14,2),
  expense_charges       NUMERIC(14,2),
  billed                NUMERIC(14,2),
  remaining_commitment  NUMERIC(14,2),
  pct_used_of_committed NUMERIC(8,4),
  paid                  NUMERIC(14,2),
  amount_due            NUMERIC(14,2)
);

CREATE INDEX IF NOT EXISTS idx_bsl_snapshot ON budget_snapshot_lines(snapshot_id);
