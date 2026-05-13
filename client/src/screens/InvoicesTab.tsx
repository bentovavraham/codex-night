import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client';
import styles from './InvoicesTab.module.css';
import { ContractPanel } from './ContractPanel';
import { InvoiceEditOverlay } from './ImportDrawer';
import { useUserStore } from '../store/userStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const STATUS_CSS: Record<string, string> = {
  pending: 'sPending', pm_approved: 'sPm', partner_approved: 'sPartner',
  approved: 'sApproved', pushed: 'sPushed', paid: 'sPaid',
  rejected: 'sRejected', on_hold: 'sHold',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  pm_approved: 'PM Approved',
  partner_approved: 'Partner Approved',
  approved: 'Approved',
  pushed: 'Pushed',
  paid: 'Paid',
  rejected: 'Rejected',
  on_hold: 'On Hold',
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
  const user = useUserStore(s => s.user);
  const roleLevel = user?.role === 'admin' ? 3 : user?.role === 'partner' ? 2 : 1;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', phaseId] });
      qc.invalidateQueries({ queryKey: ['budget',   phaseId] });
      setConfirmDeleteId(null);
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) => {
      if (action === 'pm') return api.pmApproveInvoice(id);
      if (action === 'partner') return api.partnerApproveInvoice(id);
      if (action === 'final') return api.approveInvoice(id);
      if (action === 'pushed') return api.markInvoicePushed(id);
      if (action === 'paid') {
        const paidDate = window.prompt('Paid date (YYYY-MM-DD). Leave blank for today.', '');
        return api.markInvoicePaid(id, paidDate || undefined);
      }
      if (action === 'hold') {
        const note = window.prompt('Hold reason (optional)', '');
        return api.holdInvoice(id, note || undefined);
      }
      if (action === 'reject') {
        const note = window.prompt('Rejection reason');
        if (!note?.trim()) throw new Error('Rejection reason is required.');
        return api.rejectInvoice(id, note.trim());
      }
      if (action === 'revert') return api.revertInvoice(id);
      throw new Error('Unknown invoice action');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', phaseId] });
      qc.invalidateQueries({ queryKey: ['budget',   phaseId] });
      qc.invalidateQueries({ queryKey: ['audit',    phaseId] });
      qc.invalidateQueries({ queryKey: ['txnReport', phaseId] });
    },
  });

  function actionsFor(inv: any) {
    const actions: { key: string; label: string; minRole?: number }[] = [];
    if (inv.status === 'pending') {
      actions.push({ key: 'pm', label: 'PM Approve' }, { key: 'hold', label: 'Hold' }, { key: 'reject', label: 'Reject' });
    } else if (inv.status === 'pm_approved') {
      actions.push({ key: 'partner', label: 'Partner Approve', minRole: 2 }, { key: 'reject', label: 'Reject' }, { key: 'revert', label: 'Revert' });
    } else if (inv.status === 'partner_approved') {
      actions.push({ key: 'final', label: 'Final Approve', minRole: 3 }, { key: 'reject', label: 'Reject' }, { key: 'revert', label: 'Revert' });
    } else if (inv.status === 'approved') {
      actions.push({ key: 'pushed', label: 'Pushed' }, { key: 'paid', label: 'Paid' }, { key: 'hold', label: 'Hold' }, { key: 'revert', label: 'Revert' });
    } else if (inv.status === 'pushed') {
      actions.push({ key: 'paid', label: 'Paid' }, { key: 'revert', label: 'Revert' });
    } else if (inv.status === 'rejected' || inv.status === 'on_hold') {
      actions.push({ key: 'revert', label: 'Revert' });
    }
    return actions.filter(a => !a.minRole || roleLevel >= a.minRole);
  }

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
                    <span className={`${styles.badge} ${styles[STATUS_CSS[inv.status] ?? 'sPending']}`}>
                      {STATUS_LABEL[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td className={`${styles.ltd} ${styles.actionCell}`}>
                    {actionsFor(inv).map(a => (
                      <button
                        key={a.key}
                        className={styles.editBtn}
                        onClick={() => actionMutation.mutate({ id: inv.id, action: a.key })}
                        disabled={actionMutation.isPending}
                        title={a.label}
                      >
                        {a.label}
                      </button>
                    ))}
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
