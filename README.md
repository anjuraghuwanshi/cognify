# Air-Gapped Predictive Cognify for Secure MPLS Operations - POC

A small prototype that reads recorded router telemetry, flags unusual router behaviour with
**Isolation Forest** (plus a simple hard-limit rule), and explains the results on a local
**React** dashboard.

- Runs fully on a laptop. No cloud service, no AI API, no connection to real routers.
- Uses a **public, citable dataset** of real Cisco IOS-XR router telemetry recorded in a lab.
- This is a proof of concept, **not** a production-ready MPLS monitoring system.

---

## 1. Technology stack

| Part | Technology | Why |
|---|---|---|
| Data preparation | Python, pandas, NumPy | Turn 1.2 million raw telemetry rows into a clean table |
| Machine learning | scikit-learn `IsolationForest` | Unsupervised anomaly detection, no labels needed for training |
| Backend API | FastAPI + uvicorn | Small Python web server that runs the model and returns JSON |
| Frontend | React + TypeScript (Vite), Tailwind CSS, Recharts | Interactive dashboard with clear, step-by-step charts |

The React app is **built once** into plain HTML/JS files (`frontend/dist`). At demo time the
Python server serves both those files and the API from **http://localhost:8000**. The running
dashboard needs no internet and no Node.js.

## 2. Folder structure

```
mpls-copilot-poc/
├── raw_data/cisco_portflap/    # original public dataset (downloaded once)
│   ├── portflaptypes.csv.gz    #   raw telemetry, ~1.2 million rows
│   ├── portflap_casedata.txt   #   official log of when each fault happened
│   └── portflap_header.txt     #   list of raw columns
├── data/router_metrics.csv     # cleaned data used by the dashboard (5,400 rows)
├── prepare_cisco_data.py       # raw telemetry -> data/router_metrics.csv
├── detector.py                 # load CSV, Isolation Forest + limit rule, evaluation
├── server.py                   # FastAPI server: JSON API + serves the built dashboard
├── requirements.txt            # Python packages
└── frontend/                   # React dashboard
    ├── src/App.tsx             #   page layout, slider, upload, tabs
    ├── src/api.ts              #   calls to the Python API
    ├── src/components/         #   one file per tab + small UI pieces
    └── dist/                   #   built dashboard (created by `npm run build`)
```

## 3. Dataset

**Source:** Cisco Innovation Edge, *Open-source datasets for network anomaly based machine learning*,
https://github.com/cisco-ie/telemetry, folder `4` ("Port State Changes").

**Cite in the report:**
A. Putina, D. Rossi, A. Bifet, S. Barth, D. Pletcher, C. Precup, P. Nivaggioli,
"Telemetry-based stream-learning of BGP anomalies," *ACM SIGCOMM Workshop on Big Data Analytics
and Machine Learning for Data Communication Networks (Big-DAMA '18)*, 2018.

**License:** the repository is published under CDLA-Permissive-1.0; the folder-4 README states
CC BY-NC 4.0. Both allow non-commercial academic use with attribution.

**What it contains:** model-driven telemetry streamed every ~5 seconds from 15 Cisco IOS-XR routers
(4 spine, 8 leaf, 3 edge `dr` routers) on 1 September 2017, about one hour, with 6 deliberately
caused faults:

| Time (PDT)  | Fault                                   | Devices labelled |
|-------------|-----------------------------------------|------------------|
| 10:15-10:19 | Optical transceiver pulled (local port)  | spine2, leaf3    |
| 10:21-10:25 | Optical transceiver pulled (remote port) | leaf3, spine2    |
| 10:28-10:33 | Port admin shutdown (local)              | spine2, leaf3    |
| 10:35-10:38 | Port admin shutdown (remote)             | leaf3, spine2    |
| 10:43-10:46 | Fibre cable pulled (local)               | leaf3            |
| 10:48-10:50 | Fibre cable pulled (remote)              | leaf3            |

**How we prepared it (`prepare_cisco_data.py`):** one row per router every 10 seconds:

| Column               | How it is calculated from the raw telemetry                         |
|----------------------|---------------------------------------------------------------------|
| `cpu_util_pct`       | `total-cpu-one-minute` (average of the router's CPUs)                |
| `mem_util_pct`       | 100 x (1 - `free-physical-memory` / `ram-memory`)                     |
| `bandwidth_util_pct` | (input + output data rate) / (2 x interface bandwidth) x 100          |
| `packet_loss_pct`    | new dropped packets / new packets x 100 (from interface counters)     |
| `interface_errors`   | new input errors + output errors + CRC errors                         |
| `interfaces_down`    | number of interfaces whose state is not "up"                          |
| `bgp_peers_down`     | BGP neighbours configured - BGP neighbours established                |
| `scenario_label`     | taken from the official event log above; `normal` otherwise          |

Result: 5,400 rows, 282 of them (5.2%) inside a fault window.

**Not in the dataset: latency.** Routers do not report their own latency in this telemetry.
Measuring latency needs active probes such as Cisco IP SLA or TWAMP - listed as future work.

**Label limitation:** the event log has minute-level times, so labels are approximate at the edges
of each fault. Other routers may also react to a fault but are labelled `normal`, so some
"false alarms" may be real side effects.

## 4. Installation (one time)

Needs **Python 3.11+** and **Node.js 20+** (tested with Python 3.11.5 and Node 24 on Windows 11).

```powershell
cd C:\Users\anjur\mpls-copilot-poc

# Python side
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt

# React side (build the dashboard)
cd frontend
npm install
npm run build
cd ..
```

Download and prepare the dataset (skip if `data/router_metrics.csv` already exists):

```powershell
mkdir raw_data\cisco_portflap
$base = "https://raw.githubusercontent.com/cisco-ie/telemetry/master/4"
foreach ($f in "portflaptypes.csv.gz","portflap_casedata.txt","portflap_header.txt","README.md") {
  Invoke-WebRequest "$base/$f" -OutFile "raw_data\cisco_portflap\$f"
}
python prepare_cisco_data.py raw_data/cisco_portflap/portflaptypes.csv.gz   # 1-2 minutes
```

**Fully offline laptop:** on a machine with internet, run `pip download -r requirements.txt -d wheels`
and `npm run build`. Copy the whole project folder (with `wheels`, `data` and `frontend/dist`) by USB,
then on the offline laptop run `pip install --no-index --find-links wheels -r requirements.txt`.
Node.js is not needed on the offline laptop.

## 5. Run

```powershell
.\venv\Scripts\activate
python server.py
```

Open **http://localhost:8000**. Stop with `Ctrl+C`.
The server listens on `127.0.0.1` only, so other computers cannot reach it. The API docs page is
turned off because it would load files from the internet.

**While changing the React code** (live reload): run `python server.py` in one terminal and
`npm run dev` inside `frontend` in another, then open the address Vite prints (http://127.0.0.1:5173).
Run `npm run build` again when done.

## 6. What the dashboard shows (sample output)

Numbers below are for the default setting (contamination = 5%). The tab number is kept in the
address (`#1` to `#4`), so you can open a tab directly, e.g. http://localhost:8000/#4.

**Tab 1 - Dataset:** source and citation; 5,400 rows, 15 routers, 60 minutes, 5.2% fault rows;
data preview; and observations calculated from the data:
- faults appear only on leaf3 and spine2;
- measured against each router's own normal level, only `interfaces_down` (+1.2 standard deviations)
  and `bgp_peers_down` (+1.2) clearly rise during faults;
- CPU, packet loss and interface errors hardly change, so faults are not always visible as "high CPU";
- routers have very different normal levels (bar chart: edge routers have 50-59 interfaces down,
  spines 0). This is why each router is compared with itself.

**Tab 2 - Detection results:** 5,400 checked, **287 anomalies** (286 by ML, 1 by the limit rule),
5,113 normal. Charts of CPU plus a chosen metric over time with red dots on flagged readings and grey
bands on the known fault periods (try `spine2` + BGP peers down). Table of flagged rows, most unusual
first.

**Tab 3 - Evaluation (1,350 test rows):** **Precision 0.56, Recall 0.66, F1 0.61**.

|               | Model: Normal          | Model: Anomaly      |
|---------------|------------------------|---------------------|
| Really normal | 1242 correctly normal  | 37 false alarms     |
| Really fault  | 24 missed faults       | 47 caught faults    |

Flagged share per scenario: admin_down 67%, fiber_pull 73%, transceiver_pull 63%, normal 2.9%.
At 10% contamination recall becomes 0.69 but precision drops to 0.36.

**Tab 4 - Test a data point:** pick a sample (real test rows the model never trained on, or made-up
spikes) or type your own values. The decision is explained in four steps:

1. **The reading** - each value next to the router's normal (median) level.
2. **Check 1, hard limit** - one bar per metric: 0% = normal, red line at 100% = hard limit.
3. **Check 2, Isolation Forest** - how many random cuts the trees needed to isolate this reading,
   compared with a typical normal reading and the cut-off. Fewer cuts = more unusual.
4. **Final answer** - Check 1 OR Check 2 = Normal / Anomaly, plus what really happened (for real samples).

| Sample | Cuts (typical 15.2, cut-off 9.2) | Check 1 | Result |
|---|---|---|---|
| Normal reading on leaf3 / dr03 | about 16-17 | OK | Normal |
| Real faults (admin_down, fiber_pull, transceiver_pull) | 4.9-5.8 | OK | **Anomaly** (ML) |
| A fault the model misses | 16.9 | OK | Normal - honest example of a miss |
| Made up: CPU 95% | 9.6 (ML says normal!) | CPU at 1,155% of its limit | **Anomaly** (limit) |
| Made up: 100 interface errors | 10.7 | errors at 1,280% of limit | **Anomaly** (limit) |

## 7. How the detection works (for the presentation)

**Isolation Forest in 5 sentences**
1. Unusual points are *few* and *different*, so they are easy to separate from the rest.
2. The model builds 100 random trees. Each tree repeatedly picks a random metric and a random split
   value, cutting the data into smaller groups.
3. A normal reading looks like thousands of others, so it needs **many cuts** (about 15 here) before
   it is alone. A fault reading is alone after **a few cuts** (about 5).
4. The average number of cuts becomes the anomaly score; fewer cuts than the cut-off (9.2) = anomaly.
5. It is **unsupervised**: it never sees `scenario_label`. Labels are only used afterwards to check it.

`contamination = 5%` sets the cut-off so that the most unusual ~5% of training rows are anomalies.

**Per-router baseline:** routers are very different from each other (edge routers normally have 50+
unused ports down, spines have 0). Before training we subtract each router's own median (learned from
training rows), so the model sees *"how far is this router from its own normal"*. This raised F1 on the
test set from about 0.25 to 0.61.

**Rule 2, hard limit:** Isolation Forest only knows the range of values it was trained on. A value far
beyond that range (CPU 95% on a router that never went above 30%) is treated like the most extreme
training value, so on its own the model scored such spikes as normal. We therefore also flag any metric
more than 5 standard deviations beyond the router's training min/max. Real monitoring systems combine ML
with fixed thresholds in the same way. On the real data this rule adds only 1 flagged row.

**75/25 split:** rows are split randomly with the same share of faults in both parts (stratified).
A time-based split would not work: all faults happen between 10:15 and 10:50, so the last 25% of the
hour has no faults to test on.

**Important:** an anomaly means *statistically unusual*, not *failed*. Anomaly detection does not prove
that a router has failed; an engineer still has to investigate each alert.

**Why React + FastAPI and not Streamlit:** the project brief suggested Streamlit, which is quicker to
write but limits layout and chart design. Splitting into a Python API and a React frontend let us build
the step-by-step explanation views and use better chart libraries, while the ML code stays in plain
Python. A production system would more likely feed a monitoring platform such as Grafana.

## 8. Demonstration script (about 6 minutes)

1. **Problem (30 s):** "MPLS operators watch many routers. We want a tool that points out unusual
   behaviour automatically, running fully offline for secure, air-gapped networks."
2. **Data (60 s):** Tab 1. Public Cisco IOS-XR telemetry (Cisco Innovation Edge, Big-DAMA 2018),
   15 routers, one hour, 6 deliberate port faults. Read out the four observations; show the router
   bar chart - routers differ a lot, so each is compared with its own normal.
3. **Results (60 s):** Tab 2. 287 anomalies out of 5,400. Choose `spine2` + BGP peers down: red dots
   sit inside the grey fault bands. The anomaly table is almost all leaf3 and spine2.
4. **Evaluation (45 s):** Tab 3. "On data the model never trained on, it catches two thirds of fault
   readings, and only 2.9% of normal readings are false alarms." Move the slider to 10% to show the
   precision/recall trade-off.
5. **Live test (90 s):** Tab 4, walking through the 4 steps each time:
   - *Normal reading on leaf3*: all bars small, ~16 cuts, Normal.
   - *Real fault: admin_down*: no bar near the limit, but only ~6 cuts - the ML spots the unusual
     **combination**. Anomaly.
   - *Made up: CPU 95%*: the ML alone says normal (9.6 cuts), but the CPU bar shoots past the limit.
     That is why we added Rule 2.
   - Invite the instructor to type their own values.
6. **Limits and next steps (30 s):** recorded lab data, not live; no latency metric; minute-level
   labels. Next: live telemetry collector, latency probes, more fault types, then an offline LLM
   assistant that explains alerts in plain language.

## 9. Common errors and fixes

| Problem | Fix |
|---|---|
| `running scripts is disabled on this system` when activating | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `.\venv\Scripts\python.exe server.py` |
| `ModuleNotFoundError: No module named 'fastapi'` (or sklearn) | Activate the venv, then `pip install -r requirements.txt` |
| pip says no matching version for scikit-learn | Python is too old. Install Python 3.11+ |
| `data/router_metrics.csv not found` when starting the server | Run `prepare_cisco_data.py` (section 4) from the project folder |
| Browser shows `{"detail":"Not Found"}` at localhost:8000 | The dashboard is not built. Run `npm install` and `npm run build` in `frontend`, then restart the server |
| `'npm' is not recognized` | Install Node.js (LTS) from nodejs.org, then open a new terminal |
| Port 8000 already in use | Close the other server window, or change `port=8000` at the bottom of `server.py` |
| `CSV is missing required columns` after upload | The CSV needs: `timestamp, router_id, cpu_util_pct, mem_util_pct, bandwidth_util_pct, packet_loss_pct, interface_errors, interfaces_down, bgp_peers_down` (`scenario_label` optional) |
| Changes to React code do not show | Run `npm run build` again (or use `npm run dev` while developing) |
