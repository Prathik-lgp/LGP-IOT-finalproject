from flask import Flask, render_template, jsonify, request
import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

app = Flask(__name__)

# ---------- ENV VARS ----------
@app.context_processor
def inject_env():
    return dict(
        IOT_BASE_URL=os.environ.get("IOT_BASE_URL", "https://iot.roboninja.in/index.php?action"),
        DEVICE_UID=os.environ.get("DEVICE_UID", "PR10")
    )

# ---------- SLOT CONFIG ----------
# Add more slots here any time — automatically handled by logger + predictor
slots = {
    "slot1": {"status": "empty"},
    "slot2": {"status": "empty"},
    "slot3": {"status": "empty"},
}

# ---------- DATA LOGGING ----------
log_file = "parking_log.csv"

def ensure_log_exists():
    if not os.path.exists(log_file):
        pd.DataFrame(columns=["slot_id", "time_entered", "time_left", "duration_sec"]).to_csv(log_file, index=False)
ensure_log_exists()

active_parking = {}

def log_entry(slot_id):
    active_parking[slot_id] = datetime.now()

def log_exit(slot_id):
    if slot_id in active_parking:
        t_enter = active_parking.pop(slot_id)
        t_exit = datetime.now()
        duration = (t_exit - t_enter).total_seconds()
        new_row = pd.DataFrame([{
            "slot_id": slot_id,
            "time_entered": t_enter,
            "time_left": t_exit,
            "duration_sec": duration
        }])
        new_row.to_csv(log_file, mode='a', header=False, index=False)

# ---------- AI PREDICTION ENGINE ----------
def load_logs():
    df = pd.read_csv(log_file)
    if df.empty: return df
    df["time_entered"] = pd.to_datetime(df["time_entered"])
    df["hour"] = df["time_entered"].dt.hour
    df["weekday"] = df["time_entered"].dt.weekday  # 0 = Mon, 6 = Sun
    df["is_weekend"] = df["weekday"] >= 5
    return df

def predict_occupancy():
    df = load_logs()
    if df.empty:
        return {slot: [0]*24 for slot in slots.keys()}

    now = datetime.now()
    preds = {}
    for slot_id in slots.keys():
        slot_data = df[df["slot_id"] == slot_id]
        if slot_data.empty:
            preds[slot_id] = [0]*24
            continue

        slot_data = slot_data.sort_values("time_entered")
        slot_data["duration_min"] = slot_data["duration_sec"] / 60

        # Apply recency weight — newer entries count more
        slot_data["weight"] = np.linspace(0.5, 1.0, len(slot_data))

        # Group by hour & weekend status
        is_weekend = now.weekday() >= 5
        group = slot_data[slot_data["is_weekend"] == is_weekend].groupby("hour")["duration_min"].mean()

        # Predict occupancy % for each hour
        avg_dur = group.reindex(range(24), fill_value=0)
        norm = avg_dur / avg_dur.max() if avg_dur.max() > 0 else avg_dur
        preds[slot_id] = np.round(norm * 100, 1).tolist()
    return preds

# ---------- ROUTES ----------
@app.route("/")
def index():
    return render_template("parking.html")

@app.route("/update_status", methods=["POST"])
def update_status():
    data = request.json
    slot_id = data["slot_id"]
    status = data["status"]

    if slot_id not in slots:
        return jsonify({"error": "Invalid slot"}), 400

    prev_status = slots[slot_id]["status"]
    slots[slot_id]["status"] = status

    if prev_status == "empty" and status == "occupied":
        log_entry(slot_id)
    elif prev_status == "occupied" and status == "empty":
        log_exit(slot_id)

    return jsonify({"ok": True})

@app.route("/heatmap")
def heatmap():
    preds = predict_occupancy()
    return jsonify(preds)

# ---------- MAIN ----------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
