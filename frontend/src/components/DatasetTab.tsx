import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COLORS, fmt, label, type Analysis } from "../api";
import { Card, DataTable, Pill, Select, StatTile } from "./ui";

export default function DatasetTab({ a }: { a: Analysis }) {
  const { dataset: d, observations: o } = a;
  const [metric, setMetric] = useState("interfaces_down");

  // Fault rows per router, one key per fault type (for the stacked bar chart)
  const faultTypes = o.fault_types ?? [];
  const faultByRouter = (o.fault_routers ?? []).map((router) => {
    const entry: Record<string, string | number> = { router };
    for (const t of faultTypes) {
      entry[t] = o.fault_counts?.find((c) => c.router_id === router && c.scenario_label === t)?.rows ?? 0;
    }
    return entry;
  });

  return (
    <div className="flex flex-col gap-5">
      {d.is_default ? (
        <Card title="Where the data comes from">
          <div className="grid gap-4 text-sm text-ink-2 md:grid-cols-2">
            <p>
              <strong className="text-ink">Public dataset:</strong> Cisco Innovation Edge, "Open-source datasets for
              network anomaly based machine learning", github.com/cisco-ie/telemetry, folder 4 (port state changes).
              <br />
              <strong className="text-ink">Paper:</strong> Putina et al., "Telemetry-based stream-learning of BGP
              anomalies", ACM SIGCOMM Big-DAMA Workshop, 2018.
            </p>
            <p>
              Real telemetry from <strong className="text-ink">15 Cisco IOS-XR routers</strong> in a lab on
              1 Sep 2017. During one hour, engineers caused <strong className="text-ink">6 faults on purpose</strong>:
              optics pulled, ports shut down, fibre pulled. We turned 1.2 million raw readings into one row per router
              every 10 seconds. The fault labels come from the dataset's own event log.
            </p>
          </div>
        </Card>
      ) : (
        <Card title="Where the data comes from">
          <p className="text-sm text-ink-2">Uploaded file: <strong className="text-ink">{d.name}</strong></p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Rows" value={fmt(d.rows)} note="one per router per 10 s" />
        <StatTile label="Routers" value={d.routers.length} />
        <StatTile label="Time span" value={`${d.minutes} min`} />
        <StatTile
          label="Rows labelled as fault"
          value={d.fault_share === null ? "-" : `${(d.fault_share * 100).toFixed(1)}%`}
          note={d.has_labels ? `${o.fault_rows} rows` : "no labels in this file"}
        />
      </div>

      <Card title="What we noticed in the data">
        <ol className="list-decimal space-y-2 pl-5 text-ink">
          {o.fault_routers && (
            <li>Faults happen only on <strong>{o.fault_routers.join(" and ")}</strong> - the two routers on the link that was disturbed.</li>
          )}
          {o.changed && (
            <li>During faults these metrics change most: <strong>{o.changed.map(label).join(", ")}</strong>.</li>
          )}
          {o.steady && o.steady.length > 0 && (
            <li>
              <strong>{o.steady.map(label).join(", ")}</strong> hardly change during faults - so a fault is not
              always visible as "high CPU".
            </li>
          )}
          <li>
            Routers have very different normal levels: the median number of interfaces down is{" "}
            <strong>{o.interfaces_down_range[0]}</strong> on some routers and <strong>{o.interfaces_down_range[1]}</strong>{" "}
            on others. That is why the model compares each router with <em>its own</em> normal level.
          </li>
        </ol>
      </Card>

      {o.compare && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card
            title={`Normal vs fault, on ${o.fault_routers?.join(" and ")}`}
            subtitle="Average values. 'Change' compares each router with its own normal level, in standard deviations."
          >
            <DataTable
              columns={[
                { key: "metric", label: "Metric", render: (r) => label(r.metric) },
                { key: "normal", label: "When normal", render: (r) => fmt(r.normal, 3) },
                { key: "fault", label: "During fault", render: (r) => fmt(r.fault, 3) },
                {
                  key: "verdict", label: "Change", render: (r) => (
                    <Pill tone={r.verdict.startsWith("clear") ? "critical" : "neutral"}>
                      {r.verdict} ({r.effect > 0 ? "+" : ""}{r.effect})
                    </Pill>
                  ),
                },
              ]}
              rows={o.compare}
            />
          </Card>

          <Card title="Fault rows per router" subtitle="Which routers the 6 faults affected, by fault type">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={faultByRouter} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} />
                <XAxis dataKey="router" tick={{ fill: COLORS.ink2, fontSize: 13 }} stroke={COLORS.axis} />
                <YAxis tick={{ fill: COLORS.muted, fontSize: 12 }} stroke={COLORS.axis} />
                <Tooltip cursor={{ fill: COLORS.grid, opacity: 0.4 }} />
                <Legend />
                {faultTypes.map((t, i) => (
                  <Bar key={t} dataKey={t} stackId="faults" fill={COLORS.series[i % 3]} stroke="#fcfcfb" strokeWidth={2}
                       isAnimationActive={false}
                       radius={i === faultTypes.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={80} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      <Card
        title="Each router's normal level"
        subtitle="Median value per router. Big differences between routers are why each router is compared with itself."
      >
        <div className="mb-4 max-w-xs">
          <Select label="Metric" value={metric} onChange={setMetric}
                  options={a.features.map((f) => ({ value: f, label: label(f) }))} />
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={o.router_medians} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={COLORS.grid} />
            <XAxis dataKey="router_id" tick={{ fill: COLORS.ink2, fontSize: 12 }} stroke={COLORS.axis} interval={0} />
            <YAxis tick={{ fill: COLORS.muted, fontSize: 12 }} stroke={COLORS.axis} />
            <Tooltip cursor={{ fill: COLORS.grid, opacity: 0.4 }} formatter={(v) => [fmt(Number(v)), label(metric)]} />
            <Bar dataKey={metric} fill={COLORS.series[0]} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Data preview" subtitle={`First 200 of ${fmt(d.rows)} rows`}>
        <DataTable
          columns={[
            { key: "timestamp", label: "Time", render: (r) => r.timestamp.replace("T", " ") },
            { key: "router_id", label: "Router" },
            ...a.features.map((f) => ({ key: f, label: f, render: (r: any) => fmt(r[f]) })),
            ...(d.has_labels ? [{ key: "scenario_label", label: "scenario_label" }] : []),
          ]}
          rows={a.rows.slice(0, 200)}
        />
      </Card>
    </div>
  );
}
