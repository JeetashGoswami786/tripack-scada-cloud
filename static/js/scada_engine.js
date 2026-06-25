/* ============================================================
   SCADA ENGINE v7.0 — Enterprise Light Theme & Analytics
   ============================================================ */

let masterMachineList = [];
let machineRadars = {};
let rawHistoryData = {};
let masterHistoryChart = null;
let apexHeatmap = null;

// --- DYNAMIC CARD GENERATOR ---
function getPanelHTML(m) {
    return `
    <div class="machine-panel" id="panel-${m.id}">
        <div style="display: flex; align-items: center; border-bottom: 2px solid #F1F5F9; padding-bottom: 10px; margin-bottom: 15px;">
            <div style="width: 12px; height: 12px; border-radius: 50%; background: #10B981; box-shadow: 0 0 8px #10B981;" id="led-${m.id}"></div>
            <h2 class="machine-name">${m.name}</h2>
        </div>
        
        <div style="display: flex; justify-content: space-between;">
            <div style="flex: 1; padding-right: 15px; border-right: 1px solid #F1F5F9;">
                <div class="data-row"><span class="data-label">Voltage L1</span><span class="data-value" id="v-${m.id}">---</span><span class="data-unit">V</span></div>
                <div class="data-row"><span class="data-label">Active Power</span><span class="data-value" style="color:#008FD5;" id="kw-${m.id}">---</span><span class="data-unit">kW</span></div>
                <div class="data-row"><span class="data-label">Total Energy</span><span class="data-value" style="color:#10B981;" id="kwh-${m.id}">---</span><span class="data-unit">MWh</span></div>
                <div class="data-row"><span class="data-label">CO₂ Eq.</span><span class="data-value" id="co2-${m.id}">---</span><span class="data-unit">Tons</span></div>
                <div class="data-row"><span class="data-label">THD-V (Harmonics)</span><span class="data-value" id="thdv-${m.id}">---</span><span class="data-unit">%</span></div>
            </div>
            <div style="flex: 1; padding-left: 10px;">
                <span class="data-label" style="display:block; text-align:center;">Phase Radar</span>
                <div class="radar-box"><canvas id="radar-${m.id}"></canvas></div>
            </div>
        </div>
    </div>`;
}

function initRadar(id) {
    const ctx = document.getElementById(`radar-${id}`).getContext('2d');
    machineRadars[id] = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['L1', 'L2', 'L3'],
            datasets: [
                { data: [0,0,0], borderColor: '#008FD5', backgroundColor: 'rgba(0,143,213,0.2)', borderWidth: 2 },
                { data: [0,0,0], borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.2)', borderWidth: 2 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { r: { ticks: { display: false } } }, plugins: { legend: { display: false } } }
    });
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch(`/static/data/machines_${CURRENT_SECTION}.json`);
        masterMachineList = await response.json();
        
        let gridHTML = '';
        let listHTML = '';
        let selectorsHTML = '';

        masterMachineList.forEach((m, idx) => {
            gridHTML += getPanelHTML(m);
            listHTML += `<li><a href="#" style="color:#94A3B8; display:block; padding:10px 20px; text-decoration:none;" onclick="event.preventDefault(); document.getElementById('panel-${m.id}').scrollIntoView({behavior: 'smooth'});">${m.name}</a></li>`;
            selectorsHTML += `<label style="font-size:12px; font-weight:700;"><input type="checkbox" class="hist-checkbox" value="${m.id}" ${idx < 3 ? 'checked' : ''} onchange="renderHistoryChart()"> ${m.name}</label>`;
        });

        document.getElementById('machine-grid').innerHTML = gridHTML;
        document.getElementById('machine-list').innerHTML = listHTML;
        document.getElementById('hist-machine-selectors').innerHTML = selectorsHTML;

        masterMachineList.forEach(m => initRadar(m.id));
        startPolling();
    } catch (err) { console.error("Load Failed:", err); }
});

// --- LIVE POLLING ---
function startPolling() {
    setInterval(async () => {
        try {
            const res = await fetch(`/api/live_data/${CURRENT_SECTION}`);
            const data = await res.json();
            
            for (const [id, d] of Object.entries(data)) {
                if(!document.getElementById(`v-${id}`)) continue;
                
                document.getElementById(`v-${id}`).textContent = d.v_l1 || '---';
                document.getElementById(`kw-${id}`).textContent = d.kw || '---';
                document.getElementById(`thdv-${id}`).textContent = d.thd_v || '0.0';
                
                // MWh and Carbon
                if (d.kwh_total) {
                    const mwh = parseFloat(d.kwh_total) / 1000;
                    document.getElementById(`kwh-${id}`).textContent = mwh.toFixed(1);
                    document.getElementById(`co2-${id}`).textContent = (mwh * 0.45).toFixed(1);
                }
                
                // Radar Update
                if (machineRadars[id] && d.v_l1) {
                    machineRadars[id].data.datasets[0].data = [d.v_l1, d.v_l2, d.v_l3];
                    machineRadars[id].data.datasets[1].data = [d.i_l1, d.i_l2, d.i_l3];
                    machineRadars[id].update('none');
                }

                // Status LED
                const led = document.getElementById(`led-${id}`);
                if(d.status === 'Online') {
                    led.style.background = '#10B981'; led.style.boxShadow = '0 0 8px #10B981';
                } else {
                    led.style.background = '#EF4444'; led.style.boxShadow = '0 0 8px #EF4444';
                }
            }
        } catch (err) {}
    }, 2000);
}

// --- TABS & HISTORY ---
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

async function fetchHistoryData() {
    const tf = document.getElementById('hist-timeframe').value;
    try {
        const res = await fetch(`/api/history/${CURRENT_SECTION}?timeframe=${tf}`);
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

// --- SUBSTATION AGGREGATE HEATMAP ---
function renderHeatmap() {
    if (Object.keys(rawHistoryData).length === 0) return;
    
    const heatMatrix = Array(7).fill().map(() => Array(24).fill(0));
    
    // Sum up the kW of EVERY machine in the substation for total load tracking!
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

function downloadCSV() { window.location.href = `/api/export_csv/${CURRENT_SECTION}?timeframe=${document.getElementById('hist-timeframe').value}`; }
function downloadPDF() { html2pdf().set({ margin: 0.2, filename: `${CURRENT_SECTION}_Report.pdf`, jsPDF: { format: 'a3', orientation: 'landscape' } }).from(document.getElementById('chart-export-area')).save(); }
