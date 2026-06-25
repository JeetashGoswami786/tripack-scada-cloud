/* ============================================================
   SCADA ENGINE v8.0 — True Hybrid Enterprise Analytics
   ============================================================ */

// ─── GLOBAL STATE ───────────────────────────────────────────
const machineCharts = {};
const machineRadars = {};
const prevValues = {};
const MAX_PTS = 25;
let startTime = new Date();

let masterHistoryChart = null;
let rawHistoryData = {};
let masterMachineList = [];
let apexHeatmap = null;

// ─── LIVE CLOCK & UPTIME RESTORED ───────────────────────────
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

// ─── UTILITIES & ANIMATIONS RESTORED ────────────────────────
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

// ─── SVG GAUGE BUILDERS RESTORED ────────────────────────────
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
          <stop offset="0%" stop-color="#10B981"/><stop offset="100%" stop-color="#059669"/>
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

// ─── HYBRID PANEL TEMPLATE ──────────────────────────────────
function getPanelHTML(m) {
    return `
    <div class="machine-panel" id="panel-${m.id}">
        <div class="panel-header">
            <div class="panel-title-group">
                <div class="status-led offline" id="led-${m.id}"></div>
                <h2 class="machine-name">${m.name}</h2>
            </div>
            <span class="device-id">ID: ${m.id}</span>
        </div>
        
        <div class="panel-body">
            <div class="data-column" style="padding-right: 15px; border-right: 1px solid #F1F5F9;">
                <div class="data-row"><span class="data-label">Voltage L1</span><div><span class="data-value" id="v-${m.id}">---</span><span class="data-unit">V</span></div></div>
                <div class="data-row"><span class="data-label">Power Factor</span><div><span class="data-value" id="pf-${m.id}">---</span></div></div>
                <div class="data-row"><span class="data-label">Active Power</span><div><span class="data-value" style="color:#008FD5;" id="kw-${m.id}">---</span><span class="data-unit">kW</span></div></div>
                <div class="data-row"><span class="data-label">Total Energy</span><div><span class="data-value" style="color:#10B981;" id="kwh-${m.id}">---</span><span class="data-unit">MWh</span></div></div>
                <div class="data-row"><span class="data-label">CO₂ Eq.</span><div><span class="data-value" id="co2-${m.id}">---</span><span class="data-unit">Tons</span></div></div>
                <div class="data-row" style="border:none;">
                    <span class="data-label">THD-V</span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="data-value" id="thdv-${m.id}">---</span><span class="data-unit">%</span>
                    </div>
                </div>
                <div style="text-align: right;"><span style="font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; border: 1px solid #A7F3D0; background: #ECFDF5; color: #059669;" id="badge-thdv-${m.id}">NORMAL</span></div>
            </div>
            
            <div class="gauge-column" style="text-align: center;">
                ${makeSVG(m.id)}
            </div>

            <div class="radar-column" style="text-align: center; border-left: 1px solid #F1F5F9; padding-left: 10px;">
                <span class="data-label" style="font-size: 10px;">Phasor Radar</span>
                <div class="radar-box"><canvas id="radar-${m.id}"></canvas></div>
            </div>
        </div>

        <div class="chart-container"><canvas id="chart-${m.id}"></canvas></div>
    </div>`;
}

// ─── INITIALIZE CHARTS ──────────────────────────────────────
function initMiniLineChart(id) {
    const ctx = document.getElementById(`chart-${id}`).getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 60);
    grad.addColorStop(0, 'rgba(0,143,213,0.15)');
    grad.addColorStop(1, 'rgba(0,143,213,0.01)');

    machineCharts[id] = new Chart(ctx, {
        type: 'line',
        data: { labels: Array(MAX_PTS).fill(''), datasets: [{ data: Array(MAX_PTS).fill(0), borderColor: '#008FD5', backgroundColor: grad, borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.4 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { display: false }, x: { display: false } }, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
}

function initRadar(id) {
    const ctx = document.getElementById(`radar-${id}`).getContext('2d');
    machineRadars[id] = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['L1', 'L2', 'L3'],
            datasets: [
                { data: [0,0,0], borderColor: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.2)', borderWidth: 1 },
                { data: [0,0,0], borderColor: '#F87171', backgroundColor: 'rgba(248,113,113,0.2)', borderWidth: 1 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { r: { ticks: { display: false } } }, plugins: { legend: { display: false }, tooltip: {enabled: false} } }
    });
}

// ─── DASHBOARD BUILDER ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch(`/static/data/machines_${CURRENT_SECTION}.json`);
        masterMachineList = await response.json();
        
        let gridHTML = '';
        let listHTML = '';
        let selectorsHTML = '';

        masterMachineList.forEach((m, idx) => {
            gridHTML += getPanelHTML(m);
            listHTML += `<li><a href="#" onclick="event.preventDefault(); switchTab('live'); setTimeout(() => document.getElementById('panel-${m.id}').scrollIntoView({behavior: 'smooth', block: 'start'}), 50);">${m.name}</a></li>`;
            selectorsHTML += `<label style="font-size:12px; font-weight:700; color:#64748B;"><input type="checkbox" class="hist-checkbox" value="${m.id}" ${idx < 3 ? 'checked' : ''} onchange="renderHistoryChart()"> ${m.name}</label>`;
            prevValues[m.id] = { v: 0, i: 0, kw: 0, pf: 0 };
        });

        document.getElementById('machine-grid').innerHTML = gridHTML;
        document.getElementById('machine-list').innerHTML = listHTML;
        document.getElementById('hist-machine-selectors').innerHTML = selectorsHTML;

        // Initialize BOTH charts for every machine
        masterMachineList.forEach(m => {
            initMiniLineChart(m.id);
            initRadar(m.id);
        });

        startPolling();
    } catch (err) { console.error("Initialization Failed:", err); }
});

// ─── THD SMART ALERT LOGIC ──────────────────────────────────
function updateTHDBadge(id, val) {
    const badge = document.getElementById(`badge-thdv-${id}`);
    if (!badge) return;
    if (val === '---' || val === 0) { badge.textContent = "NORMAL"; badge.style.color = "#059669"; badge.style.background = "#ECFDF5"; badge.style.borderColor = "#A7F3D0"; return; }
    
    const num = parseFloat(val);
    if (num < 3.0) {
        badge.textContent = "NORMAL"; badge.style.color = "#059669"; badge.style.background = "#ECFDF5"; badge.style.borderColor = "#A7F3D0";
    } else if (num >= 3.0 && num <= 5.0) {
        badge.textContent = "WARNING"; badge.style.color = "#D97706"; badge.style.background = "#FFFBEB"; badge.style.borderColor = "#FDE68A";
    } else {
        badge.textContent = "CRITICAL"; badge.style.color = "#DC2626"; badge.style.background = "#FEF2F2"; badge.style.borderColor = "#FECACA";
    }
}

// ─── LIVE POLLING ───────────────────────────────────────────
function startPolling() {
    setInterval(async () => {
        try {
            const res = await fetch(`/api/live_data/${CURRENT_SECTION}`);
            const data = await res.json();
            
            for (const [id, d] of Object.entries(data)) {
                if(!document.getElementById(`v-${id}`)) continue;
                
                const prev = prevValues[id] || { v: 0, i: 0, kw: 0, pf: 0 };
                const newV = parseFloat(d.v_l1) || 0;
                const newI = parseFloat(d.i_l1) || 0;
                const newKW = parseFloat(d.kw) || 0;
                const thdv = parseFloat(d.thd_v) || 0;

                // Animate Data & SVG
                animateValue(document.getElementById(`v-${id}`), prev.v, newV, 500, 1);
                animateValue(document.getElementById(`i-${id}`), prev.i, newI, 500, 0);
                document.getElementById(`kw-${id}`).textContent = newKW.toFixed(2);
                document.getElementById(`pf-${id}`).textContent = parseFloat(d.pf || 0).toFixed(2);
                document.getElementById(`thdv-${id}`).textContent = thdv.toFixed(2);
                
                setGauge(id, newI);
                updateTHDBadge(id, thdv);
                
                // MWh and Carbon Conversion
                if (d.kwh_total) {
                    const mwh = parseFloat(d.kwh_total) / 1000;
                    document.getElementById(`kwh-${id}`).textContent = mwh.toFixed(2);
                    document.getElementById(`co2-${id}`).textContent = (mwh * 0.45).toFixed(1);
                }
                
                // Update Phase Radar Chart
                if (machineRadars[id] && d.v_l1) {
                    machineRadars[id].data.datasets[0].data = [d.v_l1, d.v_l2, d.v_l3];
                    machineRadars[id].data.datasets[1].data = [d.i_l1, d.i_l2, d.i_l3];
                    machineRadars[id].update('none');
                }

                // Update Mini Line Chart
                if (machineCharts[id]) {
                    machineCharts[id].data.datasets[0].data.push(newKW);
                    machineCharts[id].data.datasets[0].data.shift();
                    machineCharts[id].update('none');
                }

                // Status LED
                const led = document.getElementById(`led-${id}`);
                if(d.status === 'Online') {
                    led.classList.remove('offline'); led.classList.add('online');
                } else {
                    led.classList.remove('online'); led.classList.add('offline');
                }
                
                prevValues[id] = { v: newV, i: newI, kw: newKW, pf: d.pf };
            }
        } catch (err) { console.warn("Polling offline..."); }
    }, 2000);
}

// ─── TABS & MASTER HISTORY ──────────────────────────────────
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    document.getElementById(`view-${tabName}`).classList.add('active');

    if ((tabName === 'history' || tabName === 'heatmap') && Object.keys(rawHistoryData).length === 0) {
        fetchHistoryData();
    } else if (tabName === 'heatmap') {
        renderHeatmap();
    }
}

function toggleCustomDates() {
    const tf = document.getElementById('hist-timeframe').value;
    document.getElementById('custom-date-pickers').style.display = tf === 'custom' ? 'flex' : 'none';
}

async function fetchHistoryData() {
    const tf = document.getElementById('hist-timeframe').value;
    let url = `/api/history/${CURRENT_SECTION}?timeframe=${tf}`;
    
    if (tf === 'custom') {
        const startVal = document.getElementById('hist-start').value;
        const endVal = document.getElementById('hist-end').value;
        if (!startVal || !endVal) return;
        const s = new Date(startVal), e = new Date(endVal);
        url += `&start=${encodeURIComponent(s.toISOString())}&end=${encodeURIComponent(e.toISOString())}`;
    }
    
    try {
        const res = await fetch(url);
        rawHistoryData = await res.json();
        renderHistoryChart();
        if (document.getElementById('tab-heatmap').classList.contains('active')) renderHeatmap();
    } catch (err) { console.error(err); }
}

function renderHistoryChart() {
    const param = document.getElementById('hist-param').value;
    const ctx = document.getElementById('master-history-chart').getContext('2d');
    const selectedIds = Array.from(document.querySelectorAll('.hist-checkbox:checked')).map(cb => cb.value);
    
    const datasets = [];
    const colors = ['#008FD5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];
    
    selectedIds.forEach((id, i) => {
        if (!rawHistoryData[id]) return;
        const name = masterMachineList.find(m => m.id == id)?.name || `Unit ${id}`;
        datasets.push({
            label: name,
            data: rawHistoryData[id].map(e => ({ x: new Date(e.ts), y: e[param] })),
            borderColor: colors[i % colors.length], borderWidth: 2, pointRadius: 0, tension: 0.2
        });
    });

    if (masterHistoryChart) masterHistoryChart.destroy();
    masterHistoryChart = new Chart(ctx, {
        type: 'line', data: { datasets },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'time', grid:{display:false} } } }
    });
}

// ─── SUBSTATION HEATMAP ENGINE ──────────────────────────────
function renderHeatmap() {
    if (Object.keys(rawHistoryData).length === 0) return;
    
    const heatMatrix = Array(7).fill().map(() => Array(24).fill(0));
    
    // Aggregating load across ALL machines
    for (const dataArray of Object.values(rawHistoryData)) {
        dataArray.forEach(row => {
            const d = new Date(row.ts);
            heatMatrix[d.getDay()][d.getHours()] += parseFloat(row.kw || 0);
        });
    }

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const seriesData = days.map((dayName, dIdx) => ({
        name: dayName,
        data: Array.from({length:24}, (_,h) => ({ x: `${h}:00`, y: heatMatrix[dIdx][h].toFixed(1) }))
    }));

    if (apexHeatmap) apexHeatmap.destroy();
    apexHeatmap = new ApexCharts(document.querySelector("#apex-heatmap"), {
        series: seriesData, chart: { height: 450, type: 'heatmap', toolbar: { show: false } },
        colors: ["#EF4444"], dataLabels: { enabled: false }
    });
    apexHeatmap.render();
}

function downloadCSV() { 
    let tf = document.getElementById('hist-timeframe').value;
    let url = `/api/export_csv/${CURRENT_SECTION}?timeframe=${tf}`;
    if (tf === 'custom') {
        const s = document.getElementById('hist-start').value;
        const e = document.getElementById('hist-end').value;
        if(s && e) url += `&start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}`;
    }
    window.location.href = url; 
}
function downloadPDF() { html2pdf().set({ margin: 0.2, filename: `${CURRENT_SECTION}_Report.pdf`, jsPDF: { format: 'a3', orientation: 'landscape' } }).from(document.getElementById('chart-export-area')).save(); }
