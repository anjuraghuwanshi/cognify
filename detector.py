"""
detector.py
All the data and ML logic for the POC (kept separate from the dashboard code).

Steps:
1. load_data()        - read the CSV and check it has the right columns
2. split_train_test() - 75% of rows for training, 25% for testing
3. train_model()      - learn each router's normal level and limits, fit an Isolation Forest
4. detect()           - mark every row as "Normal" or "Anomaly"
5. evaluate()         - compare predictions with scenario_label on the test rows

A row is an Anomaly if EITHER rule fires:
  Rule 1 (ML)    : Isolation Forest says the combination of metrics is unusual for this router.
  Rule 2 (limit) : a metric is far beyond anything this router produced in training
                   (more than 5 standard deviations past its training min/max).
Rule 2 exists because Isolation Forest only knows the range of values it was trained on,
so a single extreme value (e.g. CPU 95% on a router that never went above 30%) can slip past it.
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split

# The router metrics the model looks at. scenario_label is NOT in this list on purpose.
FEATURES = [
    "cpu_util_pct",
    "mem_util_pct",
    "bandwidth_util_pct",
    "packet_loss_pct",
    "interface_errors",
    "interfaces_down",
    "bgp_peers_down",
]
REQUIRED_COLUMNS = ["timestamp", "router_id"] + FEATURES
LABEL_COLUMN = "scenario_label"  # optional, used only for evaluation
LIMIT_STD = 5  # Rule 2: how many standard deviations past the training min/max


def load_data(file):
    """Read a CSV (path or uploaded file) and validate it. Raises ValueError on problems."""
    df = pd.read_csv(file)

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    for col in FEATURES:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Drop rows with unreadable timestamps or metric values
    df = df.dropna(subset=["timestamp"] + FEATURES)
    if len(df) < 20:
        raise ValueError("CSV needs at least 20 valid rows to train the model.")

    return df.sort_values(["timestamp", "router_id"]).reset_index(drop=True)


def split_train_test(df, test_size=0.25):
    """Randomly put 75% of rows in 'Train' and 25% in 'Test'.
    If labels exist, both parts get the same share of faults (stratified split)."""
    stratify = df[LABEL_COLUMN] if LABEL_COLUMN in df.columns else None
    _, test_idx = train_test_split(df.index, test_size=test_size, stratify=stratify, random_state=42)
    df = df.copy()
    df["split"] = "Train"
    df.loc[test_idx, "split"] = "Test"
    return df


def per_router(table, router_ids):
    """Look up one row of a per-router table for each router id.
    A router never seen in training gets the median over all routers."""
    return table.reindex(router_ids).fillna(table.median()).values


def train_model(train_df, contamination=0.05):
    """Learn everything from the training rows. Returns a dict so it is easy to pass around."""
    by_router = train_df.groupby("router_id")[FEATURES]
    margin = (LIMIT_STD * by_router.std().fillna(0)).clip(lower=1)
    trained = {
        # Routers are very different from each other (e.g. edge routers have many more ports),
        # so every router is compared with its OWN normal (median) level.
        "baseline": by_router.median(),
        "limit_low": by_router.min() - margin,
        "limit_high": by_router.max() + margin,
    }
    deviations = train_df[FEATURES].values - per_router(trained["baseline"], train_df["router_id"])
    model = IsolationForest(n_estimators=100, contamination=contamination, random_state=42)
    trained["model"] = model.fit(deviations)
    # Numbers used to explain the model: cuts for a typical training row, and the cut-off
    trained["cuts_typical"] = float(np.median(average_cuts(model, model.score_samples(deviations))))
    trained["cuts_cutoff"] = float(average_cuts(model, model.offset_))
    return trained


def average_cuts(model, raw_score):
    """Turn Isolation Forest's raw score into the average number of random cuts the trees
    needed to isolate a point (its path length). Fewer cuts = easier to isolate = more unusual.
    Formula from the Isolation Forest paper: score = -2 ** (-cuts / c(n))."""
    n = model.max_samples_
    c = 2 * (np.log(n - 1) + np.euler_gamma) - 2 * (n - 1) / n  # average cuts for n points
    return -np.log2(-np.asarray(raw_score)) * c


def detect(trained, df):
    """Add anomaly_score, rule columns and the final prediction. Lower score = more unusual."""
    values = df[FEATURES].values
    deviations = values - per_router(trained["baseline"], df["router_id"])

    df = df.copy()
    df["anomaly_score"] = trained["model"].decision_function(deviations).round(4)
    df["ml_flag"] = trained["model"].predict(deviations) == -1
    df["limit_flag"] = ((values > per_router(trained["limit_high"], df["router_id"]))
                        | (values < per_router(trained["limit_low"], df["router_id"]))).any(axis=1)
    df["prediction"] = ["Anomaly" if m or l else "Normal" for m, l in zip(df["ml_flag"], df["limit_flag"])]
    df["flagged_by"] = [("ML + limit" if m and l else "ML" if m else "Limit" if l else "")
                        for m, l in zip(df["ml_flag"], df["limit_flag"])]
    return df


def check_point(trained, router_id, values):
    """Check ONE data point typed by the user.
    Returns the result row, a per-metric explanation table, and the average number of cuts."""
    point = pd.DataFrame([{"router_id": router_id, **values}])
    result = detect(trained, point).iloc[0]

    explain = pd.DataFrame({"entered": pd.Series(values)})
    for name in ["baseline", "limit_low", "limit_high"]:
        explain[name] = per_router(trained[name], [router_id])[0]
    explain = explain.rename(columns={"baseline": "router_normal"})
    beyond = (explain["entered"] > explain["limit_high"]) | (explain["entered"] < explain["limit_low"])
    explain["status"] = ["Beyond limit" if b else "Within limit" for b in beyond]

    deviations = point[FEATURES].values - per_router(trained["baseline"], [router_id])
    cuts = float(average_cuts(trained["model"], trained["model"].score_samples(deviations))[0])
    return result, explain, cuts


def evaluate(test_df):
    """Compare predictions with the known labels (any label other than 'normal' is a fault)."""
    y_true = test_df[LABEL_COLUMN] != "normal"
    y_pred = test_df["prediction"] == "Anomaly"

    results = {
        "precision": precision_score(y_true, y_pred, zero_division=0),
        "recall": recall_score(y_true, y_pred, zero_division=0),
        "f1": f1_score(y_true, y_pred, zero_division=0),
        # rows = actual [Normal, Fault], columns = predicted [Normal, Anomaly]
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=[False, True]),
    }

    # How many rows of each scenario were flagged
    per_scenario = (
        test_df.groupby(LABEL_COLUMN)["prediction"]
        .agg(rows="count", flagged=lambda s: (s == "Anomaly").sum())
        .reset_index()
    )
    per_scenario["flagged_pct"] = (100 * per_scenario["flagged"] / per_scenario["rows"]).round(1)
    results["per_scenario"] = per_scenario
    return results
