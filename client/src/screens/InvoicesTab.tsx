import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client';
import styles from './InvoicesTab.module.css';
import { ContractPanel } from './ContractPanel';
import { InvoiceEditOverlay } from './ImportDrawer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const STATUS_CSS: Record<string, string> = {
  pending: 'sPending', pm_approved: 'sPm', partner_approved: 'sPartner',
  approved: 'sApproved', pushed: 'sPushed', paid: 'sPaid',
  rejected: 'sRejected', on_hold: 'sHold',
};


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

export default function InvoicesTab() {
  const { phaseId } = useParams<{ phaseId: string }>();
  const phaseIdNum = Number(phaseId);
  const qc = useQueryClient();

  const [editInvoiceId, setEditInvoiceId] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Open Edit overlay when navigated here with ?edit=X (from drill panel etc.)
  useEffect(() => {
    const editParam = searchParams.get('edit');
    if (editParam) {
      const id = Number(editParam);
      if (Number.isInteger(id) && id > 0) {
        setEditInvoiceId(id);
        const next = new URLSearchParams(searchParams);
        next.delete('edit');
        setSearchParams(next, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ['invoices', phaseIdNum],
    queryFn:  () => api.listInvoices(phaseIdNum),
    enabled:  !!phaseIdNum,
  });

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ['invoices',       phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['budget',         phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['phaseContracts', phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['drill',          phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['contractDetail'] });
    qc.invalidateQueries({ queryKey: ['audit',          phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['txnReport',      phaseIdNum] });
    setEditInvoiceId(null);
  }

  function handleClose() {
    setEditInvoiceId(null);
  }

  function handleEdit(id: number) {
    setEditInvoiceId(id);
  }

  if (isLoading) return <div className={styles.splash}>Loading…</div>;

  if (editInvoiceId) {
    return (
      <InvoiceEditOverlay
        invoiceId={editInvoiceId}
        phaseId={phaseIdNum}
        onClose={handleClose}
        onSaved={handleSaved}
      />
    );
  }

  return <InvoiceList invoices={invoices} phaseId={phaseIdNum} onEdit={handleEdit} />;
}
