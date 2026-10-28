"""
prepare_cisco_data.py
Converts the PUBLIC Cisco IOS-XR telemetry dataset into the simple CSV used by the dashboard.

Data source (cite this in the report):
  Cisco Innovation Edge, "Open-source datasets for network anomaly based machine learning",
  https://github.com/cisco-ie/telemetry  - folder 4 "Port State Changes" (portflaptypes.csv.gz)
  Paper: A. Putina, D. Rossi, A. Bifet, S. Barth, D. Pletcher, C. Precup, P. Nivaggioli,
  "Telemetry-based stream-learning of BGP anomalies", ACM SIGCOMM Big-DAMA Workshop, 2018.

The raw file has one row per (router, telemetry path, interface, sample) - about 1.2 million rows.
This script turns it into one row per router every 10 seconds with these columns:
  timestamp, router_id, cpu_util_pct, mem_util_pct, bandwidth_util_pct, packet_loss_pct,
  interface_errors, interfaces_down, bgp_peers_down, scenario_label

Usage:  python prepare_cisco_data.py raw_data/cisco_portflap/portflaptypes.csv.gz
"""

import sys

import numpy as np
import pandas as pd

OUTPUT_FILE = "data/router_metrics.csv"
BIN = "10s"  # routers report every ~5 seconds; we average into 10-second rows

# Fault events copied from portflap_casedata.txt (times are PDT, minute resolution).
# Both the device where the fault was triggered and its link neighbour are labelled.
EVENTS = [
    ("10:15", "10:19", ["spine2", "leaf3"], "transceiver_pull"),
    ("10:21", "10:25", ["leaf3", "spine2"], "transceiver_pull"),
    ("10:28", "10:33", ["spine2", "leaf3"], "admin_down"),
    ("10:35", "10:38", ["leaf3", "spine2"], "admin_down"),
    ("10:43", "10:46", ["leaf3"], "fiber_pull"),  # neighbour rswA5 has no telemetry
    ("10:48", "10:50", ["leaf3"], "fiber_pull"),
]
EVENT_DATE = "2017-09-01"

PATHS = {
    "cpu": "Cisco-IOS-XR-wdsysmon-fd-oper:system-monitoring/cpu-utilization",
    "mem": "Cisco-IOS-XR-nto-misc-oper:memory-summary/nodes/node/summary",
    "rate": "Cisco-IOS-XR-infra-statsd-oper:infra-statistics/interfaces/interface/latest/data-rate",
    "counters": "Cisco-IOS-XR-infra-statsd-oper:infra-statistics/interfaces/interface/latest/generic-counters",
    "brief": "Cisco-IOS-XR-pfi-im-cmd-oper:interfaces/interface-briefs/interface-brief",
    "bgp": "Cisco-IOS-XR-ipv4-bgp-oper:bgp/instances/instance/instance-active/default-vrf/process-info",
}
USE_COLS = [
    "time", "EncodingPath", "Producer", "node-name", "interface-name",
    "total-cpu-one-minute", "free-physical-memory", "ram-memory",
    "bandwidth", "input-data-rate", "output-data-rate",
    "input-errors", "output-errors", "crc-errors", "input-drops", "output-drops",
    "packets-received", "packets-sent", "actual-state",
    "global__neighbors-count-total", "global__established-neighbors-count-total",
]


def read_raw(path):
    """Read only the columns and telemetry paths we need, in chunks to save memory."""
    parts = []
    for chunk in pd.read_csv(path, usecols=USE_COLS, chunksize=300_000, low_memory=False):
        parts.append(chunk[chunk["EncodingPath"].isin(PATHS.values())])
    raw = pd.concat(parts, ignore_index=True)
    # Nanosecond UTC epoch -> local lab time (PDT), so it matches the event log
    raw["timestamp"] = (pd.to_datetime(raw["time"], unit="ns", utc=True)
                        .dt.tz_convert("America/Los_Angeles").dt.tz_localize(None))
    raw["bin"] = raw["timestamp"].dt.floor(BIN)
    raw = raw.rename(columns={"Producer": "router_id"})
    return raw


def per_path(raw, key):
    return raw[raw["EncodingPath"] == PATHS[key]]


def counter_deltas(df, columns, key_cols):
    """Counters only ever grow, so we take the increase since the previous sample."""
    df = df.sort_values("timestamp")
    deltas = df.groupby(key_cols)[columns].diff().clip(lower=0)  # negative = counter reset
    return deltas.fillna(0)


def build_features(raw):
    keys = ["router_id", "bin"]

    cpu = per_path(raw, "cpu").groupby(keys)["total-cpu-one-minute"].mean().rename("cpu_util_pct")

    mem = per_path(raw, "mem").groupby(keys)[["free-physical-memory", "ram-memory"]].sum()
    mem = (100 * (1 - mem["free-physical-memory"] / mem["ram-memory"])).rename("mem_util_pct")

    rate = per_path(raw, "rate")
    rate = rate[rate["bandwidth"] > 0]
    rate = rate.groupby(keys)[["input-data-rate", "output-data-rate", "bandwidth"]].mean()
    bandwidth = (100 * (rate["input-data-rate"] + rate["output-data-rate"]) / (2 * rate["bandwidth"])
                 ).rename("bandwidth_util_pct")

    c = per_path(raw, "counters").copy()
    cols = ["input-errors", "output-errors", "crc-errors", "input-drops", "output-drops",
            "packets-received", "packets-sent"]
    c[cols] = counter_deltas(c, cols, ["router_id", "interface-name"])
    c = c.groupby(keys)[cols].sum()
    errors = (c["input-errors"] + c["output-errors"] + c["crc-errors"]).rename("interface_errors")
    packets = (c["packets-received"] + c["packets-sent"]).replace(0, np.nan)
    loss = (100 * (c["input-drops"] + c["output-drops"]) / packets).fillna(0).rename("packet_loss_pct")

    brief = per_path(raw, "brief")
    down = (brief[brief["actual-state"] != "im-state-up"]
            .groupby(keys)["interface-name"].nunique().rename("interfaces_down"))

    bgp = per_path(raw, "bgp").groupby(keys)[
        ["global__neighbors-count-total", "global__established-neighbors-count-total"]].min()
    bgp_down = (bgp["global__neighbors-count-total"] - bgp["global__established-neighbors-count-total"]
                ).rename("bgp_peers_down")

    df = pd.concat([cpu, mem, bandwidth, loss, errors, down, bgp_down], axis=1).reset_index()
    df["interfaces_down"] = df["interfaces_down"].fillna(0)  # no rows = no down interfaces
    # Some paths report less often than every 10 s: carry the last known value forward
    df = df.sort_values(keys)
    df[df.columns[2:]] = df.groupby("router_id")[list(df.columns[2:])].ffill()
    df = df.dropna().rename(columns={"bin": "timestamp"})
    return df


def add_labels(df):
    df["scenario_label"] = "normal"
    for start, end, routers, label in EVENTS:
        t0 = pd.Timestamp(f"{EVENT_DATE} {start}")
        t1 = pd.Timestamp(f"{EVENT_DATE} {end}") + pd.Timedelta(minutes=1)  # include the end minute
        mask = df["router_id"].isin(routers) & (df["timestamp"] >= t0) & (df["timestamp"] < t1)
        df.loc[mask, "scenario_label"] = label
    return df


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: python prepare_cisco_data.py raw_data/cisco_portflap/portflaptypes.csv.gz")

    print("Reading raw telemetry (takes 1-2 minutes)...")
    df = add_labels(build_features(read_raw(sys.argv[1])))

    # Drop the first and last bins, which are only partly filled
    df = df[(df["timestamp"] > df["timestamp"].min()) & (df["timestamp"] < df["timestamp"].max())]
    df = df.round({"cpu_util_pct": 2, "mem_util_pct": 2, "bandwidth_util_pct": 2, "packet_loss_pct": 4})
    for col in ["interface_errors", "interfaces_down", "bgp_peers_down"]:
        df[col] = df[col].astype(int)

    df = df.sort_values(["timestamp", "router_id"]).reset_index(drop=True)
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"Saved {len(df)} rows ({df['router_id'].nunique()} routers) to {OUTPUT_FILE}")
    print(df["scenario_label"].value_counts().to_string())


if __name__ == "__main__":
    main()
