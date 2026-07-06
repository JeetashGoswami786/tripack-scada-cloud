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

# --- TIER 1: PLANT AREAS (ADDED LINE 3) ---
SECTIONS = {
    "line3": {"name": "Line 3", "password": "tripack123"},
    "line3_ems": {"name": "Line 3 EMS", "password": "tripack123"},
    "line4_lt1": {"name": "Line 4 - LT 01", "password": "tripack123"},
    "line4_lt2": {"name": "Line 4 - LT 02", "password": "tripack123"},
    "line5_sub1": {"name": "Line 5 - Substation 1", "password": "tripack123"},
    "line5_sub2": {"name": "Line 5 - Substation 2", "password": "tripack123"},
    "line5_sub3": {"name": "Line 5 - Substation 3", "password": "tripack123"},
}

# --- TIER 2: ISOLATED DIRECTORIES ---
# --- TIER 2: ISOLATED DIRECTORIES ---
# --- TIER 2: ISOLATED DIRECTORIES ---
MAIN_INCOMING = {
    "inc_ext_delta_l4": {"name": "INCOMING Ext Delta Line 4", "password": "machine1"},
    "inc_l4_feeder_1": {"name": "INCOMING L4 Feeder 1", "password": "machine2"},
    "inc_ext_star_l4": {"name": "INCOMING Ext Star Line 4", "password": "machine3"},
    "inc_l4_feeder_2": {"name": "INCOMING L4 Feeder 2", "password": "machine4"},
    
    "inc_qm2_lvp_03": {"name": "Line5 LT1 Feeder 3 (QM2)", "password": "machine5"},
    "inc_qm3_lvp_01": {"name": "Line5 LT1 Feeder 1 (QM3)", "password": "machine6"},
    "inc_qm1_f12_lvp_02_b": {"name": "Line5 LT1 Feeder 2 Ext Delta (QM1 F12)", "password": "machine7"},
    "inc_qm1_f13_lvp_02_a": {"name": "Line5 LT1 Feeder 2 Ext Star (QM1 F13)", "password": "machine8"},
    "inc_qm1_lvp_04": {"name": "Line5 LT2 Feeder 4 (QM1)", "password": "machine9"},
    "inc_qm3_lvp_05": {"name": "Line5 LT2 Feeder 5 (QM3)", "password": "machine10"},
    "inc_qm1_lvp_07": {"name": "Line5 LT3 Feeder 7 (QM1)", "password": "machine11"},
    "inc_qm3_lvp_06": {"name": "Line5 LT3 Feeder 6 (QM3)", "password": "machine12"},
    
    "inc_l3_feeder_1": {"name": "Line3 Feeder 1 (TR1)", "password": "machine13"},
    "inc_l3_feeder_2": {"name": "Line3 Feeder 2 (TR2)", "password": "machine14"},
    "inc_cpp_met": {"name": "Line3 Feeder 3 (CPP)", "password": "machine15"},
    
    # CONSOLIDATED CPP PLANTS
    "inc_cpp2": {"name": "CPP2 Plant", "password": "machine16"},
    "inc_cpp1": {"name": "CPP1 Plant", "password": "machine18"}
}

INDIVIDUAL_MACHINES = {
    "m_ps5": {"name": "PS 5 (BOPP)", "password": "machine16"},
    "m_ps7": {"name": "PS 7 (BOPP)", "password": "machine17"},
    "m_k52": {"name": "K5 2 (BOPP)", "password": "machine18"},
    "m_ss10": {"name": "SS-10", "password": "machine19"},
    "m_k5_expert": {"name": "K-5 Expert", "password": "machine20"}, # REPLACED K5 4 WITH K-5 EXPERT
    "m_ss14": {"name": "SS-14", "password": "machine21"},
    "m_erema3": {"name": "Erema 3", "password": "machine22"},
    "m_erema4": {"name": "Erema 4", "password": "machine23"},
    "m_ss04": {"name": "SS-04", "password": "machine24"},
    "m_ss12": {"name": "SS-12", "password": "machine25"},
    "m_ss13": {"name": "SS-13", "password": "machine26"},
    "m_ss09": {"name": "SS-09", "password": "machine27"},
    "m_ss11": {"name": "SS-11", "password": "machine28"},
    "m_ss08": {"name": "SS-08", "password": "machine29"},
    "m_cpp1": {"name": "CPP 1", "password": "machine30"},
    "m_cpp2": {"name": "CPP 2", "password": "machine31"},
    "m_k51": {"name": "K5 1 (CPP)", "password": "machine32"},
    "m_ps4": {"name": "PS 4 (CPP)", "password": "machine33"},
    "m_k53": {"name": "K5 3 (CPP)", "password": "machine34"},
    "m_ps6": {"name": "PS 6 (CPP)", "password": "machine35"},
    "m_tape_line": {"name": "Tape Line Machine", "password": "machine37"},
    "m_tape_slitter": {"name": "Tape Machine Slitter", "password": "machine38"}
}

LIVE_DATA = {sec_id: {} for sec_id in SECTIONS.keys()}
LIVE_DATA["individual_machines"] = {}
DATABASE_URL = os.environ.get("DATABASE_URL")
last_db_write = {sec: 0 for sec in SECTIONS.keys()}
last_db_write["individual_machines"] = 0

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

def send_daily_report(): pass

@app.on_event("startup")
def init_server():
    scheduler = BackgroundScheduler()
    scheduler.add_job(send_daily_report, 'cron', hour=8, minute=0)
    scheduler.start()
    if not DATABASE_URL: return
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('''CREATE TABLE IF NOT EXISTS scada_history (
            id SERIAL PRIMARY KEY, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            section_id VARCHAR(50), machine_id VARCHAR(50),
            v_l1 REAL, i_l1 REAL, kw REAL, pf REAL, kwh REAL DEFAULT 0,
            v_l2 REAL DEFAULT 0, v_l3 REAL DEFAULT 0, i_l2 REAL DEFAULT 0, i_l3 REAL DEFAULT 0,
            thd_v REAL DEFAULT 0, thd_i REAL DEFAULT 0)''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_machine_time ON scada_history(machine_id, timestamp);')
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e: print(f"DB Error: {e}")

# ==========================================
# --- CRASH-FREE ROUTING ---
# ==========================================
# ==========================================
# --- CRASH-FREE ROUTING ---
# ==========================================
# ==========================================
# --- CRASH-FREE ROUTING ---
# ==========================================
@app.get("/")
async def serve_hub(request: Request):
    return templates.TemplateResponse(
        request=request, 
        name="hub.html", 
        context={
            "sections": SECTIONS,
            "individual_machines": INDIVIDUAL_MACHINES,
            "main_incoming": MAIN_INCOMING # Added to dynamically build the Incoming dropdown
        }
    )

@app.post("/login/{section_id}")
async def login_submit(request: Request, section_id: str, password: str = Form(...)):
    if section_id not in SECTIONS: return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    if password == SECTIONS[section_id]["password"]:
        auth_list = request.session.get("authorized", [])
        if section_id not in auth_list:
            auth_list.append(section_id)
            request.session["authorized"] = auth_list
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

@app.post("/login_machine/{machine_id}")
async def login_machine(request: Request, machine_id: str, password: str = Form(...)):
    m = MAIN_INCOMING.get(machine_id) or INDIVIDUAL_MACHINES.get(machine_id)
    if m and password.strip() == m["password"]:
        m_auth_list = request.session.get("machine_auth", [])
        if machine_id not in m_auth_list:
            m_auth_list.append(machine_id)
            request.session["machine_auth"] = m_auth_list
        return RedirectResponse(url=f"/isolated/{machine_id}", status_code=status.HTTP_303_SEE_OTHER)
    # If the password is wrong, redirect back to the Hub with an error flag
    return RedirectResponse(url="/?error=1", status_code=status.HTTP_303_SEE_OTHER)

@app.get("/isolated/{machine_id}")
async def serve_isolated(request: Request, machine_id: str):
    if machine_id not in request.session.get("machine_auth", []):
        # If unauthorized, return directly to the Master Hub
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    m = MAIN_INCOMING.get(machine_id) or INDIVIDUAL_MACHINES.get(machine_id)
    return templates.TemplateResponse(request=request, name="single_machine.html", context={"machine_id": machine_id, "machine_name": m["name"]})
# ==========================================
# --- DATA APIs ---
# ==========================================
@app.get("/api/live_data/{section_id}")
async def serve_api_data(section_id: str):
    return LIVE_DATA.get(section_id, {})

@app.post("/api/update_data/{section_id}")
async def update_live_data(section_id: str, data: dict = Body(...)):
    global LIVE_DATA, last_db_write
    if section_id not in SECTIONS and section_id != "individual_machines": return {"status": "error"}
    
    LIVE_DATA[section_id] = data
    current_time = time.time()
    
    if DATABASE_URL and (current_time - last_db_write.get(section_id, 0) >= 60):
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
        except Exception as e: pass
    return {"status": "success"}

def get_sql_interval(timeframe):
    return {"1h": "1 HOUR", "8h": "8 HOURS", "24h": "24 HOURS", "7d": "7 DAYS", "30d": "30 DAYS"}.get(timeframe, "24 HOURS")

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
        else: query += f" AND timestamp >= NOW() - INTERVAL '{get_sql_interval(timeframe)}'"
        query += " ORDER BY timestamp ASC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        history = {machine_id: [{"ts": r['ts'], "kw": r['kw'], "pf": r['pf'], "kwh": r['kwh'], "v_l1": r['v_l1'], "i_l1": r['i_l1'], "thd_v": r['thd_v']} for r in rows]}
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
        else: query += f" AND timestamp >= NOW() - INTERVAL '{get_sql_interval(timeframe)}'"
        query += " ORDER BY timestamp ASC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        history = {}
        for row in rows:
            m_id = str(row['machine_id'])
            if m_id not in history: history[m_id] = []
            history[m_id].append({"ts": row['ts'], "kw": row['kw'], "pf": row['pf'], "kwh": row['kwh'], "v_l1": row['v_l1'], "i_l1": row['i_l1'], "thd_v": row['thd_v']})
        return history
    except Exception as e: return {"error": str(e)}

@app.get("/api/export_csv/{section_id}")
async def export_csv(section_id: str, timeframe: str = "24h", start: str = None, end: str = None):
    if not DATABASE_URL: return {"error": "No db"}
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        query = "SELECT timestamp, machine_id, v_l1, i_l1, kw, pf, kwh, thd_v, thd_i FROM scada_history WHERE section_id = %s"
        params = [section_id]
        if timeframe == 'custom' and start and end:
            query += " AND timestamp >= CAST(%s AS TIMESTAMP) AND timestamp <= CAST(%s AS TIMESTAMP)"
            params.extend([start, end])
        else: query += f" AND timestamp >= NOW() - INTERVAL '{get_sql_interval(timeframe)}'"
        query += " ORDER BY timestamp DESC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Date & Time', 'Section', 'Machine ID', 'V_L1', 'I_L1', 'kW', 'PF', 'kWh', 'THD-V', 'THD-I'])
        for row in rows:
            fmt_time = (row['timestamp'] + timedelta(hours=5)).strftime('%d-%b-%Y %I:%M:%S %p') if row['timestamp'] else 'N/A'
            writer.writerow([fmt_time, section_id, row['machine_id'], row['v_l1'], row['i_l1'], row['kw'], row['pf'], row['kwh'], row['thd_v'], row['thd_i']])
        output.seek(0)
        return StreamingResponse(output, media_type="text/csv", headers={'Content-Disposition': f'attachment; filename="TriPack_{section_id}_Export.csv"'})
    except Exception as e: return {"error": str(e)}

@app.get("/api/monthly_stats/{section_id}")
async def get_monthly_stats(section_id: str):
    if not DATABASE_URL: return {}
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        cur.execute("SELECT machine_id, MAX(kwh) as max_kwh, MIN(kwh) as min_kwh, AVG(kw) AS current_avg_kw FROM scada_history WHERE section_id = %s AND timestamp >= DATE_TRUNC('month', CURRENT_DATE) GROUP BY machine_id", (section_id,))
        curr_data = cur.fetchall()
        
        cur.execute("SELECT machine_id, MAX(kwh) as max_kwh, MIN(kwh) as min_kwh FROM scada_history WHERE section_id = %s AND timestamp >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND timestamp < DATE_TRUNC('month', CURRENT_DATE) GROUP BY machine_id", (section_id,))
        past_data = cur.fetchall()
        
        cur.close()
        conn.close()
        
        def safe_energy(max_val, min_val):
            if max_val is None or min_val is None: return 0.0
            v_max = max_val / 1000 if max_val > 100000000 else max_val
            v_min = min_val / 1000 if min_val > 100000000 else min_val
            return max(0, v_max - v_min) # Now returns pure kWh!
            
        stats = {}
        for row in curr_data:
            m_id = str(row['machine_id'])
            stats[m_id] = { "current_month_energy": round(safe_energy(row['max_kwh'], row['min_kwh']), 2), "current_month_avg_kw": round(row['current_avg_kw'] or 0, 2), "past_month_energy": 0.0 }
        for row in past_data:
            m_id = str(row['machine_id'])
            if m_id in stats: stats[m_id]["past_month_energy"] = round(safe_energy(row['max_kwh'], row['min_kwh']), 2)
            else: stats[m_id] = { "current_month_energy": 0.0, "current_month_avg_kw": 0.0, "past_month_energy": round(safe_energy(row['max_kwh'], row['min_kwh']), 2) }
        return stats
    except Exception as e: return {}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
