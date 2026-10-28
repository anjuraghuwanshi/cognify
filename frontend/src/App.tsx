import { RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getAnalysis, resetData, uploadCsv, type Analysis } from "./api";
import DatasetTab from "./components/DatasetTab";
import DetectionTab from "./components/DetectionTab";
import EvaluationTab from "./components/EvaluationTab";
import TestPointTab from "./components/TestPointTab";

const TABS = ["Dataset", "Detection results", "Evaluation", "Test a data point"];

export default function App() {
  // The open tab is kept in the address (#1 to #4), so a refresh stays on the same tab
  const [tab, setTabState] = useState(() => Math.min(Math.max(Number(location.hash.slice(1)) - 1 || 0, 0), 3));
  const setTab = (i: number) => { setTabState(i); history.replaceState(null, "", `#${i + 1}`); };
  const [contamination, setContamination] = useState(0.05);
  const [sliderValue, setSliderValue] = useState(0.05);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  // Re-run the analysis whenever the setting or the dataset changes
  useEffect(() => {
    setLoading(true);
    getAnalysis(contamination)
      .then((a) => { setAnalysis(a); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [contamination, dataVersion]);

  // Wait until the user stops moving the slider before re-training
  useEffect(() => {
    const timer = setTimeout(() => setContamination(sliderValue), 400);
    return () => clearTimeout(timer);
  }, [sliderValue]);

  async function onUpload(file: File) {
    try {
      await uploadCsv(file);
      setDataVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onReset() {
    await resetData();
    setDataVersion((v) => v + 1);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Air-Gapped Predictive Cognify</h1>
          <p className="mt-1 text-ink-2">Anomaly detection for secure MPLS operations - proof of concept</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink-2">
          <ShieldCheck size={16} className="text-good" />
          Runs offline on this laptop
        </div>
      </header>

      <div className="mt-4 rounded-lg border border-warning/60 bg-warning/10 px-4 py-3 text-sm text-ink">
        <strong>Proof of concept.</strong> The data is a recorded public lab dataset, replayed from a CSV file.
        No real routers are contacted or configured. This is not a production-ready MPLS monitoring system.
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-end gap-6 rounded-xl border border-line bg-surface px-5 py-4">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm text-ink-2">
          <span>
            Expected share of anomalies (contamination): <strong className="text-ink">{Math.round(sliderValue * 100)}%</strong>
          </span>
          <input
            type="range" min={0.01} max={0.15} step={0.01} value={sliderValue}
            onChange={(e) => setSliderValue(Number(e.target.value))}
            className="accent-series-1"
          />
          <span className="text-xs text-muted">Isolation Forest flags roughly this share of training rows as unusual.</span>
        </label>
        <div className="flex flex-col gap-1 text-sm text-ink-2">
          <span>Data: <strong className="text-ink">{analysis?.dataset.name ?? "..."}</strong></span>
          <div className="flex gap-2">
            <button
              onClick={() => fileInput.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-page px-3 py-2 text-ink hover:bg-grid/50"
            >
              <Upload size={16} /> Upload CSV
            </button>
            {analysis && !analysis.dataset.is_default && (
              <button
                onClick={onReset}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-page px-3 py-2 text-ink hover:bg-grid/50"
              >
                <RotateCcw size={16} /> Use Cisco dataset
              </button>
            )}
          </div>
          <input
            ref={fileInput} type="file" accept=".csv" className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) onUpload(e.target.files[0]); e.target.value = ""; }}
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-critical/50 bg-critical/10 px-4 py-3 text-sm text-critical">
          {error}
        </div>
      )}

      {/* Tabs */}
      <nav className="mt-6 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((name, i) => (
          <button
            key={name}
            onClick={() => setTab(i)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${
              tab === i ? "border-series-1 text-ink" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full text-xs ${
              tab === i ? "bg-series-1 text-white" : "bg-grid text-ink-2"
            }`}>{i + 1}</span>
            {name}
          </button>
        ))}
        {loading && <span className="ml-auto self-center text-sm text-muted">Running model...</span>}
      </nav>

      <main className="mt-6">
        {analysis && tab === 0 && <DatasetTab a={analysis} />}
        {analysis && tab === 1 && <DetectionTab a={analysis} />}
        {analysis && tab === 2 && <EvaluationTab a={analysis} />}
        {analysis && tab === 3 && <TestPointTab a={analysis} contamination={contamination} />}
      </main>

      <footer className="mt-10 border-t border-line pt-4 text-sm text-ink-2">
        An anomaly means a reading is statistically unusual compared with that router's normal behaviour.
        It does not prove that a router has failed - an engineer should still investigate each alert.
      </footer>
    </div>
  );
}
