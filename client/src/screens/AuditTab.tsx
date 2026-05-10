import { useRef, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { ImportDrawer } from './ImportDrawer';
import { UploadPanel } from './ContractsTab';
import styles from './AuditTab.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QbAccount { id: number; account_number: string; full_name: string; }

interface TxnRow {
  id: number;
  txn_date: string | null;
  vendor_name: string;
  ref_number: string | null;
  memo: string | null;
  qb_gl_code: string | null;
  qb_gl_name: string | null;
  amount: number;
  paid_amount: number;
  open_balance: number;
  is_paid: boolean;
  // linked invoice (if any)
  inv_id: number | null;
  invoice_number: string | null;
  inv_amount: number | null;
  invoice_date: string | null;
  inv_status: string | null;
  recon_status: string | null;
  pm_gl_code: string | null;
  pm_gl_name: string | null;
  pm_gl_id: number | null;
}

interface OrphanInvoice {
  id: number;
  invoice_number: string;
  vendor_name: string;
  inv_amount: number;
  invoice_date: string | null;
  status: string;
  recon_status: string | null;
  pm_gl_code: string | null;
  pm_gl_name: string | null;
}

interface Summary {
  total: number;
  with_invoice: number;
  verified: number;
  total_amount: number;
  verified_amount: number;
}

interface ReportData {
  transactions: TxnRow[];
  orphan_invoices: OrphanInvoice[];
  summary: Summary;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const fmtDate = (s: string | null) => s ? s.slice(0, 10) : '—';

function verifyStatus(row: TxnRow): 'verified' | 'amount_off' | 'gl_off' | 'unverified' {
  if (!row.inv_id) return 'unverified';
  if (row.recon_status === 'matched') return 'verified';
  if (row.recon_status === 'gl_mismatch') return 'gl_off';
  return 'amount_off';
}

// ─── GL Picker (inline in table row) ─────────────────────────────────────────

function GlPickerCell({ invId, glCode, glName, accounts, onSave }: {
  invId: number; glCode: string | null; glName: string | null;
  accounts: QbAccount[]; onSave: (invId: number, glId: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch]   = useState('');

  const filtered = accounts.filter(a =>
    !search || a.account_number.includes(search) ||
    a.full_name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 40);

  if (!editing) {
    return (
      <div className={styles.glCell} onClick={() => setEditing(true)} title="Click to set PM-validated GL code">
        {glCode
          ? <><span className={styles.glCode}>{glCode}</span><span className={styles.glNameSmall}>{glName?.split(':').pop()?.trim()}</span></>
          : <span className={styles.glPlaceholder}>Set code…</span>}
      </div>
    );
  }

  return (
    <div className={styles.glPickerWrap}>
      <input autoFocus className={styles.glSearch} placeholder="Code or name…"
        value={search} onChange={e => setSearch(e.target.value)}
        onBlur={() => { setTimeout(() => setEditing(false), 150); }} />
      <div className={styles.glDropdown}>
        {filtered.map(a => (
          <div key={a.id} className={styles.glOption}
            onMouseDown={() => { onSave(invId, a.id); setEditing(false); setSearch(''); }}>
            <span className={styles.glCode}>{a.account_number}</span>
            <span className={styles.glName}>{a.full_name}</span>
          </div>
        ))}
        {!filtered.length && <div className={styles.glEmpty}>No match</div>}
      </div>
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ summary }: { summary: Summary }) {
  const pct = summary.total > 0 ? (summary.with_invoice / summary.total) * 100 : 0;
  const amtPct = summary.total_amount > 0 ? (summary.verified_amount / summary.total_amount) * 100 : 0;

  return (
    <div className={styles.progressWrap}>
      <div className={styles.progressHeader}>
        <span className={styles.progressTitle}>Invoice Coverage</span>
        <span className={styles.progressCounts}>
          <strong>{summary.with_invoice}</strong> of <strong>{summary.total}</strong> transactions have an invoice
          <span className={styles.progressDivider}>·</span>
          <strong>{fmt(summary.verified_amount)}</strong> of <strong>{fmt(summary.total_amount)}</strong> covered
          <span className={styles.progressDivider}>·</span>
          <span className={pct >= 100 ? styles.progressComplete : styles.progressPartial}>
            {pct.toFixed(1)}%
          </span>
        </span>
      </div>
      <div className={styles.progressTrack}>
        <div className={styles.progressFillVerified} style={{ width: `${amtPct}%` }} />
        <div className={styles.progressFillCounted} style={{ width: `${Math.max(pct - amtPct, 0)}%` }} />
      </div>
      <div className={styles.progressLegend}>
        <span className={styles.legendVerified}>■ Verified &amp; matched</span>
        <span className={styles.legendUnverified}>■ No invoice yet</span>
      </div>
    </div>
  );
}

// ─── Vendor Group ─────────────────────────────────────────────────────────────

function VendorGroup({ vendor, rows, accounts, statusFilter, onValidateGl, onImport }: {
  vendor: string;
  rows: TxnRow[];
  accounts: QbAccount[];
  statusFilter: string;
  onValidateGl: (invId: number, glId: number | null) => void;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(true);

  const totalAmt   = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  const verified   = rows.filter(r => verifyStatus(r) === 'verified').length;
  const issues     = rows.filter(r => { const s = verifyStatus(r); return s === 'amount_off' || s === 'gl_off'; }).length;
  const unverified = rows.filter(r => !r.inv_id).length;

  const visible = rows.filter(r => {
    if (statusFilter === 'verified')   return verifyStatus(r) === 'verified';
    if (statusFilter === 'unverified') return !r.inv_id;
    if (statusFilter === 'issues')     return verifyStatus(r) === 'amount_off' || verifyStatus(r) === 'gl_off';
    return true;
  });

  if (statusFilter !== 'all' && visible.length === 0) return null;

  return (
    <div className={styles.vendorGroup}>
      <div className={styles.vendorHeader} onClick={() => setOpen(o => !o)}>
        <span className={styles.vendorChevron}>{open ? '▾' : '▸'}</span>
        <span className={styles.vendorName}>{vendor}</span>
        <div className={styles.vendorMeta}>
          {verified > 0    && <span className={styles.metaVerified}>{verified} verified</span>}
          {issues > 0      && <span className={styles.metaIssue}>{issues} issue{issues > 1 ? 's' : ''}</span>}
          {unverified > 0  && <span className={styles.metaUnverified}>{unverified} need invoice</span>}
        </div>
        <span className={styles.vendorTotal}>{fmt(totalAmt)}</span>
      </div>

      {open && (
        <div className={styles.vendorBody}>
          <table className={styles.txnTable}>
            <colgroup>
              <col style={{ width: '18px' }} />
              <col style={{ width: '82px' }} />
              <col style={{ width: '80px' }} />
              <col style={{ width: '200px' }} />
              <col style={{ width: '130px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '70px' }} />
              <col style={{ width: '130px' }} />
              <col style={{ width: '70px' }} />
            </colgroup>
            <thead>
              <tr className={styles.txnHead}>
                <th />
                <th>Date</th>
                <th>Ref #</th>
                <th>Memo</th>
                <th>QB GL Code</th>
                <th className={styles.right}>QB Amount</th>
                <th className={styles.right}>Inv Amount</th>
                <th>Paid?</th>
                <th>PM GL Code</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => {
                const vs = verifyStatus(row);
                const amtDelta = row.inv_amount != null
                  ? Number(row.inv_amount) - Number(row.amount) : null;

                return (
                  <tr key={row.id} className={`${styles.txnRow} ${styles['txnRow_' + vs]}`}>
                    {/* status dot */}
                    <td><span className={`${styles.dot} ${styles['dot_' + vs]}`} title={vs} /></td>

                    {/* date */}
                    <td className={styles.txnDate}>{fmtDate(row.txn_date)}</td>

                    {/* ref # */}
                    <td className={styles.txnRef}>{row.ref_number || '—'}</td>

                    {/* memo */}
                    <td className={styles.txnMemo} title={row.memo || ''}>{row.memo || '—'}</td>

                    {/* QB GL */}
                    <td className={styles.txnGl}>
                      {row.qb_gl_code
                        ? <><span className={styles.glCode}>{row.qb_gl_code}</span><span className={styles.glNameSmall}>{row.qb_gl_name?.split(':').pop()?.trim()}</span></>
                        : <span className={styles.noData}>—</span>}
                    </td>

                    {/* QB amount */}
                    <td className={`${styles.right} ${styles.txnAmt}`}>{fmt(row.amount)}</td>

                    {/* invoice amount (delta highlighted if off) */}
                    <td className={`${styles.right} ${amtDelta != null && Math.abs(amtDelta) >= 0.02 ? styles.amtOff : ''}`}>
                      {row.inv_id
                        ? <>{fmt(row.inv_amount)}{amtDelta != null && Math.abs(amtDelta) >= 0.02 && <span className={styles.deltaNote}> ({amtDelta > 0 ? '+' : ''}{fmt(amtDelta)})</span>}</>
                        : <span className={styles.noInv} onClick={onImport} title="No invoice — click Import to attach one">+ add</span>}
                    </td>

                    {/* paid */}
                    <td>
                      <span className={row.is_paid ? styles.paidYes : styles.paidNo}>
                        {row.is_paid ? 'Paid' : 'Open'}
                      </span>
                    </td>

                    {/* PM GL picker (only if invoice linked) */}
                    <td className={styles.txnPmGl}>
                      {row.inv_id
                        ? <GlPickerCell invId={row.inv_id} glCode={row.pm_gl_code} glName={row.pm_gl_name}
                            accounts={accounts} onSave={onValidateGl} />
                        : <span className={styles.noData}>—</span>}
                    </td>

                    {/* status badge */}
                    <td>
                      {vs === 'verified'   && <span className={styles.badgeVerified}>✓ Verified</span>}
                      {vs === 'amount_off' && <span className={styles.badgeAmtOff}>Amt Off</span>}
                      {vs === 'gl_off'     && <span className={styles.badgeGlOff}>GL Off</span>}
                      {vs === 'unverified' && <span className={styles.badgeUnverified}>No Invoice</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AuditTab() {
  const { phaseId, projectId } = useParams();
  const pid  = Number(phaseId);
  const proj = Number(projectId);
  const qc   = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [importing,           setImporting]           = useState(false);
  const [importMsg,           setImportMsg]           = useState<string | null>(null);
  const [showImport,          setShowImport]          = useState(false);
  const [showContractUpload,  setShowContractUpload]  = useState(false);
  const [vendorFilter,        setVendorFilter]        = useState('');
  const [statusFilter,        setStatusFilter]        = useState<'all' | 'verified' | 'unverified' | 'issues'>('all');

  const { data, isLoading, error } = useQuery<ReportData>({
    queryKey: ['txnReport', pid],
    queryFn:  () => api.getTransactionReport(pid),
    enabled:  !!pid,
  });

  const { data: accounts = [] } = useQuery<QbAccount[]>({
    queryKey: ['qb-accounts'],
    queryFn:  () => api.listQbAccounts(),
  });

  const validateGl = useMutation({
    mutationFn: ({ invoiceId, glId }: { invoiceId: number; glId: number | null }) =>
      api.validateGl(invoiceId, glId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['txnReport', pid] }),
  });

  async function handleQbImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const r = await api.importQbExcel(pid, file);
      setImportMsg(`Imported ${r.inserted} rows, matched ${r.matched} invoices, skipped ${r.skipped} duplicates.`);
      qc.invalidateQueries({ queryKey: ['txnReport', pid] });
    } catch (err: any) {
      setImportMsg(`Error: ${err.message}`);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  const vendorGroups = useMemo(() => {
    if (!data) return [];
    let rows = data.transactions;
    if (vendorFilter.trim())
      rows = rows.filter(r => r.vendor_name.toLowerCase().includes(vendorFilter.trim().toLowerCase()));

    const map = new Map<string, TxnRow[]>();
    for (const row of rows) {
      const key = row.vendor_name || '(Unknown)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, vendorFilter]);

  if (isLoading) return <div className={styles.empty}>Loading transaction report…</div>;
  if (error)     return <div className={styles.error}>Error loading data</div>;

  const d = data!;
  const hasQb = d.transactions.length > 0;

  const statusCounts = {
    all:        d.transactions.length,
    verified:   d.transactions.filter(r => verifyStatus(r) === 'verified').length,
    unverified: d.transactions.filter(r => !r.inv_id).length,
    issues:     d.transactions.filter(r => { const s = verifyStatus(r); return s === 'amount_off' || s === 'gl_off'; }).length,
  };

  return (
    <div className={styles.wrap}>

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <span className={styles.label}>TRANSACTION REPORT</span>

        <div className={styles.filterToggle}>
          {(['all', 'verified', 'unverified', 'issues'] as const).map(f => (
            <button key={f}
              className={`${styles.toggleBtn} ${statusFilter === f ? styles.toggleActive : ''}`}
              onClick={() => setStatusFilter(f)}>
              {f === 'all'        ? `All (${statusCounts.all})` : ''}
              {f === 'verified'   ? `✓ Verified (${statusCounts.verified})` : ''}
              {f === 'unverified' ? `○ Need Invoice (${statusCounts.unverified})` : ''}
              {f === 'issues'     ? `⚠ Issues (${statusCounts.issues})` : ''}
            </button>
          ))}
        </div>

        <div className={styles.toolbarRight}>
          <input
            className={styles.vendorSearch}
            placeholder="Filter vendor…"
            value={vendorFilter}
            onChange={e => setVendorFilter(e.target.value)}
          />
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" style={{ display: 'none' }} onChange={handleQbImport} />
          <button className={styles.btnSecondary} onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : '↑ QB Export'}
          </button>
          {hasQb && (
            <button className={styles.btnSecondary} onClick={() => api.downloadCorrectionReport(pid)}>
              ↓ Correction Report
            </button>
          )}
        </div>
      </div>

      {importMsg && (
        <div className={importMsg.startsWith('Error') ? styles.importErr : styles.importOk}>
          {importMsg}
        </div>
      )}

      {/* ── Progress bar ── */}
      {hasQb && <ProgressBar summary={d.summary} />}

      {!hasQb && (
        <div className={styles.noQbState}>
          <div className={styles.noQbTitle}>No QB transaction data yet</div>
          <div className={styles.noQbSub}>Import a QuickBooks Transaction Detail report (Excel or PDF) to see all transactions for this property. Each transaction will appear here — invoices attach to them as you import vendor PDFs.</div>
          <button className={styles.btnPrimary} onClick={() => fileRef.current?.click()}>↑ Import QB Export</button>
        </div>
      )}

      {/* ── Transaction list ── */}
      {hasQb && (
        <div className={styles.txnList}>
          {vendorGroups.map(([vendor, rows]) => (
            <VendorGroup
              key={vendor}
              vendor={vendor}
              rows={rows}
              accounts={accounts as QbAccount[]}
              statusFilter={statusFilter}
              onValidateGl={(invId, glId) => validateGl.mutate({ invoiceId: invId, glId })}
              onImport={() => setShowImport(true)}
            />
          ))}
          {vendorGroups.length === 0 && (
            <div className={styles.empty}>No transactions match the current filter.</div>
          )}
        </div>
      )}

      {/* ── Orphan invoices (confirmed but no QB match) ── */}
      {d.orphan_invoices.length > 0 && (
        <div className={styles.orphanSection}>
          <div className={styles.orphanHeader}>
            Invoices with no QB transaction match ({d.orphan_invoices.length})
            <span className={styles.orphanNote}> — these are confirmed but couldn't be linked to a QB entry</span>
          </div>
          <table className={styles.txnTable} style={{ width: '100%' }}>
            <thead>
              <tr className={styles.txnHead}>
                <th>Vendor</th>
                <th>Invoice #</th>
                <th className={styles.right}>Amount</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.orphan_invoices.map(inv => (
                <tr key={inv.id} className={styles.txnRow}>
                  <td>{inv.vendor_name}</td>
                  <td>{inv.invoice_number}</td>
                  <td className={styles.right}>{fmt(inv.inv_amount)}</td>
                  <td>{fmtDate(inv.invoice_date)}</td>
                  <td><span className={styles.badgeUnverified}>Not in QB</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Import invoice drawer ── */}
      {showImport && (
        <ImportDrawer
          phaseId={pid}
          onClose={() => setShowImport(false)}
          onConfirmed={() => {
            qc.invalidateQueries({ queryKey: ['txnReport', pid] });
            qc.invalidateQueries({ queryKey: ['audit', pid] });
          }}
        />
      )}

      {/* ── Import contract overlay ── */}
      {showContractUpload && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--bg)' }}>
          <UploadPanel
            qbAccounts={accounts as any[]}
            projectId={proj}
            phaseId={pid}
            onClose={() => setShowContractUpload(false)}
            onSaved={() => {
              setShowContractUpload(false);
              qc.invalidateQueries({ queryKey: ['phaseContracts', pid] });
              qc.invalidateQueries({ queryKey: ['budget', pid] });
            }}
          />
        </div>
      )}
    </div>
  );
}
