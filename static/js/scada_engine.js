/* ============================================================
   SCADA ENGINE v9.5 — Bulletproof HTML Dashboard
   ============================================================ */

const machineCharts = {};
const prevValues = {};
const MAX_PTS = 25;
let startTime = new Date();

let masterHistoryChart = null;
let rawHistoryData = {};
let masterMachineList = [];
let apexHeatmap = null;
let currentDisplayMode = 'chart';

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

function setDisplayMode(mode) {
    currentDisplayMode = mode;
    const btnChart = document.getElementById('btn-view-chart');
    const btnTable = document.getElementById('btn-view-table');
    
    if (mode === 'chart') {
        btnChart.style.background = '#FFFFFF'; btnChart.style.color = '#008FD5'; btnChart.style.boxShadow = '0 2px 5px rgba(0,0,0,0.05)';
        btnTable.style.background = 'transparent'; btnTable.style.color = '#64748B'; btnTable.style.boxShadow = 'none';
        document.getElementById('display-chart').style.display = 'block';
        document.getElementById('display-table').style.display = 'none';
    } else {
        btnTable.style.background = '#FFFFFF'; btnTable.style.color = '#008FD5'; btnTable.style.boxShadow = '0 2px 5px rgba(0,0,0,0.05)';
        btnChart.style.background = 'transparent'; btnChart.style.color = '#64748B'; btnChart.style.boxShadow = 'none';
        document.getElementById('display-chart').style.display = 'none';
        document.getElementById('display-table').style.display = 'block';
    }
    if (Object.keys(rawHistoryData).length > 0) renderHistoryChart(); 
}

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

function makeGauge(id, type, label, maxVal) {
    const colors = {
        'v':  { c1: '#FBBF24', c2: '#F59E0B' },
        'i':  { c1: '#34D399', c2: '#10B981' },
        'kw': { c1: '#38BDF8', c2: '#0284C7' },
        'pf': { c1: '#A78BFA', c2: '#7C3AED' }
    }[type];

    return `
    <svg viewBox="0 0 120 72" class="industrial-gauge">
      <defs>
        <linearGradient id="gGrad-${type}-${id}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${colors.c1}"/><stop offset="100%" stop-color="${colors.c2}"/>
        </linearGradient>
      </defs>
      ${buildTicks()}
      <path class="gauge-track" d="M 16 56 A 44 44 0 0 1 104 56"/>
      <path class="gauge-fill" id="gauge-${type}-${id}" d="M 16 56 A 44 44 0 0 1 104 56" stroke="url(#gGrad-${type}-${id})" stroke-dasharray="0,138.23"/>
      <text x="60" y="51" class="gauge-value" id="val-${type}-${id}">0</text>
      <text x="60" y="61" class="gauge-unit">${label}</text>
      <text x="17" y="68" class="gauge-range-label" text-anchor="start">0</text>
      <text x="103" y="68" class="gauge-range-label" text-anchor="end">${maxVal}</text>
    </svg>`;
}

function updateGauge(id, type, val, maxVal) {
    const pct = Math.min(Math.max(val / maxVal, 0), 1);
    const len = (pct * 138.23).toFixed(2);
    const el = document.getElementById(`gauge-${type}-${id}`);
    if (el) el.setAttribute('stroke-dasharray', `${len},138.23`);
}

function initMiniLineChart(id) {
    const ctx = document.getElementById(`chart-${id}`).getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 70);
    grad.addColorStop(0, 'rgba(0,143,213,0.15)');
    grad.addColorStop(1, 'rgba(0,143,213,0.01)');
    machineCharts[id] = new Chart(ctx, {
        type: 'line',
        data: { labels: Array(MAX_PTS).fill(''), datasets: [{ data: Array(MAX_PTS).fill(0), borderColor: '#008FD5', backgroundColor: grad, borderWidth: 1.5, fill: true, pointRadius: 0, tension: 0.3 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { display: false }, x: { display: false } }, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
}

function getPanelHTML(m) {
    return `
    <div class="machine-panel" id="panel-${m.id}">
        <div class="panel-header">
            <div class="panel-title-group">
                <div class="status-led offline" id="led-${m.id}"></div>
                <h2 class="machine-name">${m.name}</h2>
            </div>
            <span class="device-id">NODE ID: ${m.id}</span>
        </div>
        
        <div class="panel-body-wide">
            <div class="gauge-wrap">${makeGauge(m.id, 'v', 'VOLTAGE (V)', 300)}</div>
            <div class="gauge-wrap">${makeGauge(m.id, 'i', 'CURRENT (A)', 3000)}</div>
            <div class="gauge-wrap">${makeGauge(m.id, 'kw', 'POWER (kW)', 500)}</div>
            <div class="gauge-wrap">${makeGauge(m.id, 'pf', 'PWR FACTOR', 1.0)}</div>
            
            <div class="radar-column">
                <span class="data-label" style="text-align:center; display:block; margin-bottom:10px;">Live Current (L1/L2/L3)</span>
                <div style="display: flex; gap: 10px; align-items: center; justify-content: center; height: 110px;">
                    <div style="flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: center; text-align: center; background: #FEF2F2; border: 2px solid #FECACA; border-radius: 8px;">
                        <div style="font-size: 10px; font-weight: 800; color: #EF4444; margin-bottom: 5px;">PHASE L1</div>
                        <div style="font-family: 'JetBrains Mono'; font-size: 18px; font-weight: 900; color: #B91C1C;"><span id="val-i1-${m.id}">---</span><span style="font-size: 10px;">A</span></div>
                    </div>
                    <div style="flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: center; text-align: center; background: #FFFBEB; border: 2px solid #FDE68A; border-radius: 8px;">
                        <div style="font-size: 10px; font-weight: 800; color: #F59E0B; margin-bottom: 5px;">PHASE L2</div>
                        <div style="font-family: 'JetBrains Mono'; font-size: 18px; font-weight: 900; color: #B45309;"><span id="val-i2-${m.id}">---</span><span style="font-size: 10px;">A</span></div>
                    </div>
                    <div style="flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: center; text-align: center; background: #ECFDF5; border: 2px solid #A7F3D0; border-radius: 8px;">
                        <div style="font-size: 10px; font-weight: 800; color: #10B981; margin-bottom: 5px;">PHASE L3</div>
                        <div style="font-family: 'JetBrains Mono'; font-size: 18px; font-weight: 900; color: #047857;"><span id="val-i3-${m.id}">---</span><span style="font-size: 10px;">A</span></div>
                    </div>
                </div>
            </div>

            <div class="stats-column">
                <div class="data-row"><span class="data-label">Total Energy</span><div><span class="data-value" style="color:#10B981;" id="kwh-${m.id}">---</span><span class="data-unit">kWh</span></div></div>
                <div class="data-row"><span class="data-label">CO₂ Eq.</span><div><span class="data-value" style="color:#008FD5;" id="co2-${m.id}">---</span><span class="data-unit">Tons</span></div></div>
                <div class="data-row" style="border:none;">
                    <span class="data-label">THD-V</span>
                    <div><span class="data-value" id="thdv-${m.id}">---</span><span class="data-unit">%</span></div>
                </div>
                <div style="text-align: right;"><span class="thd-badge" id="badge-thdv-${m.id}">NORMAL</span></div>
            </div>
        </div>
        
        <div style="display: flex; justify-content: space-around; background: #F8FAFC; padding: 12px; border-radius: 8px; margin: 15px 0; border: 1px solid #E2E8F0;">
            <div style="text-align:center;"><span style="font-size:11px; color:#64748B; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Past Month Energy</span> <span style="font-family:'JetBrains Mono'; font-size:16px; font-weight:800; color:#0F172A;" id="past-mwh-${m.id}">---</span> <span style="font-size:11px; color:#94A3B8; font-weight:700;">kWh</span></div>
            <div style="width: 1px; background: #E2E8F0;"></div>
            <div style="text-align:center;"><span style="font-size:11px; color:#64748B; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Current Month Energy</span> <span style="font-family:'JetBrains Mono'; font-size:16px; font-weight:800; color:#10B981;" id="curr-mwh-${m.id}">---</span> <span style="font-size:11px; color:#94A3B8; font-weight:700;">kWh</span></div>
            <div style="width: 1px; background: #E2E8F0;"></div>
            <div style="text-align:center;"><span style="font-size:11px; color:#64748B; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Current Month Avg Load</span> <span style="font-family:'JetBrains Mono'; font-size:16px; font-weight:800; color:#008FD5;" id="curr-avg-kw-${m.id}">---</span> <span style="font-size:11px; color:#94A3B8; font-weight:700;">kW</span></div>
        </div>

        <div class="chart-container"><canvas id="chart-${m.id}"></canvas></div>
    </div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch(`/static/data/machines_${CURRENT_SECTION}.json`);
        masterMachineList = await response.json();
        
        let gridHTML = ''; let listHTML = ''; let selectorsHTML = '';

        masterMachineList.forEach((m, idx) => {
            gridHTML += getPanelHTML(m);
            listHTML += `<li><a href="#" style="color:#94A3B8; display:block; padding:10px 20px; text-decoration:none;" onclick="event.preventDefault(); switchTab('live'); setTimeout(() => document.getElementById('panel-${m.id}').scrollIntoView({behavior: 'smooth', block: 'start'}), 50);">${m.name}</a></li>`;
            selectorsHTML += `<label class="hist-checkbox-wrapper"><input type="checkbox" class="hist-checkbox" value="${m.id}" ${idx < 3 ? 'checked' : ''} onchange="renderHistoryChart()"> ${m.name}</label>`;
            prevValues[m.id] = { v: 0, i: 0, kw: 0, pf: 0, i1: 0, i2: 0, i3: 0 };
        });

        document.getElementById('machine-grid').innerHTML = gridHTML;
        document.getElementById('machine-list').innerHTML = listHTML;
        document.getElementById('hist-machine-selectors').innerHTML = selectorsHTML;

        masterMachineList.forEach(m => { initMiniLineChart(m.id); });
        startPolling();
    } catch (err) { console.error("Initialization Failed:", err); }
});

function updateTHDBadge(id, val) {
    const badge = document.getElementById(`badge-thdv-${id}`);
    if (!badge) return;
    if (val === '---' || val === 0) { badge.textContent = "NORMAL"; badge.style.color = "#059669"; badge.style.background = "#ECFDF5"; badge.style.borderColor = "#A7F3D0"; return; }
    
    const num = parseFloat(val);
    if (num < 3.0) { badge.textContent = "NORMAL"; badge.style.color = "#059669"; badge.style.background = "#ECFDF5"; badge.style.borderColor = "#A7F3D0";
    } else if (num >= 3.0 && num <= 5.0) { badge.textContent = "WARNING"; badge.style.color = "#D97706"; badge.style.background = "#FFFBEB"; badge.style.borderColor = "#FDE68A";
    } else { badge.textContent = "CRITICAL"; badge.style.color = "#DC2626"; badge.style.background = "#FEF2F2"; badge.style.borderColor = "#FECACA"; }
}

function startPolling() {
    setInterval(async () => {
        try {
            const res = await fetch(`/api/live_data/${CURRENT_SECTION}`);
            const data = await res.json();
            
            for (const [id, d] of Object.entries(data)) {
                if(!document.getElementById(`val-v-${id}`)) continue;
                
                const prev = prevValues[id] || { v: 0, i: 0, kw: 0, pf: 0, i1: 0, i2: 0, i3: 0 };
                const newV = parseFloat(d.v_l1) || 0;
                const newI = parseFloat(d.i_l1) || 0;
                const newKW = parseFloat(d.kw) || 0;
                const newPF = parseFloat(d.pf) || 0;
                const thdv = parseFloat(d.thd_v) || 0;

                animateValue(document.getElementById(`val-v-${id}`), prev.v, newV, 500, 1);
                animateValue(document.getElementById(`val-i-${id}`), prev.i, newI, 500, 1);
                animateValue(document.getElementById(`val-kw-${id}`), prev.kw, newKW, 500, 2);
                animateValue(document.getElementById(`val-pf-${id}`), prev.pf, newPF, 500, 2);
                
                updateGauge(id, 'v', newV, 300);
                updateGauge(id, 'i', newI, 3000);
                updateGauge(id, 'kw', newKW, 500);
                updateGauge(id, 'pf', newPF, 1.0);

                document.getElementById(`thdv-${id}`).textContent = thdv.toFixed(2);
                updateTHDBadge(id, thdv);
                
                // SAFELY UDPATE L1/L2/L3 BOXES
                // SAFELY UDPATE L1/L2/L3 BOXES
                if (d.i_l1 !== undefined && d.i_l1 !== "---") {
                    animateValue(document.getElementById(`val-i1-${id}`), prev.i1, parseFloat(d.i_l1), 500, 1);
                    animateValue(document.getElementById(`val-i2-${id}`), prev.i2, parseFloat(d.i_l2), 500, 1);
                    animateValue(document.getElementById(`val-i3-${id}`), prev.i3, parseFloat(d.i_l3), 500, 1);
                    prev.i1 = parseFloat(d.i_l1);
                    prev.i2 = parseFloat(d.i_l2);
                    prev.i3 = parseFloat(d.i_l3);
                } else {
                    if(document.getElementById(`val-i1-${id}`)) document.getElementById(`val-i1-${id}`).textContent = "---";
                    if(document.getElementById(`val-i2-${id}`)) document.getElementById(`val-i2-${id}`).textContent = "---";
                    if(document.getElementById(`val-i3-${id}`)) document.getElementById(`val-i3-${id}`).textContent = "---";
                }
                
                if (d.kwh_total && d.kwh_total !== "---") {
                    const rawKwh = parseFloat(d.kwh_total);
                    document.getElementById(`kwh-${id}`).textContent = rawKwh.toFixed(1);
                    document.getElementById(`co2-${id}`).textContent = ((rawKwh / 1000) * 0.45).toFixed(2);
                } else {
                    document.getElementById(`kwh-${id}`).textContent = "---";
                    document.getElementById(`co2-${id}`).textContent = "---";
                }

                if (machineCharts[id]) {
                    machineCharts[id].data.datasets[0].data.push(newKW);
                    machineCharts[id].data.datasets[0].data.shift();
                    machineCharts[id].update('none');
                }

                const led = document.getElementById(`led-${id}`);
                if(d.status === 'Online') { led.classList.remove('offline'); led.classList.add('online'); } 
                else { led.classList.remove('online'); led.classList.add('offline'); }
                
                prevValues[id] = { v: newV, i: newI, kw: newKW, pf: newPF, i1: prev.i1, i2: prev.i2, i3: prev.i3 };
            }
        } catch (err) {}
    }, 2000);
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    document.getElementById(`view-${tabName}`).classList.add('active');

    if ((tabName === 'history' || tabName === 'heatmap') && Object.keys(rawHistoryData).length === 0) {
        fetchHistoryData();
    } else if (tabName === 'heatmap') { renderHeatmap(); }
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
    } catch (err) {}
}

function renderHistoryChart() {
    const param = document.getElementById('hist-param').value;
    const ctx = document.getElementById('master-history-chart').getContext('2d');
    const selectedIds = Array.from(document.querySelectorAll('.hist-checkbox:checked')).map(cb => cb.value);
    
    const datasets = [];
    const colors = ['#008FD5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#3B82F6', '#14B8A6'];
    
    selectedIds.forEach((id, i) => {
        if (!rawHistoryData[id] || rawHistoryData[id].length === 0) return;
        const name = masterMachineList.find(m => m.id == id)?.name || `Unit ${id}`;
        
        const dataPoints = rawHistoryData[id].map(e => {
            let yVal = e[param];
            if (param === 'kwh' || param === 'co2') {
                let rawKwh = parseFloat(e.kwh || 0);
                if (rawKwh > 100000000) rawKwh = rawKwh / 1000; 
                // Serve raw kWh, but calculate CO2 using MWh base (kWh / 1000 * 0.45)
                yVal = param === 'kwh' ? rawKwh : ((rawKwh / 1000) * 0.45);
            }
            return { x: new Date(e.ts), y: yVal !== undefined ? yVal : 0 };
        });

        datasets.push({ label: name, data: dataPoints, borderColor: colors[i % colors.length], borderWidth: 2, pointRadius: 0, tension: 0.2 });
    });

    const paramName = document.getElementById('hist-param').options[document.getElementById('hist-param').selectedIndex].text;
    
    if (currentDisplayMode === 'chart') {
        if (masterHistoryChart) masterHistoryChart.destroy();
        if (datasets.length > 0) {
            masterHistoryChart = new Chart(ctx, {
                type: 'line', data: { datasets },
                options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'time', grid:{display:false} } }, plugins: { legend: { position: 'top' } } }
            });
        }
    } else {
        document.getElementById('table-param-header').textContent = paramName;
        let tableHTML = '';
        let flatData = [];
        datasets.forEach(ds => { ds.data.forEach(point => { flatData.push({ time: point.x, name: ds.label, value: point.y }); }); });
        flatData.sort((a, b) => b.time - a.time);

        flatData.forEach(row => {
            tableHTML += `
                <tr style="transition: 0.2s; border-bottom: 1px solid #E2E8F0;">
                    <td style="padding: 12px 15px; font-family: 'JetBrains Mono'; font-weight: 600; font-size: 14px; color: #0F172A;">${row.time.toLocaleString()}</td>
                    <td style="padding: 12px 15px; font-family: 'Inter'; font-weight: 800; font-size: 13px; color: #64748B;">${row.name}</td>
                    <td style="padding: 12px 15px; font-family: 'JetBrains Mono'; font-weight: 800; font-size: 15px; color: #008FD5;">${parseFloat(row.value).toFixed(2)}</td>
                </tr>`;
        });
        document.getElementById('history-table-body').innerHTML = tableHTML;
    }
}

function renderHeatmap() {
    if (Object.keys(rawHistoryData).length === 0) return;
    const heatMatrix = Array(7).fill().map(() => Array(24).fill(0));
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

async function fetchMonthlyStats() {
    try {
        const res = await fetch(`/api/monthly_stats/${CURRENT_SECTION}`);
        const stats = await res.json();
        for (const [id, data] of Object.entries(stats)) {
            if (document.getElementById(`past-mwh-${id}`)) {
                document.getElementById(`past-mwh-${id}`).textContent = data.past_month_energy;
                document.getElementById(`curr-mwh-${id}`).textContent = data.current_month_energy;
                document.getElementById(`curr-avg-kw-${id}`).textContent = data.current_month_avg_kw;
            }
        }
    } catch(e) {}
}

setTimeout(fetchMonthlyStats, 1500); 
setInterval(fetchMonthlyStats, 300000);
