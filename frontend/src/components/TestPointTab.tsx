import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, XAxis, YAxis,
} from "recharts";
import { checkPoint, COLORS, fmt, label, type Analysis, type CheckResult, type MetricCheck, type Sample } from "../api";
import { Select } from "./ui";

const KIND_TAG: Record<Sample["kind"], string> = {
  "real-normal": "Real reading - normal",
  "real-fault": "Real reading - fault",
  "real-missed": "Real reading - fault",
  "made-up": "Made up",
};

function Verdict({ unusual, children }: { unusual: boolean; children: ReactNode }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${
      unusual ? "bg-critical/10 text-critical" : "bg-good/10 text-good-text"}`}>
      {unusual ? <CircleAlert size={18} className="mt-0.5 shrink-0" /> : <CircleCheck size={18} className="mt-0.5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

// One row of Check 1: grey bar = allowed range, black tick = normal, dot = this reading
function LimitRow({ m }: { m: MetricCheck }) {
  const low = Math.max(m.limit_low, 0); // metrics cannot be negative
  const high = m.limit_high;
  // The allowed range fills the middle 80% of the row; values outside it sit in the end zones
  const place = (v: number) => (v > high ? 96 : v < low ? 4 : 10 + (80 * (v - low)) / (high - low || 1));
  const outside = m.status === "Beyond limit";
  return (
    <div className="grid grid-cols-[170px_1fr_190px] items-center gap-4 border-t border-line py-2.5 first:border-t-0">
      <div className="text-sm text-ink">{label(m.metric)}</div>
      <div className="relative h-6">
        <div className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-grid" style={{ left: "10%", width: "80%" }} />
        <div className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 bg-ink" style={{ left: `${place(m.normal)}%` }} />
        <div
          className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface ${
            outside ? "bg-critical" : "bg-good"}`}
          style={{ left: `${place(m.entered)}%` }}
          title={`${fmt(m.entered)} (allowed ${fmt(low, 1)} to ${fmt(high, 1)})`}
        />
      </div>
      <div className="tabular whitespace-nowrap text-sm">
        <span className={`font-semibold ${outside ? "text-critical" : "text-ink"}`}>{fmt(m.entered)}</span>
        <span className="text-muted"> / allowed {fmt(low, 1)}-{fmt(high, 1)}</span>
      </div>
    </div>
  );
}

function Step({ n, title, children, last = false }: { n: number; title: string; children: ReactNode; last?: boolean }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-series-1 font-semibold text-white">{n}</div>
        {!last && <div className="mt-2 w-0.5 flex-1 bg-grid" />}
      </div>
      <div className="min-w-0 flex-1 pb-8">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

export default function TestPointTab({ a, contamination }: { a: Analysis; contamination: number }) {
  const [sampleIndex, setSampleIndex] = useState(0);
  const sample = a.samples[sampleIndex];
  const [router, setRouter] = useState(sample.router_id);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edited, setEdited] = useState(false); // true once the user changes the sample's values

  function run(routerId: string, values: Record<string, string>) {
    const numbers = Object.fromEntries(a.features.map((f) => [f, Number(values[f])]));
    if (Object.values(numbers).some((v) => Number.isNaN(v) || v < 0)) {
      setError("Every metric needs a number of 0 or more.");
      return;
    }
    setError(null);
    checkPoint(routerId, numbers, contamination).then(setResult).catch((e) => setError(e.message));
  }

  // Load a sample into the form and check it straight away
  function pick(index: number) {
    const s = a.samples[index];
    const values = Object.fromEntries(a.features.map((f) => [f, String(s.values[f])]));
    setSampleIndex(index);
    setRouter(s.router_id);
    setInputs(values);
    setEdited(false);
    run(s.router_id, values);
  }

  useEffect(() => pick(sampleIndex), [a, contamination]); // eslint-disable-line react-hooks/exhaustive-deps

  const beyond = result?.metrics.filter((m) => m.status === "Beyond limit") ?? [];
  const cutsData = result && [
    { name: "Typical normal reading", cuts: result.cuts_typical, color: COLORS.neutral },
    { name: "This reading", cuts: result.cuts, color: result.ml_flag ? COLORS.critical : COLORS.good },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      {/* Left: choose and edit the data point */}
      <aside className="flex flex-col gap-4">
        <div>
          <h3 className="text-base font-semibold text-ink">Pick a sample</h3>
          <p className="mt-1 text-sm text-ink-2">Real samples come from test rows the model never trained on.</p>
          <div className="mt-3 flex flex-col gap-2">
            {a.samples.map((s, i) => (
              <button key={s.title} onClick={() => pick(i)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm ${
                        i === sampleIndex ? "border-series-1 bg-series-1/10" : "border-line bg-surface hover:bg-grid/40"}`}>
                <div className="text-xs text-muted">{KIND_TAG[s.kind]}</div>
                <div className="font-medium text-ink">{s.title}</div>
              </button>
            ))}
          </div>
        </div>

        <form className="rounded-xl border border-line bg-surface p-4"
              onSubmit={(e) => { e.preventDefault(); run(router, inputs); }}>
          <h3 className="text-base font-semibold text-ink">Change any value (optional)</h3>
          <div className="mt-3 flex flex-col gap-3">
            <Select label="Router" value={router} onChange={(r) => { setRouter(r); setEdited(true); }}
                    options={a.dataset.routers.map((r) => ({ value: r, label: r }))} />
            {a.features.map((f) => (
              <label key={f} className="flex items-center justify-between gap-3 text-sm text-ink-2">
                {label(f)}
                <input type="number" min={0} step="any" value={inputs[f] ?? ""}
                       onChange={(e) => { setInputs({ ...inputs, [f]: e.target.value }); setEdited(true); }}
                       className="tabular w-28 rounded-md border border-line bg-page px-2 py-1 text-right text-ink" />
              </label>
            ))}
          </div>
          <button type="submit" className="mt-4 w-full rounded-lg bg-series-1 px-4 py-2 font-medium text-white hover:opacity-90">
            Check this reading
          </button>
          {error && <p className="mt-2 text-sm text-critical">{error}</p>}
        </form>
      </aside>

      {/* Right: the step-by-step explanation */}
      <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
        <h2 className="mb-6 text-xl font-semibold text-ink">How Cognify decides</h2>
        {result && cutsData && (
          <>
            <Step n={1} title={`The reading, compared with ${router}'s normal level`}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {result.metrics.map((m) => {
                  const diff = m.entered - m.normal;
                  return (
                    <div key={m.metric} className="rounded-lg border border-line bg-page px-3 py-2">
                      <div className="text-xs text-ink-2">{label(m.metric)}</div>
                      <div className="text-xl font-semibold text-ink">{fmt(m.entered)}</div>
                      <div className="text-xs text-muted">
                        normal {fmt(m.normal)} ({diff >= 0 ? "+" : ""}{fmt(diff)})
                      </div>
                    </div>
                  );
                })}
              </div>
            </Step>

            <Step n={2} title="Check 1 - Is any metric past its hard limit?">
              <p className="mb-2 text-sm text-ink-2">
                <span className="inline-block h-2 w-6 rounded-full bg-grid align-middle" /> allowed range for {router}
                {" "}(from its training data, with a safety margin)
                <span className="mx-3 inline-block h-3.5 w-0.5 bg-ink align-middle" />its normal value
                <span className="mx-3 inline-block h-3 w-3 rounded-full bg-good align-middle" />this reading.
                A dot outside the grey bar breaks the limit and turns red.
              </p>
              <div className="mb-3 rounded-lg border border-line bg-page px-4 py-1">
                {result.metrics.map((m) => <LimitRow key={m.metric} m={m} />)}
              </div>
              <Verdict unusual={result.limit_flag}>
                {result.limit_flag
                  ? <><strong>Yes</strong> - {beyond.map((m) => label(m.metric)).join(", ")} {beyond.length > 1 ? "are" : "is"} past the limit. Check 1 says <strong>unusual</strong>.</>
                  : <><strong>No</strong> - every metric is inside its limits. Check 1 says <strong>normal</strong>.</>}
              </Verdict>
            </Step>

            <Step n={3} title="Check 2 - Does Isolation Forest find the combination unusual?">
              <p className="mb-3 text-sm text-ink-2">
                Isolation Forest keeps cutting the data at random until this reading is on its own. A normal reading looks
                like thousands of others, so it takes many cuts. An unusual one is separated after only a few. If it takes
                fewer cuts than the cut-off (red line), the model calls it unusual.
              </p>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={cutsData} layout="vertical" margin={{ top: 16, right: 56, left: 8, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke={COLORS.grid} />
                  <XAxis type="number" domain={[0, Math.ceil(Math.max(result.cuts_typical, result.cuts) + 2)]}
                         tick={{ fill: COLORS.muted, fontSize: 12 }} stroke={COLORS.axis} />
                  <YAxis type="category" dataKey="name" width={170} tick={{ fill: COLORS.ink2, fontSize: 13 }} stroke={COLORS.axis} />
                  <ReferenceLine x={result.cuts_cutoff} stroke={COLORS.critical} strokeDasharray="4 3" strokeWidth={2}
                                 label={{ value: `cut-off ${fmt(result.cuts_cutoff, 1)}`, fill: COLORS.critical, fontSize: 12, position: "top" }} />
                  <Bar dataKey="cuts" maxBarSize={22} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {cutsData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    <LabelList dataKey="cuts" position="right" formatter={(v: any) => `${fmt(Number(v), 1)} cuts`}
                               style={{ fill: COLORS.ink2, fontSize: 12 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <Verdict unusual={result.ml_flag}>
                Separated after <strong>{fmt(result.cuts, 1)} cuts</strong> on average,{" "}
                {result.ml_flag ? "fewer" : "more"} than the cut-off of {fmt(result.cuts_cutoff, 1)}.
                Check 2 says <strong>{result.ml_flag ? "unusual" : "normal"}</strong>.
              </Verdict>
            </Step>

            <Step n={4} title="Final answer" last>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className={`rounded-lg px-3 py-2 font-medium ${result.limit_flag ? "bg-critical/10 text-critical" : "bg-good/10 text-good-text"}`}>
                  Check 1: {result.limit_flag ? "unusual" : "normal"}
                </span>
                <span className="font-semibold text-ink-2">OR</span>
                <span className={`rounded-lg px-3 py-2 font-medium ${result.ml_flag ? "bg-critical/10 text-critical" : "bg-good/10 text-good-text"}`}>
                  Check 2: {result.ml_flag ? "unusual" : "normal"}
                </span>
                <span className="font-semibold text-ink-2">=</span>
                <span className={`flex items-center gap-2 rounded-lg px-4 py-2 text-lg font-semibold text-white ${
                  result.prediction === "Anomaly" ? "bg-critical" : "bg-good"}`}>
                  {result.prediction === "Anomaly" ? <CircleAlert size={20} /> : <CircleCheck size={20} />}
                  {result.prediction}
                </span>
              </div>
              <p className="mt-3 text-sm text-ink-2">The reading is an anomaly if <em>either</em> check finds it unusual.</p>
              {sample.label && !edited && (
                <p className="mt-2 text-sm text-ink-2">
                  What really happened (event log): <strong className="text-ink">{sample.label}</strong> at{" "}
                  {sample.timestamp?.replace("T", " ")}.
                  {sample.kind === "real-missed" && " This is a fault the model misses - no detector is perfect."}
                </p>
              )}
            </Step>
          </>
        )}
      </section>
    </div>
  );
}
