/* ============================================================
   SCADA ENGINE v5.0 — Packages Group Professional Theme
   Real-time industrial data visualization engine
   + Sidebar / hamburger navigation (built from the same live
     data as the panels, so IDs always match — no separate
     machines.json needed)
   ============================================================ */

// ─── GLOBAL STATE ───────────────────────────────────────────
let isInitialized  = false;
const machineCharts = {};
const MAX_PTS       = 25;
const prevValues    = {};
let startTime       = null;
let activeModalId   = null;
let modalChart       = null;

// ─── SIDEBAR / HAMBURGER ─────────────────────────────────────
function toggleSidebar(forceClose) {
    const sb  = document.getElementById('machine-sidebar');
    const btn = document.getElementById('menu-toggle');
    if (!sb) return;

    if (forceClose === true) {
        sb.classList.add('collapsed');
        if (btn) btn.textContent = '☰';
        return;
    }
    sb.classList.toggle('collapsed');
    if (btn) btn.textContent = sb.classList.contains('collapsed') ? '☰' : '✕';
}

function scrollToMachine(e, id) {
    if (e) e.preventDefault();
    const panel = document.getElementById(`panel-${id}`);
    if (!panel) return;

    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.classList.add('highlight-flash');
    setTimeout(() => panel.classList.remove('highlight-flash'), 1200);

    document.querySelectorAll('.sidebar-nav-list a').forEach(a => a.classList.remove('active'));
    if (e && e.currentTarget) e.currentTarget.classList.add('active');

    // Auto-collapse on small screens after navigating
    if (window.innerWidth < 900) toggleSidebar(true);
}

// ─── SMOOTH NUMBER TRANSITION ────────────────────────────────
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
tickClock();

// ─── GAUGE SVG BUILDER ───────────────────────────────────────
// Semi-circle: centre (60,56), radius 44, arc length π×44 = 138.23
function buildTicks() {
    let s = '';
    for (let i = 0; i <= 10; i++) {
        const ang = Math.PI + (Math.PI * i / 10);
        const major = i % 5 === 0;
        const r0 = major ? 38 : 41;
        const r1 = 45;
        const cx = 60, cy = 56;
        const x1 = (cx + r0 * Math.cos(ang)).toFixed(1);
        const y1 = (cy + r0 * Math.sin(ang)).toFixed(1);
        const x2 = (cx + r1 * Math.cos(ang)).toFixed(1);
        const y2 = (cy + r1 * Math.sin(ang)).toFixed(1);
        s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${major ? 'gauge-tick-major' : 'gauge-tick'}" />`;
    }
    return s;
}

function gaugeGradId(id, modal) { return `gGrad${modal ? 'M' : ''}${id}`; }
function gaugeHighId(id, modal) { return `gHigh${modal ? 'M' : ''}${id}`; }
function gaugeElId(id, modal)   { return `${modal ? 'mg-' : 'gauge-'}${id}`; }
function gaugeLblId(id, modal)  { return `${modal ? 'mi-' : 'i-'}${id}`; }

function makeSVG(id, modal = false) {
    const gId = gaugeGradId(id, modal);
    const hId = gaugeHighId(id, modal);
    const eId = gaugeElId(id, modal);
    const lId = gaugeLblId(id, modal);
    return `
<svg viewBox="0 0 120 72" class="industrial-gauge">
  <defs>
    <linearGradient id="${gId}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="#006FAD"/>
      <stop offset="100%" stop-color="#008FD5"/>
    </linearGradient>
    <linearGradient id="${hId}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="#B45309"/>
      <stop offset="100%" stop-color="#EF4444"/>
    </linearGradient>
  </defs>
  ${buildTicks()}
  <path class="gauge-track" d="M 16 56 A 44 44 0 0 1 104 56"/>
  <path class="gauge-fill"  id="${eId}" d="M 16 56 A 44 44 0 0 1 104 56"
        stroke="url(#${gId})" stroke-dasharray="0,138.23"/>
  <text x="60" y="51" class="gauge-value" id="${lId}">0</text>
  <text x="60" y="61" class="gauge-unit">CURRENT (A)</text>
  <text x="17"  y="68" class="gauge-range-label" text-anchor="start">0</text>
  <text x="103" y="68" class="gauge-range-label" text-anchor="end">3000</text>
</svg>`;
}

function setGauge(id, ampere, modal = false) {
    const pct = Math.min(ampere / 3000, 1);
    const len = (pct * 138.23).toFixed(2);
    const el  = document.getElementById(gaugeElId(id, modal));
    const lb  = document.getElementById(gaugeLblId(id, modal));
    if (el) {
        el.setAttribute('stroke-dasharray', `${len},138.23`);
        el.setAttribute('stroke', `url(#${pct > 0.72 ? gaugeHighId(id,modal) : gaugeGradId(id,modal)})`);
    }
    if (lb) lb.textContent = Math.round(ampere);
}

// ─── INIT DASHBOARD ──────────────────────────────────────────
// Builds BOTH the panel grid and the sidebar from the exact same
// live-data object, in the exact same pass, so panel-${id} and
// the sidebar link to it can never drift out of sync again.
function initDashboard(data) {
    const grid = document.getElementById('machine-grid');
    let html        = '';
    let sidebarHtml = '';
    let idx  = 0;

    for (const [id, d] of Object.entries(data)) {
        const delay = (idx * 0.12).toFixed(2);

        // ── Sidebar entry ──
        sidebarHtml += `
<li>
  <a href="#panel-${id}" onclick="scrollToMachine(event,'${id}')">
    <span class="sidebar-dot online" id="sdot-${id}"></span>
    <span>${d.name}</span>
  </a>
</li>`;

        // ── Panel card ──
        html += `
<div class="machine-panel online" id="panel-${id}" style="--delay:${delay}s"
     onclick="openModal('${id}')">
  <div class="panel-status-bar" id="sbar-${id}"></div>

  <div class="panel-header">
    <div class="panel-title-group">
      <span class="status-led online" id="led-${id}"></span>
      <h2 class="machine-name">${d.name}</h2>
    </div>
    <div class="panel-badges">
      <span class="device-id">UNIT&nbsp;${id}</span>
      <span class="status-badge online" id="badge-${id}">ONLINE</span>
    </div>
  </div>

  <div class="panel-body">
    <div class="data-column">

      <div class="data-row">
        <span class="data-label">Voltage L1</span>
        <div class="data-value-group">
          <span class="data-value" id="v-${id}">---</span>
          <span class="data-unit">V</span>
        </div>
      </div>
      <div class="data-bar"><div class="data-bar-fill bar-voltage" id="vbar-${id}" style="width:0"></div></div>

      <div class="data-row">
        <span class="data-label">Power Factor</span>
        <div class="data-value-group">
          <span class="data-value" id="pf-${id}">---</span>
        </div>
      </div>
      <div class="data-bar"><div class="data-bar-fill bar-pf" id="pfbar-${id}" style="width:0"></div></div>

      <div class="data-row">
        <span class="data-label">Active Power</span>
        <div class="data-value-group">
          <span class="data-value" id="kw-${id}">---</span>
          <span class="data-unit">kW</span>
        </div>
      </div>
      <div class="data-bar"><div class="data-bar-fill bar-power" id="kwbar-${id}" style="width:0"></div></div>

      <div class="data-row">
        <span class="data-label">Frequency</span>
        <div class="data-value-group">
          <span class="data-value" id="freq-${id}">50.0</span>
          <span class="data-unit">Hz</span>
        </div>
      </div>

    </div>
    <div class="gauge-column">${makeSVG(id)}</div>
  </div>

  <div class="chart-container">
    <canvas id="chart-${id}"></canvas>
  </div>

  <div class="panel-footer">
    <button class="detail-btn" onclick="event.stopPropagation();openModal('${id}')">⊞ EXPAND</button>
    <span class="last-update" id="ts-${id}">--:--:--</span>
  </div>
</div>`;
        idx++;
    }

    grid.innerHTML = html;

    const sidebarList = document.getElementById('machine-list');
    if (sidebarList) sidebarList.innerHTML = sidebarHtml;
    const sidebarCount = document.getElementById('sidebar-count');
    if (sidebarCount) sidebarCount.textContent = `${idx} UNITS`;

    // Chart.js — professional light theme
    for (const id of Object.keys(data)) {
        const canvasEl = document.getElementById(`chart-${id}`);
        if (!canvasEl) continue;
        const ctx  = canvasEl.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 80);
        grad.addColorStop(0, 'rgba(0,143,213,0.15)');
        grad.addColorStop(1, 'rgba(0,143,213,0.01)');

        machineCharts[id] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array(MAX_PTS).fill(''),
                datasets: [{
                    data: Array(MAX_PTS).fill(0),
                    borderColor:     '#008FD5',
                    backgroundColor: grad,
                    borderWidth: 1.5,
                    fill: true,
                    pointRadius: 0,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        suggestedMax: 500,
                        grid:  { color: 'rgba(0,0,0,0.05)', drawBorder: false },
                        ticks: {
                            font:    { size: 8, family: "'JetBrains Mono',monospace" },
                            color:   '#8098B4',
                            maxTicksLimit: 4,
                            padding: 4
                        }
                    },
                    x: { display: false }
                },
                plugins: { legend: { display: false }, tooltip: { enabled: false } }
            }
        });
        prevValues[id] = { v: 0, i: 0, kw: 0, pf: 0 };
    }

    isInitialized = true;
}

// ─── UPDATE DASHBOARD ────────────────────────────────────────
function updateDashboard(data) {
    let tPow = 0, tCur = 0, tVolt = 0, tPF = 0;
    let online = 0, total = 0;

    for (const [id, d] of Object.entries(data)) {
        total++;
        const panel = document.getElementById(`panel-${id}`);
        const led   = document.getElementById(`led-${id}`);
        const badge = document.getElementById(`badge-${id}`);
        const tsEl  = document.getElementById(`ts-${id}`);
        const sbar  = document.getElementById(`sbar-${id}`);
        const sdot  = document.getElementById(`sdot-${id}`);
        if (!panel) continue; // safety: skip ids that aren't in the DOM yet

        const off = ['Offline','Gateway Offline','Timeout','Read Error'].includes(d.status);

        if (off) {
            panel.className = 'machine-panel offline';
            panel.style.setProperty('--delay','0s');
            if (led)   led.className   = 'status-led offline';
            if (badge) { badge.className = 'status-badge offline'; badge.textContent = d.status.toUpperCase(); }
            if (sdot)  sdot.className  = 'sidebar-dot offline';
            if (tsEl) tsEl.textContent = 'NO DATA';
            if (sbar) sbar.style.background = 'var(--status-offline)';
            ['v','pf','kw'].forEach(k => {
                const e = document.getElementById(`${k}-${id}`);
                if (e) e.textContent = '---';
            });
            setGauge(id, 0);
            ['vbar','pfbar','kwbar'].forEach(k => {
                const b = document.getElementById(`${k}-${id}`);
                if (b) b.style.width = '0%';
            });
            continue;
        }

        online++;
        panel.className = 'machine-panel online';
        if (led)   led.className   = 'status-led online';
        if (badge) { badge.className = 'status-badge online'; badge.textContent = 'ONLINE'; }
        if (sdot)  sdot.className  = 'sidebar-dot online';
        if (sbar) sbar.style.background = 'var(--brand-blue)';

        const prev = prevValues[id] || { v:0, i:0, kw:0, pf:0 };
        const newV  = parseFloat(d.v_l1) || 0;
        const newI  = parseFloat(d.i_l1) || 0;
        const newKW = parseFloat(d.kw)   || 0;
        const newPF = parseFloat(d.pf)   || 0;

        // Voltage
        const vEl = document.getElementById(`v-${id}`);
        animateValue(vEl, prev.v, newV, 500, 1);
        if (vEl && Math.abs(newV - prev.v) > 0.3) { vEl.classList.add('flash'); setTimeout(()=>vEl.classList.remove('flash'),600); }
        const vb = document.getElementById(`vbar-${id}`);
        if (vb) vb.style.width = Math.min((newV / 250)*100, 100) + '%';

        // PF
        const pfEl = document.getElementById(`pf-${id}`);
        animateValue(pfEl, prev.pf, newPF, 500, 2);
        const pfb = document.getElementById(`pfbar-${id}`);
        if (pfb) pfb.style.width = (newPF * 100) + '%';

        // Power
        const kwEl = document.getElementById(`kw-${id}`);
        animateValue(kwEl, prev.kw, newKW, 500, 1);
        if (kwEl && Math.abs(newKW - prev.kw) > 1) { kwEl.classList.add('flash'); setTimeout(()=>kwEl.classList.remove('flash'),600); }
        const kwb = document.getElementById(`kwbar-${id}`);
        if (kwb) kwb.style.width = Math.min((newKW / 500)*100, 100) + '%';

        // Gauge
        const iEl = document.getElementById(`i-${id}`);
        animateValue(iEl, prev.i, newI, 600, 0);
        setGauge(id, newI);

        // Timestamp
        if (tsEl) tsEl.textContent = new Date().toLocaleTimeString('en-GB',{hour12:false});

        // Chart
        const ch = machineCharts[id];
        if (ch) {
            ch.data.datasets[0].data.push(newKW);
            ch.data.datasets[0].data.shift();
            ch.update('none');
        }

        prevValues[id] = { v: newV, i: newI, kw: newKW, pf: newPF };
        tPow  += newKW;
        tCur  += newI;
        tVolt += newV;
        tPF   += newPF;
    }

    // KPI Strip
    const kp = document.getElementById('kpi-total-power');
    const kc = document.getElementById('kpi-total-current');
    const kv = document.getElementById('kpi-avg-voltage');
    const kf = document.getElementById('kpi-avg-pf');
    const ko = document.getElementById('kpi-online-count');
    if (kp) animateValue(kp, parseFloat(kp.textContent)||0, tPow, 600, 1);
    if (kc) animateValue(kc, parseFloat(kc.textContent)||0, tCur, 600, 0);
    if (kv && online) animateValue(kv, parseFloat(kv.textContent)||0, tVolt/online, 600, 1);
    if (kf && online) animateValue(kf, parseFloat(kf.textContent)||0, tPF/online,   600, 2);
    if (ko) ko.textContent = `${online} / ${total}`;

    // Sync modal if open
    if (activeModalId && data[activeModalId]) syncModal(activeModalId, data[activeModalId]);
}

// ─── DETAIL MODAL ────────────────────────────────────────────
function openModal(id) {
    const prev = prevValues[id];
    if (!prev) return;
    activeModalId = id;

    const nameEl = document.querySelector(`#panel-${id} .machine-name`);
    const name   = nameEl ? nameEl.textContent : `Unit ${id}`;
    const kva    = (prev.kw / (prev.pf || 1)).toFixed(1);
    const modal  = document.getElementById('detail-modal');
    const content= document.getElementById('detail-modal-content');

    content.innerHTML = `
<div class="modal-header">
  <h2 class="modal-title">${name} — Unit ${id}</h2>
  <button class="modal-close-btn" onclick="closeModal()" aria-label="Close">&times;</button>
</div>
<div class="modal-body">
  <div class="modal-data-section">
    <div class="modal-section-title">Electrical Parameters</div>
    <div class="modal-data-row">
      <span class="modal-data-label">Voltage L1-N</span>
      <span class="modal-data-value" id="mv-${id}">${prev.v.toFixed(1)} V</span>
    </div>
    <div class="modal-data-row">
      <span class="modal-data-label">Current L1</span>
      <span class="modal-data-value" id="mi-${id}">${prev.i.toFixed(1)} A</span>
    </div>
    <div class="modal-data-row">
      <span class="modal-data-label">Active Power</span>
      <span class="modal-data-value" id="mkw-${id}">${prev.kw.toFixed(1)} kW</span>
    </div>
    <div class="modal-data-row">
      <span class="modal-data-label">Power Factor</span>
      <span class="modal-data-value" id="mpf-${id}">${prev.pf.toFixed(2)}</span>
    </div>
    <div class="modal-data-row">
      <span class="modal-data-label">Frequency</span>
      <span class="modal-data-value">50.0 Hz</span>
    </div>
    <div class="modal-data-row">
      <span class="modal-data-label">Apparent Power</span>
      <span class="modal-data-value" id="mkva-${id}">${kva} kVA</span>
    </div>
  </div>

  <div class="modal-data-section">
    <div class="modal-section-title">Current Gauge</div>
    <div class="modal-gauge-container">${makeSVG(id, true)}</div>
  </div>

  <div class="modal-chart-container">
    <div class="modal-chart-title">Active Power Trend (Real-Time)</div>
    <div class="modal-chart-wrap">
      <canvas id="mchart-${id}"></canvas>
    </div>
  </div>
</div>`;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden','false');

    // Gauge with small delay for animation
    setTimeout(() => setGauge(id, prev.i, true), 80);

    // Modal chart
    const src = machineCharts[id];
    if (src) {
        const ctx  = document.getElementById(`mchart-${id}`).getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 120);
        grad.addColorStop(0, 'rgba(0,143,213,0.18)');
        grad.addColorStop(1, 'rgba(0,143,213,0.01)');
        if (modalChart) modalChart.destroy();
        modalChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array(MAX_PTS).fill(''),
                datasets: [{
                    data: [...src.data.datasets[0].data],
                    borderColor: '#008FD5',
                    backgroundColor: grad,
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 2.5,
                    pointBackgroundColor: '#008FD5',
                    pointBorderColor: '#FFFFFF',
                    pointBorderWidth: 1.5,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        suggestedMax: 500,
                        grid:  { color: 'rgba(0,0,0,0.05)', drawBorder: false },
                        ticks: {
                            font:    { size: 9, family: "'JetBrains Mono',monospace" },
                            color:   '#8098B4',
                            maxTicksLimit: 5
                        }
                    },
                    x: { display: false }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true,
                        backgroundColor: '#1B3A5C',
                        titleColor:  'rgba(255,255,255,0.6)',
                        bodyColor:   '#FFFFFF',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        cornerRadius: 6,
                        titleFont: { family:"'Inter',sans-serif", size:10 },
                        bodyFont:  { family:"'JetBrains Mono',monospace", size:13, weight:'bold' },
                        padding: 10,
                        callbacks: {
                            label: ctx => ` ${ctx.parsed.y.toFixed(1)} kW`
                        }
                    }
                }
            }
        });
    }
}

function syncModal(id, d) {
    const upd = (sel, val) => { const e = document.getElementById(sel); if (e) e.textContent = val; };
    upd(`mv-${id}`,   `${parseFloat(d.v_l1).toFixed(1)} V`);
    upd(`mi-${id}`,   `${parseFloat(d.i_l1).toFixed(1)} A`);
    upd(`mkw-${id}`,  `${parseFloat(d.kw).toFixed(1)} kW`);
    upd(`mpf-${id}`,  parseFloat(d.pf).toFixed(2));
    upd(`mkva-${id}`, `${(parseFloat(d.kw)/(parseFloat(d.pf)||1)).toFixed(1)} kVA`);
    setGauge(id, parseFloat(d.i_l1)||0, true);
    if (modalChart && machineCharts[id]) {
        modalChart.data.datasets[0].data = [...machineCharts[id].data.datasets[0].data];
        modalChart.update('none');
    }
}

function closeModal() {
    document.getElementById('detail-modal').classList.remove('active');
    document.getElementById('detail-modal').setAttribute('aria-hidden','true');
    activeModalId = null;
    if (modalChart) { modalChart.destroy(); modalChart = null; }
}

document.addEventListener('click', e => { if (e.target.id === 'modal-backdrop') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ─── POLLING ─────────────────────────────────────────────────
async function poll() {
    const t0 = performance.now();
    try {
        const data    = await (await fetch('/api/live_data')).json();
        const latency = Math.round(performance.now() - t0);

        const latEl = document.getElementById('api-latency');
        if (latEl) latEl.textContent = latency;

        if (!startTime) startTime = new Date();
        isInitialized ? updateDashboard(data) : initDashboard(data);

        // Status — online
        const st = document.getElementById('connection-status');
        const pd = document.getElementById('pulse-dot');
        const sw = document.getElementById('system-status-wrap');
        if (st) { st.textContent = 'Live Data Streaming Active'; st.classList.remove('offline'); }
        if (pd) pd.classList.remove('offline');
        if (sw) sw.classList.remove('offline');

    } catch (err) {
        console.error('[SCADA] Poll failed:', err);
        const st = document.getElementById('connection-status');
        const pd = document.getElementById('pulse-dot');
        const sw = document.getElementById('system-status-wrap');
        if (st) { st.textContent = 'CONNECTION LOST'; st.classList.add('offline'); }
        if (pd) pd.classList.add('offline');
        if (sw) sw.classList.add('offline');
    }
}

poll();
setInterval(poll, 2000);
