interface Props { label: string; }
export default function PlaceholderTab({ label }: Props) {
  return (
    <div style={{ padding: 40, color: 'var(--text-3)', fontSize: 13 }}>
      {label} — coming next.
    </div>
  );
}
