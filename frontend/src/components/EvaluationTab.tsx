import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COLORS, fmt, type Analysis } from "../api";
import { Card, StatTile } from "./ui";

function MatrixCell({ value, title, note, good }: { value: number; title: string; note: string; good: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${good ? "border-good/40 bg-good/10" : "border-critical/40 bg-critical/10"}`}>
      <div className="text-3xl font-semibold text-ink">{fmt(value)}</div>
      <div className={`text-sm font-medium ${good ? "text-good-text" : "text-critical"}`}>{title}</div>
      <div className="text-xs text-ink-2">{note}</div>
    </div>
  );
}

export default function EvaluationTab({ a }: { a: Analysis }) {
  const e = a.evaluation;
  if (!e) {
    return <Card title="Evaluation">This file has no scenario_label column, so the predictions cannot be checked.</Card>;
  }
  const [[tn, fp], [fn, tp]] = e.confusion;
  const perScenario = e.per_scenario.map((s) => ({
    ...s,
    name: s.scenario_label === "normal" ? "normal (false alarms)" : s.scenario_label,
  }));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-ink-2">
        Checked on the <strong className="text-ink">{fmt(a.summary.test_rows)} test rows</strong> (25%) that the model
        never saw during training. The labels come from the dataset's event log and are used only here, after prediction.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Precision" value={e.precision.toFixed(2)}
                  note={`When it raises an alarm, it is a real fault ${Math.round(e.precision * 100)}% of the time`} />
        <StatTile label="Recall" value={e.recall.toFixed(2)}
                  note={`It catches ${Math.round(e.recall * 100)}% of the real fault readings`} />
        <StatTile label="F1-score" value={e.f1.toFixed(2)} note="Balance of precision and recall (1.0 = perfect)" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Confusion matrix" subtitle="Rows = what really happened, columns = what the model said">
          <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-3 text-sm">
            <div />
            <div className="text-center font-medium text-ink-2">Model: Normal</div>
            <div className="text-center font-medium text-ink-2">Model: Anomaly</div>
            <div className="font-medium text-ink-2">Really normal</div>
            <MatrixCell value={tn} title="Correctly normal" note="no alarm, nothing wrong" good />
            <MatrixCell value={fp} title="False alarm" note="alarm, but nothing wrong" good={false} />
            <div className="font-medium text-ink-2">Really a fault</div>
            <MatrixCell value={fn} title="Missed fault" note="fault, but no alarm" good={false} />
            <MatrixCell value={tp} title="Caught fault" note="fault, and an alarm" good />
          </div>
        </Card>

        <Card title="Share of rows flagged, by scenario" subtitle="High is good for faults, low is good for normal">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={perScenario} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke={COLORS.grid} />
              <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fill: COLORS.muted, fontSize: 12 }} stroke={COLORS.axis} />
              <YAxis type="category" dataKey="name" width={150} tick={{ fill: COLORS.ink2, fontSize: 13 }} stroke={COLORS.axis} />
              <Tooltip cursor={{ fill: COLORS.grid, opacity: 0.4 }}
                       formatter={(v, _n, p) => [`${v}% (${p.payload.flagged} of ${p.payload.rows} rows)`, "flagged"]} />
              <Bar dataKey="flagged_pct" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false}>
                {perScenario.map((s) => (
                  <Cell key={s.name} fill={s.scenario_label === "normal" ? COLORS.neutral : COLORS.series[0]} />
                ))}
                <LabelList dataKey="flagged_pct" position="right" formatter={(v: any) => `${v}%`}
                           style={{ fill: COLORS.ink2, fontSize: 12 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card>
        <p className="text-sm text-ink-2">
          <strong className="text-ink">Try it:</strong> raise the contamination slider to 10%. Recall goes up a little,
          but precision falls - more alarms catch more faults, but also raise more false alarms.
        </p>
      </Card>
    </div>
  );
}
