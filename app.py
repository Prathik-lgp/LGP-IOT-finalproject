from flask import Flask, render_template, jsonify, request
import os
import pandas as pd
import numpy as np
from datetime import datetime
import requests
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

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
def get_history(slot):
    url = f"https://iot.roboninja.in/index.php?action=read_history&UID=PR10&field={slot}" 
    try:
        r = requests.get(url, timeout=5)
        return r.json()
    except:
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
def predictor_json():
    return jsonify({
        "Distance1": get_history("Distance1"),
        "Distance2": get_history("Distance2"),
        "Distance3": get_history("Distance3"),
        "DistanceX1": get_history("DistanceX1")
    })

@app.route("/heatmap_data")
def heatmap_data():
    slots = ["Distance1", "Distance2", "Distance3", "DistanceX1"]
    result = {}

    for slot in slots:
        url = f"https://iot.roboninja.in/index.php?action=read_history&UID=PR10&field={slot}"
        try:
            r = requests.get(url, timeout=5)
            records = r.json()
        except:
            result[slot] = [0] * 24
            continue

        hourly_buckets = {h: [] for h in range(24)}

        for row in records:
            ts = row.get("Timestamp")
            value = row.get("Value")

            try:
                dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
                hour = dt.hour
                val = float(value)
                hourly_buckets[hour].append(val)
            except:
                pass

        # build final 24-hour vector
        hourly_avg = []
        for h in range(24):
            vals = hourly_buckets[h]
            if len(vals) == 0:
                hourly_avg.append(0)          # no data → 0
            else:
                hourly_avg.append(sum(vals) / len(vals))

        result[slot] = hourly_avg

    return jsonify(result)

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

def build_ml_dataset():
    slots = ["Distance1", "Distance2", "Distance3", "DistanceX1"]
    rows = []

    for slot in slots:
        data = get_history(slot)

        for entry in data:
            ts = entry.get("Timestamp")
            val = entry.get("Value")

            try:
                dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
                dist = float(val)

                rows.append({
                    "slot": slot,
                    "hour": dt.hour,
                    "weekday": dt.weekday(),
                    "value": dist,
                    "occupied": 1 if dist < 20 else 0    # tune this threshold later
                })
            except:
                pass

    if len(rows) == 0:
        return pd.DataFrame()

    return pd.DataFrame(rows)

def train_predictor_model():
    df = build_ml_dataset()
    if df.empty:
        return None

    # One-hot encode the slot name
    df_encoded = pd.get_dummies(df, columns=["slot"])

    X = df_encoded.drop("occupied", axis=1)
    y = df_encoded["occupied"]

    model = RandomForestClassifier(n_estimators=80)
    model.fit(X, y)

    return model, df_encoded

def predict_future(slot, hour, weekday, guess_distance=15):
    model_data = train_predictor_model()
    if model_data is None:
        return "Not enough training data"

    model, df_encoded = model_data

    # Build an input row with all dummy columns = 0 except selected one
    input_row = {
        "hour": hour,
        "weekday": weekday,
        "value": guess_distance,
    }

    for c in df_encoded.columns:
        if c.startswith("slot_"):
            input_row[c] = 1 if c == f"slot_{slot}" else 0

    X_new = pd.DataFrame([input_row])

    prob = model.predict_proba(X_new)[0][1]
    return round(prob * 100, 1)

# ---------- PREDICTOR PAGE ----------
@app.route("/predictor", methods=["GET", "POST"])
def predictor_page():
    prediction = None
    fields = ["Distance1", "Distance2", "Distance3", "DistanceX1"]

    if request.method == "POST":
        slot = request.form.get("slot")
        hour = int(request.form.get("hour"))
        weekday = int(request.form.get("weekday"))

        prediction = predict_future(slot, hour, weekday)

    return jsonify({"prediction": prediction})


# ---------- RAW JSON HEATMAP API (for JS) ----------
@app.route("/heatmap_data")
def heatmap_json():
    return jsonify(build_heatmap())

# ---------- MAIN ----------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
