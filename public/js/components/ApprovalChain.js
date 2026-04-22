// Shared 3-tier approval chain component: PM → Partner → Seth
// Renders the pipeline badge + action buttons appropriate for the current user's role.
//
// Props:
//   item        — the document record (must have .status, .pm_approved_by, etc.)
//   userRole    — current user's role ('pm' | 'partner' | 'admin')
//   onPmApprove, onPartnerApprove, onApprove, onReject  — action callbacks

const APPROVAL_STAGES = [
  { key: 'pm',      label: 'PM',      doneStatus: 'pm_approved',      minRole: 'pm'      },
  { key: 'partner', label: 'Partner', doneStatus: 'partner_approved',  minRole: 'partner' },
  { key: 'seth',    label: 'Seth',    doneStatus: 'approved',          minRole: 'admin'   },
];

const ROLE_LEVEL = { pm: 1, partner: 2, admin: 3 };
function hasMinRole(role, min) {
  return (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[min] || 99);
}

function stageIndex(status) {
  if (status === 'approved')         return 3;
  if (status === 'partner_approved') return 2;
  if (status === 'pm_approved')      return 1;
  return 0;
}

// Small horizontal pipeline: [PM ✓] → [Partner ✓] → [Seth →]
window.ApprovalPipeline = function ApprovalPipeline({ status }) {
  const done = stageIndex(status);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
      {APPROVAL_STAGES.map((stage, i) => {
        const isDone   = done > i;
        const isCurrent = done === i && status !== 'rejected';
        return (
          <React.Fragment key={stage.key}>
            {i > 0 && (
              <span style={{ color: isDone ? 'var(--ok)' : 'var(--text-3)', fontSize: 10 }}>→</span>
            )}
            <span style={{
              padding: '2px 7px', borderRadius: 4, fontWeight: 600,
              background: isDone
                ? 'rgba(34,197,94,0.12)'
                : isCurrent
                  ? 'rgba(232,146,26,0.15)'
                  : 'rgba(156,163,175,0.1)',
              border: `1px solid ${isDone ? 'rgba(34,197,94,0.35)' : isCurrent ? 'rgba(232,146,26,0.4)' : 'var(--border)'}`,
              color: isDone ? '#16a34a' : isCurrent ? '#b45309' : 'var(--text-3)',
            }}>
              {isDone ? '✓ ' : isCurrent ? '⏳ ' : ''}{stage.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
};

// Full action row: pipeline + buttons for the next action the user can take
window.ApprovalActions = function ApprovalActions({
  item, userRole,
  onPmApprove, onPartnerApprove, onApprove, onReject,
  size = 'normal',
}) {
  const s = item.status;
  if (s === 'approved' || s === 'rejected' || s === 'pushed' || s === 'paid') return null;

  const btnStyle = size === 'small'
    ? { fontSize: 11, padding: '3px 10px' }
    : { fontSize: 12, padding: '5px 12px' };

  const rejectBtn = (
    <button
      style={{ ...btnStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }}
      onClick={onReject}>
      Reject
    </button>
  );

  if (s === 'pending' && hasMinRole(userRole, 'pm')) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="primary" style={btnStyle} onClick={onPmApprove}>PM Approve</button>
        {rejectBtn}
      </div>
    );
  }
  if (s === 'pm_approved' && hasMinRole(userRole, 'partner')) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="primary" style={btnStyle} onClick={onPartnerApprove}>Partner Approve</button>
        {rejectBtn}
      </div>
    );
  }
  if (s === 'partner_approved' && hasMinRole(userRole, 'admin')) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="primary" style={{ ...btnStyle, background: 'var(--ok)', borderColor: 'var(--ok)' }}
          onClick={onApprove}>
          Final Approve
        </button>
        {rejectBtn}
      </div>
    );
  }
  // User's role isn't high enough for the next step — show who needs to act
  const nextStage = APPROVAL_STAGES[stageIndex(s)];
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Awaiting {nextStage?.label} approval</span>
      {rejectBtn}
    </div>
  );
};
