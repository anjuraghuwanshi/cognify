import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COLORS, fmt, label, type Analysis, type Row } from "../api";
import { Card, DataTable, Pill, Select, StatTile } from "./ui";

// Red dot only on rows flagged as Anomaly
function AnomalyDot(props: any) {
  const { cx, cy, payload, index } = props;
  if (payload.prediction !== "Anomaly") return <g key={index} />;
  return <circle key={index} cx={cx} cy={cy} r={3.5} fill={COLORS.critical} />;
}

// Start/end time of each known fault window for one router (from scenario_label)
function faultWindows(rows: Row[]) {
  const windows: { start: string; end: string }[] = [];
  for (const r of rows) {
    const isFault = r.scenario_label && r.scenario_label !== "normal";
    const last = windows[windows.length - 1];
    if (isFault && last && last.end === "__open__") continue;
    if (isFault) windows.push({ start: r.time as string, end: "__open__" });
    else if (last && last.end === "__open__") last.end = r.time as string;
  }
  const last = windows[windows.length - 1];
  if (last && last.end === "__open__") last.end = rows[rows.length - 1].time as string;
  return windows;
}

function MetricChart({ rows, metric, windows }: { rows: Row[]; metric: string; windows: { start: string; end: string }[] }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-ink">{label(metric)}</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={COLORS.grid} />
          {windows.map((w, i) => (
            <ReferenceArea key={i} x1={w.start} x2={w.end} fill={COLORS.neutral} fillOpacity={0.25} />
          ))}
          <XAxis dataKey="time" tick={{ fill: COLORS.muted, fontSize: 12 }} stroke={COLORS.axis} minTickGap={40} />
          <YAxis tick={{ fill: COLORS.muted, fontSize: 12 }} stroke={COLORS.axis} width={48} />
          <Tooltip
            formatter={(v) => [fmt(Number(v)), label(metric)]}
            labelFormatter={(t, p) => `${t}  -  ${p?.[0]?.payload?.prediction ?? ""}`}
          />
          <Line type="linear" dataKey={metric} stroke={COLORS.series[0]} strokeWidth={2}
                dot={<AnomalyDot />} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DetectionTab({ a }: { a: Analysis }) {
  const s = a.summary;
  const [router, setRouter] = useState(a.observations.fault_routers?.[1] ?? a.dataset.routers[0]);
  const [metric, setMetric] = useState("bgp_peers_down");

  const routerRows = useMemo(
    () => a.rows.filter((r) => r.router_id === router).map((r) => ({ ...r, time: r.timestamp.slice(11) })),
    [a.rows, router],
  );
  const windows = a.dataset.has_labels ? faultWindows(routerRows) : [];
  const anomalies = useMemo(
    () => a.rows.filter((r) => r.prediction === "Anomaly").sort((x, y) => x.anomaly_score - y.anomaly_score),
    [a.rows],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Observations checked" value={fmt(s.checked)}
                  note={`${fmt(s.train_rows)} used for training, ${fmt(s.test_rows)} for testing`} />
        <StatTile label="Anomalies detected" value={fmt(s.anomalies)}
                  note={Object.entries(s.by_rule).map(([k, v]) => `${k}: ${v}`).join(" - ")} />
        <StatTile label="Normal observations" value={fmt(s.checked - s.anomalies)} />
      </div>

      <Card
        title="Router metrics over time"
        subtitle={<>Red dots = readings flagged as Anomaly.{a.dataset.has_labels && " Grey bands = known fault periods from the event log."}</>}
      >
        <div className="mb-4 grid max-w-xl grid-cols-2 gap-4">
          <Select label="Router" value={router} onChange={setRouter}
                  options={a.dataset.routers.map((r) => ({ value: r, label: r }))} />
          <Select label="Second metric" value={metric} onChange={setMetric}
                  options={a.features.filter((f) => f !== "cpu_util_pct").map((f) => ({ value: f, label: label(f) }))} />
        </div>
        <div className="grid gap-6">
          <MetricChart rows={routerRows} metric="cpu_util_pct" windows={windows} />
          <MetricChart rows={routerRows} metric={metric} windows={windows} />
        </div>
      </Card>

      <Card title="Detected anomalies" subtitle="Most unusual first (lowest score). 'Flagged by' shows which rule fired.">
        <DataTable
          columns={[
            { key: "router_id", label: "Router" },
            { key: "timestamp", label: "Time", render: (r) => r.timestamp.slice(11) },
            { key: "split", label: "Split" },
            ...a.features.map((f) => ({ key: f, label: f, render: (r: any) => fmt(r[f]) })),
            { key: "anomaly_score", label: "Score", render: (r) => r.anomaly_score.toFixed(3) },
            { key: "flagged_by", label: "Flagged by" },
            ...(a.dataset.has_labels ? [{
              key: "scenario_label", label: "Known label",
              render: (r: any) => <Pill tone={r.scenario_label === "normal" ? "neutral" : "critical"}>{r.scenario_label}</Pill>,
            }] : []),
          ]}
          rows={anomalies}
          maxHeight={420}
        />
      </Card>
    </div>
  );
}
