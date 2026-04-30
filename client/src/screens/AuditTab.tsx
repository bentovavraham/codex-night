import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './AuditTab.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QbAccount { id: number; account_number: string; full_name: string; }

interface AuditInvoice {
  id: number;
  invoice_number: string;
  vendor_name: string;
  folder_amount: number | null;
  invoice_date: string | null;
  status: string;
  recon_status: string | null;
  pm_validated_gl_id: number | null;
  pm_validated_gl_code: string | null;
  pm_validated_gl_name: string | null;
  qb_txn_id: number | null;
  qb_amount: number | null;
  qb_gl_code: string | null;
  qb_gl_name: string | null;
  qb_project: string | null;
  is_paid: boolean | null;
  paid_amount: number | null;
  open_balance: number | null;
  qb_memo: string | null;
  active_gl_code: string | null;
  active_gl_name: string | null;
}

interface AuditData {
  invoices: AuditInvoice[];
  unmatched_qb: any[];
  totals: Record<string, any>;
  has_qb_data: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const RECON_LABEL: Record<string, string> = {
  matched:          'OK',
  amount_mismatch:  'Amt Mismatch',
  gl_mismatch:      'GL Mismatch',
  missing_in_qb:    'Not in QB',
  missing_source:   'No Source Doc',
  duplicate:        'Duplicate',
};

const RECON_CLASS: Record<string, string> = {
  matched:          styles.tagOk,
  amount_mismatch:  styles.tagWarn,
  gl_mismatch:      styles.tagWarn,
  missing_in_qb:    styles.tagMiss,
  missing_source:   styles.tagMiss,
  duplicate:        styles.tagErr,
};

// ─── GL Picker cell ──────────────────────────────────────────────────────────

function GlPicker({ invoice, accounts, onSave }: {
  invoice: AuditInvoice;
  accounts: QbAccount[];
  onSave: (invoiceId: number, glId: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch]   = useState('');

  const filtered = accounts.filter(a =>
    !search || a.account_number.includes(search) ||
    a.full_name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 40);

  if (!editing) {
    return (
      <div className={styles.glCell} onClick={() => setEditing(true)}>
        {invoice.pm_validated_gl_code
          ? <><span className={styles.glCode}>{invoice.pm_validated_gl_code}</span> <span className={styles.glName}>{invoice.pm_validated_gl_name}</span></>
          : <span className={styles.glPlaceholder}>Click to set…</span>
        }
      </div>
    );
  }

  return (
    <div className={styles.glPickerWrap}>
      <input
        autoFocus
        className={styles.glSearch}
        placeholder="Code or name…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        onBlur={() => { setTimeout(() => setEditing(false), 150); }}
      />
      <div className={styles.glDropdown}>
        {filtered.map(a => (
          <div
            key={a.id}
            className={styles.glOption}
            onMouseDown={() => { onSave(invoice.id, a.id); setEditing(false); setSearch(''); }}
          >
            <span className={styles.glCode}>{a.account_number}</span>
            <span className={styles.glName}>{a.full_name}</span>
          </div>
        ))}
        {!filtered.length && <div className={styles.glEmpty}>No match</div>}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AuditTab() {
  const { phaseId } = useParams();
  const pid = Number(phaseId);
  const qc  = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [filter, setFilter]       = useState<'all' | 'issues'>('all');

  const { data, isLoading, error } = useQuery<AuditData>({
    queryKey: ['audit', pid],
    queryFn:  () => api.getAudit(pid),
    enabled:  !!pid,
  });

  const { data: accounts = [] } = useQuery<QbAccount[]>({
    queryKey: ['qb-accounts'],
    queryFn:  () => api.listQbAccounts(),
  });

  const validateGl = useMutation({
    mutationFn: ({ invoiceId, glId }: { invoiceId: number; glId: number | null }) =>
      api.validateGl(invoiceId, glId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit', pid] }),
  });

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const r = await api.importQbExcel(pid, file);
      setImportMsg(`Imported ${r.inserted} rows, auto-matched ${r.matched} invoices, skipped ${r.skipped} duplicates.`);
      qc.invalidateQueries({ queryKey: ['audit', pid] });
    } catch (err: any) {
      setImportMsg(`Error: ${err.message}`);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  if (isLoading) return <div className={styles.empty}>Loading audit…</div>;
  if (error)     return <div className={styles.error}>Error loading audit data</div>;

  const d = data!;
  const invoices = filter === 'issues'
    ? d.invoices.filter(i => i.recon_status && i.recon_status !== 'matched')
    : d.invoices;

  const t = d.totals;

  return (
    <div className={styles.wrap}>

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <span className={styles.label}>AUDIT</span>

        <div className={styles.filterToggle}>
          <button
            className={filter === 'all' ? `${styles.toggleBtn} ${styles.toggleActive}` : styles.toggleBtn}
            onClick={() => setFilter('all')}
          >All ({d.invoices.length})</button>
          <button
            className={filter === 'issues' ? `${styles.toggleBtn} ${styles.toggleActive}` : styles.toggleBtn}
            onClick={() => setFilter('issues')}
          >Issues only ({d.invoices.filter(i => i.recon_status && i.recon_status !== 'matched').length})</button>
        </div>

        <div className={styles.toolbarRight}>
          {!d.has_qb_data && (
            <span className={styles.noQbHint}>No QB data yet — import an Excel export to begin reconciliation</span>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleImport} />
          <button className={styles.btnSecondary} onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : '↑ Import QB Excel'}
          </button>
          {d.has_qb_data && (
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

      {/* ── Summary strip ── */}
      {d.has_qb_data && (
        <div className={styles.summaryStrip}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryVal}>{fmt(t.total_folder)}</div>
            <div className={styles.summaryLbl}>Folder Total</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryVal}>{fmt(t.total_qb)}</div>
            <div className={styles.summaryLbl}>QB Total</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryVal}>{fmt(t.total_paid_qb)}</div>
            <div className={styles.summaryLbl}>Paid in QB</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryVal}>{fmt(t.total_open_qb)}</div>
            <div className={styles.summaryLbl}>QB Open Balance</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={`${styles.summaryVal} ${Number(t.cnt_matched) === d.invoices.length ? styles.allGood : styles.hasIssues}`}>
              {t.cnt_matched} / {d.invoices.length}
            </div>
            <div className={styles.summaryLbl}>Matched</div>
          </div>
        </div>
      )}

      {/* ── Main audit table ── */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Invoice #</th>
              <th className={styles.th}>Vendor</th>
              <th className={`${styles.th} ${styles.right}`}>Folder Amt</th>
              <th className={`${styles.th} ${styles.right}`}>QB Amt</th>
              <th className={styles.th}>QB GL Code</th>
              <th className={styles.th}>PM Validated Code</th>
              <th className={styles.th}>Match?</th>
              <th className={styles.th}>Paid in QB?</th>
              <th className={`${styles.th} ${styles.right}`}>QB Open Bal</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={9} className={styles.emptyRow}>
                  {filter === 'issues' ? 'No issues found — everything looks good.' : 'No invoices in this phase yet.'}
                </td>
              </tr>
            )}
            {invoices.map(inv => {
              const amtMismatch = inv.qb_amount != null && inv.folder_amount != null &&
                Math.abs(inv.folder_amount - inv.qb_amount) >= 0.02;
              return (
                <tr key={inv.id} className={styles.row}>
                  <td className={styles.td}>{inv.invoice_number || '—'}</td>
                  <td className={styles.td}>{inv.vendor_name}</td>
                  <td className={`${styles.td} ${styles.right}`}>{fmt(inv.folder_amount)}</td>
                  <td className={`${styles.td} ${styles.right} ${amtMismatch ? styles.mismatch : ''}`}>
                    {fmt(inv.qb_amount)}
                  </td>
                  <td className={styles.td}>
                    {inv.qb_gl_code
                      ? <><span className={styles.glCode}>{inv.qb_gl_code}</span> <span className={styles.glNameSmall}>{inv.qb_gl_name}</span></>
                      : <span className={styles.noData}>—</span>}
                  </td>
                  <td className={`${styles.td} ${styles.glPickerCell}`}>
                    <GlPicker
                      invoice={inv}
                      accounts={accounts as QbAccount[]}
                      onSave={(invId, glId) => validateGl.mutate({ invoiceId: invId, glId })}
                    />
                  </td>
                  <td className={styles.td}>
                    {inv.recon_status
                      ? <span className={`${styles.tag} ${RECON_CLASS[inv.recon_status] || styles.tagWarn}`}>
                          {RECON_LABEL[inv.recon_status] || inv.recon_status}
                        </span>
                      : <span className={styles.noData}>—</span>
                    }
                  </td>
                  <td className={styles.td}>
                    {inv.qb_txn_id != null
                      ? <span className={inv.is_paid ? styles.paidYes : styles.paidNo}>{inv.is_paid ? 'Yes' : 'No'}</span>
                      : <span className={styles.noData}>—</span>}
                  </td>
                  <td className={`${styles.td} ${styles.right}`}>{fmt(inv.open_balance)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Unmatched QB transactions ── */}
      {d.unmatched_qb.length > 0 && (
        <div className={styles.unmatchedSection}>
          <div className={styles.unmatchedHeader}>
            QB transactions with no source document ({d.unmatched_qb.length})
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Date</th>
                <th className={styles.th}>Vendor</th>
                <th className={styles.th}>Ref #</th>
                <th className={`${styles.th} ${styles.right}`}>Amount</th>
                <th className={styles.th}>QB GL</th>
                <th className={styles.th}>Paid?</th>
              </tr>
            </thead>
            <tbody>
              {d.unmatched_qb.map(txn => (
                <tr key={txn.id} className={`${styles.row} ${styles.unmatchedRow}`}>
                  <td className={styles.td}>{txn.txn_date?.slice(0, 10) || '—'}</td>
                  <td className={styles.td}>{txn.vendor_name || '—'}</td>
                  <td className={styles.td}>{txn.ref_number || '—'}</td>
                  <td className={`${styles.td} ${styles.right}`}>{fmt(txn.amount)}</td>
                  <td className={styles.td}>
                    {txn.qb_gl_code
                      ? <><span className={styles.glCode}>{txn.qb_gl_code}</span> <span className={styles.glNameSmall}>{txn.qb_gl_name}</span></>
                      : '—'}
                  </td>
                  <td className={styles.td}>
                    <span className={txn.is_paid ? styles.paidYes : styles.paidNo}>
                      {txn.is_paid ? 'Yes' : 'No'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
