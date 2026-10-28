"""
server.py
Local web server for the POC:
  - a small JSON API (FastAPI) around detector.py
  - the built React dashboard (frontend/dist), served from the same address

Run with:  python server.py      then open http://localhost:8000
Everything stays on this laptop: the server only listens on 127.0.0.1.
"""

import io
import os

import pandas as pd
import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from detector import (FEATURES, LABEL_COLUMN, LIMIT_STD, check_point, detect, evaluate, load_data,
                      split_train_test, train_model)

DEFAULT_CSV = "data/router_metrics.csv"
FRONTEND_DIST = "frontend/dist"

# docs_url=None: the interactive API docs page loads files from the internet, so it is turned off
app = FastAPI(title="MPLS Anomaly Cognify", docs_url=None, redoc_url=None)

# The dataset currently in use (default CSV, or the user's upload) and cached model results
state = {"df": None, "name": None, "is_default": True}
cache = {}


def use_dataset(df, name, is_default):
    state.update(df=df, name=name, is_default=is_default)
    cache.clear()


def run_model(contamination):
    """Split, train and detect. Cached per contamination value, because training takes ~1 second."""
    key = round(contamination, 2)
    if key not in cache:
        df = split_train_test(state["df"])
        trained = train_model(df[df["split"] == "Train"], key)
        cache[key] = (detect(trained, df), trained)
    return cache[key]


# ---------------- Helpers that build the JSON for each dashboard tab ----------------

def dataset_info(df):
    has_labels = LABEL_COLUMN in df.columns
    return {
        "name": state["name"],
        "is_default": state["is_default"],
        "rows": len(df),
        "routers": sorted(df["router_id"].unique().tolist()),
        "start": df["timestamp"].min().isoformat(),
        "end": df["timestamp"].max().isoformat(),
        "minutes": round((df["timestamp"].max() - df["timestamp"].min()).total_seconds() / 60),
        "has_labels": has_labels,
        "fault_share": float((df[LABEL_COLUMN] != "normal").mean()) if has_labels else None,
    }


def observations(df):
    """Facts about the data, calculated (not typed by hand) so they also work for uploaded files."""
    medians = df.groupby("router_id")[FEATURES].median().round(3)
    result = {
        "router_medians": medians.reset_index().to_dict("records"),
        "interfaces_down_range": [float(medians["interfaces_down"].min()), float(medians["interfaces_down"].max())],
    }
    if LABEL_COLUMN not in df.columns:
        return result

    faults = df[df[LABEL_COLUMN] != "normal"]
    fault_routers = sorted(faults["router_id"].unique().tolist())
    involved = df[df["router_id"].isin(fault_routers)]
    is_fault = involved[LABEL_COLUMN] != "normal"

    # Effect size: how far the fault rows move from each router's own normal level,
    # measured in standard deviations of the normal rows (so metrics with different units compare fairly)
    medians = involved[~is_fault].groupby("router_id")[FEATURES].median()
    deviation = involved[FEATURES] - medians.reindex(involved["router_id"]).values
    spread = deviation[~is_fault].std().replace(0, 1)
    effect = (deviation[is_fault].mean() - deviation[~is_fault].mean()) / spread

    def verdict(e):
        if abs(e) >= 0.75:
            return "clear rise" if e > 0 else "clear drop"
        return "small change" if abs(e) >= 0.3 else "about the same"

    result.update({
        "fault_routers": fault_routers,
        "fault_rows": len(faults),
        "changed": [f for f in FEATURES if abs(effect[f]) >= 0.75],
        "steady": [f for f in FEATURES if abs(effect[f]) < 0.3],
        "compare": [{"metric": f,
                     "normal": round(float(involved[~is_fault][f].mean()), 3),
                     "fault": round(float(involved[is_fault][f].mean()), 3),
                     "effect": round(float(effect[f]), 2),
                     "verdict": verdict(effect[f])}
                    for f in FEATURES],
        "fault_counts": (faults.groupby(["router_id", LABEL_COLUMN]).size()
                         .rename("rows").reset_index().to_dict("records")),
        "fault_types": sorted(faults[LABEL_COLUMN].unique().tolist()),
    })
    return result


def sample_points(df):
    """Ready-made examples for the 'Test a data point' tab, taken from TEST rows (never trained on)."""
    test = df[df["split"] == "Test"]
    picked = []  # (title, kind, row)
    if LABEL_COLUMN in df.columns:
        normal = test[test[LABEL_COLUMN] == "normal"]
        faults = test[test[LABEL_COLUMN] != "normal"]
        fault_router = faults["router_id"].mode()[0] if len(faults) else normal["router_id"].iloc[0]
        busiest = df.groupby("router_id")["interfaces_down"].median().idxmax()
        for rid in dict.fromkeys([fault_router, busiest]):
            rows = normal[normal["router_id"] == rid].sort_values("anomaly_score", ascending=False)
            if len(rows):
                picked.append((f"Normal reading on {rid}", "real-normal", rows.iloc[0]))
        for label, rows in faults.groupby(LABEL_COLUMN):
            row = rows.sort_values("anomaly_score").iloc[0]
            picked.append((f"Real fault: {label} on {row['router_id']}", "real-fault", row))
        missed = faults[faults["prediction"] == "Normal"]
        if len(missed):
            row = missed.sort_values("anomaly_score", ascending=False).iloc[0]
            picked.append((f"A fault the model misses ({row[LABEL_COLUMN]})", "real-missed", row))
    else:
        ordered = test.sort_values("anomaly_score")
        picked.append(("Most normal test reading", "real-normal", ordered.iloc[-1]))
        picked.append(("Most unusual test reading", "real-fault", ordered.iloc[0]))

    first = picked[0][2]
    cpu_spike = first.copy()
    cpu_spike["cpu_util_pct"] = 95.0
    picked.append((f"Made up: CPU spike to 95% on {first['router_id']}", "made-up", cpu_spike))
    errors = first.copy()
    errors["interface_errors"] = 100
    errors["packet_loss_pct"] = 2.0
    picked.append((f"Made up: 100 interface errors on {first['router_id']}", "made-up", errors))

    return [{
        "title": title,
        "kind": kind,
        "router_id": row["router_id"],
        "values": {f: float(row[f]) for f in FEATURES},
        "label": row[LABEL_COLUMN] if kind.startswith("real") and LABEL_COLUMN in row else None,
        "timestamp": row["timestamp"].isoformat() if kind.startswith("real") else None,
    } for title, kind, row in picked]


def rows_for_charts(df):
    cols = ["timestamp", "router_id"] + FEATURES + ["split", "anomaly_score", "prediction", "flagged_by"]
    if LABEL_COLUMN in df.columns:
        cols.append(LABEL_COLUMN)
    out = df[cols].copy()
    out["timestamp"] = out["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%S")
    return out.to_dict("records")


# ---------------- API ----------------

@app.get("/api/analysis")
def analysis(contamination: float = 0.05):
    if not 0.01 <= contamination <= 0.15:
        raise HTTPException(400, "contamination must be between 0.01 and 0.15")
    df, trained = run_model(contamination)
    has_labels = LABEL_COLUMN in df.columns

    evaluation = None
    if has_labels:
        r = evaluate(df[df["split"] == "Test"])
        evaluation = {
            "precision": r["precision"], "recall": r["recall"], "f1": r["f1"],
            "confusion": r["confusion_matrix"].tolist(),
            "per_scenario": r["per_scenario"].to_dict("records"),
        }

    return {
        "features": FEATURES,
        "limit_std": LIMIT_STD,
        "dataset": dataset_info(df),
        "observations": observations(df),
        "summary": {
            "checked": len(df),
            "anomalies": int((df["prediction"] == "Anomaly").sum()),
            "train_rows": int((df["split"] == "Train").sum()),
            "test_rows": int((df["split"] == "Test").sum()),
            "by_rule": df.loc[df["flagged_by"] != "", "flagged_by"].value_counts().to_dict(),
        },
        "evaluation": evaluation,
        "samples": sample_points(df),
        "rows": rows_for_charts(df),
    }


class PointRequest(BaseModel):
    router_id: str
    values: dict[str, float]
    contamination: float = 0.05


@app.post("/api/check")
def check(req: PointRequest):
    missing = [f for f in FEATURES if f not in req.values]
    if missing:
        raise HTTPException(400, f"Missing values for: {', '.join(missing)}")
    _, trained = run_model(req.contamination)
    result, explain, cuts = check_point(trained, req.router_id, {f: req.values[f] for f in FEATURES})

    metrics = []
    for metric, r in explain.iterrows():
        # How far the value has moved towards its hard limit: 0% = normal, 100% = at the limit
        if r["entered"] >= r["router_normal"]:
            room = r["limit_high"] - r["router_normal"]
            used = 100 * (r["entered"] - r["router_normal"]) / room
        else:
            room = r["router_normal"] - r["limit_low"]
            used = -100 * (r["router_normal"] - r["entered"]) / room
        metrics.append({
            "metric": metric,
            "entered": float(r["entered"]),
            "normal": round(float(r["router_normal"]), 3),
            "limit_low": round(float(r["limit_low"]), 3),
            "limit_high": round(float(r["limit_high"]), 3),
            "limit_used_pct": round(float(used), 1),
            "status": r["status"],
        })

    return {
        "prediction": result["prediction"],
        "flagged_by": result["flagged_by"],
        "ml_flag": bool(result["ml_flag"]),
        "limit_flag": bool(result["limit_flag"]),
        "score": float(result["anomaly_score"]),
        "cuts": round(cuts, 2),
        "cuts_typical": round(trained["cuts_typical"], 2),
        "cuts_cutoff": round(trained["cuts_cutoff"], 2),
        "metrics": metrics,
    }


@app.post("/api/upload")
async def upload(file: UploadFile):
    try:
        df = load_data(io.BytesIO(await file.read()))
    except ValueError as err:
        raise HTTPException(400, str(err))
    except Exception:
        raise HTTPException(400, "Could not read this file as a CSV.")
    use_dataset(df, file.filename, is_default=False)
    return {"ok": True}


@app.post("/api/reset")
def reset():
    use_dataset(load_data(DEFAULT_CSV), DEFAULT_CSV, is_default=True)
    return {"ok": True}


# The built React app (run `npm run build` in frontend/ first)
if os.path.isdir(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

if not os.path.exists(DEFAULT_CSV):
    raise SystemExit(f"{DEFAULT_CSV} not found. Run prepare_cisco_data.py first (see README).")
use_dataset(load_data(DEFAULT_CSV), DEFAULT_CSV, is_default=True)

if __name__ == "__main__":
    print("Dashboard: http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
