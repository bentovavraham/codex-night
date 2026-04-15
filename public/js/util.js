// Formatting helpers shared across components.

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
