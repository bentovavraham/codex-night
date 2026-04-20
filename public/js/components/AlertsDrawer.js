// AlertsDrawer — right-side slide-in panel.
// Two sections:
//   1. "GETTING BANGED OUT" — contracts being invoiced above initial contract amount
//   2. "BUDGET PRESSURE"   — contracts where total commitment approaches/exceeds internal budget

window.AlertsDrawer = function AlertsDrawer({ open, onClose, onGoToContract }) {
  const [data, setData]     = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr]       = React.useState(null);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.getAlerts()
      .then(d => { setData(d); setErr(null); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  // Severity → visual config
  const sevConfig = {
    low:      { label: 'LOW',      color: '#d97706', bg: '#fffbeb', border: '#fde68a', bar: '#f59e0b' },
    moderate: { label: 'MODERATE', color: '#c4522a', bg: '#fff7f4', border: '#fcd9cc', bar: '#e8921a' },
    high:     { label: 'HIGH',     color: '#b04824', bg: '#fef3ee', border: '#f9b49a', bar: '#c4522a' },
    critical: { label: 'CRITICAL', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', bar: '#dc2626' },
  };

  function SevBadge({ sev }) {
    if (!sev) return null;
    const cfg = sevConfig[sev];
    return (
      <span style={{
        display: 'inline-block',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        padding: '2px 7px', borderRadius: 4,
        background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      }}>{cfg.label}</span>
    );
  }

  function PctBar({ pct, sev, label }) {
    if (!sev) return null;
    const cfg = sevConfig[sev];
    // Bar fills relative to overage — cap display at ~200%
    const filled = Math.min(pct, 200);
    const barPct = Math.min(100, (filled / 200) * 100);  // 200% = full bar

    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 11, color: '#6b7280' }}>
          <span>{label}</span>
          <span style={{ fontWeight: 700, color: cfg.color, fontVariantNumeric: 'tabular-nums' }}>
            +{pct.toFixed(1)}%
          </span>
        </div>
        <div style={{ height: 7, background: '#f0ede8', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 4,
            width: `${barPct}%`,
            background: cfg.bar,
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>
    );
  }

  // Group contract flags by project
  function groupByProject(flags) {
    const map = {};
    for (const f of flags) {
      if (!map[f.project_id]) map[f.project_id] = { name: f.project_name, contracts: [] };
      map[f.project_id].contracts.push(f);
    }
    return Object.entries(map).map(([pid, g]) => ({ pid: Number(pid), ...g }));
  }

  const flags = data?.contract_flags || [];

  const overInitialFlags = flags.filter(f => f.over_initial_sev);
  const budgetFlags      = flags.filter(f => f.budget_sev);

  const sevOrder = ['critical','high','moderate','low'];
  function sortBySev(arr, sevKey) {
    return [...arr].sort((a, b) => sevOrder.indexOf(a[sevKey]) - sevOrder.indexOf(b[sevKey]));
  }

  function ContractAlertCard({ flag, type }) {
    const sev = type === 'over_initial' ? flag.over_initial_sev : flag.budget_sev;
    const cfg = sevConfig[sev];
    return (
      <div
        onClick={() => onGoToContract && onGoToContract(flag.project_id, flag.contract_id)}
        style={{
          padding: '12px 14px',
          marginBottom: 8,
          borderRadius: 8,
          border: `1px solid ${cfg.border}`,
          background: cfg.bg,
          cursor: onGoToContract ? 'pointer' : 'default',
          borderLeft: `4px solid ${cfg.bar}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1c1814', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {flag.vendor_name}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
              {flag.project_name}
              {flag.description && <> · {flag.description}</>}
            </div>
          </div>
          <SevBadge sev={sev} />
        </div>

        {type === 'over_initial' && flag.over_initial_sev && (
          <>
            <PctBar pct={flag.over_initial_pct} sev={flag.over_initial_sev} label="Over initial contract" />
            <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280', display: 'flex', gap: 12 }}>
              <span>Initial: <strong style={{ color: '#1c1814' }}>{fmt.money(flag.total_value)}</strong></span>
              <span>Invoiced: <strong style={{ color: cfg.color }}>{fmt.money(flag.invoiced_amount)}</strong></span>
              <span>Over: <strong style={{ color: cfg.color }}>{fmt.money(flag.over_initial_amt)}</strong></span>
            </div>
          </>
        )}

        {type === 'budget' && flag.budget_sev && (
          <>
            <PctBar pct={flag.budget_used_pct} sev={flag.budget_sev} label="Budget utilisation" />
            <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280', display: 'flex', gap: 12 }}>
              <span>Budget: <strong style={{ color: '#1c1814' }}>{fmt.money(flag.earmarked_amount)}</strong></span>
              <span>Commitment: <strong style={{ color: cfg.color }}>{fmt.money(flag.commitment)}</strong></span>
            </div>
          </>
        )}
      </div>
    );
  }

  function Section({ title, subtitle, icon, flags: sectionFlags, type }) {
    if (sectionFlags.length === 0) return (
      <div style={{ marginBottom: 28 }}>
        <SectionHeader title={title} icon={icon} count={0} />
        <div style={{ padding: '18px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          No issues detected
        </div>
      </div>
    );
    const sorted = sortBySev(sectionFlags, type === 'over_initial' ? 'over_initial_sev' : 'budget_sev');
    return (
      <div style={{ marginBottom: 28 }}>
        <SectionHeader title={title} icon={icon} subtitle={subtitle} count={sectionFlags.length} />
        {sorted.map(f => (
          <ContractAlertCard key={`${type}-${f.contract_id}`} flag={f} type={type} />
        ))}
      </div>
    );
  }

  function SectionHeader({ title, subtitle, icon, count }) {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#1c1814' }}>
            {title}
          </span>
          {count > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
              background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
              marginLeft: 'auto',
            }}>{count}</span>
          )}
        </div>
        {subtitle && <div style={{ fontSize: 12, color: '#6b7280', paddingLeft: 24 }}>{subtitle}</div>}
        <div style={{ height: 1, background: '#e8e3dc', marginTop: 8 }} />
      </div>
    );
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(28,24,20,0.35)',
            animation: 'fadeIn 0.18s ease',
          }}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 420,
        zIndex: 1001,
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-6px 0 28px rgba(28,24,20,0.14)',
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.28s cubic-bezier(0.32, 0, 0.12, 1)',
      }}>

        {/* Header */}
        <div style={{
          padding: '18px 20px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1c1814', letterSpacing: '-0.01em' }}>
              Alerts
            </div>
            {data && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                {flags.length === 0
                  ? 'All contracts look healthy'
                  : `${flags.length} contract${flags.length !== 1 ? 's' : ''} flagged`}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: '50%', border: 'none',
              background: 'var(--surface-2)', cursor: 'pointer', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#6b7280',
            }}
            aria-label="Close alerts">✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 40px' }}>
          {loading && (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 13 }}>
              Scanning contracts…
            </div>
          )}
          {err && (
            <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 13 }}>
              {err}
            </div>
          )}
          {!loading && !err && data && (
            <>
              <Section
                title="Getting Banged Out"
                subtitle="Invoiced exceeds the initial contract amount"
                icon="⚠"
                flags={overInitialFlags}
                type="over_initial"
              />
              <Section
                title="Budget Pressure"
                subtitle="Total commitment approaching or exceeding internal budget"
                icon="◎"
                flags={budgetFlags}
                type="budget"
              />
            </>
          )}
        </div>
      </div>
    </>
  );
};
