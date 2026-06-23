/* ============================================================
   SCADA ENGINE v6.0 — Enterprise with History Module
   ============================================================ */

// ─── GLOBAL STATE ───────────────────────────────────────────
const machineCharts = {};
const prevValues = {};
const MAX_PTS = 25;
let startTime = new Date();

// History Module State
let masterHistoryChart = null;
let rawHistoryData = {};
let masterMachineList = [];

// ─── LIVE CLOCK & UPTIME ─────────────────────────────────────
function tickClock() {
    const now = new Date();
    const cl = document.getElementById('live-clock');
    if (cl) cl.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
    
    if (startTime) {
        const s = Math.floor((now - startTime) / 1000);
        const h = String(Math.floor(s / 3600)).padStart(2,'0');
        const m = String(Math.floor((s % 3600) / 60)).padStart(2,'0');
        const sc= String(s % 60).padStart(2,'0');
        const up = document.getElementById('uptime-counter');
        if (up) up.textContent = `${h}:${m}:${sc}`;
    }
}
setInterval(tickClock, 1000);
document.addEventListener('DOMContentLoaded', tickClock);

// ─── UTILITIES & ANIMATIONS ─────────────────────────────────
function animateValue(el, from, to, ms, dp = 1) {
    if (!el) return;
    if (isNaN(from) || isNaN(to)) { el.textContent = isNaN(to) ? '---' : to.toFixed(dp); return; }
    const diff = to - from;
    if (Math.abs(diff) < 0.005) { el.textContent = to.toFixed(dp); return; }
    const t0 = performance.now();
    function tick(now) {
        const p = Math.min((now - t0) / ms, 1);
        el.textContent = (from + diff * (1 - Math.pow(1 - p, 3))).toFixed(dp);
        if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ─── GAUGE BUILDERS ─────────────────────────────────────────
function buildTicks() {
    let s = '';
    for (let i = 0; i <= 10; i++) {
        const ang = Math.PI + (Math.PI * i / 10);
        const major = i % 5 === 0;
        const r0 = major ? 38 : 41;
        const r1 = 45;
        s += `<line x1="${(60 + r0 * Math.cos(ang)).toFixed(1)}" y1="${(56 + r0 * Math.sin(ang)).toFixed(1)}" x2="${(60 + r1 * Math.cos(ang)).toFixed(1)}" y2="${(56 + r1 * Math.sin(ang)).toFixed(1)}" class="${major ? 'gauge-tick-major' : 'gauge-tick'}" />`;
    }
    return s;
}

function makeSVG(id) {
    return `
    <svg viewBox="0 0 120 72" class="industrial-gauge">
      <defs>
        <linearGradient id="gGrad-${id}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#006FAD"/><stop offset="100%" stop-color="#008FD5"/>
        </linearGradient>
      </defs>
      ${buildTicks()}
      <path class="gauge-track" d="M 16 56 A 44 44 0 0 1 104 56"/>
      <path class="gauge-fill" id="gauge-${id}" d="M 16 56 A 44 44 0 0 1 104 56" stroke="url(#gGrad-${id})" stroke-dasharray="0,138.23"/>
      <text x="60" y="51" class="gauge-value" id="i-${id}">0</text>
      <text x="60" y="61" class="gauge-unit">CURRENT (A)</text>
      <text x="17" y="68" class="gauge-range-label" text-anchor="start">0</text>
      <text x="103" y="68" class="gauge-range-label" text-anchor="end">3000</text>
    </svg>`;
}

function setGauge(id, ampere) {
    const pct = Math.min(ampere / 3000, 1);
    const len = (pct * 138.23).toFixed(2);
    const el = document.getElementById(`gauge-${id}`);
    if (el) el.setAttribute('stroke-dasharray', `${len},138.23`);
}

// ─── HTML PANEL TEMPLATE ────────────────────────────────────
function getPanelHTML(m) {
    return `
    <div class="machine-panel online" id="panel-${m.id}" style="--delay:${(m.id * 0.05).toFixed(2)}s">
        <div class="panel-status-bar" id="sbar-${m.id}"></div>
        <div class="panel-header">
            <div class="panel-title-group">
                <span class="status-led online" id="led-${m.id}"></span>
                <h2 class="machine-name">${m.name}</h2>
            </div>
            <div class="panel-badges">
                <span class="device-id">UNIT ${m.id}</span>
                <span class="status-badge online" id="badge-${m.id}">ONLINE</span>
            </div>
        </div>
        <div class="panel-body">
            <div class="data-column">
                <div class="data-row"><span class="data-label">Voltage L1</span><div class="data-value-group"><span class="data-value" id="v-${m.id}">---</span><span class="data-unit">V</span></div></div>
                <div class="data-bar"><div class="data-bar-fill bar-voltage" id="vbar-${m.id}" style="width:0"></div></div>
                
                <div class="data-row"><span class="data-label">Power Factor</span><div class="data-value-group"><span class="data-value" id="pf-${m.id}">---</span></div></div>
                <div class="data-bar"><div class="data-bar-fill bar-pf" id="pfbar-${m.id}" style="width:0"></div></div>
                
                <div class="data-row"><span class="data-label">Active Power</span><div class="data-value-group"><span class="data-value" id="kw-${m.id}">---</span><span class="data-unit">kW</span></div></div>
                <div class="data-bar"><div class="data-bar-fill bar-power" id="kwbar-${m.id}" style="width:0"></div></div>

                <div class="data-row">
                    <span class="data-label">ACTIVE ENERGY</span>
                    <span class="data-value"><span id="kwh-${machine.id}">---</span> <span class="unit">kWh</span></span>
                </div>
                <div class="data-row"><span class="data-label">Frequency</span><div class="data-value-group"><span class="data-value" id="freq-${m.id}">50.0</span><span class="data-unit">Hz</span></div></div>
            </div>
            <div class="gauge-column">${makeSVG(m.id)}</div>
        </div>
        <div class="chart-container"><canvas id="chart-${m.id}"></canvas></div>
        <div class="panel-footer">
            <button class="detail-btn">⊞ EXPAND</button>
            <span class="last-update" id="ts-${m.id}">--:--:--</span>
        </div>
    </div>`;
}

function initChart(id) {
    const ctx = document.getElementById(`chart-${id}`).getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 80);
    grad.addColorStop(0, 'rgba(0,143,213,0.15)');
    grad.addColorStop(1, 'rgba(0,143,213,0.01)');

    machineCharts[id] = new Chart(ctx, {
        type: 'line',
        data: { labels: Array(MAX_PTS).fill(''), datasets: [{ data: Array(MAX_PTS).fill(0), borderColor: '#008FD5', backgroundColor: grad, borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { display: false }, x: { display: false } }, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
}

// ─── TAB SWITCHING & HISTORY MODULE ─────────────────────────
function switchTab(tabName) {
    document.getElementById('tab-live').classList.toggle('active', tabName === 'live');
    document.getElementById('tab-history').classList.toggle('active', tabName === 'history');
    
    document.getElementById('view-live').style.display = tabName === 'live' ? 'block' : 'none';
    document.getElementById('view-history').style.display = tabName === 'history' ? 'block' : 'none';

    if (tabName === 'history') {
        fetchHistoryData();
    }
}

async function fetchHistoryData() {
    document.getElementById('hist-loader').style.display = 'block';
    const timeframe = document.getElementById('hist-timeframe').value; // Get the selected time
    
    try {
        const res = await fetch(`/api/history/${CURRENT_SECTION}?timeframe=${timeframe}`);
        rawHistoryData = await res.json();
        document.getElementById('hist-loader').style.display = 'none';
        renderHistoryChart();
    } catch (err) {
        console.error("Failed to load history:", err);
        document.getElementById('hist-loader').textContent = "Error loading data.";
    }
}

// --- EXPORT FUNCTIONS ---
function downloadCSV() {
    const timeframe = document.getElementById('hist-timeframe').value;
    // Tell the browser to download the file directly from our Python route
    window.location.href = `/api/export_csv/${CURRENT_SECTION}?timeframe=${timeframe}`;
}

function downloadPDF() {
    const element = document.querySelector('.master-chart-container');
    const tfLabel = document.getElementById('hist-timeframe').options[document.getElementById('hist-timeframe').selectedIndex].text;
    
    const opt = {
        margin:       0.2, // Tighter margin to leave room for the chart
        filename:     `SCADA_Report_${tfLabel}.pdf`,
        image:        { type: 'png', quality: 1.0 }, // PNG prevents text blurring
        html2canvas:  { 
            scale: 2, 
            backgroundColor: '#ffffff',
            useCORS: true
        }, 
        // FIX: Upgraded to 'a3' paper size to completely stop edge cropping
        jsPDF:        { unit: 'in', format: 'a3', orientation: 'landscape' }
    };
    
    html2pdf().set(opt).from(element).save();
}

function renderHistoryChart() {
    const param = document.getElementById('hist-param').value;
    const ctx = document.getElementById('master-history-chart').getContext('2d');
    
    // Find which checkboxes are checked
    const selectedIds = Array.from(document.querySelectorAll('.hist-checkbox:checked')).map(cb => cb.value);
    
    const datasets = [];
    const colors = ['#008FD5', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6']; // Color palette for multiple lines
    let colorIdx = 0;

    selectedIds.forEach(id => {
        if (!rawHistoryData[id]) return;

        // Find machine name for the legend
        const mObj = masterMachineList.find(m => m.id == id);
        const name = mObj ? mObj.name : `Unit ${id}`;

        const dataPoints = rawHistoryData[id].map(entry => ({
            x: new Date(entry.ts),
            y: entry[param]
        }));

        datasets.push({
            label: name,
            data: dataPoints,
            borderColor: colors[colorIdx % colors.length],
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
            fill: false
        });
        colorIdx++;
    });

    if (masterHistoryChart) {
        masterHistoryChart.destroy();
    }

    masterHistoryChart = new Chart(ctx, {
        type: 'line',
        data: { datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { 
                    type: 'time', 
                    time: { tooltipFormat: 'dd MMM, HH:mm' },
                    grid: { display: false }
                },
                y: { beginAtZero: true }
            },
            plugins: {
                legend: { position: 'top', align: 'end' },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
}


// ─── DASHBOARD BUILDER ──────────────────────────────────────
async function initDashboard() {
    try {
        const response = await fetch(`/static/data/machines_${CURRENT_SECTION}.json`);
        masterMachineList = await response.json();
        
        const grid = document.getElementById('machine-grid');
        const sidebar = document.getElementById('machine-list');
        const histSelectors = document.getElementById('hist-machine-selectors');
        
        let gridHTML = ''; 
        let histHTML = '';

        masterMachineList.forEach((m, idx) => {
            // Sidebar Scroll Links
            const li = document.createElement('li');
            li.innerHTML = `<a href="#" onclick="event.preventDefault(); document.getElementById('panel-${m.id}').scrollIntoView({behavior: 'smooth', block: 'start'}); switchTab('live');">${m.name}</a>`;
            sidebar.appendChild(li);

            // History View Checkboxes (Check the first two by default)
            const isChecked = idx < 2 ? 'checked' : '';
            histHTML += `<label><input type="checkbox" class="hist-checkbox" value="${m.id}" ${isChecked} onchange="renderHistoryChart()"> ${m.name}</label>`;

            // Add panel HTML to string
            gridHTML += getPanelHTML(m);
        });

        grid.innerHTML = gridHTML;
        histSelectors.innerHTML = histHTML;

        // Destroy ghost loader
        const loader = document.getElementById('loading-state') || document.querySelector('.loading-state');
        if (loader) loader.remove();

        // Initialize Live Charts
        masterMachineList.forEach(m => {
            initChart(m.id);
            prevValues[m.id] = { v: 0, i: 0, kw: 0, pf: 0 };
        });

        startPolling();
    } catch (err) { console.error("Initialization Failed:", err); }
}

// ─── LIVE POLLING ───────────────────────────────────────────
async function startPolling() {
    setInterval(async () => {
        try {
            const res = await fetch(`/api/live_data/${CURRENT_SECTION}`);
            const data = await res.json();
            
            for (const [id, d] of Object.entries(data)) {
                const vEl = document.getElementById(`v-${id}`);
                if (!vEl) continue;
                
                const prev = prevValues[id] || { v: 0, i: 0, kw: 0, pf: 0, kwh: 0 };
                const newV = parseFloat(d.v_l1) || 0;
                const newKW = parseFloat(d.kw) || 0;
                const newI = parseFloat(d.i_l1) || 0;
                const newKWH = parseFloat(d.kwh_total) || 0; // Grab the new KWh value

                animateValue(vEl, prev.v, newV, 500, 1);
                document.getElementById(`pf-${id}`).textContent = parseFloat(d.pf).toFixed(2);
                document.getElementById(`kw-${id}`).textContent = newKW.toFixed(1);
                
                // NEW: Update the KWh display (Ensure you have an element with id="kwh-${id}")
                const kwhEl = document.getElementById(`kwh-${id}`);
                if (kwhEl) {
                    kwhEl.textContent = newKWH.toFixed(1);
                }
                
                document.getElementById(`vbar-${id}`).style.width = Math.min((newV / 250) * 100, 100) + '%';
                document.getElementById(`pfbar-${id}`).style.width = (parseFloat(d.pf) * 100) + '%';
                document.getElementById(`kwbar-${id}`).style.width = Math.min((newKW / 50) * 100, 100) + '%';

                setGauge(id, newI);
                animateValue(document.getElementById(`i-${id}`), prev.i, newI, 500, 0);
                document.getElementById(`ts-${id}`).textContent = new Date().toLocaleTimeString('en-GB',{hour12:false});

                if (machineCharts[id]) {
                    machineCharts[id].data.datasets[0].data.push(newKW);
                    machineCharts[id].data.datasets[0].data.shift();
                    machineCharts[id].update('none');
                }

                prevValues[id] = { v: newV, i: newI, kw: newKW, pf: d.pf, kwh: newKWH };
            }
        } catch (err) { console.warn("Polling offline..."); }
    }, 2000);
}

// Ensure Chart.js Time Adapter is loaded for the History Chart to work
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js';
document.head.appendChild(script);
// Add this to the very bottom of scada_engine.js
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Initializing Dashboard for:", CURRENT_SECTION);
    await init(); // This builds the cards
    startPolling(); // This starts the live data loop
});
