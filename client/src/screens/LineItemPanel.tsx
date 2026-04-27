import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { BudgetRow } from './BudgetGrid';
import styles from './LineItemPanel.module.css';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n: number) => n > 0 ? usd.format(n) : '—';

const CONTRACT_STATUS: Record<string, string> = {
  draft: 'Draft', pending: 'Pending', active: 'Active', completed: 'Completed', voided: 'Voided',
};
const CONTRACT_CSS: Record<string, string> = {
  draft: 'sDraft', pending: 'sPending', active: 'sActive', completed: 'sCompleted', voided: 'sVoided',
};
const INV_STATUS: Record<string, string> = {
  pending: 'Pending', pm_approved: 'PM ✓', partner_approved: 'Partner ✓',
  approved: 'Approved', pushed: 'Pushed', paid: 'Paid', rejected: 'Rejected', on_hold: 'Hold',
};
const INV_CSS: Record<string, string> = {
  pending: 'sPending', pm_approved: 'sPm', partner_approved: 'sPartner',
  approved: 'sApproved', pushed: 'sPushed', paid: 'sPaid', rejected: 'sRejected', on_hold: 'sHold',
};

function PdfModal({ fileRef, onClose }: { fileRef: string; onClose: () => void }) {
  return (
    <div className={styles.pdfOverlay} onClick={onClose}>
      <div className={styles.pdfBox} onClick={e => e.stopPropagation()}>
        <div className={styles.pdfBar}>
          <span>Document</span>
          <button className={styles.pdfClose} onClick={onClose}>✕</button>
        </div>
        <iframe src={`/api/files/${encodeURIComponent(fileRef)}`} className={styles.pdfFrame} title="Document" />
      </div>
    </div>
  );
}

interface Props {
  row: BudgetRow;
  onClose: () => void;
}

export function LineItemPanel({ row, onClose }: Props) {
  const [pdfRef, setPdfRef] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['lineActivity', row.id],
    queryFn: () => api.getLineActivity(row.id),
    staleTime: 30_000,
    retry: false,
  });

  const contracts: any[] = data?.contracts ?? [];
  const invoices: any[]  = data?.invoices  ?? [];

  const totalCommitted = contracts
    .filter(c => c.status !== 'voided')
    .reduce((s, c) => s + Number(c.total_value || 0), 0);
  const totalBilled = invoices.reduce((s, i) => s + Number(i.amount || 0), 0);

  return (
    <>
      {pdfRef && <PdfModal fileRef={pdfRef} onClose={() => setPdfRef(null)} />}

      <div className={styles.backdrop} onClick={onClose} />

      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.taskName}>{row.task_name}</div>
            {row.discipline && <div className={styles.taskSub}>{row.discipline}</div>}
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Financial summary bar */}
        <div className={styles.summaryBar}>
          <div className={styles.summaryCol}>
            <div className={styles.summaryLabel}>Budgeted</div>
            <div className={styles.summaryVal}>{fmt(row.budgeted_amount)}</div>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryCol}>
            <div className={styles.summaryLabel}>Committed</div>
            <div className={styles.summaryVal}>{fmt(totalCommitted)}</div>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryCol}>
            <div className={styles.summaryLabel}>Billed</div>
            <div className={styles.summaryVal}>{fmt(totalBilled)}</div>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryCol}>
            <div className={styles.summaryLabel}>Remaining</div>
            <div className={`${styles.summaryVal} ${row.remaining_budget < 0 ? styles.danger : ''}`}>
              {fmt(row.remaining_budget)}
            </div>
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className={styles.loading}><div className={styles.spinner} />Loading…</div>
        ) : isError ? (
          <div className={styles.loading} style={{ flexDirection: 'column', gap: 4 }}>
            <span style={{ color: 'var(--status-rejected)' }}>Failed to load activity</span>
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{(error as any)?.message}</span>
          </div>
        ) : (
          <div className={styles.body}>

            {/* Contracts */}
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                Contracts
                {contracts.length > 0 && <span className={styles.sectionCount}>{contracts.length}</span>}
              </div>
              {contracts.length === 0 ? (
                <div className={styles.empty}>No contracts linked.</div>
              ) : (
                contracts.map(c => (
                  <div key={c.id} className={styles.contractRow}>
                    <div className={styles.contractMain}>
                      <span className={`${styles.badge} ${styles[CONTRACT_CSS[c.status] ?? 'sDraft']}`}>
                        {CONTRACT_STATUS[c.status] ?? c.status}
                      </span>
                      <span className={styles.contractVendor}>{c.vendor_name}</span>
                      {c.reference_number && (
                        <span className={styles.contractRef}>{c.reference_number}</span>
                      )}
                      <span className={styles.contractAmt}>{fmt(Number(c.total_value || 0))}</span>
                      {c.file_reference && (
                        <button className={styles.pdfBtn} onClick={() => setPdfRef(c.file_reference)}>
                          PDF
                        </button>
                      )}
                    </div>
                    {c.contract_date && (
                      <div className={styles.contractSub}>
                        {String(c.contract_date).slice(0, 10)}
                        {c.description && <span className={styles.contractDesc}> · {c.description}</span>}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Invoices */}
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                Invoices
                {invoices.length > 0 && <span className={styles.sectionCount}>{invoices.length}</span>}
                {totalBilled > 0 && <span className={styles.sectionTotal}>{usd.format(totalBilled)}</span>}
              </div>
              {invoices.length === 0 ? (
                <div className={styles.empty}>No invoices yet.</div>
              ) : (
                invoices.map(inv => (
                  <div key={inv.id} className={styles.invoiceRow}>
                    <div className={styles.invoiceMain}>
                      <span className={`${styles.badge} ${styles[INV_CSS[inv.status] ?? 'sPending']}`}>
                        {INV_STATUS[inv.status] ?? inv.status}
                      </span>
                      <span className={styles.invNum}>{inv.invoice_number || '—'}</span>
                      <span className={styles.invDate}>
                        {inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : ''}
                      </span>
                      <span className={styles.invAmt}>{usd.format(Number(inv.amount || 0))}</span>
                      {inv.file_reference && (
                        <button className={styles.pdfBtn} onClick={() => setPdfRef(inv.file_reference)}>
                          PDF
                        </button>
                      )}
                    </div>
                    <div className={styles.invoiceSub}>
                      {inv.vendor_name || inv.contract_vendor || ''}
                      {inv.contract_ref && <span className={styles.contractRef}> · {inv.contract_ref}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        )}
      </div>
    </>
  );
}
