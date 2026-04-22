// Project Dashboard — shows project-level rollup + each contract as a health card.
// Clicking a contract navigates directly into ContractDetail.

window.Dashboard = function Dashboard({ projectId, onOpenContract }) {
  const [summary, setSummary] = React.useState(null);
  const [contracts, setContracts] = React.useState([]);
  const [ledgers, setLedgers] = React.useState({});   // contractId → ledger
  const [err, setErr] = React.useState(null);

  async function load() {
    try {
      const [s, cs] = await Promise.all([
        api.getCostSummary(projectId),
        api.listContracts(projectId),
      ]);
      setSummary(s);
      setContracts(cs);
      // Load ledgers for all contracts in parallel
      const ledgerMap = {};
      await Promise.all(cs.map(async c => {
        try {
          ledgerMap[c.id] = await api.getContractLedger(c.id);
        } catch (_) {}
      }));
      setLedgers(ledgerMap);
    } catch (e) { setErr(e.message); }
  }

  React.useEffect(() => { load(); }, [projectId]);

  if (err) return <div className="error" style={{ padding: 24 }}>{err}</div>;
  if (!summary) return <div style={{ padding: 24, color: 'var(--text-3)' }}>Loading…</div>;

  const s = summary;
  const hasContracts = contracts.length > 0;

  // Project-level health
  let projectHealth = 'clear';
  if (s.cost_creep || s.overrun) projectHealth = 'danger';
  else if (s.pending_co_count > 0 || s.pending_invoice_count > 0) projectHealth = 'warn';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Project rollup strip ── */}
      <ProjectRollup summary={s} health={projectHealth} />

      {/* ── Contract cards ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 }}>
            Contracts ({contracts.length})
          </div>
        </div>

        {!hasContracts ? (
          <div style={{
            background: 'var(--surface)', border: '1px dashed var(--border-2)',
            borderRadius: 8, padding: '40px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No contracts yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              Go to the Contracts tab to add your first contract.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {contracts.map(c => (
              <ContractHealthCard
                key={c.id}
                contract={c}
                ledger={ledgers[c.id] || null}
                onClick={() => onOpenContract && onOpenContract(c.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function ProjectRollup({ summary: s, health }) {
  const hc = {
    clear:  { color: 'var(--ok)',     bg: 'rgba(34,197,94,0.07)',  border: 'rgba(34,197,94,0.18)',  icon: '●' },
    warn:   { color: 'var(--warn)',   bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.22)', icon: '▲' },
    danger: { color: 'var(--danger)', bg: 'rgba(239,68,68,0.09)',  border: 'rgba(239,68,68,0.28)',  icon: '■' },
  }[health];

  const hasEarmark = s.earmarked_total > 0;
  const earmarkPct = hasEarmark ? Math.min(Math.round((s.commitment / s.earmarked_total) * 100), 999) : 0;

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${hc.border}`, borderRadius: 8, overflow: 'hidden' }}>
      {/* Status bar */}
      <div style={{ padding: '12px 20px', background: hc.bg, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: `1px solid ${hc.border}` }}>
        <span style={{ color: hc.color, fontSize: 14 }}>{hc.icon}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: hc.color }}>
          {health === 'clear' ? 'Project on track' : health === 'warn' ? 'Attention needed' : 'Action required'}
        </span>
        <div style={{ display: 'flex', gap: 16, marginLeft: 4, flexWrap: 'wrap' }}>
          {s.cost_creep && <AlertPill color="var(--danger)" text={`Cost creep — ${fmt.money(s.commitment - s.earmarked_total)} over internal budget`} />}
          {s.overrun && <AlertPill color="var(--danger)" text={`Overrun — invoiced ${fmt.money(s.invoiced)} exceeds commitment ${fmt.money(s.commitment)}`} />}
          {s.pending_co_count > 0 && <AlertPill color="var(--warn)" text={`${s.pending_co_count} change order${s.pending_co_count > 1 ? 's' : ''} pending (${fmt.money(s.pending_cos)})`} />}
          {s.pending_invoice_count > 0 && <AlertPill color="var(--warn)" text={`${s.pending_invoice_count} invoice${s.pending_invoice_count > 1 ? 's' : ''} pending (${fmt.money(s.pending_invoice_amount)})`} />}
          {health === 'clear' && s.commitment > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {hasEarmark ? `${earmarkPct}% of internal budget committed — ${fmt.money(s.earmark_remaining)} buffer remaining` : `${fmt.money(s.commitment)} committed`}
            </span>
          )}
        </div>
      </div>

      {/* Rollup numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: hasEarmark ? 'repeat(4,1fr)' : 'repeat(3,1fr)', gap: 1, background: 'var(--border)' }}>
        {hasEarmark && <RollupCell label="Internal Budget" value={s.earmarked_total} sub={s.earmark_remaining != null ? (s.earmark_remaining >= 0 ? `${fmt.money(s.earmark_remaining)} buffer` : `${fmt.money(Math.abs(s.earmark_remaining))} OVER`) : null} subColor={s.earmark_remaining < 0 ? 'var(--danger)' : 'var(--text-3)'} tip="Sum of all internal budget estimates across contracts — your total expected spend including T&M and overages" />}
        <RollupCell label="Commitment" value={s.commitment} sub={hasEarmark && s.earmarked_total > 0 ? `${Math.min(Math.round((s.commitment/s.earmarked_total)*100),999)}% of internal budget` : null} accent={s.cost_creep ? 'var(--danger)' : s.commitment > 0 ? 'var(--accent)' : null} tip="Sum of all contract values including approved change orders — what you've legally agreed to pay" />
        <RollupCell label="Invoiced" value={s.invoiced} sub={s.commitment > 0 && s.invoiced > 0 ? `${Math.min(Math.round((s.invoiced/s.commitment)*100),999)}% of commitment` : null} accent={s.overrun ? 'var(--danger)' : null} tip="Total billed by all vendors to date — includes T&M and additional services beyond initial contract amounts" />
        <RollupCell label="Paid" value={s.paid} sub={s.invoiced > 0 && s.paid > 0 ? `${Math.round((s.paid/s.invoiced)*100)}% of invoiced` : null} accent={s.paid > 0 ? 'var(--ok)' : null} tip="Cash actually sent — approved invoices that have been marked as paid" />
      </div>

      {/* Burn bar */}
      {hasEarmark && s.earmarked_total > 0 && (
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)' }}>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden', display: 'flex' }}>
            {s.paid > 0 && <div style={{ width: pct(s.paid, s.earmarked_total), background: 'var(--ok)', height: '100%' }} />}
            {(s.invoiced - s.paid) > 0 && <div style={{ width: pct(s.invoiced - s.paid, s.earmarked_total), background: '#3b82f6', height: '100%' }} />}
            {(s.commitment - s.invoiced) > 0 && <div style={{ width: pct(s.commitment - s.invoiced, s.earmarked_total), background: 'var(--accent)', opacity: 0.8, height: '100%' }} />}
          </div>
        </div>
      )}
    </div>
  );
}

function ContractHealthCard({ contract: c, ledger: l, onClick }) {
  const hasLedger = !!l;

  // Determine card health
  let health = 'ok';
  if (hasLedger && l.cost_creep) health = 'danger';
  else if (hasLedger && l.overrun) health = 'danger';
  else if (hasLedger && l.pending_co_count > 0) health = 'warn';

  const hColor = { ok: 'var(--border)', warn: 'rgba(245,158,11,0.5)', danger: 'rgba(239,68,68,0.5)' }[health];
  const commitment = hasLedger ? l.commitment : Number(c.total_value);
  const earmarked = hasLedger ? l.earmarked_amount : null;
  const invoiced = hasLedger ? l.invoiced : Number(c.invoiced_amount || 0);
  const paid = hasLedger ? l.paid : 0;
  const commitmentPct = earmarked ? Math.min(Math.round((commitment / earmarked) * 100), 999) : null;

  return (
    <div onClick={onClick} style={{
      background: 'var(--surface)', borderRadius: 8, cursor: 'pointer',
      border: `1px solid ${hColor}`,
      transition: 'border-color 0.15s, background 0.15s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
    onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
    >
      {/* Card header */}
      <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{c.vendor_name}</span>
            <span className={`badge ${c.status}`}>{c.status}</span>
            {hasLedger && l.cost_creep && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', padding: '1px 6px', borderRadius: 3, border: '1px solid rgba(239,68,68,0.3)' }}>COST CREEP</span>}
            {hasLedger && l.overrun && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', background: 'rgba(239,68,68,0.1)', padding: '1px 6px', borderRadius: 3, border: '1px solid rgba(239,68,68,0.3)' }}>OVERRUN</span>}
            {hasLedger && l.pending_co_count > 0 && !l.cost_creep && <span style={{ fontSize: 11, color: 'var(--warn)', background: 'rgba(245,158,11,0.1)', padding: '1px 6px', borderRadius: 3, border: '1px solid rgba(245,158,11,0.25)' }}>⏳ {l.pending_co_count} CO pending</span>}
          </div>
          {c.description && <div style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description}</div>}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{fmt.date(c.contract_date)}{c.reference_number ? ` · Ref: ${c.reference_number}` : ''}</div>
        </div>

        {/* Key number — commitment */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>Commitment</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: l && l.cost_creep ? 'var(--danger)' : 'var(--accent)' }}>
            {fmt.money(commitment)}
          </div>
          {earmarked && (
            <div style={{ fontSize: 11, color: commitmentPct > 100 ? 'var(--danger)' : commitmentPct > 85 ? 'var(--warn)' : 'var(--text-3)' }}>
              {commitmentPct}% of {fmt.money(earmarked)} internal budget
            </div>
          )}
        </div>
      </div>

      {/* Numbers row */}
      <div style={{ display: 'grid', gridTemplateColumns: earmarked ? 'repeat(4,1fr)' : 'repeat(3,1fr)', background: 'var(--border)', gap: 1, borderTop: '1px solid var(--border)' }}>
        <MiniCell label="Initial Contract Amt" value={Number(c.total_value)} tip="Original signed contract value — the number the vendor committed to at execution" />
        {earmarked && <MiniCell label="Internal Budget" value={earmarked} sub={l && l.earmark_remaining != null ? (l.earmark_remaining >= 0 ? `${fmt.money(l.earmark_remaining)} buffer` : `${fmt.money(Math.abs(l.earmark_remaining))} over`) : null} subColor={l && l.earmark_remaining < 0 ? 'var(--danger)' : 'var(--text-3)'} tip="Internal budget estimate including T&M tail and overages — set above the initial contract" />}
        <MiniCell label="Invoiced" value={invoiced} tip="Total billed by this vendor to date — includes all T&M and additional services" />
        <MiniCell label="Paid" value={paid} color={paid > 0 ? 'var(--ok)' : null} tip="Cash actually sent to this vendor" />
      </div>

      {/* Commitment breakdown if has COs/TM/expenses */}
      {hasLedger && (l.approved_cos > 0 || l.tm_approved > 0 || l.expense_approved > 0) && (
        <div style={{ padding: '8px 18px', borderTop: '1px solid var(--border)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {fmt.money(l.original_contract)} base
            {l.approved_cos > 0 && <span style={{ color: 'var(--warn)' }}> + {fmt.money(l.approved_cos)} COs</span>}
            {l.tm_approved > 0 && <span style={{ color: 'var(--warn)' }}> + {fmt.money(l.tm_approved)} T&M</span>}
            {l.expense_approved > 0 && <span style={{ color: 'var(--warn)' }}> + {fmt.money(l.expense_approved)} expenses</span>}
            <span style={{ color: 'var(--text-2)', fontWeight: 600 }}> = {fmt.money(l.commitment)} commitment</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function pct(val, total) {
  if (!total) return '0%';
  return Math.min((val / total) * 100, 100).toFixed(2) + '%';
}

function AlertPill({ color, text }) {
  return <span style={{ fontSize: 12, color }}>{text}</span>;
}

function RollupCell({ label, value, sub, subColor, accent, tip }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '14px 18px' }}>
      <div data-tip={tip || undefined} style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7, fontWeight: 600, display: 'inline-block' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--mono)', color: accent || 'var(--text-1)', lineHeight: 1 }}>
        {value > 0 ? fmt.money(value) : <span style={{ color: 'var(--text-3)', fontSize: 18 }}>—</span>}
      </div>
      {sub && <div style={{ fontSize: 12.5, color: subColor || 'var(--text-3)', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function MiniCell({ label, value, sub, subColor, color, tip }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '10px 16px' }}>
      <div data-tip={tip || undefined} style={{ fontSize: 11.5, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, fontWeight: 600, display: 'inline-block' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--mono)', color: color || 'var(--text-1)' }}>
        {value > 0 ? fmt.money(value) : <span style={{ color: 'var(--text-3)' }}>—</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: subColor || 'var(--text-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
