from flask import Flask, render_template
import os

app = Flask(__name__)

# Inject env vars into templates
@app.context_processor
def inject_env():
    return dict(
        IOT_BASE_URL=os.environ.get("IOT_BASE_URL", "https://iot.roboninja.in/index.php?action"),
        DEVICE_UID=os.environ.get("DEVICE_UID", "PR10")
    )

@app.route("/")
def index():
    return render_template("parking.html")

if __name__ == "__main__":
    app.run(debug=True)
