import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './ImportDrawer.module.css';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface ImportItem {
  id: number;
  phase_id: number;
  original_filename: string;
  file_reference: string | null;
  doc_type: string | null;
  doc_type_confidence: string | null;
  extracted_data: any | null;
  suggested_budget_line_id: number | null;
  suggested_line_name: string | null;
  match_confidence: string | null;
  status: string;
  error_message: string | null;
}

interface Props {
  phaseId: number;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  extracting: 'Extracting…',
  needs_review: 'Needs Review',
  confirmed: 'Confirmed',
  failed: 'Failed',
  discarded: 'Discarded',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`${styles.badge} ${styles[`badge_${status}`] ?? styles.badge_queued}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function TypeChip({ type, onClick }: { type: string | null; onClick: () => void }) {
  return (
    <button
      className={`${styles.typeChip} ${type === 'contract' ? styles.typeContract : type === 'invoice' ? styles.typeInvoice : styles.typeUnknown}`}
      onClick={onClick}
      title="Click to flip type"
    >
      {type ? type.toUpperCase() : '?'}
    </button>
  );
}

// ── Review Form ─────────────────────────────────────────────────────────────

interface ReviewFormProps {
  item: ImportItem;
  budgetLines: any[];
  onConfirm: (formData: any) => Promise<void>;
  onDiscard: () => Promise<void>;
  onBack: () => void;
  saving: boolean;
}

function ReviewForm({ item, budgetLines, onConfirm, onDiscard, onBack, saving }: ReviewFormProps) {
  const ext = item.extracted_data || {};
  const isContract = item.doc_type === 'contract';

  const [vendor, setVendor] = useState<string>(ext.vendor_name || '');
  const [description, setDescription] = useState<string>(ext.description || ext.summary || '');
  const [budgetLineId, setBudgetLineId] = useState<string>(
    item.suggested_budget_line_id ? String(item.suggested_budget_line_id) : ''
  );

  // Contract-specific
  const [totalValue, setTotalValue] = useState<string>(ext.total_value ? String(ext.total_value) : '');
  const [contractDate, setContractDate] = useState<string>(ext.contract_date || '');
  const [referenceNumber, setReferenceNumber] = useState<string>(ext.reference_number || '');
  const [contractStatus, setContractStatus] = useState<string>('active');

  // Invoice-specific
  const [invoiceNumber, setInvoiceNumber] = useState<string>(ext.invoice_number || '');
  const [amount, setAmount] = useState<string>(ext.amount ? String(ext.amount) : '');
  const [invoiceDate, setInvoiceDate] = useState<string>(ext.invoice_date || '');
  const [invoiceType, setInvoiceType] = useState<string>('fixed');
  const [invoiceStatus, setInvoiceStatus] = useState<string>('pending');

  const handleConfirm = async () => {
    const base = {
      vendor_name: vendor,
      description,
      phase_budget_line_id: budgetLineId ? Number(budgetLineId) : null,
    };
    if (isContract) {
      await onConfirm({
        ...base,
        total_value: totalValue,
        contract_date: contractDate || null,
        reference_number: referenceNumber,
        status: contractStatus,
        line_items: ext.line_items || [],
      });
    } else {
      await onConfirm({
        ...base,
        invoice_number: invoiceNumber,
        amount,
        invoice_date: invoiceDate || null,
        invoice_type: invoiceType,
        status: invoiceStatus,
      });
    }
  };

  return (
    <div className={styles.reviewForm}>
      <div className={styles.reviewHeader}>
        <button className={styles.backBtn} onClick={onBack}>← Queue</button>
        <div className={styles.reviewTitle}>
          <span className={`${styles.typeChip} ${isContract ? styles.typeContract : styles.typeInvoice}`}>
            {isContract ? 'CONTRACT' : 'INVOICE'}
          </span>
          <span className={styles.reviewFilename}>{item.original_filename}</span>
        </div>
      </div>

      <div className={styles.reviewBody}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>Vendor</label>
          <input className={styles.fieldInput} value={vendor} onChange={e => setVendor(e.target.value)} />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>Description</label>
          <textarea className={styles.fieldTextarea} value={description} onChange={e => setDescription(e.target.value)} rows={3} />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>Budget Line</label>
          <select className={styles.fieldSelect} value={budgetLineId} onChange={e => setBudgetLineId(e.target.value)}>
            <option value="">— Unassigned —</option>
            {budgetLines.map((bl: any) => (
              <option key={bl.id} value={bl.id}>{bl.task_name}{bl.discipline ? ` · ${bl.discipline}` : ''}</option>
            ))}
          </select>
        </div>

        {isContract ? (
          <>
            <div className={styles.fieldRow}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Total Value</label>
                <input className={styles.fieldInput} value={totalValue} onChange={e => setTotalValue(e.target.value)} type="number" min="0" step="0.01" />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Contract Date</label>
                <input className={styles.fieldInput} value={contractDate} onChange={e => setContractDate(e.target.value)} type="date" />
              </div>
            </div>
            <div className={styles.fieldRow}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Reference #</label>
                <input className={styles.fieldInput} value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Status</label>
                <select className={styles.fieldSelect} value={contractStatus} onChange={e => setContractStatus(e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="pending">Pending</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="voided">Voided</option>
                </select>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={styles.fieldRow}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Invoice #</label>
                <input className={styles.fieldInput} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Amount</label>
                <input className={styles.fieldInput} value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" step="0.01" />
              </div>
            </div>
            <div className={styles.fieldRow}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Invoice Date</label>
                <input className={styles.fieldInput} value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} type="date" />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Status</label>
                <select className={styles.fieldSelect} value={invoiceStatus} onChange={e => setInvoiceStatus(e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="pm_approved">PM Approved</option>
                  <option value="approved">Approved</option>
                </select>
              </div>
            </div>
          </>
        )}

        {/* Line items preview */}
        {ext.line_items && ext.line_items.length > 0 && (
          <div className={styles.lineItemsPreview}>
            <div className={styles.lineItemsHeader}>Line Items ({ext.line_items.length})</div>
            {ext.line_items.map((li: any, idx: number) => (
              <div key={idx} className={styles.lineItemRow}>
                <span className={styles.lineItemType}>{li.billing_type}</span>
                <span className={styles.lineItemDesc}>{li.description}</span>
                <span className={styles.lineItemAmt}>{usd.format(Number(li.budgeted_amount ?? li.amount ?? 0))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.reviewFooter}>
        <button className={styles.discardBtn} onClick={onDiscard} disabled={saving}>Discard</button>
        <button className={styles.confirmBtn} onClick={handleConfirm} disabled={saving}>
          {saving ? 'Saving…' : 'Confirm & Save'}
        </button>
      </div>
    </div>
  );
}

// ── Queue Card ───────────────────────────────────────────────────────────────

function QueueCard({ item, onClick, onFlipType }: {
  item: ImportItem;
  onClick: () => void;
  onFlipType: () => void;
}) {
  const ext = item.extracted_data || {};
  const isClickable = item.status === 'needs_review' || item.status === 'failed';
  const vendor = ext.vendor_name || '—';
  const amount = ext.amount != null ? usd.format(Number(ext.amount))
    : ext.total_value != null ? usd.format(Number(ext.total_value))
    : null;

  return (
    <div
      className={`${styles.queueCard} ${isClickable ? styles.queueCardClickable : ''}`}
      onClick={isClickable ? onClick : undefined}
    >
      <div className={styles.cardRow}>
        <TypeChip
          type={item.doc_type}
          onClick={e => { (e as any).stopPropagation?.(); onFlipType(); }}
        />
        <span className={styles.cardFilename} title={item.original_filename}>
          {item.original_filename}
        </span>
        <StatusBadge status={item.status} />
      </div>
      {(item.status === 'needs_review' || item.status === 'confirmed') && (
        <div className={styles.cardMeta}>
          <span className={styles.cardVendor}>{vendor}</span>
          {amount && <span className={styles.cardAmt}>{amount}</span>}
          {item.suggested_line_name && (
            <span className={styles.cardLine} title={item.suggested_line_name}>
              {item.suggested_line_name}
            </span>
          )}
        </div>
      )}
      {item.status === 'failed' && item.error_message && (
        <div className={styles.cardError}>{item.error_message}</div>
      )}
    </div>
  );
}

// ── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPdf = (f: File) =>
    f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(isPdf);
    if (files.length) onFiles(files);
  }, [onFiles]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(isPdf);
    if (files.length) onFiles(files);
    e.target.value = '';
  };

  return (
    <div
      className={`${styles.dropZone} ${dragging ? styles.dropZoneDragging : ''}`}
      onDragEnter={e => { e.preventDefault(); setDragging(true); }}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={e => { e.preventDefault(); setDragging(false); }}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={handleChange} />
      <div className={styles.dropIcon}>↑</div>
      <div className={styles.dropText}>Drop PDFs here or click to browse</div>
      <div className={styles.dropSub}>Contracts and invoices — mixed OK</div>
    </div>
  );
}

// ── Main Drawer ──────────────────────────────────────────────────────────────

export function ImportDrawer({ phaseId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [drawerView, setDrawerView] = useState<'queue' | 'review'>('queue');
  const [reviewItem, setReviewItem] = useState<ImportItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: queue = [], refetch } = useQuery<ImportItem[]>({
    queryKey: ['importQueue', phaseId],
    queryFn: () => api.getImportQueue(phaseId),
    refetchInterval: (query) => {
      const items = query.state.data ?? [];
      const hasActive = items.some((i: ImportItem) => i.status === 'queued' || i.status === 'extracting');
      return hasActive ? 4000 : false;
    },
  });

  const { data: budgetLines = [] } = useQuery<any[]>({
    queryKey: ['budgetLines', phaseId],
    queryFn: () => api.listBudgetLines(phaseId),
  });

  const pending = queue.filter(i => i.status !== 'confirmed' && i.status !== 'discarded');
  const done = queue.filter(i => i.status === 'confirmed' || i.status === 'discarded');

  const handleFiles = async (files: File[]) => {
    setUploading(true);
    try {
      await api.importFiles(phaseId, files);
      await refetch();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleFlipType = async (item: ImportItem) => {
    const newType = item.doc_type === 'contract' ? 'invoice' : 'contract';
    await api.updateImportItem(item.id, { doc_type: newType });
    await refetch();
  };

  const handleOpenReview = (item: ImportItem) => {
    setReviewItem(item);
    setDrawerView('review');
  };

  const handleConfirm = async (formData: any) => {
    if (!reviewItem) return;
    setSaving(true);
    try {
      await api.confirmImportItem(reviewItem.id, formData);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['budget', phaseId] });
      queryClient.invalidateQueries({ queryKey: ['contracts', phaseId] });
      queryClient.invalidateQueries({ queryKey: ['invoices', phaseId] });
      setDrawerView('queue');
      setReviewItem(null);
    } catch (err) {
      console.error('Confirm failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = async () => {
    if (!reviewItem) return;
    setSaving(true);
    try {
      await api.discardImportItem(reviewItem.id);
      await refetch();
      setDrawerView('queue');
      setReviewItem(null);
    } catch (err) {
      console.error('Discard failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    setDrawerView('queue');
    setReviewItem(null);
  };

  // Keep reviewItem in sync with latest queue data
  const liveReviewItem = reviewItem
    ? (queue.find(i => i.id === reviewItem.id) ?? reviewItem)
    : null;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerTitle}>Bulk Import</div>
            <div className={styles.headerSub}>AI classifies and extracts — you review</div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {drawerView === 'queue' ? (
          <div className={styles.queueView}>
            {/* Drop zone */}
            {true && (
              <div className={styles.dropZoneWrap}>
                {uploading ? (
                  <div className={styles.uploadingMsg}>
                    <div className={styles.spinner} /> Uploading…
                  </div>
                ) : (
                  <DropZone onFiles={handleFiles} />
                )}
              </div>
            )}

            {/* Pending section */}
            {pending.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  Pending
                  <span className={styles.sectionCount}>{pending.length}</span>
                </div>
                {pending.map(item => (
                  <QueueCard
                    key={item.id}
                    item={item}
                    onClick={() => handleOpenReview(item)}
                    onFlipType={() => handleFlipType(item)}
                  />
                ))}
              </div>
            )}

            {/* Done section — collapsed by default */}
            {done.length > 0 && (
              <div className={styles.section}>
                <button className={styles.doneToggle} onClick={() => setDoneOpen(o => !o)}>
                  <span>{doneOpen ? '▾' : '▸'} Done</span>
                  <span className={styles.sectionCount}>{done.length}</span>
                </button>
                {doneOpen && done.map(item => (
                  <QueueCard
                    key={item.id}
                    item={item}
                    onClick={() => {}}
                    onFlipType={() => {}}
                  />
                ))}
              </div>
            )}

            {queue.length === 0 && !uploading && (
              <div className={styles.emptyQueue}>
                Drop PDFs above to get started.
              </div>
            )}
          </div>
        ) : (
          liveReviewItem && (
            <ReviewForm
              item={liveReviewItem}
              budgetLines={budgetLines}
              onConfirm={handleConfirm}
              onDiscard={handleDiscard}
              onBack={handleBack}
              saving={saving}
            />
          )
        )}
      </div>
    </>
  );
}
