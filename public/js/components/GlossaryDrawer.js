// GlossaryDrawer — right slide-in reference panel.
// Triggered from the sidebar "?" button.

window.GlossaryDrawer = function GlossaryDrawer({ open, onClose }) {

  const groups = [
    {
      title: 'The Money Math',
      items: [
        {
          term: 'Contract',
          short: 'The base agreement',
          def: 'A signed agreement with a vendor covering defined scope, estimated cost, and date. Everything else is measured against this.',
        },
        {
          term: 'Internal Budget',
          short: 'Your per-contract budget estimate',
          def: 'The internal budget set aside to cover this contract including expected extras — T&M tail, change orders, expenses. Should always be ≥ contract value. Set it high enough that you won\'t need more money. Referenced everywhere in the app as "Internal Budget".',
        },
        {
          term: 'Commitment',
          short: 'What you\'re legally on the hook for',
          def: 'Contract value + all approved Change Orders. This is the legal obligation — the scope you have signed off on. T&M and expenses are tracked separately as additional exposure.',
        },
        {
          term: 'Total Exposure',
          short: 'Full spend risk',
          def: 'Commitment + approved T&M + approved Expenses. The realistic total you expect to spend, including everything approved. This is what gets compared to your Internal Budget.',
        },
        {
          term: 'Buffer',
          short: 'Room left before "get more money"',
          def: 'Internal Budget minus Total Exposure. As long as this is positive you\'re inside budget. When it hits zero — or goes negative — you need to go get more money.',
        },
        {
          term: 'Cost Creep',
          short: 'Total Exposure > Earmarked Amount',
          def: 'When the full expected spend (commitment + T&M + expenses) exceeds the internal budget. The system flags this immediately — it\'s the signal to escalate.',
        },
        {
          term: 'Change Order Creep',
          short: 'COs have inflated the contract significantly',
          def: 'When approved change orders have grown the commitment well beyond the initial signed contract value. The system flags this when COs represent a meaningful percentage above the original scope.',
        },
        {
          term: 'Overrun',
          short: 'Invoiced > Total Exposure',
          def: 'When vendors have billed more than your total exposure. This should not happen if change orders and T&M are tracked properly — it usually means something wasn\'t logged.',
        },
      ],
    },
    {
      title: 'What You Enter',
      items: [
        {
          term: 'Change Order (CO)',
          short: 'A formal scope modification',
          def: 'A written modification to the original contract changing scope and/or cost. Must be approved before it counts toward commitment. Pending COs are tracked but don\'t affect the numbers until approved.',
        },
        {
          term: 'Time & Material (T&M)',
          short: 'Hourly + materials, outside scope',
          def: 'Billable work not covered by the original contract scope — charged by the hour plus materials. Common with trades who run out of contracted scope and keep billing. Tracked separately from commitment.',
        },
        {
          term: 'Contract Expense',
          short: 'Reimbursable vendor costs',
          def: 'Expenses billed by the vendor on top of contract work — travel, tolls, food, hotels, permits. Reimbursable but not part of the contracted scope.',
        },
        {
          term: 'Invoice',
          short: 'A payment request',
          def: 'A billing submitted by a vendor against any category: contract work, a change order, T&M, or expenses. Has an invoice number, amount, date, and QB code. Must be approved before it counts as invoiced.',
        },
        {
          term: 'QB Code',
          short: 'QuickBooks ledger account',
          def: 'The general ledger account in QuickBooks that this cost is coded to. Required on every invoice line so costs flow into the right account for accounting.',
        },
      ],
    },
    {
      title: 'Status Terms',
      items: [
        {
          term: 'Pending',
          short: 'Submitted, awaiting approval',
          def: 'An invoice, change order, T&M, or expense that has been entered but not yet reviewed. Does not affect financial totals until approved.',
        },
        {
          term: 'Approved',
          short: 'Counts toward the numbers',
          def: 'Reviewed and signed off. For invoices — counts as invoiced. For change orders, T&M, and expenses — counts toward commitment or exposure.',
        },
        {
          term: 'Pushed',
          short: 'Sent to accounting',
          def: 'An approved invoice that has been sent to QuickBooks or the accounting system for payment processing.',
        },
        {
          term: 'Paid',
          short: 'Cash sent',
          def: 'The vendor has been paid. Shows in the green segment of the burn bar.',
        },
        {
          term: 'Rejected',
          short: 'Declined with a note',
          def: 'Not approved — a rejection note is required explaining why. The vendor or team member will need to resubmit or resolve the issue.',
        },
        {
          term: 'Duplicate',
          short: 'Possibly already paid',
          def: 'An invoice or contract that matches another in the system — same vendor, similar amount, same period. Flagged for review before approving.',
        },
      ],
    },
  ];

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={onClose} style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(28,24,20,0.35)',
          animation: 'fadeIn 0.18s ease',
        }} />
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
          background: 'var(--sidebar-bg)',
          backgroundImage: 'repeating-linear-gradient(90deg, transparent 0px, transparent 18px, rgba(0,0,0,0.06) 18px, rgba(0,0,0,0.06) 20px, rgba(255,255,255,0.03) 20px, rgba(255,255,255,0.03) 21px)',
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Glossary
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
              Financial terms reference
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: '50%', border: 'none',
            background: 'rgba(0,0,0,0.2)', cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.8)',
          }} aria-label="Close glossary">✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 48px' }}>
          {groups.map((group, gi) => (
            <div key={gi} style={{ marginBottom: 32 }}>

              {/* Group label — stencil style, echoes container lettering */}
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
                textTransform: 'uppercase', color: 'var(--accent)',
                marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>{group.title}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group.items.map((item, ii) => (
                  <div key={ii} style={{
                    padding: '11px 14px',
                    borderRadius: 8,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderLeft: '3px solid var(--accent)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                      <span style={{
                        fontWeight: 700, fontSize: 14, color: 'var(--text-1)',
                        letterSpacing: '-0.01em',
                      }}>
                        {item.term}
                      </span>
                      <span style={{
                        fontSize: 11, color: 'var(--text-3)',
                        fontWeight: 500, fontStyle: 'italic',
                      }}>
                        {item.short}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 13, color: 'var(--text-2)',
                      lineHeight: 1.55,
                    }}>
                      {item.def}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
