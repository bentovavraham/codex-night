import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './HistoryTab.module.css';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: number;
  source: 'contract' | 'invoice' | 'change_order';
  subject_id: number;
  vendor_name: string;
  ref_number: string | null;
  action: string;
  detail: string | null;
  amount: number | null;
  changed_by_name: string;
  changed_at: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null) {
  if (n == null) return '';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = ms / 1000;
  if (s < 60)  return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function absDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

const SOURCE_LABEL: Record<string, string> = {
  contract: 'Contract',
  invoice: 'Invoice',
  change_order: 'Change Order',
};

const SOURCE_COLOR: Record<string, string> = {
  contract: '#1a73e8',
  invoice: '#e65100',
  change_order: '#6a1b9a',
};

const ACTION_ICON: Record<string, string> = {
  created: '●',
  edited: '✎',
  approved: '✓',
  rejected: '✗',
  voided: '⊘',
  submitted: '↑',
  paid: '$',
  status_changed: '↻',
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function HistoryTab() {
  const { phaseId } = useParams<{ phaseId: string }>();
  const pid = Number(phaseId);

  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState<'all' | 'contract' | 'invoice' | 'change_order'>('all');

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['phaseHistory', pid],
    queryFn: () => api.getPhaseHistory(pid, { limit: 500 }),
    enabled: !!pid,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    let rows = data as HistoryEntry[];
    if (filter !== 'all') rows = rows.filter(r => r.source === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        r.vendor_name?.toLowerCase().includes(q) ||
        r.ref_number?.toLowerCase().includes(q) ||
        r.detail?.toLowerCase().includes(q) ||
        r.changed_by_name?.toLowerCase().includes(q) ||
        r.action?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [data, filter, search]);

  // Group by calendar date
  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const row of filtered) {
      const day = new Date(row.changed_at).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      });
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(row);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className={styles.wrap}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search vendor, ref, action…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className={styles.filters}>
          {(['all', 'contract', 'invoice', 'change_order'] as const).map(f => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filter === f ? styles.active : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : SOURCE_LABEL[f]}
            </button>
          ))}
        </div>
        <span className={styles.count}>{filtered.length} event{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Feed */}
      <div className={styles.feed}>
        {isLoading && <div className={styles.empty}>Loading…</div>}
        {isError  && <div className={styles.empty}>Failed to load history.</div>}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className={styles.empty}>No events found.</div>
        )}

        {groups.map(([day, rows]) => (
          <div key={day} className={styles.group}>
            <div className={styles.dayLabel}>{day}</div>
            {rows.map(row => (
              <div key={`${row.source}-${row.id}`} className={styles.entry}>
                <div className={styles.entryLeft}>
                  <span
                    className={styles.dot}
                    style={{ background: SOURCE_COLOR[row.source] }}
                    title={SOURCE_LABEL[row.source]}
                  >
                    {ACTION_ICON[row.action] ?? '·'}
                  </span>
                  <div className={styles.entryBody}>
                    <div className={styles.entryHeader}>
                      <span className={styles.vendor}>{row.vendor_name}</span>
                      {row.ref_number && (
                        <span className={styles.ref}>{row.ref_number}</span>
                      )}
                      <span
                        className={styles.badge}
                        style={{ background: SOURCE_COLOR[row.source] + '22', color: SOURCE_COLOR[row.source] }}
                      >
                        {SOURCE_LABEL[row.source]}
                      </span>
                      <span className={styles.action}>{row.action}</span>
                    </div>
                    {row.detail && <div className={styles.detail}>{row.detail}</div>}
                    <div className={styles.meta}>
                      {row.amount != null && (
                        <span className={styles.amount}>{fmt(row.amount)}</span>
                      )}
                      <span className={styles.by}>by {row.changed_by_name}</span>
                    </div>
                  </div>
                </div>
                <div className={styles.time} title={absDate(row.changed_at)}>
                  {relTime(row.changed_at)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
