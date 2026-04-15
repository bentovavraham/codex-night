// Controlled combobox: free-text input + dropdown of matching suggestions.
//
// Props:
//   value            — current text value (controlled)
//   onChange(text, option?) — fires on every keystroke AND on selection. When
//                             the user picks a suggestion, `option` is the
//                             matched row.
//   fetcher(query)   — async fn returning an array of { id, name, qb_id? }
//   placeholder
//   allowFreeText    — if false, the input must match an option. Default true.

window.SmartSearch = function SmartSearch({ value, onChange, fetcher, placeholder, allowFreeText = true }) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const boxRef = React.useRef(null);

  const debouncedValue = useDebouncedValue(value, 150);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await fetcher(debouncedValue || '');
        if (!cancelled) setOptions(rows);
      } catch (e) {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedValue, fetcher]);

  React.useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && activeIdx >= 0 && options[activeIdx]) {
      e.preventDefault(); pick(options[activeIdx]);
    } else if (e.key === 'Escape') setOpen(false);
  }

  function pick(opt) {
    onChange(opt.name, opt);
    setOpen(false);
    setActiveIdx(-1);
  }

  return (
    <div className="combo" ref={boxRef}>
      <input
        value={value || ''}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIdx(-1); }}
        onKeyDown={onKeyDown}
      />
      {open && (options.length > 0 || loading) && (
        <ul className="combo-list">
          {loading && <li className="combo-empty">Searching…</li>}
          {!loading && options.length === 0 && <li className="combo-empty">No matches</li>}
          {!loading && options.map((o, i) => (
            <li key={o.id}
                className={`combo-item ${i === activeIdx ? 'active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              {o.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

function useDebouncedValue(value, ms) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
