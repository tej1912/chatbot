export const usd = (n: number | null | undefined): string => {
  const v = Number(n) || 0;
  if (v === 0) return "$0.00";
  return v < 0.01 ? "$" + v.toFixed(4) : "$" + v.toFixed(v < 1 ? 3 : 2);
};
export const num = (n: number | null | undefined): string => (Number(n) || 0).toLocaleString("en-US");
export const pct = (n: number | null | undefined): string => Math.round((Number(n) || 0) * 100) + "%";
export const when = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
export const dateOnly = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
/** Stop spreadsheet formula injection in CSV exports. */
export const csvCell = (v: unknown): string => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
/** 1234567 -> "1.2M", 45000 -> "45k" */
export const compact = (n: number | null | undefined): string => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n) || 0);
