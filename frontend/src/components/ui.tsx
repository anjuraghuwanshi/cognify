// Small reusable building blocks for the dashboard.
import type { ReactNode } from "react";

export function Card({ title, subtitle, children, className = "" }: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
      {title && <h3 className="text-base font-semibold text-ink">{title}</h3>}
      {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      <div className={title || subtitle ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4">
      <div className="text-sm text-ink-2">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-ink">{value}</div>
      {note && <div className="mt-1 text-xs text-muted">{note}</div>}
    </div>
  );
}

export function Select({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-ink-2">
      {label}
      <select
        className="rounded-lg border border-line bg-surface px-3 py-2 text-ink"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function DataTable({ columns, rows, maxHeight = 360 }: {
  columns: { key: string; label: string; render?: (row: any) => ReactNode }[];
  rows: any[];
  maxHeight?: number;
}) {
  return (
    <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight }}>
      <table className="tabular w-full text-left text-sm">
        <thead className="sticky top-0 bg-page text-ink-2">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-line">
              {columns.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-3 py-1.5 text-ink">
                  {c.render ? c.render(row) : String(row[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pill({ tone, children }: { tone: "good" | "critical" | "neutral"; children: ReactNode }) {
  const styles = {
    good: "bg-good/10 text-good-text",
    critical: "bg-critical/10 text-critical",
    neutral: "bg-grid/60 text-ink-2",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}
