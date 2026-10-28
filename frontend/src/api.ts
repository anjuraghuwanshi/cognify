// Types for the JSON returned by server.py, and the functions that call it.

export type Row = {
  timestamp: string;
  router_id: string;
  split: "Train" | "Test";
  anomaly_score: number;
  prediction: "Normal" | "Anomaly";
  flagged_by: string;
  scenario_label?: string;
  [metric: string]: string | number | undefined;
};

export type Sample = {
  title: string;
  kind: "real-normal" | "real-fault" | "real-missed" | "made-up";
  router_id: string;
  values: Record<string, number>;
  label: string | null;
  timestamp: string | null;
};

export type Analysis = {
  features: string[];
  limit_std: number;
  dataset: {
    name: string;
    is_default: boolean;
    rows: number;
    routers: string[];
    start: string;
    end: string;
    minutes: number;
    has_labels: boolean;
    fault_share: number | null;
  };
  observations: {
    router_medians: Record<string, number | string>[];
    interfaces_down_range: [number, number];
    fault_routers?: string[];
    fault_rows?: number;
    changed?: string[];
    steady?: string[];
    compare?: { metric: string; normal: number; fault: number; effect: number; verdict: string }[];
    fault_counts?: { router_id: string; scenario_label: string; rows: number }[];
    fault_types?: string[];
  };
  summary: {
    checked: number;
    anomalies: number;
    train_rows: number;
    test_rows: number;
    by_rule: Record<string, number>;
  };
  evaluation: {
    precision: number;
    recall: number;
    f1: number;
    confusion: [[number, number], [number, number]];
    per_scenario: { scenario_label: string; rows: number; flagged: number; flagged_pct: number }[];
  } | null;
  samples: Sample[];
  rows: Row[];
};

export type MetricCheck = {
  metric: string;
  entered: number;
  normal: number;
  limit_low: number;
  limit_high: number;
  limit_used_pct: number;
  status: "Within limit" | "Beyond limit";
};

export type CheckResult = {
  prediction: "Normal" | "Anomaly";
  flagged_by: string;
  ml_flag: boolean;
  limit_flag: boolean;
  score: number;
  cuts: number;
  cuts_typical: number;
  cuts_cutoff: number;
  metrics: MetricCheck[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.detail ?? `Request failed (${res.status})`);
  return body as T;
}

export const getAnalysis = (contamination: number) =>
  request<Analysis>(`/api/analysis?contamination=${contamination}`);

export const checkPoint = (router_id: string, values: Record<string, number>, contamination: number) =>
  request<CheckResult>("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ router_id, values, contamination }),
  });

export const uploadCsv = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<{ ok: boolean }>("/api/upload", { method: "POST", body: form });
};

export const resetData = () => request<{ ok: boolean }>("/api/reset", { method: "POST" });

// Chart colours (SVG needs real colour values, so they are repeated here from index.css)
export const COLORS = {
  series: ["#2a78d6", "#eb6834", "#1baf7a"],
  good: "#0ca30c",
  critical: "#d03b3b",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  muted: "#898781",
  ink2: "#52514e",
  neutral: "#b7b5ac",
};

// Friendly names for the metric columns
export const LABELS: Record<string, string> = {
  cpu_util_pct: "CPU utilization (%)",
  mem_util_pct: "Memory utilization (%)",
  bandwidth_util_pct: "Bandwidth utilization (%)",
  packet_loss_pct: "Packet loss (%)",
  interface_errors: "Interface errors",
  interfaces_down: "Interfaces down",
  bgp_peers_down: "BGP peers down",
};

export const label = (metric: string) => LABELS[metric] ?? metric;

export const fmt = (value: number, digits = 2) =>
  Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: digits });
