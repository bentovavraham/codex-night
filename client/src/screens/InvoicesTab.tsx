import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client';
import styles from './InvoicesTab.module.css';
import { ContractPanel } from './ContractPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QbAccount { id: number; account_number: string; full_name: string; short_name: string; }

interface LineItem {
  billing_type: 'fixed' | 'tm' | 'expense';
  description: string;
  person: string;
  line_date: string;
  hours: string;
  rate: string;
  amount: string;
  qb_account_id: number | null;
  phase_budget_line_id: number | null;
  // AI suggestion metadata
  suggested_qb_account_id: number | null;
  qb_suggestion_confidence: string | null;
}

interface InvoiceForm {
  invoice_number: string;
  vendor_name: string;
  vendor_id: number | null;
  vendor_is_new: boolean;
  invoice_date: string;
  services_thru_date: string;
  amount: string;
  description: string;
  contract_id: number | null;
  phase_budget_line_id: number | null;
  status: string;
  line_items: LineItem[];
  reviewed: boolean;
}

const EMPTY_FORM: InvoiceForm = {
  invoice_number: '', vendor_name: '', vendor_id: null, vendor_is_new: false,
  invoice_date: '', services_thru_date: '', amount: '',
  description: '', contract_id: null, phase_budget_line_id: null,
  status: 'pending', line_items: [], reviewed: false,
};

type Stage = 'drop' | 'extracting' | 'review';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const STATUS_CSS: Record<string, string> = {
  pending: 'sPending', pm_approved: 'sPm', partner_approved: 'sPartner',
  approved: 'sApproved', pushed: 'sPushed', paid: 'sPaid',
  rejected: 'sRejected', on_hold: 'sHold',
};

function ConfDot({ level }: { level?: string | null }) {
  const bg = level === 'high' ? '#22c55e' : level === 'medium' ? '#f59e0b' : '#ef4444';
  if (!level) return null;
  return <span className={styles.confDot} style={{ background: bg }} title={`AI confidence: ${level}`} />;
}

// ─── QB Code autocomplete ─────────────────────────────────────────────────────

function QbPicker({
  accounts, value, suggestedId, suggestionConfidence, onChange,
}: {
  accounts: QbAccount[];
  value: number | null;
  suggestedId: number | null;
  suggestionConfidence: string | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = accounts.find(a => a.id === value) ?? null;
  const suggested = accounts.find(a => a.id === suggestedId) ?? null;

  // Show suggestion if nothing manually selected yet
  const display = selected ?? suggested;
  const isAiSuggested = !selected && !!suggested;

  const filtered = useMemo(() => {
    if (!query.trim()) return accounts; // show ALL accounts — fully scannable
    const q = query.toLowerCase();
    return accounts.filter(a =>
      a.account_number.toLowerCase().includes(q) ||
      a.full_name.toLowerCase().includes(q) ||
      a.short_name.toLowerCase().includes(q)
    );
  }, [accounts, query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function openDropdown() {
    setQuery('');
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  function pick(a: QbAccount) {
    onChange(a.id);
    setOpen(false);
    setQuery('');
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
  }

  return (
    <div className={styles.qbPicker} ref={ref}>
      <div
        className={`${styles.qbDisplay} ${isAiSuggested ? styles.qbAi : ''} ${!display ? styles.qbEmpty : ''}`}
        onClick={openDropdown}
        title={display?.full_name}
      >
        {display ? (
          <>
            <span className={styles.qbNum}>{display.account_number}</span>
            <span className={styles.qbName}>{display.full_name}</span>
            {isAiSuggested && <ConfDot level={suggestionConfidence} />}
            <button className={styles.qbClear} onClick={clear} title="Clear">✕</button>
          </>
        ) : (
          <span className={styles.qbPlaceholder}>Select account…</span>
        )}
      </div>

      {open && (
        <div className={styles.qbDropdown}>
          <input
            ref={inputRef}
            className={styles.qbSearch}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by number or name…"
          />
          <div className={styles.qbList}>
            {filtered.map(a => (
              <div
                key={a.id}
                className={`${styles.qbOption} ${a.id === (value ?? suggestedId) ? styles.qbOptionSelected : ''}`}
                onMouseDown={() => pick(a)}
              >
                <span className={styles.qbOptNum}>{a.account_number}</span>
                <span className={styles.qbOptName}>{a.full_name}</span>
              </div>
            ))}
            {filtered.length === 0 && <div className={styles.qbNoMatch}>No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Budget line autocomplete picker ─────────────────────────────────────────

function BudgetLinePicker({ lines, value, onChange }: {
  lines: any[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = lines.find(l => l.id === value) ?? null;

  const filtered = useMemo(() => {
    if (!query.trim()) return lines;
    const q = query.toLowerCase();
    return lines.filter(l =>
      l.task_name.toLowerCase().includes(q) ||
      (l.discipline && l.discipline.toLowerCase().includes(q))
    );
  }, [lines, query]);

  useEffect(() => {
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  function openDropdown() { setQuery(''); setOpen(true); setTimeout(() => inputRef.current?.focus(), 30); }
  function pick(l: any) { onChange(l.id); setOpen(false); setQuery(''); }
  function clear(e: React.MouseEvent) { e.stopPropagation(); onChange(null); }

  const label = selected ? `${selected.task_name}${selected.discipline ? ` · ${selected.discipline}` : ''}` : null;

  return (
    <div className={styles.qbPicker} ref={ref}>
      <div className={`${styles.qbDisplay} ${!selected ? styles.qbEmpty : ''}`} onClick={openDropdown}>
        {selected ? (
          <>
            <span className={styles.qbName}>{label}</span>
            <button className={styles.qbClear} onClick={clear} title="Clear">✕</button>
          </>
        ) : <span className={styles.qbPlaceholder}>Search tasks…</span>}
      </div>
      {open && (
        <div className={styles.qbDropdown}>
          <input ref={inputRef} className={styles.qbSearch} value={query}
            onChange={e => setQuery(e.target.value)} placeholder="Type task name or discipline…" />
          <div className={styles.qbList}>
            {filtered.map(l => (
              <div key={l.id}
                className={`${styles.qbOption} ${l.id === value ? styles.qbOptionSelected : ''}`}
                onMouseDown={() => pick(l)}>
                <span className={styles.qbOptName}>{l.task_name}{l.discipline ? ` · ${l.discipline}` : ''}</span>
              </div>
            ))}
            {filtered.length === 0 && <div className={styles.qbNoMatch}>No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Invoice list ─────────────────────────────────────────────────────────────

function InvoiceList({ invoices, phaseId, onEdit }: {
  invoices: any[];
  phaseId: number;
  onEdit: (id: number) => void;
}) {
  const [pdfRef, setPdfRef] = useState<string | null>(null);
  const [panelContractId, setPanelContractId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const qc = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', phaseId] });
      qc.invalidateQueries({ queryKey: ['budget',   phaseId] });
      setConfirmDeleteId(null);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.updateInvoice(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', phaseId] });
      qc.invalidateQueries({ queryKey: ['budget',   phaseId] });
    },
  });

  return (
    <div className={styles.listWrap}>
      {panelContractId && (
        <ContractPanel contractId={panelContractId} onClose={() => setPanelContractId(null)} />
      )}
      {/* PDF viewer modal */}
      {pdfRef && (
        <div className={styles.pdfModal} onClick={() => setPdfRef(null)}>
          <div className={styles.pdfModalInner} onClick={e => e.stopPropagation()}>
            <div className={styles.pdfModalBar}>
              <span>Invoice PDF</span>
              <button className={styles.closeBtn} onClick={() => setPdfRef(null)}>✕</button>
            </div>
            <iframe src={`/api/files/${encodeURIComponent(pdfRef)}`} className={styles.pdfModalFrame} title="Invoice PDF" />
          </div>
        </div>
      )}

      <div className={styles.toolbar}>
        <span className={styles.toolLabel}>Invoices</span>
        <span className={styles.uploadHint}>Upload invoices via ↑ Import Invoices in the Audit tab</span>
      </div>
      {invoices.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No invoices yet — use <strong>↑ Import Invoices</strong> in the Audit tab.</p>
        </div>
      ) : (
        <div className={styles.scrollArea}>
          <table className={styles.listTable}>
            <thead>
              <tr className={styles.listThead}>
                <th className={`${styles.lth} ${styles.left}`}>Invoice #</th>
                <th className={`${styles.lth} ${styles.left}`}>Vendor</th>
                <th className={`${styles.lth} ${styles.left}`}>Task</th>
                <th className={`${styles.lth} ${styles.right}`}>Date</th>
                <th className={`${styles.lth} ${styles.right}`}>Amount</th>
                <th className={`${styles.lth} ${styles.center}`}>Status</th>
                <th className={styles.lth} />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv: any) => (
                <tr key={inv.id} className={styles.listRow}>
                  <td className={`${styles.ltd} ${styles.mono}`}>{inv.invoice_number}</td>
                  <td className={styles.ltd}>{inv.vendor_name}</td>
                  <td className={`${styles.ltd} ${styles.dim}`}>
                    {inv.budget_line_name ?? (inv.contract_vendor ? `${inv.contract_vendor}${inv.contract_ref ? ` · ${inv.contract_ref}` : ''}` : '—')}
                  </td>
                  <td className={`${styles.ltd} ${styles.mono} ${styles.right}`}>
                    {inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : '—'}
                  </td>
                  <td className={`${styles.ltd} ${styles.mono} ${styles.right}`}>{usd.format(Number(inv.amount))}</td>
                  <td className={`${styles.ltd} ${styles.center}`}>
                    <select
                      className={`${styles.statusSelect} ${styles[STATUS_CSS[inv.status] ?? 'sPending']}`}
                      value={inv.status}
                      disabled={statusMutation.isPending}
                      onChange={e => statusMutation.mutate({ id: inv.id, status: e.target.value })}
                    >
                      <option value="pending">Pending</option>
                      <option value="pm_approved">PM ✓</option>
                      <option value="partner_approved">Partner ✓</option>
                      <option value="approved">Approved</option>
                      <option value="pushed">Pushed</option>
                      <option value="paid">Paid</option>
                      <option value="on_hold">On Hold</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </td>
                  <td className={`${styles.ltd} ${styles.actionCell}`}>
                    {inv.contract_id && (
                      <button className={styles.contractBtn} onClick={() => setPanelContractId(inv.contract_id)} title="View contract">
                        ↑ Contract
                      </button>
                    )}
                    {inv.file_reference && (
                      <button className={styles.pdfBtn} onClick={() => setPdfRef(inv.file_reference)} title="View PDF">
                        PDF
                      </button>
                    )}
                    <button className={styles.editBtn} onClick={() => onEdit(inv.id)} title="Edit invoice">
                      Edit
                    </button>
                    {confirmDeleteId === inv.id ? (
                      <button className={styles.confirmDeleteBtn}
                        onClick={() => deleteMutation.mutate(inv.id)}
                        disabled={deleteMutation.isPending}>
                        Confirm?
                      </button>
                    ) : (
                      <button className={styles.deleteBtn} onClick={() => setConfirmDeleteId(inv.id)} title="Delete invoice">
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={styles.totalRow}>
                <td colSpan={4} className={styles.totalLabel}>
                  {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
                </td>
                <td className={`${styles.ltd} ${styles.mono} ${styles.right} ${styles.totalCell}`}>
                  {usd.format(invoices.reduce((s: number, inv: any) => s + Number(inv.amount), 0))}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Upload + review panel ────────────────────────────────────────────────────

function UploadPanel({
  contracts, budgetLines, qbAccounts, projectId, phaseIdNum, onClose, onSaved, editId,
}: {
  contracts: any[];
  budgetLines: any[];
  qbAccounts: QbAccount[];
  projectId: number;
  phaseIdNum: number;
  onClose: () => void;
  onSaved: () => void;
  editId?: number;
}) {
  const [stage, setStage] = useState<Stage>(editId ? 'extracting' : 'drop');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fileRef, setFileRef] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<any>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [form, setForm] = useState<InvoiceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Only revoke blob URLs, not server URLs
  useEffect(() => () => { if (pdfUrl?.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  // Load existing invoice when in edit mode
  useEffect(() => {
    if (!editId) return;
    api.getInvoice(editId).then(inv => {
      if (inv.file_reference) {
        setPdfUrl(`/api/files/${encodeURIComponent(inv.file_reference)}`);
      }
      setFileRef(inv.file_reference ?? null);
      setForm({
        invoice_number:      inv.invoice_number ?? '',
        vendor_name:         inv.vendor_name ?? '',
        vendor_id:           null,
        vendor_is_new:       false,
        invoice_date:        inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : '',
        services_thru_date:  '',
        amount:              inv.amount != null ? String(inv.amount) : '',
        description:         inv.description ?? '',
        contract_id:         inv.contract_id ?? null,
        phase_budget_line_id: inv.phase_budget_line_id ?? null,
        status:              inv.status ?? 'pending',
        line_items: (inv.invoice_line_items ?? []).map((li: any) => ({
          billing_type:             li.billing_type ?? 'fixed',
          description:              li.description ?? '',
          person:                   li.person ?? '',
          line_date:                li.line_date ? String(li.line_date).slice(0, 10) : '',
          hours:                    li.hours != null ? String(li.hours) : '',
          rate:                     li.rate != null ? String(li.rate) : '',
          amount:                   li.amount != null ? String(li.amount) : '',
          qb_account_id:            li.qb_account_id ?? null,
          phase_budget_line_id:     li.phase_budget_line_id ?? null,
          suggested_qb_account_id:  null,
          qb_suggestion_confidence: null,
        })),
        reviewed: true,
      });
      setStage('review');
    }).catch(err => {
      setExtractError(err.message ?? 'Failed to load invoice');
      setStage('review');
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file);
    setPdfUrl(url);
    setStage('extracting');
    setExtractError(null);
    try {
      const result = await api.extractInvoice(file);
      setFileRef(result.file_reference ?? null);
      if (result.extracted) {
        const e = result.extracted;
        setExtracted(e);
        const items: LineItem[] = (e.line_items ?? []).map((li: any) => ({
          billing_type:             li.billing_type ?? 'fixed',
          description:              li.description  ?? '',
          person:                   li.person       ?? '',
          line_date:                li.line_date    ?? '',
          hours:                    li.hours  != null ? String(li.hours)  : '',
          rate:                     li.rate   != null ? String(li.rate)   : '',
          amount:                   li.amount != null ? String(li.amount) : '',
          qb_account_id:            null,
          phase_budget_line_id:     null,
          suggested_qb_account_id:  li.suggested_qb_account_id  ?? null,
          qb_suggestion_confidence: li.qb_suggestion_confidence ?? null,
        }));
        setForm({
          invoice_number:      e.invoice_number     ?? '',
          vendor_name:         e.vendor_name        ?? '',
          vendor_id:           e.vendor_match?.id   ?? null,
          vendor_is_new:       e.vendor_is_new      ?? false,
          invoice_date:        e.invoice_date       ?? '',
          services_thru_date:  e.services_thru_date ?? '',
          amount:              e.amount != null ? String(e.amount) : '',
          description:         e.summary ?? '',
          contract_id:         null,
          phase_budget_line_id: null,
          status:              'pending',
          line_items:          items,
          reviewed:            false,
        });
      }
      if (result.extract_error) setExtractError(result.extract_error);
    } catch (err: any) {
      setExtractError(err.message ?? 'Extraction failed');
    } finally {
      setStage('review');
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') handleFile(file);
  }, [handleFile]);

  function setF<K extends keyof InvoiceForm>(key: K, val: InvoiceForm[K]) {
    setForm(f => ({ ...f, [key]: val }));
  }

  function setLine(idx: number, patch: Partial<LineItem>) {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], ...patch };
      return { ...f, line_items: items };
    });
  }

  // ── AI task suggestions for shared GL codes ────────────────────────────────
  // For line items whose GL code is shared by multiple PM tasks, ask Claude to
  // pick the right task per line (using the PM/engineer persona prompt).
  // Triggered automatically once on modal open if there are unassigned shared
  // lines, or manually via the AI Suggest button.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<Map<number, { id: number; reason: string; confidence: string }>>(new Map());
  const autoSuggestedRef = useRef(false);

  const runSuggestions = useCallback(async (silent = false) => {
    if (suggesting) return;
    if (!form.line_items.length) return;
    if (!phaseIdNum) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      // ── Tier 1: AI GL code suggestion ──────────────────────────────
      // For lines that don't have a qb_account_id yet, ask Claude to look
      // at the original PDF and suggest one. Only available when editing an
      // existing invoice (we need the saved file_reference).
      let lineItemsForTier2 = form.line_items;
      if (editId) {
        const needGl = form.line_items
          .map((li, i) => ({ li, i }))
          .filter(({ li }) => li.qb_account_id == null);
        if (needGl.length > 0) {
          try {
            const t1 = await api.suggestInvoiceLineCodes(editId);
            // Build a quick lookup line_index → qb_account_id
            const byIndex = new Map<number, number>();
            (t1.suggestions ?? []).forEach(s => {
              if (s.qb_account_id != null && Number.isInteger(s.line_index)) {
                byIndex.set(s.line_index, s.qb_account_id);
              }
            });
            if (byIndex.size > 0) {
              const updated = [...form.line_items];
              byIndex.forEach((qbId, idx) => {
                if (updated[idx] && updated[idx].qb_account_id == null) {
                  updated[idx] = { ...updated[idx], qb_account_id: qbId };
                }
              });
              setForm(f => ({ ...f, line_items: updated }));
              lineItemsForTier2 = updated; // use freshly-coded lines for Tier 2
            }
          } catch (t1err) {
            // Tier 1 failure is non-fatal — Tier 2 still runs on whatever GL codes exist.
            console.warn('Tier 1 (GL code) suggestion failed:', t1err);
          }
        }
      }

      // ── Tier 2: AI task suggestion within the GL code group ────────
      const res = await api.suggestLineTasks(phaseIdNum, {
        vendor_name: form.vendor_name,
        description: form.description,
        line_items: lineItemsForTier2.map(li => ({
          description: li.description,
          billing_type: li.billing_type,
          amount: Number(li.amount) || 0,
          qb_account_id: li.qb_account_id ?? null,
        })),
      });
      const map = new Map<number, { id: number; reason: string; confidence: string }>();
      const newPicks: { idx: number; pbl_id: number }[] = [];
      (res.suggestions ?? []).forEach(s => {
        if (s.budget_line_id == null) return;
        map.set(s.line_index, { id: s.budget_line_id, reason: s.reason, confidence: s.confidence });
        const li = lineItemsForTier2[s.line_index];
        if (li && li.phase_budget_line_id == null) {
          newPicks.push({ idx: s.line_index, pbl_id: s.budget_line_id });
        }
      });
      if (newPicks.length > 0) {
        setForm(f => {
          const items = [...f.line_items];
          newPicks.forEach(p => { items[p.idx] = { ...items[p.idx], phase_budget_line_id: p.pbl_id }; });
          return { ...f, line_items: items };
        });
      }
      setAiSuggestions(map);
    } catch (err: any) {
      if (!silent) setSuggestError(err?.message || 'AI suggestion failed');
    } finally {
      setSuggesting(false);
    }
  }, [form.line_items, form.vendor_name, form.description, phaseIdNum, suggesting, editId]);

  // Auto-trigger once when modal opens if any line item needs help:
  //   - Missing GL code → Tier 1 (suggest qb_account_id from PDF), then
  //   - Shared GL code with no task picked → Tier 2 (suggest task)
  useEffect(() => {
    if (autoSuggestedRef.current) return;
    if (!budgetLines || budgetLines.length === 0) return;
    if (form.line_items.length === 0) return;
    const needsHelp = form.line_items.some(li => {
      if (li.qb_account_id == null) return true; // Tier 1 needed
      if (li.phase_budget_line_id != null) return false;
      const matching = (budgetLines as any[]).filter(b => b.qb_account_id === li.qb_account_id);
      return matching.length > 1; // Tier 2 needed
    });
    if (needsHelp) {
      autoSuggestedRef.current = true;
      runSuggestions(true);
    }
  }, [budgetLines, form.line_items, runSuggestions]);

  // Auto-resolve / auto-clear `phase_budget_line_id` based on the line item's
  // GL code and the available PM tasks in this phase. Runs whenever line items
  // or budget lines change.
  //   - GL code maps to exactly 1 task → auto-set phase_budget_line_id
  //   - GL code maps to multiple tasks → leave alone (user picks via dropdown)
  //   - GL code maps to 0 tasks → clear phase_budget_line_id (it would be stale)
  //   - GL code changed and old phase_budget_line_id no longer matches → clear
  useEffect(() => {
    if (!budgetLines || budgetLines.length === 0) return;
    const updated: { idx: number; pbl_id: number | null }[] = [];
    form.line_items.forEach((li, idx) => {
      if (li.qb_account_id == null) {
        if (li.phase_budget_line_id != null) updated.push({ idx, pbl_id: null });
        return;
      }
      const matching = (budgetLines as any[]).filter(b => b.qb_account_id === li.qb_account_id);
      if (matching.length === 1) {
        if (li.phase_budget_line_id !== matching[0].id) {
          updated.push({ idx, pbl_id: matching[0].id });
        }
      } else if (matching.length === 0) {
        if (li.phase_budget_line_id != null) updated.push({ idx, pbl_id: null });
      } else {
        // Shared GL code: keep current pick if still valid, otherwise clear
        if (li.phase_budget_line_id != null && !matching.find(t => t.id === li.phase_budget_line_id)) {
          updated.push({ idx, pbl_id: null });
        }
      }
    });
    if (updated.length === 0) return;
    setForm(f => {
      const items = [...f.line_items];
      updated.forEach(u => { items[u.idx] = { ...items[u.idx], phase_budget_line_id: u.pbl_id }; });
      return { ...f, line_items: items };
    });
  }, [form.line_items, budgetLines]);

  function addLine() {
    setForm(f => ({
      ...f,
      line_items: [...f.line_items, {
        billing_type: 'fixed', description: '', person: '', line_date: '',
        hours: '', rate: '', amount: '',
        qb_account_id: null, phase_budget_line_id: null,
        suggested_qb_account_id: null, qb_suggestion_confidence: null,
      }],
    }));
  }

  function clearLines() {
    setForm(f => ({ ...f, line_items: [] }));
  }

  function removeLine(idx: number) {
    setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }));
  }

  // Derived total from line items (if lines exist)
  const lineTotal = form.line_items.reduce((s, li) => s + (Number(li.amount) || 0), 0);

  async function handleSave() {
    setSaveError(null);
    const amt = Number(form.amount);
    if (!form.invoice_number.trim()) return setSaveError('Invoice number is required.');
    if (!form.vendor_name.trim())    return setSaveError('Vendor name is required.');
    if (!amt || amt <= 0)            return setSaveError('Amount must be greater than 0.');
    if (!form.reviewed)              return setSaveError('Please check the review confirmation.');

    setSaving(true);
    try {
      // Derive invoice type from line items
      const types = new Set(form.line_items.map(li => li.billing_type));
      const invoiceType = types.has('tm') ? 'tm' : types.has('expense') ? 'expense' : 'fixed';

      const payload: any = {
        invoice_number:       form.invoice_number.trim(),
        vendor_name:          form.vendor_name.trim(),
        amount:               amt,
        invoice_date:         form.invoice_date       || null,
        description:          form.description        || null,
        file_reference:       fileRef                 || null,
        invoice_type:         invoiceType,
        project_id:           projectId,
        // Preserve the legacy invoice-level task assignment as-is. Aggregations
        // use it only as a fallback for line items that don't have their own
        // GL code or pbl assignment yet — once Richard adds GL codes per line,
        // those line items naturally bypass the legacy field.
        phase_budget_line_id: form.phase_budget_line_id || null,
        status:               form.status,
        invoice_line_items: form.line_items
          .filter(li => Number(li.amount) > 0)
          .map((li, i) => ({
            billing_type:         li.billing_type,
            description:          li.description  || null,
            person:               li.person       || null,
            line_date:            li.line_date    || null,
            hours:                li.hours  ? Number(li.hours)  : null,
            rate:                 li.rate   ? Number(li.rate)   : null,
            amount:               Number(li.amount),
            qb_account_id:        li.qb_account_id ?? li.suggested_qb_account_id ?? null,
            phase_budget_line_id: li.phase_budget_line_id ?? null,
            sort_order:           i,
          })),
      };
      if (form.contract_id) payload.contract_id = form.contract_id;
      if (editId) {
        await api.updateInvoice(editId, payload);
      } else {
        await api.createInvoice(payload);
      }
      onSaved();
    } catch (err: any) {
      setSaveError(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const conf = extracted?.confidence ?? {};
  const hasBudgetTarget = !!form.contract_id || !!form.phase_budget_line_id;
  const canSave = form.reviewed && !!form.invoice_number && !!form.vendor_name && Number(form.amount) > 0 && hasBudgetTarget;

  return (
    <div className={styles.uploadLayout}>

      {/* ── Left: PDF pane ──────────────────────────────── */}
      <div className={styles.pdfPane}>
        {stage === 'drop' ? (
          <div
            className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
          >
            <input ref={fileInput} type="file" accept="application/pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <div className={styles.dropIcon}>📄</div>
            <p className={styles.dropText}>Drop invoice PDF here</p>
            <p className={styles.dropSub}>or click to browse</p>
          </div>
        ) : pdfUrl ? (
          <iframe src={pdfUrl} className={styles.pdfFrame} title="Invoice PDF" />
        ) : null}
      </div>

      {/* ── Right: form pane ────────────────────────────── */}
      <div className={styles.formPane}>

        {/* Header bar */}
        <div className={styles.formBar}>
          <span className={styles.formBarTitle}>
            {stage === 'extracting'
              ? (editId ? 'Loading invoice…' : 'Reading invoice…')
              : stage === 'drop' ? 'New Invoice'
              : `${editId ? 'Edit ' : ''}Invoice${form.invoice_number ? ` #${form.invoice_number}` : ''}`}
          </span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {stage === 'extracting' && (
          <div className={styles.extractingWrap}>
            <div className={styles.spinner} />
            <p>{editId ? 'Loading invoice…' : 'Claude is reading your invoice…'}</p>
            {!editId && <p className={styles.extractingSub}>Extracting line items and suggesting QB codes</p>}
          </div>
        )}

        {stage === 'review' && (
          <div className={styles.formScroll}>

            {/* Extraction warning */}
            {extractError && (
              <div className={styles.warnBanner}>
                ⚠ AI extraction had issues — please fill fields manually.
                <span className={styles.warnDetail}> {extractError}</span>
              </div>
            )}

            {/* ── QB-style header fields ── */}
            <div className={styles.headerFields}>
              {/* Payee */}
              <div className={styles.hfGroup}>
                <label className={styles.hfLabel}>
                  Payee <ConfDot level={conf.vendor_name} />
                </label>
                <input className={styles.hfInput} value={form.vendor_name}
                  onChange={e => setF('vendor_name', e.target.value)} placeholder="Who did you pay?" />
                {form.vendor_is_new && (
                  <div className={styles.vendorNewWarn}>⚠ New vendor — will be created in QB on push</div>
                )}
                {extracted?.vendor_match && !extracted.vendor_match.exact && (
                  <div className={styles.vendorMatchNote}>
                    Matched to QB vendor: <strong>{extracted.vendor_match.name}</strong>
                  </div>
                )}
              </div>

              {/* Contract link */}
              <div className={styles.hfGroup}>
                <label className={styles.hfLabel}>Contract <span className={styles.hfOptional}>(optional)</span></label>
                <select className={styles.hfSelect} value={form.contract_id ?? ''}
                  onChange={e => setF('contract_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— No contract —</option>
                  {contracts.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.vendor_name}{c.reference_number ? ` · ${c.reference_number}` : ''} (${Number(c.total_value).toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              {/* Status */}
              {editId && (
                <div className={styles.hfGroup}>
                  <label className={styles.hfLabel}>Status</label>
                  <select className={styles.hfSelect} value={form.status}
                    onChange={e => setF('status', e.target.value)}>
                    <option value="pending">Pending</option>
                    <option value="pm_approved">PM Approved</option>
                    <option value="partner_approved">Partner Approved</option>
                    <option value="approved">Approved</option>
                    <option value="pushed">Pushed</option>
                    <option value="paid">Paid</option>
                    <option value="on_hold">On Hold</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              )}

              {/* Invoice-level Task / Budget Line removed: allocation is now driven
                  by per-line-item GL codes (and an optional per-line task picker
                  when the GL code is shared by multiple PM tasks). */}

              {/* Date + Ref row */}
              <div className={styles.hfRow}>
                <div className={styles.hfGroup}>
                  <label className={styles.hfLabel}>
                    Invoice Date <ConfDot level={conf.invoice_date} />
                  </label>
                  <input className={styles.hfInput} type="date" value={form.invoice_date}
                    onChange={e => setF('invoice_date', e.target.value)} />
                </div>
                <div className={styles.hfGroup}>
                  <label className={styles.hfLabel}>Ref / Invoice #
                    <ConfDot level={conf.invoice_number} />
                  </label>
                  <input className={styles.hfInput} value={form.invoice_number}
                    onChange={e => setF('invoice_number', e.target.value)} placeholder="e.g. 203010a-4" />
                </div>
                {form.services_thru_date && (
                  <div className={styles.hfGroup}>
                    <label className={styles.hfLabel}>Services Through</label>
                    <input className={styles.hfInput} type="date" value={form.services_thru_date}
                      onChange={e => setF('services_thru_date', e.target.value)} />
                  </div>
                )}
              </div>
            </div>

            {/* ── Category details (QB-style line items) ── */}
            <div className={styles.catSection}>
              <div className={styles.catTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Category details</span>
                <button
                  type="button"
                  onClick={() => runSuggestions(false)}
                  disabled={suggesting}
                  style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 3,
                    border: '1px solid var(--accent)', background: 'var(--accent-light)',
                    color: 'var(--accent)', fontWeight: 700, cursor: suggesting ? 'wait' : 'pointer',
                    letterSpacing: '0.02em',
                  }}
                  title="Ask Claude (acting as a senior PM) to assign each line item to the right PM task within its GL code group"
                >
                  {suggesting ? '✦ Thinking…' : '✦ AI Suggest tasks'}
                </button>
              </div>
              {suggestError && (
                <div style={{ fontSize: 11, color: '#b45309', padding: '4px 8px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 3, marginBottom: 6 }}>
                  ⚠ {suggestError}
                </div>
              )}
              <table className={styles.catTable}>
                <thead>
                  <tr className={styles.catThead}>
                    <th className={styles.colHash}>#</th>
                    <th className={styles.colCat}>CATEGORY</th>
                    <th className={styles.colType}>TYPE</th>
                    <th className={styles.colDesc}>DESCRIPTION</th>
                    <th className={`${styles.colAmt} ${styles.right}`}>AMOUNT</th>
                    <th className={styles.colDel} />
                  </tr>
                </thead>
                <tbody>
                  {form.line_items.map((li, i) => {
                    // Determine which PM tasks share this GL code in this phase.
                    // - 1 match: phase_budget_line_id auto-set by useEffect below
                    // - >1 match: show task picker (Option C — required when shared)
                    // - 0 match: warn (uncoded GL — surfaces in integrity report)
                    const matchingTasks = li.qb_account_id != null
                      ? budgetLines.filter((b: any) => b.qb_account_id === li.qb_account_id)
                      : [];
                    const isShared = matchingTasks.length > 1;
                    const noMatch  = li.qb_account_id != null && matchingTasks.length === 0;
                    return (
                    <tr key={i} className={styles.catRow}>
                      <td className={styles.colHash}>{i + 1}</td>
                      <td className={styles.colCat}>
                        <QbPicker
                          accounts={qbAccounts}
                          value={li.qb_account_id}
                          suggestedId={li.suggested_qb_account_id}
                          suggestionConfidence={li.qb_suggestion_confidence}
                          onChange={id => setLine(i, { qb_account_id: id, phase_budget_line_id: null })}
                        />
                        {/* Conditional task picker — appears only when the GL code
                            maps to multiple PM tasks. Required field for shared GL
                            codes; the value is written to ili.phase_budget_line_id. */}
                        {isShared && (() => {
                          const ai = aiSuggestions.get(i);
                          const isAiPick = !!ai && ai.id === li.phase_budget_line_id;
                          return (
                            <>
                              <select
                                value={li.phase_budget_line_id ?? ''}
                                onChange={e => setLine(i, { phase_budget_line_id: e.target.value ? Number(e.target.value) : null })}
                                style={{
                                  marginTop: 4, width: '100%', fontSize: 11,
                                  padding: '3px 4px',
                                  border: li.phase_budget_line_id ? (isAiPick ? '1px solid var(--accent)' : '1px solid #d0d0d0') : '1px solid #f59e0b',
                                  borderRadius: 3,
                                  background: li.phase_budget_line_id
                                    ? (isAiPick ? 'var(--accent-light)' : '#fff')
                                    : '#fffbeb',
                                }}
                              >
                                <option value="">⚠ Pick task ({matchingTasks.length} share this GL)</option>
                                {matchingTasks.map((t: any) => (
                                  <option key={t.id} value={t.id}>{t.task_name}</option>
                                ))}
                              </select>
                              {ai && isAiPick && (
                                <div style={{ marginTop: 2, fontSize: 10, color: 'var(--accent)', fontStyle: 'italic' }}
                                  title={ai.reason}>
                                  ✦ AI ({ai.confidence}): {ai.reason.length > 80 ? ai.reason.slice(0, 80) + '…' : ai.reason}
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {noMatch && (
                          <div style={{
                            marginTop: 4, fontSize: 11, color: '#b45309',
                            padding: '3px 6px', background: '#fffbeb',
                            border: '1px solid #fde68a', borderRadius: 3,
                          }}>
                            ⚠ No PM task uses this GL code in this phase
                          </div>
                        )}
                      </td>
                      <td className={styles.colType}>
                        <select
                          className={styles.typeSelect}
                          value={li.billing_type}
                          onChange={e => setLine(i, { billing_type: e.target.value as LineItem['billing_type'] })}
                        >
                          <option value="fixed">Fixed</option>
                          <option value="tm">T&amp;M</option>
                          <option value="expense">Expense</option>
                        </select>
                      </td>
                      <td className={styles.colDesc}>
                        <input
                          className={styles.descInput}
                          value={li.description}
                          onChange={e => setLine(i, { description: e.target.value })}
                          placeholder="Description"
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }}
                        />
                        {li.billing_type === 'tm' && (
                          <div className={styles.tmSub}>
                            <input className={styles.tmField} value={li.person}
                              onChange={e => setLine(i, { person: e.target.value })}
                              placeholder="Person" style={{ width: 90 }} />
                            <input className={styles.tmField} type="date" value={li.line_date}
                              onChange={e => setLine(i, { line_date: e.target.value })} style={{ width: 110 }} />
                            <input className={styles.tmField} value={li.hours}
                              onChange={e => setLine(i, { hours: e.target.value })}
                              placeholder="hrs" style={{ width: 44 }} />
                            <span className={styles.tmSep}>×</span>
                            <input className={styles.tmField} value={li.rate}
                              onChange={e => setLine(i, { rate: e.target.value })}
                              placeholder="rate" style={{ width: 54 }} />
                          </div>
                        )}
                      </td>
                      <td className={`${styles.colAmt} ${styles.right}`}>
                        <input
                          className={`${styles.amtInput} ${styles.mono}`}
                          value={li.amount}
                          onChange={e => setLine(i, { amount: e.target.value })}
                          placeholder="0.00"
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }}
                        />
                      </td>
                      <td className={styles.colDel}>
                        <button className={styles.delBtn} onClick={() => removeLine(i)} title="Remove">✕</button>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>

              <div className={styles.catFooter}>
                <div className={styles.catFooterLeft}>
                  <button className={styles.addLineBtn} onClick={addLine}>Add lines</button>
                  {form.line_items.length > 0 && (
                    <button className={styles.clearLinesBtn} onClick={clearLines}>Clear all lines</button>
                  )}
                </div>
                {form.line_items.length > 0 && lineTotal > 0 && (
                  <div className={styles.lineTotal}>
                    <span>Total</span>
                    <span className={styles.mono}>{usd.format(lineTotal)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Total (header amount) ── */}
            <div className={styles.totalSection}>
              <label className={styles.hfLabel}>
                Total Amount <ConfDot level={conf.amount} />
              </label>
              <input
                className={`${styles.hfInput} ${styles.mono} ${styles.totalInput}`}
                value={form.amount}
                onChange={e => setF('amount', e.target.value)}
                placeholder="0.00"
              />
              {form.line_items.length > 0 && lineTotal > 0 && Math.abs(lineTotal - Number(form.amount)) > 0.02 && (
                <div className={styles.totalMismatch}>
                  ⚠ Line items total {usd.format(lineTotal)} — doesn't match invoice total
                </div>
              )}
            </div>

          </div>
        )}

        {stage === 'review' && (
          <div className={styles.formFooter}>
            {/* ── Review checkbox ── */}
            <label className={styles.reviewCheck}>
              <input type="checkbox" checked={form.reviewed}
                onChange={e => setF('reviewed', e.target.checked)} />
              <span>I have reviewed this invoice and confirm all details are correct</span>
            </label>

            {saveError && <div className={styles.saveError}>{saveError}</div>}

            <div className={styles.formActions}>
              <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button className={styles.saveBtn} onClick={handleSave} disabled={saving || !canSave}>
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Save & Close'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function InvoicesTab() {
  const { projectId, phaseId } = useParams<{ projectId: string; phaseId: string }>();
  const phaseIdNum   = Number(phaseId);
  const projectIdNum = Number(projectId);
  const qc = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState<number | null>(null);

  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ['invoices', phaseIdNum],
    queryFn:  () => api.listInvoices(phaseIdNum),
    enabled:  !!phaseIdNum,
  });

  const { data: contracts = [] } = useQuery<any[]>({
    queryKey: ['phaseContracts', phaseIdNum],
    queryFn:  () => api.listContracts(phaseIdNum),
    enabled:  !!phaseIdNum,
  });

  const { data: budgetLines = [] } = useQuery<any[]>({
    queryKey: ['budgetLines', phaseIdNum],
    queryFn:  () => api.listBudgetLines(phaseIdNum),
    enabled:  !!phaseIdNum,
    staleTime: 60_000,
  });

  const { data: qbAccounts = [] } = useQuery<QbAccount[]>({
    queryKey: ['qbAccounts'],
    queryFn:  () => api.listQbAccounts(),
    staleTime: Infinity,
  });

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ['invoices',      phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['budget',        phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['phaseContracts', phaseIdNum] });
    setUploadOpen(false);
    setEditInvoiceId(null);
  }

  function handleClose() {
    setUploadOpen(false);
    setEditInvoiceId(null);
  }

  function handleEdit(id: number) {
    setEditInvoiceId(id);
    setUploadOpen(true);
  }

  if (isLoading) return <div className={styles.splash}>Loading…</div>;

  if (uploadOpen) {
    return (
      <UploadPanel
        contracts={contracts}
        budgetLines={budgetLines}
        qbAccounts={qbAccounts}
        projectId={projectIdNum}
        phaseIdNum={phaseIdNum}
        editId={editInvoiceId ?? undefined}
        onClose={handleClose}
        onSaved={handleSaved}
      />
    );
  }

  return <InvoiceList invoices={invoices} phaseId={phaseIdNum} onEdit={handleEdit} />;
}
