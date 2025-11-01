/*
  Parking Dashboard Unified Script
  - Handles live monitoring (parking.html)
  - Handles AI Heatmap (heatmap.html)
  - Handles Day & Time Predictor (predictor.html)
*/

// ---------------- GLOBAL CONFIG ----------------
const config = {
    pollInterval: 5000, // ms
    endpoints: {
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
    },
    threshold: 30
};

// ---------------- HELPER FUNCTIONS ----------------
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

        const matched = txt.match(/-?\d+(\.\d+)?/);
        if (matched) return { ok: true, raw: txt, value: Number(matched[0]) };

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

// ---------------- PARKING PAGE LOGIC ----------------
async function initParking() {
    const ui = {
        lot1: document.getElementById('lot1'),
        lot1sub: document.getElementById('lot1-sub'),
        lot2: document.getElementById('lot2'),
        lot2sub: document.getElementById('lot2-sub'),
        lot3: document.getElementById('lot3'),
        lot3sub: document.getElementById('lot3-sub'),
        nopark: document.getElementById('nopark'),
        noparksub: document.getElementById('nopark-sub'),
        lastUpdate: document.getElementById('lastUpdate'),
        rawDump: document.getElementById('rawDump'),
        statusMsg: document.getElementById('statusMsg'),
        dotLed: document.getElementById('dotLed')
    };

    let lastLedState = null;
    let pollTimer = null;

    function setStatus(msg) { ui.statusMsg.textContent = 'Status: ' + msg; }

    function setLotState(lotEl, label, subText, isFree) {
        lotEl.classList.remove('free', 'occupied', 'nopark', 'blink');
        if (label) lotEl.querySelector('div').textContent = label;
        lotEl.querySelector('.sub').textContent = subText;
        if (isFree === true) lotEl.classList.add('free');
        else if (isFree === false) lotEl.classList.add('occupied');
    }

    function setNoParkViolation(violated, info) {
        const el = ui.nopark;
        const sub = ui.noparksub;
        sub.textContent = info;
        if (violated) {
            el.classList.add('blink', 'occupied');
            el.classList.remove('nopark');
        } else {
            el.classList.remove('blink', 'occupied');
            el.classList.add('nopark');
        }
    }

    async function setLed(desiredOn) {
        if (lastLedState === desiredOn) return;
        lastLedState = desiredOn;
        ui.dotLed.style.background = desiredOn ? 'var(--free)' : '#7c7c7c';
        try {
            const url = desiredOn ? config.endpoints.ledOn : config.endpoints.ledOff;
            const res = await fetch(url);
            if (!res.ok) setStatus('LED write error: ' + res.status);
            else setStatus(desiredOn ? 'LED turned ON' : 'LED turned OFF');
        } catch (e) {
            setStatus('LED write failed');
        }
    }

    async function pollAll() {
        setStatus('Polling sensors...');
        const started = Date.now();

        const promises = {
            d1: fetchAndParse(config.endpoints.distance1),
            i1: fetchAndParse(config.endpoints.ir1),
            d2: fetchAndParse(config.endpoints.distance2),
            i2: fetchAndParse(config.endpoints.ir2),
            d3: fetchAndParse(config.endpoints.distance3),
            i3: fetchAndParse(config.endpoints.ir3),
            dx: fetchAndParse(config.endpoints.distanceX1),
            ix: fetchAndParse(config.endpoints.irX1)
        };

        const results = {};
        for (const k of Object.keys(promises)) results[k] = await promises[k];
        ui.rawDump.textContent = JSON.stringify(results, null, 2);
        ui.lastUpdate.textContent = new Date().toLocaleString();

        const val = (r) => (r && r.ok && typeof r.value === 'number') ? r.value : null;

        const d1 = val(results.d1), ir1 = val(results.i1);
        const lot1Free = (d1 !== null && d1 > config.threshold) && (ir1 === 1);

        const d2 = val(results.d2), ir2 = val(results.i2);
        const lot2Free = (d2 !== null && d2 > config.threshold) && (ir2 === 1);

        const d3 = val(results.d3), ir3 = val(results.i3);
        const lot3Free = (d3 !== null && d3 > config.threshold) && (ir3 === 1);

        const dx = val(results.dx), irx = val(results.ix);
        const violated = (dx !== null && dx < config.threshold) || (irx === 0);

        setLotState(ui.lot1, 'Lot 1', `Dist: ${d1 ?? 'NA'} | IR: ${ir1 ?? 'NA'}`, lot1Free);
        setLotState(ui.lot2, 'Lot 2', `Dist: ${d2 ?? 'NA'} | IR: ${ir2 ?? 'NA'}`, lot2Free);
        setLotState(ui.lot3, 'Lot 3', `Dist: ${d3 ?? 'NA'} | IR: ${ir3 ?? 'NA'}`, lot3Free);
        setNoParkViolation(violated, `Dist: ${dx ?? 'NA'} | IR: ${irx ?? 'NA'}`);

        await setLed(violated);
        setStatus('Updated (' + (Date.now() - started) + 'ms)');
    }

    document.getElementById('refreshBtn')?.addEventListener('click', pollAll);
    document.getElementById('intervalSelect')?.addEventListener('change', e => {
        config.pollInterval = Number(e.target.value);
        clearInterval(pollTimer);
        pollTimer = setInterval(pollAll, config.pollInterval);
    });

    pollAll();
    pollTimer = setInterval(pollAll, config.pollInterval);
}

// ---------------- HEATMAP PAGE ----------------
async function initHeatmap() {
    const ctx = document.getElementById('occupancyHeatmap')?.getContext('2d');
    if (!ctx) return;

    const res = await fetch('/api/heatmap');
    const data = await res.json();
    const labels = [...Array(24).keys()].map(h => `${h}:00`);

    new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: Object.entries(data).map(([slot, values]) => ({
                label: slot,
                data: values,
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }))
        },
        options: {
            responsive: true,
            plugins: {
                title: { display: true, text: 'Predicted Occupancy (Next 24 Hours)' },
                legend: { position: 'bottom' }
            },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Occupancy %' } },
                x: { title: { display: true, text: 'Hour of Day' } }
            }
        }
    });
}

// ---------------- PREDICTOR PAGE ----------------
async function initPredictor() {
    const res = await fetch('/api/heatmap');
    const data = await res.json();
    const slots = Object.keys(data);
    const output = document.getElementById('predictResult');
    const timeInput = document.getElementById('predictTime');
    const dayInput = document.getElementById('predictDay');

    function calcPrediction() {
        const hour = Number(timeInput.value);
        const day = dayInput.value;
        const isWeekend = ['sat', 'sun'].includes(day.toLowerCase());
        const avg = Object.values(data).map(v => v[hour]).reduce((a, b) => a + b, 0) / slots.length;
        output.textContent = `Expected Occupancy at ${hour}:00 on ${day.toUpperCase()} — ${avg.toFixed(1)}%`;
    }

    document.getElementById('predictBtn')?.addEventListener('click', calcPrediction);
}

// ---------------- PAGE DETECTION ----------------
document.addEventListener('DOMContentLoaded', () => {
    if (document.body.classList.contains('page-parking')) initParking();
    else if (document.body.classList.contains('page-heatmap')) initHeatmap();
    else if (document.body.classList.contains('page-predictor')) initPredictor();
});
