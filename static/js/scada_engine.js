/* ============================================================
   SCADA ENGINE v4.1 — Bulletproof Version
   ============================================================ */

const machineCharts = {};
const prevValues = {};
const MAX_PTS = 25;

// ─── DEBUGGING HELPERS ──────────────────────────────────────
function log(msg) { console.log(`[SCADA ENGINE]: ${msg}`); }

// ─── CORE TEMPLATES ─────────────────────────────────────────
function getPanelHTML(m) {
    return `
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
            <div class="data-row">
                <span class="data-label">Voltage L1</span>
                <span class="data-value" id="v-${m.id}">---</span>
            </div>
            <div class="data-row">
                <span class="data-label">Power Factor</span>
                <span class="data-value" id="pf-${m.id}">---</span>
            </div>
            <div class="data-row">
                <span class="data-label">Active Power</span>
                <span class="data-value" id="kw-${m.id}">---</span>
            </div>
        </div>
    </div>
    <div class="panel-footer">
        <button class="detail-btn" onclick="openModal('${m.id}')">⊞ EXPAND</button>
    </div>`;
}

// ─── INITIALIZATION ────────────────────────────────────────
async function initDashboard() {
    log("Initializing dashboard...");
    try {
        // Use an absolute path or relative path carefully
        const response = await fetch('/static/data/machines.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const machines = await response.json();
        log(`Loaded ${machines.length} machines.`);
        
        const grid = document.getElementById('machine-grid');
        const sidebar = document.getElementById('machine-list');
        
        // Clear previous
        grid.innerHTML = '';
        sidebar.innerHTML = '';

        machines.forEach(m => {
            // Sidebar link
            const li = document.createElement('li');
            li.innerHTML = `<a href="#panel-${m.id}">${m.name}</a>`;
            sidebar.appendChild(li);

            // Grid Panel
            const wrapper = document.createElement('div');
            wrapper.id = `panel-${m.id}`; // The Anchor target
            wrapper.className = 'machine-panel-wrapper';
            wrapper.innerHTML = getPanelHTML(m);
            grid.appendChild(wrapper);
        });

        startPolling();
    } catch (err) {
        log("CRITICAL ERROR: " + err.message);
        document.getElementById('machine-grid').innerHTML = 
            `<div style="color:red; padding:20px;">FAILED TO LOAD JSON. Check Console (F12).</div>`;
    }
}

// ─── START ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initDashboard);

// (Keep your animateValue, setGauge, and poll functions below this)
