/*
  Dashboard script:
  - Polls ultrasound and IR APIs for 3 parking lots + no-park zone.
  - Decides Free/Occupied per lot using rules:
      Free if distance > 30 AND IR == 1
      Occupied otherwise
  - No-parking zone: violated if distance < 30 OR IR == 0
    If violated -> add blink, set D1=1 using write API. Else set D1=0.
  - LED write calls are sent only when desired state changes (prevents spam).
  - Robust parsing: tries JSON first, else extracts first numeric token.
*/

const config = {

    pollInterval: 5000, // default (ms)
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


// helper: try to parse response (json or plain). Return first numeric token or raw trimmed string.
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

/* state */
let lastLedState = null; // true => LED ON (D1=1), false => OFF
let pollTimer = null;

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

function setStatus(msg) {
    ui.statusMsg.textContent = 'Status: ' + msg;
}

function setLotState(lotEl, label, subText, isFree) {
    lotEl.classList.remove('free', 'occupied');
    lotEl.classList.remove('nopark', 'blink');
    if (label) lotEl.querySelector('div').textContent = label;
    lotEl.querySelector('.sub').textContent = subText;
    if (isFree === true) {
        lotEl.classList.add('free');
        lotEl.style.color = '';
    } else if (isFree === false) {
        lotEl.classList.add('occupied');
    }
}

function setNoParkViolation(violated, info) {
    const el = ui.nopark;
    const sub = ui.noparksub;
    sub.textContent = info;
    if (violated) {
        el.classList.add('blink');
        el.classList.remove('nopark');
        el.classList.add('occupied');
    } else {
        el.classList.remove('blink');
        el.classList.remove('occupied');
        el.classList.add('nopark');
    }
}

// call LED toggle endpoint, but only when desired != lastLedState
async function setLed(desiredOn) {
    if (lastLedState === desiredOn) return;
    lastLedState = desiredOn;
    ui.dotLed.style.background = desiredOn ? 'var(--free)' : '#7c7c7c';
    try {
        const url = desiredOn ? config.endpoints.ledOn : config.endpoints.ledOff;
        const res = await fetch(url);
        if (!res.ok) {
            console.warn('LED write returned non-ok', res.status);
            setStatus('LED write error: ' + res.status);
        } else {
            setStatus(desiredOn ? 'LED turned ON' : 'LED turned OFF');
        }
    } catch (e) {
        console.warn('LED write failed', e);
        setStatus('LED write failed');
    }
}

// main poller
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
    for (const k of Object.keys(promises)) {
        results[k] = await promises[k];
    }

    ui.rawDump.textContent = JSON.stringify(results, replacer, 2);
    ui.lastUpdate.textContent = new Date().toLocaleString();

    const val = (r) => (r && r.ok && typeof r.value === 'number') ? r.value : null;

    const distance1 = val(results.d1);
    const ir1 = val(results.i1);
    const lot1Free = (distance1 !== null && distance1 > config.threshold) && (ir1 === 1);

    const distance2 = val(results.d2);
    const ir2 = val(results.i2);
    const lot2Free = (distance2 !== null && distance2 > config.threshold) && (ir2 === 1);

    const distance3 = val(results.d3);
    const ir3 = val(results.i3);
    const lot3Free = (distance3 !== null && distance3 > config.threshold) && (ir3 === 1);

    const distanceX = val(results.dx);
    const irX = val(results.ix);
    const violated = (distanceX !== null && distanceX < config.threshold) || (irX === 0);

    setLotState(ui.lot1, 'Lot 1', `Dist: ${distance1 === null ? 'NA' : distance1} | IR: ${ir1 === null ? 'NA' : ir1}`, lot1Free);
    setLotState(ui.lot2, 'Lot 2', `Dist: ${distance2 === null ? 'NA' : distance2} | IR: ${ir2 === null ? 'NA' : ir2}`, lot2Free);
    setLotState(ui.lot3, 'Lot 3', `Dist: ${distance3 === null ? 'NA' : distance3} | IR: ${ir3 === null ? 'NA' : ir3}`, lot3Free);

    setNoParkViolation(violated, `Dist: ${distanceX === null ? 'NA' : distanceX} | IR: ${irX === null ? 'NA' : irX}`);

    await setLed(violated ? true : false);

    const took = Date.now() - started;
    setStatus('Updated (' + (took) + 'ms)');
}

function replacer(k, v) { return v; }

document.getElementById('refreshBtn').addEventListener('click', () => { pollAll(); });
document.getElementById('intervalSelect').addEventListener('change', (e) => {
    config.pollInterval = Number(e.target.value);
    restartPoller();
});

function startPoller() {
    stopPoller();
    pollTimer = setInterval(pollAll, config.pollInterval);
    pollAll();
}

function stopPoller() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function restartPoller() { stopPoller(); startPoller(); }

startPoller();
window._parkingDashboard = { pollAll, startPoller, stopPoller, config };
