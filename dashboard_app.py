import os
import time
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, Request, Form, status, Body
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from datetime import timedelta
import uvicorn
import io
import csv

from apscheduler.schedulers.background import BackgroundScheduler

app = FastAPI(title="Tri-Pack Industrial Master SCADA")

app.add_middleware(SessionMiddleware, secret_key="tripack_super_secret_key_123")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- TIER 1: PLANT AREAS ---
SECTIONS = {
    "line4_lt1": {"name": "Line 4 - LT 01", "password": "tripack123"},
    "line4_lt2": {"name": "Line 4 - LT 02", "password": "tripack123"},
    "line5_sub1": {"name": "Line 5 - Substation 1", "password": "tripack123"},
    "line5_sub2": {"name": "Line 5 - Substation 2", "password": "tripack123"},
    "line5_sub3": {"name": "Line 5 - Substation 3", "password": "tripack123"},
    "individual_machines": {"name": "Main Incoming", "password": "tripack123"},
}

# --- TIER 2: MAIN INCOMING (NEW NETWORK) ---
INDIVIDUAL_MACHINES = {
    "inc_ext_delta_l4": {"name": "INCOMING Ext Delta Line 4", "password": "machine1"},
    "inc_l4_feeder_1": {"name": "INCOMING L4 Feeder 1", "password": "machine2"},
    "inc_ext_star_l4": {"name": "INCOMING Ext Star Line 4", "password": "machine3"},
    "inc_l4_feeder_2": {"name": "INCOMING L4 Feeder 2", "password": "machine4"},
    "inc_qm2_lvp_03": {"name": "INCOMING QM2 LVP-03", "password": "machine5"},
    "inc_qm3_lvp_01": {"name": "INCOMING QM3 LVP-01", "password": "machine6"},
    "inc_qm1_f12_lvp_02_b": {"name": "INCOMING QM1 F12 LVP-02 B", "password": "machine7"},
    "inc_qm1_f13_lvp_02_a": {"name": "INCOMING QM1 F13 LVP-02 A", "password": "machine8"},
    "inc_qm1_lvp_04": {"name": "INCOMING QM1 LVP-04", "password": "machine9"},
    "inc_qm3_lvp_05": {"name": "INCOMING QM3 LVP-05", "password": "machine10"},
    "inc_qm1_lvp_07": {"name": "INCOMING QM1 LVP-07", "password": "machine11"},
    "inc_qm3_lvp_06": {"name": "INCOMING QM3 LVP-06", "password": "machine12"},
    "inc_pending_13": {"name": "INCOMING 13 (Pending)", "password": "machine13"}
}

LIVE_DATA = {sec_id: {} for sec_id in SECTIONS.keys()}
DATABASE_URL = os.environ.get("DATABASE_URL")
last_db_write = {sec: 0 for sec in SECTIONS.keys()}

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

def send_daily_report():
    print("CRON: Generating automated daily management report...")
    pass

@app.on_event("startup")
def init_server():
    scheduler = BackgroundScheduler()
    scheduler.add_job(send_daily_report, 'cron', hour=8, minute=0)
    scheduler.start()
    
    if not DATABASE_URL: return
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS scada_history (
                id SERIAL PRIMARY KEY, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                section_id VARCHAR(50), machine_id VARCHAR(50),
                v_l1 REAL, i_l1 REAL, kw REAL, pf REAL, kwh REAL DEFAULT 0
            )
        ''')
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS section_id VARCHAR(50) DEFAULT 'line5_sub3';")
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS kwh REAL DEFAULT 0;")
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS v_l2 REAL DEFAULT 0;")
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS v_l3 REAL DEFAULT 0;")
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS i_l2 REAL DEFAULT 0;")
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS i_l3 REAL DEFAULT 0;")
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS thd_v REAL DEFAULT 0;")
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS thd_i REAL DEFAULT 0;")
        cur.execute('CREATE INDEX IF NOT EXISTS idx_machine_time ON scada_history(machine_id, timestamp);')
        conn.commit()
        cur.close()
        conn.close()
        print("✅ Database Upgraded for 3-Phase & THD Analytics!")
    except Exception as e: print(f"DB Error: {e}")

@app.get("/")
async def serve_hub(request: Request):
    return templates.TemplateResponse(request=request, name="hub.html", context={"sections": SECTIONS})

@app.post("/login/{section_id}")
async def login_submit(request: Request, section_id: str, password: str = Form(...)):
    if section_id not in SECTIONS: return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    sec = SECTIONS[section_id]
    if password == sec["password"]:
        auth_list = request.session.get("authorized", [])
        if section_id not in auth_list:
            auth_list.append(section_id)
            request.session["authorized"] = auth_list
        if section_id == "individual_machines": return RedirectResponse(url="/machine_hub", status_code=status.HTTP_303_SEE_OTHER)
        return RedirectResponse(url=f"/dashboard/{section_id}", status_code=status.HTTP_303_SEE_OTHER)
    return RedirectResponse(url="/?error=1", status_code=status.HTTP_303_SEE_OTHER)

@app.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)

@app.get("/dashboard/{section_id}")
async def serve_dashboard(request: Request, section_id: str):
    if section_id not in SECTIONS or section_id not in request.session.get("authorized", []):
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(request=request, name="index.html", context={"section_id": section_id, "section_name": SECTIONS[section_id]["name"]})

@app.get("/machine_hub")
async def serve_machine_hub(request: Request):
    if "individual_machines" not in request.session.get("authorized", []):
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(request=request, name="machine_hub.html", context={"machines": INDIVIDUAL_MACHINES})

@app.post("/login_machine/{machine_id}")
async def login_machine(request: Request, machine_id: str, password: str = Form(...)):
    if machine_id in INDIVIDUAL_MACHINES:
        m = INDIVIDUAL_MACHINES[machine_id]
        if password.strip() == m["password"]:
            m_auth_list = request.session.get("machine_auth", [])
            if machine_id not in m_auth_list:
                m_auth_list.append(machine_id)
                request.session["machine_auth"] = m_auth_list
            return RedirectResponse(url=f"/isolated/{machine_id}", status_code=status.HTTP_303_SEE_OTHER)
    return RedirectResponse(url="/machine_hub?error=1", status_code=status.HTTP_303_SEE_OTHER)

@app.get("/isolated/{machine_id}")
async def serve_isolated(request: Request, machine_id: str):
    if machine_id not in INDIVIDUAL_MACHINES or machine_id not in request.session.get("machine_auth", []):
        return RedirectResponse(url="/machine_hub", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(request=request, name="single_machine.html", context={"machine_id": machine_id, "machine_name": INDIVIDUAL_MACHINES[machine_id]["name"]})

@app.get("/api/live_data/{section_id}")
async def serve_api_data(section_id: str):
    return LIVE_DATA.get(section_id, {})

@app.post("/api/update_data/{section_id}")
async def update_live_data(section_id: str, data: dict = Body(...)):
    global LIVE_DATA, last_db_write
    if section_id not in SECTIONS: return {"status": "error"}
    LIVE_DATA[section_id] = data
    current_time = time.time()
    
    if DATABASE_URL and (current_time - last_db_write[section_id] >= 60):
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            for m_id, vals in data.items():
                if vals.get('status') == 'Online':
                    cur.execute('''
                        INSERT INTO scada_history 
                        (section_id, machine_id, v_l1, v_l2, v_l3, i_l1, i_l2, i_l3, kw, pf, kwh, thd_v, thd_i)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ''', (section_id, str(m_id), 
                          vals.get('v_l1', 0), vals.get('v_l2', 0), vals.get('v_l3', 0),
                          vals.get('i_l1', 0), vals.get('i_l2', 0), vals.get('i_l3', 0),
                          vals.get('kw', 0), vals.get('pf', 0), vals.get('kwh_total', 0),
                          vals.get('thd_v', 0), vals.get('thd_i', 0)))
            conn.commit()
            cur.close()
            conn.close()
            last_db_write[section_id] = current_time
        except Exception as e: print(f"Historian Write Error: {e}")
    return {"status": "success"}

def get_sql_interval(timeframe):
    intervals = {"1h": "1 HOUR", "8h": "8 HOURS", "24h": "24 HOURS", "7d": "7 DAYS", "30d": "30 DAYS"}
    return intervals.get(timeframe, "24 HOURS")

@app.get("/api/isolated_history/{machine_id}")
async def get_isolated_history(request: Request, machine_id: str, timeframe: str = "24h", start: str = None, end: str = None):
    if machine_id not in request.session.get("machine_auth", []): return {"error": "Unauthorized"}
    if not DATABASE_URL: return {"error": "No db"}
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        query = "SELECT machine_id, EXTRACT(EPOCH FROM timestamp) * 1000 AS ts, kw, i_l1, i_l2, i_l3, v_l1, v_l2, v_l3, pf, kwh, thd_v, thd_i FROM scada_history WHERE machine_id = %s"
        params = [machine_id]
        if timeframe == 'custom' and start and end:
            query += " AND timestamp >= CAST(%s AS TIMESTAMP) AND timestamp <= CAST(%s AS TIMESTAMP)"
            params.extend([start, end])
        else:
            query += f" AND timestamp >= NOW() - INTERVAL '{get_sql_interval(timeframe)}'"
        query += " ORDER BY timestamp ASC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        history = {machine_id: []}
        for row in rows:
            history[machine_id].append({ 
                "ts": row['ts'], "kw": row['kw'], "pf": row['pf'], "kwh": row['kwh'],
                "v_l1": row['v_l1'], "v_l2": row['v_l2'], "v_l3": row['v_l3'], 
                "i_l1": row['i_l1'], "i_l2": row['i_l2'], "i_l3": row['i_l3'],
                "thd_v": row['thd_v'], "thd_i": row['thd_i']
            })
        return history
    except Exception as e: return {"error": str(e)}

@app.get("/api/history/{section_id}")
async def get_history(section_id: str, timeframe: str = "24h", start: str = None, end: str = None):
    if not DATABASE_URL: return {"error": "No db"}
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        query = "SELECT machine_id, EXTRACT(EPOCH FROM timestamp) * 1000 AS ts, kw, i_l1, i_l2, i_l3, v_l1, v_l2, v_l3, pf, kwh, thd_v, thd_i FROM scada_history WHERE section_id = %s"
        params = [section_id]
        if timeframe == 'custom' and start and end:
            query += " AND timestamp >= CAST(%s AS TIMESTAMP) AND timestamp <= CAST(%s AS TIMESTAMP)"
            params.extend([start, end])
        else:
            query += f" AND timestamp >= NOW() - INTERVAL '{get_sql_interval(timeframe)}'"
        query += " ORDER BY timestamp ASC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        history = {}
        for row in rows:
            m_id = str(row['machine_id'])
            if m_id not in history: history[m_id] = []
            history[m_id].append({ 
                "ts": row['ts'], "kw": row['kw'], "pf": row['pf'], "kwh": row['kwh'],
                "v_l1": row['v_l1'], "v_l2": row['v_l2'], "v_l3": row['v_l3'], 
                "i_l1": row['i_l1'], "i_l2": row['i_l2'], "i_l3": row['i_l3'],
                "thd_v": row['thd_v'], "thd_i": row['thd_i']
            })
        return history
    except Exception as e: return {"error": str(e)}

@app.get("/api/export_csv/{section_id}")
async def export_csv(section_id: str, timeframe: str = "24h", start: str = None, end: str = None):
    if not DATABASE_URL: return {"error": "No db"}
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        query = "SELECT timestamp, machine_id, v_l1, v_l2, v_l3, i_l1, i_l2, i_l3, kw, pf, kwh, thd_v, thd_i FROM scada_history WHERE section_id = %s"
        params = [section_id]
        if timeframe == 'custom' and start and end:
            query += " AND timestamp >= CAST(%s AS TIMESTAMP) AND timestamp <= CAST(%s AS TIMESTAMP)"
            params.extend([start, end])
        else:
            query += f" AND timestamp >= NOW() - INTERVAL '{get_sql_interval(timeframe)}'"
        query += " ORDER BY timestamp DESC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Date & Time', 'Section', 'Machine ID', 'V_L1', 'V_L2', 'V_L3', 'I_L1', 'I_L2', 'I_L3', 'kW', 'PF', 'kWh', 'THD-V', 'THD-I'])
        for row in rows:
            fmt_time = (row['timestamp'] + timedelta(hours=5)).strftime('%d-%b-%Y %I:%M:%S %p') if row['timestamp'] else 'N/A'
            writer.writerow([fmt_time, section_id, row['machine_id'], row['v_l1'], row['v_l2'], row['v_l3'], row['i_l1'], row['i_l2'], row['i_l3'], row['kw'], row['pf'], row['kwh'], row['thd_v'], row['thd_i']])
        output.seek(0)
        headers = { 'Content-Disposition': f'attachment; filename="TriPack_{section_id}_Export.csv"' }
        return StreamingResponse(output, media_type="text/csv", headers=headers)
    except Exception as e: return {"error": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
