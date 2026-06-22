/* ============================================================
   SCADA ENGINE v5.0 — Final Enterprise Layout
   ============================================================ */

const machineCharts = {};
const prevValues = {};
const MAX_PTS = 25;

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

// ─── DASHBOARD BUILDER ──────────────────────────────────────
async function initDashboard() {
    try {
        const response = await fetch('/static/data/machines.json');
        const machines = await response.json();
        
        const grid = document.getElementById('machine-grid');
        const sidebar = document.getElementById('machine-list');
        
        let gridHTML = ''; // Build in a string first to prevent layout breakage

        machines.forEach(m => {
            // Sidebar link
            const li = document.createElement('li');
            li.innerHTML = `<a href="#panel-${m.id}">${m.name}</a>`;
            sidebar.appendChild(li);

            // Add panel HTML to string
            gridHTML += getPanelHTML(m);
        });

        // Push all HTML to grid at once
        grid.innerHTML = gridHTML;

        // Initialize Charts AFTER HTML is on the page
        machines.forEach(m => {
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
            const res = await fetch('/api/live_data');
            const data = await res.json();
            
            for (const [id, d] of Object.entries(data)) {
                const vEl = document.getElementById(`v-${id}`);
                if (!vEl) continue; // Safety check
                
                const prev = prevValues[id];
                const newV = parseFloat(d.v_l1) || 0;
                const newKW = parseFloat(d.kw) || 0;
                const newI = parseFloat(d.i_l1) || 0;

                animateValue(vEl, prev.v, newV, 500, 1);
                document.getElementById(`pf-${id}`).textContent = parseFloat(d.pf).toFixed(2);
                document.getElementById(`kw-${id}`).textContent = newKW.toFixed(1);
                
                // Animate progress bars
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

                prevValues[id] = { v: newV, i: newI, kw: newKW, pf: d.pf };
            }
        } catch (err) { console.warn("Polling offline..."); }
    }, 2000);
}

document.addEventListener('DOMContentLoaded', initDashboard);
