/* main.js
   Unified dashboard JS: live sensors, heatmap, predictor.
   - Reads env injected into window.IOT_BASE_URL and window.DEVICE_UID (fallback to hard-coded)
   - Polls sensors and updates UI
   - Controls LED D1 only when violation state changes
   - Renders heatmap chart from /heatmap_data
*/

(function () {
    // --- config: base + uid (prefer injected env, fallback to official URLs) ---
    const injectedBase = (window.IOT_BASE_URL && window.IOT_BASE_URL.length) ? window.IOT_BASE_URL.trim() : "";
    const injectedUid = (window.DEVICE_UID && window.DEVICE_UID.length) ? window.DEVICE_UID.trim() : "";

    // If injected env looks like the exact "https://iot.roboninja.in/index.php?action" format, use it.
    // Otherwise fall back to hardcoded base and UID.
    const base = injectedBase || "https://iot.roboninja.in/index.php?action";
    const uid = injectedUid || "PR10";

    const endpoints = {
        distance1: `${base}=read&UID=${uid}&Distance1`,
        ir1: `${base}=read&UID=${uid}&D7`,

        distance2: `${base}=read&UID=${uid}&Distance2`,
        ir2: `${base}=read&UID=${uid}&D2`,

        distance3: `${base}=read&UID=${uid}&Distance3`,
        ir3: `${base}=read&UID=${uid}&D3`,

        distanceX1: `${base}=read&UID=${uid}&DistanceX1`,
        irX1: `${base}=read&UID=${uid}&D4`,

        ledOn: `${base}=write&UID=${uid}&D1=1`,
        ledOff: `${base}=write&UID=${uid}&D1=0`
    };

    // Poll interval
    let pollInterval = 5000;

    // Helper: parse response (JSON or plain text containing number)
    async function fetchAndParse(url) {
        try {
            const res = await fetch(url, { cache: 'no-store' });
            const txt = await res.text();
            // try JSON
            try {
                const j = JSON.parse(txt);
                const val = findFirstNumberInObject(j);
                if (val !== null) return { ok: true, raw: txt, value: val };
            } catch (e) { }
            // fallback to first numeric token
            const m = txt.match(/-?\d+(\.\d+)?/);
            if (m) return { ok: true, raw: txt, value: Number(m[0]) };
            const trimmed = txt.trim();
            if (trimmed === '0' || trimmed === '1') return { ok: true, raw: txt, value: Number(trimmed) };
            return { ok: false, raw: txt, value: null, error: 'no number found' };
        } catch (err) {
            return { ok: false, raw: String(err), value: null, error: err.message };
        }
    }

    function findFirstNumberInObject(obj) {
        if (obj == null) return null;
        if (typeof obj === 'number') return obj;
        if (typeof obj === 'string') {
            const m = obj.match(/-?\d+(\.\d+)?/);
            return m ? Number(m[0]) : null;
        }
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const v = findFirstNumberInObject(item);
                if (v !== null) return v;
            }
            return null;
        }
        if (typeof obj === 'object') {
            for (const k of Object.keys(obj)) {
                const v = findFirstNumberInObject(obj[k]);
                if (v !== null) return v;
            }
        }
        return null;
    }

    // UI elements
    const ui = {
        slot1: document.getElementById('slot1'),
        slot1sub: document.getElementById('slot1-sub'),
        slot2: document.getElementById('slot2'),
        slot2sub: document.getElementById('slot2-sub'),
        slot3: document.getElementById('slot3'),
        slot3sub: document.getElementById('slot3-sub'),
        nopark: document.getElementById('nopark'),
        noparksub: document.getElementById('nopark-sub'),
        lastUpdate: document.getElementById('lastUpdate'),
        rawDump: document.getElementById('rawDump'),
        statusMsg: document.getElementById('statusMsg'),
        dotLed: document.getElementById('dotLed'),
        refreshBtn: document.getElementById('refreshBtn'),
        intervalSelect: document.getElementById('intervalSelect')
    };

    // Internal state
    let lastLedState = null; // true -> LED ON
    let pollTimer = null;

    function setStatus(msg) {
        if (ui.statusMsg) ui.statusMsg.textContent = 'Status: ' + msg;
    }

    function setLotState(lotEl, subEl, label, isFree) {
        lotEl.classList.remove('free', 'occupied', 'nopark', 'blink');
        if (label) lotEl.querySelector('div').textContent = label;
        if (subEl) subEl.textContent = (typeof isFree === 'boolean') ? (isFree ? 'Free' : 'Occupied') : subEl.textContent;
        if (isFree === true) lotEl.classList.add('free');
        else if (isFree === false) lotEl.classList.add('occupied');
    }

    function setNoParkViolation(violated, info) {
        const el = ui.nopark;
        const sub = ui.noparksub;
        if (sub) sub.textContent = info;
        if (violated) {
            el.classList.add('blink', 'occupied');
            el.classList.remove('nopark');
        } else {
            el.classList.remove('blink', 'occupied');
            el.classList.add('nopark');
        }
    }

    // Toggle LED (only when desired changes)
    async function setLed(desiredOn) {
        if (lastLedState === desiredOn) return;
        lastLedState = desiredOn;
        if (ui.dotLed) ui.dotLed.style.background = desiredOn ? 'var(--free)' : '#7c7c7c';
        const url = desiredOn ? endpoints.ledOn : endpoints.ledOff;
        try {
            const r = await fetch(url);
            if (!r.ok) setStatus('LED write error: ' + r.status);
            else setStatus(desiredOn ? 'LED turned ON' : 'LED turned OFF');
        } catch (e) {
            setStatus('LED write failed');
            console.warn('LED write failed', e);
        }
    }

    // Core poller: fetch all sensors in parallel, update UI & LED
    async function pollAll() {
        setStatus('Polling sensors...');
        const started = Date.now();

        const promises = {
            d1: fetchAndParse(endpoints.distance1),
            i1: fetchAndParse(endpoints.ir1),
            d2: fetchAndParse(endpoints.distance2),
            i2: fetchAndParse(endpoints.ir2),
            d3: fetchAndParse(endpoints.distance3),
            i3: fetchAndParse(endpoints.ir3),
            dx: fetchAndParse(endpoints.distanceX1),
            ix: fetchAndParse(endpoints.irX1)
        };

        const results = {};
        for (const k of Object.keys(promises)) results[k] = await promises[k];

        // show raw JSON for debugging
        if (ui.rawDump) ui.rawDump.textContent = JSON.stringify(results, null, 2);
        if (ui.lastUpdate) ui.lastUpdate.textContent = new Date().toLocaleString();

        const val = (r) => (r && r.ok && typeof r.value === 'number') ? r.value : null;

        // interpret each lot
        const distance1 = val(results.d1);
        const ir1 = val(results.i1);
        const lot1Free = (distance1 !== null && distance1 > 30) && (ir1 === 1);

        const distance2 = val(results.d2);
        const ir2 = val(results.i2);
        const lot2Free = (distance2 !== null && distance2 > 30) && (ir2 === 1);

        const distance3 = val(results.d3);
        const ir3 = val(results.i3);
        const lot3Free = (distance3 !== null && distance3 > 30) && (ir3 === 1);

        // no-parking violation condition
        const distanceX = val(results.dx);
        const irX = val(results.ix);
        const violated = (distanceX !== null && distanceX < 30) || (irX === 0);

        // update UI
        setLotState(ui.slot1, ui.slot1sub, 'Lot 1', lot1Free);
        setLotState(ui.slot2, ui.slot2sub, 'Lot 2', lot2Free);
        setLotState(ui.slot3, ui.slot3sub, 'Lot 3', lot3Free);

        setNoParkViolation(violated, `Dist: ${distanceX === null ? 'NA' : distanceX} | IR: ${irX === null ? 'NA' : irX}`);

        // LED control
        await setLed(violated ? true : false);

        setStatus('Updated (' + (Date.now() - started) + 'ms)');
    }

    // Start / stop poller
    function startPoller() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(pollAll, pollInterval);
        // run immediately
        pollAll();
    }
    function stopPoller() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

    // Hook UI controls
    function bindUI() {
        ui.refreshBtn?.addEventListener('click', pollAll);
        ui.intervalSelect?.addEventListener('change', (e) => {
            pollInterval = Number(e.target.value);
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = setInterval(pollAll, pollInterval);
            }
        });
    }

    // ---------------- Heatmap rendering (Chart.js) ----------------
    async function loadHeatmapChart() {
        const canvas = document.getElementById('occupancyHeatmap');
        if (!canvas) return;
        // fetch JSON from server endpoint /heatmap_data
        try {
            const res = await fetch('/heatmap_data');
            const json = await res.json();
            const labels = [...Array(24).keys()].map(h => `${h}:00`);
            const datasets = Object.entries(json).map(([slot, arr], idx) => ({
                label: slot,
                data: arr,
                borderWidth: 2,
                fill: true,
                tension: 0.25,
                backgroundColor: `rgba(${(idx * 60) % 255}, ${(idx * 110) % 255}, ${(idx * 190) % 255}, 0.25)`,
                borderColor: `rgba(${(idx * 60) % 255}, ${(idx * 110) % 255}, ${(idx * 190) % 255}, 0.9)`
            }));

            new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: { labels, datasets },
                options: {
                    responsive: true,
                    plugins: { legend: { position: 'bottom' }, title: { display: false } },
                    scales: { y: { beginAtZero: true, title: { display: true, text: 'Occupancy %' } } }
                }
            });
        } catch (e) {
            console.warn('Heatmap load failed', e);
        }
    }

    // ---------------- Predictor UI (ML API version) ----------------
    function bindPredictor() {
        const btn = document.getElementById('predictBtn');
        const out = document.getElementById('predictResult');

        btn?.addEventListener('click', async (e) => {
            e.preventDefault();

            const slot = document.getElementById("predictSlot").value;
            const hour = Number(document.getElementById("predictTime").value);
            const dayName = document.getElementById("predictDay").value;

            // convert weekday name → index
            const weekdayMap = {
                "Monday": 0,
                "Tuesday": 1,
                "Wednesday": 2,
                "Thursday": 3,
                "Friday": 4,
                "Saturday": 5,
                "Sunday": 6
            };
            const weekday = weekdayMap[dayName];

            try {
                const res = await fetch('/predictor', {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ slot, hour, weekday })
                });

                const data = await res.json();

                if (data.prediction !== undefined) {
                    out.textContent = `Predicted occupancy: ${data.prediction}%`;
                } else {
                    out.textContent = "Prediction failed (no data)";
                }

            } catch (err) {
                out.textContent = "Prediction failed";
            }
        });
    }



    // ---------------- init ----------------
    function init() {
        bindUI();
        bindPredictor();
        startPoller();
        loadHeatmapChart();
    }

    // run once DOM is ready
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();
