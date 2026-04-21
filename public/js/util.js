// Formatting helpers shared across components.

// ── Global tooltip — appends to document.body so it's never clipped ──────────
(function () {
  const tip = document.createElement('div');
  tip.id = 'global-tip';
  Object.assign(tip.style, {
    position: 'fixed',
    zIndex: '99999',
    background: '#1c1814',
    color: '#f5f2ee',
    fontSize: '12px',
    lineHeight: '1.55',
    padding: '7px 11px',
    borderRadius: '6px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
    maxWidth: '260px',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.13s ease',
    whiteSpace: 'normal',
    display: 'none',
  });
  document.body.appendChild(tip);

  let current = null;

  document.addEventListener('mouseover', function (e) {
    const el = e.target.closest('[data-tip]');
    if (!el || el === current) return;
    current = el;
    const text = el.getAttribute('data-tip');
    if (!text) return;
    tip.textContent = text;
    tip.style.display = 'block';
    position(e);
    requestAnimationFrame(() => { tip.style.opacity = '1'; });
  });

  document.addEventListener('mousemove', function (e) {
    if (!current) return;
    position(e);
  });

  document.addEventListener('mouseout', function (e) {
    const el = e.target.closest('[data-tip]');
    if (el && el === current) {
      current = null;
      tip.style.opacity = '0';
      setTimeout(() => { if (!current) tip.style.display = 'none'; }, 140);
    }
  });

  function position(e) {
    const PAD = 12;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = e.clientX - tw / 2;
    let y = e.clientY - th - 14;
    // Keep within viewport
    if (x < PAD) x = PAD;
    if (x + tw > window.innerWidth - PAD) x = window.innerWidth - tw - PAD;
    if (y < PAD) y = e.clientY + 20; // flip below cursor
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  }
})();

window.fmt = {
  money(n) {
    const v = Number(n || 0);
    return v.toLocaleString('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
  },
  moneyPrecise(n) {
    const v = Number(n || 0);
    return v.toLocaleString('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  },
  date(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  },
  datetime(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  },
};
