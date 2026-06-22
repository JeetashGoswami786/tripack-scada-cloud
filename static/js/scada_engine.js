/* ============================================================
   SCADA ENGINE v4.0 — Data-Driven Professional Theme
   ============================================================ */

// ─── GLOBAL STATE ───────────────────────────────────────────
const machineCharts = {};
const prevValues    = {};
const MAX_PTS       = 25;
let startTime       = null;

// ─── CORE TEMPLATES ─────────────────────────────────────────
// This function "stamps out" the HTML for any machine
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
                ${['Voltage', 'Power Factor', 'Active Power'].map((label, i) => `
                    <div class="data-row">
                        <span class="data-label">${label}</span>
                        <div class="data-value-group">
                            <span class="data-value" id="${['v','pf','kw'][i]}-${m.id}">---</span>
                            <span class="data-unit">${['V','','kW'][i]}</span>
                        </div>
                    </div>
                    <div class="data-bar"><div class="data-bar-fill ${['bar-voltage','bar-pf','bar-power'][i]}" id="${['vbar','pfbar','kwbar'][i]}-${m.id}" style="width:0"></div></div>
                `).join('')}
            </div>
            <div class="gauge-column" id="g-${m.id}">${makeSVG(m.id)}</div>
        </div>
        <div class="chart-container"><canvas id="chart-${m.id}"></canvas></div>
        <div class="panel-footer">
            <button class="detail-btn" onclick="openModal('${m.id}')">⊞ EXPAND</button>
            <span class="last-update" id="ts-${m.id}">--:--:--</span>
        </div>
    </div>`;
}

// ─── INITIALIZATION ────────────────────────────────────────
async function initDashboard() {
    try {
        const response = await fetch('/static/data/machines.json');
        const machines = await response.json();
        
        const grid = document.getElementById('machine-grid');
        const sidebar = document.getElementById('machine-list');
        grid.innerHTML = '';
        sidebar.innerHTML = '';

        machines.forEach(m => {
            // 1. Build Sidebar Link (Point to #panel-id)
            const li = document.createElement('li');
            li.innerHTML = `<a href="#panel-${m.id}">${m.name}</a>`;
            sidebar.appendChild(li);

            // 2. Build Panel (Must have id="panel-id" to match)
            const wrapper = document.createElement('div');
            wrapper.id = `panel-${m.id}`; 
            wrapper.className = 'machine-wrapper'; // Added for styling control
            wrapper.innerHTML = getPanelHTML(m);
            grid.appendChild(wrapper);

            // 3. Init Chart
            initChart(m.id);
            prevValues[m.id] = { v:0, i:0, kw:0, pf:0 };
        });

        startPolling();
    } catch (err) { console.error("Init Error:", err); }
}

// ─── POLLING ENGINE ──────────────────────────────────────────
async function startPolling() {
    setInterval(async () => {
        try {
            const res = await fetch('/api/live_data');
            const data = await res.json();
            updateDashboard(data);
        } catch (err) { console.warn("Polling offline..."); }
    }, 2000);
}

// ─── UI UPDATER ─────────────────────────────────────────────
function updateDashboard(data) {
    for (const [id, d] of Object.entries(data)) {
        const vEl = document.getElementById(`v-${id}`);
        if (!vEl) continue; // Skip if element doesn't exist yet

        // Update logic (Use your existing animateValue here)
        animateValue(vEl, prevValues[id].v, d.v_l1, 500, 1);
        document.getElementById(`pf-${id}`).textContent = parseFloat(d.pf).toFixed(2);
        document.getElementById(`kw-${id}`).textContent = parseFloat(d.kw).toFixed(1);
        setGauge(id, d.i_l1);

        // Update Charts
        if (machineCharts[id]) {
            machineCharts[id].data.datasets[0].data.push(d.kw);
            machineCharts[id].data.datasets[0].data.shift();
            machineCharts[id].update('none');
        }
        prevValues[id] = { v: d.v_l1, i: d.i_l1, kw: d.kw, pf: d.pf };
    }
}

// ... (KEEP YOUR EXISTING: animateValue, makeSVG, buildTicks, setGauge, initChart functions below this) ...

document.addEventListener('DOMContentLoaded', initDashboard);
