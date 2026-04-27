import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './ContractPanel.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const CONTRACT_STATUS_CSS: Record<string, string> = {
  draft: 'sDraft', pending: 'sPending', active: 'sActive',
  completed: 'sCompleted', voided: 'sVoided',
};
const INV_STATUS_CSS: Record<string, string> = {
  pending: 'sPending', pm_approved: 'sPm', partner_approved: 'sPartner',
  approved: 'sApproved', pushed: 'sPushed', paid: 'sPaid',
  rejected: 'sRejected', on_hold: 'sHold',
};
const INV_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', pm_approved: 'PM ✓', partner_approved: 'Partner ✓',
  approved: 'Approved', pushed: 'Pushed', paid: 'Paid',
  rejected: 'Rejected', on_hold: 'Hold',
};

function Badge({ status, map, labelMap }: { status: string; map: Record<string,string>; labelMap: Record<string,string> }) {
  return (
    <span className={`${styles.badge} ${styles[map[status] ?? 'sDraft']}`}>
      {labelMap[status] ?? status}
    </span>
  );
}

// ─── Invoice PDF mini-viewer ──────────────────────────────────────────────────

function PdfModal({ fileRef, onClose }: { fileRef: string; onClose: () => void }) {
  return (
    <div className={styles.pdfOverlay} onClick={onClose}>
      <div className={styles.pdfBox} onClick={e => e.stopPropagation()}>
        <div className={styles.pdfBar}>
          <span>Document</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <iframe src={`/api/files/${encodeURIComponent(fileRef)}`} className={styles.pdfFrame} title="Document" />
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  contractId: number;
  onClose: () => void;
  onEdit?: () => void;
}

export function ContractPanel({ contractId, onClose, onEdit }: Props) {
  const [pdfRef, setPdfRef] = useState<string | null>(null);
  const [confirmDeleteContract, setConfirmDeleteContract] = useState(false);
  const [confirmDeleteInvId, setConfirmDeleteInvId] = useState<number | null>(null);
  const qc = useQueryClient();

  const { data: c, isLoading, isError, error } = useQuery({
    queryKey: ['contractDetail', contractId],
    queryFn: () => api.getContract(contractId),
    staleTime: 30_000,
    retry: false,
  });

  const deleteContract = useMutation({
    mutationFn: () => api.deleteContract(contractId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['phaseContracts'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      onClose();
    },
  });

  const deleteInvoice = useMutation({
    mutationFn: (id: number) => api.deleteInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contractDetail', contractId] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      setConfirmDeleteInvId(null);
    },
  });

  const totalInvoiced = c ? (Number(c.invoiced_amount) + Number(c.tm_invoiced_amount) + Number(c.expense_invoiced_amount)) : 0;
  const nonDraftInvoices = c?.invoices?.filter((i: any) => i.status !== 'voided') ?? [];

  return (
    <>
      {pdfRef && <PdfModal fileRef={pdfRef} onClose={() => setPdfRef(null)} />}

      {/* Backdrop */}
      <div className={styles.backdrop} onClick={onClose} />

      {/* Drawer */}
      <div className={styles.panel}>

        {/* ── Header bar ── */}
        <div className={styles.panelBar}>
          <div className={styles.panelTitle}>
            {!c || isLoading ? 'Contract' : (
              <>
                <span className={styles.panelVendor}>{c.vendor_name}</span>
                {c.reference_number && <span className={styles.panelRef}> · {c.reference_number}</span>}
              </>
            )}
          </div>
          <div className={styles.panelBarActions}>
            {onEdit && (
              <button className={styles.editPanelBtn} onClick={onEdit} title="Edit this contract">
                Edit
              </button>
            )}
            {confirmDeleteContract ? (
              <button className={styles.confirmDeleteBtn}
                onClick={() => deleteContract.mutate()}
                disabled={deleteContract.isPending}>
                Confirm delete?
              </button>
            ) : (
              <button className={styles.deletePanelBtn}
                onClick={() => setConfirmDeleteContract(true)}
                title="Delete this contract">
                Delete
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {isError ? (
          <div className={styles.loading} style={{ flexDirection: 'column', gap: 4 }}>
            <span style={{ color: 'var(--status-rejected)' }}>Failed to load contract</span>
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{(error as any)?.message}</span>
          </div>
        ) : isLoading || !c ? (
          <div className={styles.loading}><div className={styles.spinner} /><span>Loading…</span></div>
        ) : (
          <div className={styles.body}>

            {/* ── Contract meta ── */}
            <div className={styles.metaGrid}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Status</span>
                <Badge status={c.status} map={CONTRACT_STATUS_CSS} labelMap={{
                  draft:'Draft', pending:'Pending', active:'Active', completed:'Completed', voided:'Voided',
                }} />
              </div>
              {c.budget_line_name && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Task</span>
                  <span className={styles.metaValue}>
                    {c.budget_line_name}
                    {c.budget_line_discipline && <span className={styles.metaDim}> · {c.budget_line_discipline}</span>}
                  </span>
                </div>
              )}
              {c.contract_date && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Date</span>
                  <span className={styles.metaValue}>{String(c.contract_date).slice(0, 10)}</span>
                </div>
              )}
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Fixed Value</span>
                <span className={styles.metaValue}>{Number(c.total_value) > 0 ? usd2.format(Number(c.total_value)) : '—'}</span>
              </div>
              {totalInvoiced > 0 && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Invoiced</span>
                  <span className={styles.metaValue}>{usd2.format(totalInvoiced)}</span>
                </div>
              )}
              {c.file_reference && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Document</span>
                  <button className={styles.docBtn} onClick={() => setPdfRef(c.file_reference)}>
                    📋 View Contract PDF
                  </button>
                </div>
              )}
            </div>

            {/* ── Description ── */}
            {c.description && (
              <div className={styles.descBlock}>{c.description}</div>
            )}

            {/* ── Tasks / scope ── */}
            {c.task_items?.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>Scope of Work</div>
                <div className={styles.taskList}>
                  {c.task_items.map((t: any, i: number) => (
                    <div key={t.id} className={styles.taskRow}>
                      <span className={styles.taskNum}>{i + 1}</span>
                      <span className={`${styles.taskType} ${t.billing_type === 'tm' ? styles.typeTm : t.billing_type === 'expense' ? styles.typeExp : styles.typeFix}`}>
                        {t.billing_type === 'tm' ? 'T&M' : t.billing_type === 'expense' ? 'Exp' : 'Fixed'}
                      </span>
                      <span className={styles.taskDesc}>{t.description}</span>
                      <span className={styles.taskAmt}>
                        {t.billing_type === 'tm'
                          ? <span className={styles.taskTm}>T&amp;M</span>
                          : usd2.format(Number(t.budgeted_amount) || 0)}
                      </span>
                    </div>
                  ))}
                  {/* Fixed total row */}
                  {(() => {
                    const fixedTotal = c.task_items
                      .filter((t: any) => t.billing_type === 'fixed')
                      .reduce((s: number, t: any) => s + (Number(t.budgeted_amount) || 0), 0);
                    const hasTm = c.task_items.some((t: any) => t.billing_type === 'tm');
                    if (fixedTotal > 0) return (
                      <div className={styles.taskFooter}>
                        <span>{usd2.format(fixedTotal)} fixed{hasTm ? ' + T&M' : ''}</span>
                      </div>
                    );
                    return null;
                  })()}
                </div>
              </div>
            )}

            {/* ── Invoices ── */}
            <div className={styles.section}>
              <div className={styles.sectionLabel}>
                Invoices
                {nonDraftInvoices.length > 0 && (
                  <span className={styles.sectionCount}>{nonDraftInvoices.length}</span>
                )}
                {totalInvoiced > 0 && (
                  <span className={styles.sectionTotal}>{usd.format(totalInvoiced)} invoiced</span>
                )}
              </div>

              {nonDraftInvoices.length === 0 ? (
                <div className={styles.empty}>No invoices yet.</div>
              ) : (
                <div className={styles.invoiceList}>
                  {nonDraftInvoices.map((inv: any) => (
                    <div key={inv.id} className={styles.invoiceRow}>
                      <div className={styles.invMain}>
                        <span className={styles.invNum}>{inv.invoice_number}</span>
                        <span className={styles.invDate}>
                          {inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : '—'}
                        </span>
                        <span className={styles.invAmt}>{usd2.format(Number(inv.amount))}</span>
                        <Badge status={inv.status} map={INV_STATUS_CSS} labelMap={INV_STATUS_LABEL} />
                        {inv.file_reference && (
                          <button className={styles.invPdfBtn} onClick={() => setPdfRef(inv.file_reference)} title="View PDF">
                            PDF
                          </button>
                        )}
                        {confirmDeleteInvId === inv.id ? (
                          <button className={styles.confirmDeleteBtn}
                            onClick={() => deleteInvoice.mutate(inv.id)}
                            disabled={deleteInvoice.isPending}>
                            Confirm?
                          </button>
                        ) : (
                          <button className={styles.invDeleteBtn}
                            onClick={() => setConfirmDeleteInvId(inv.id)}
                            title="Delete invoice">✕</button>
                        )}
                      </div>
                      {inv.description && (
                        <div className={styles.invDesc}>{inv.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </>
  );
}
