export function RangeSelect({ value, onChange, className = "range" }: { value: number; onChange: (n: number) => void; className?: string }) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
    </select>
  );
}
