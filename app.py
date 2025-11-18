from flask import Flask, render_template, jsonify, request
import os
import pandas as pd
import numpy as np
from datetime import datetime
import requests

app = Flask(__name__)

# ---------- ENV VARS ----------
@app.context_processor
def inject_env():
    return dict(
        IOT_BASE_URL=os.environ.get("IOT_BASE_URL", "https://iot.roboninja.in/index.php?action"),
        DEVICE_UID=os.environ.get("DEVICE_UID", "PR10")
    )

# ---------- SLOT CONFIG ----------
slots = {
    "slot1": {"status": "empty"},
    "slot2": {"status": "empty"},
    "slot3": {"status": "empty"},
}

# ---------- DATA LOGGING ----------
def get_history(field):
    try:
        url = f"https://iot.roboninja.in/index.php?action=read_history&UID=PR10&field={field}"
        r = requests.get(url, timeout=5)
        data = r.json()
        return data.get("result", [])
    except Exception as e:
        print("History fetch error:", e)
        return []

# ---------- ROUTES ----------
@app.route("/")
def parking_page():
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

    return jsonify({"ok": True})

@app.route("/predictor-data")
def predictor_data():
    return jsonify({
        "Distance1": get_history("Distance1"),
        "Distance2": get_history("Distance2"),
        "Distance3": get_history("Distance3"),
        "DistanceX1": get_history("DistanceX1")
    })

@app.route("/heatmap_data")
def heatmap_data():
    UID = "PR10"
    slots = ["Distance1", "Distance2", "Distance3", "DistanceX1"]

    final_data = {}

    for slot in slots:
        url = f"https://iot.roboninja.in/index.php?action=read_history&UID={UID}&field={slot}"

        try:
            r = requests.get(url, timeout=5)
            history = r.json()    # list of {"value": "...", "timestamp": "..."}
        except:
            # If API fails → return empty 24hrs
            final_data[slot] = [0]*24
            continue

        # Create empty counters for each hour
        hour_counts = [0]*24
        hour_total = [0]*24

        OCC_THRESHOLD = 30  # cm distance → slot occupied

        for entry in history:
            try:
                dist = float(entry["value"])
                ts = datetime.strptime(entry["timestamp"], "%Y-%m-%d %H:%M:%S")
                hr = ts.hour

                hour_total[hr] += 1
                if dist < OCC_THRESHOLD:
                    hour_counts[hr] += 1
            except:
                continue

        # Convert to % occupancy per hour
        hourly_percent = [
            int((hour_counts[h] / hour_total[h]) * 100) if hour_total[h] > 0 else 0
            for h in range(24)
        ]

        final_data[slot] = hourly_percent

    return jsonify(final_data)

# Debug code
@app.route("/test_api")
def test_api():
    import requests
    try:
        url = "https://iot.roboninja.in/index.php?action=read_history&UID=PR10&field=Distance2"
        r = requests.get(url, timeout=5)
        return r.text
    except Exception as e:
        return str(e)


# ---------- HEATMAP PAGE ----------
def build_heatmap():
    fields = ["Distance1", "Distance2", "Distance3", "DistanceX1"]
    heatmap = {}

    for field in fields:
        data = get_history(field)   # <--- Using your IoT API
        points = []
        for row in data:
            try:
                t = datetime.fromtimestamp(int(row["timestamp"]))
                points.append({
                    "value": float(row["value"]),
                    "hour": t.hour,
                    "weekday": t.weekday()
                })
            except:
                pass
        heatmap[field] = points
    return heatmap


# ---------- PREDICTOR PAGE ----------
@app.route("/predictor", methods=["GET", "POST"])
def predictor_page():
    df = load_logs()
    prediction = None
    chosen_day = None
    chosen_hour = None

    if request.method == "POST" and not df.empty:
        chosen_day = request.form.get("day")
        chosen_hour = int(request.form.get("hour"))
        df["day"] = df["time_entered"].dt.day_name()
        df["hour"] = df["time_entered"].dt.hour

        recency_weight = 0.7
        recent_df = df.tail(200)

        mean_recent = recent_df[(recent_df["day"] == chosen_day) & (recent_df["hour"] == chosen_hour)]["duration_sec"].mean()
        mean_all = df[(df["day"] == chosen_day) & (df["hour"] == chosen_hour)]["duration_sec"].mean()

        if pd.isna(mean_recent): mean_recent = 0
        if pd.isna(mean_all): mean_all = 0

        prediction = round((recency_weight * mean_recent + (1 - recency_weight) * mean_all) / 60, 2)

    return render_template("predictor.html", prediction=prediction, day=chosen_day, hour=chosen_hour)

# ---------- RAW JSON HEATMAP API (for JS) ----------
@app.route("/heatmap_data")
def heatmap_json():
    return jsonify(build_heatmap())

# ---------- MAIN ----------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
