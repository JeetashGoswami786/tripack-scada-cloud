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

app = FastAPI(title="Tri-Pack Industrial Master SCADA")

app.add_middleware(SessionMiddleware, secret_key="tripack_super_secret_key_123")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- TIER 1: PLANT AREAS (Passwords Simplified) ---
SECTIONS = {
    "line4_lt1": {"name": "Line 4 - LT 01", "password": "tripack123"},
    "line4_lt2": {"name": "Line 4 - LT 02", "password": "tripack123"},
    "line5_sub1": {"name": "Line 5 - Substation 1", "password": "tripack123"},
    "line5_sub2": {"name": "Line 5 - Substation 2", "password": "tripack123"},
    "line5_sub3": {"name": "Line 5 - Substation 3", "password": "tripack123"},
    "individual_machines": {"name": "Individual Machines", "password": "tripack123"},
}

# --- TIER 2: ISOLATED MACHINES (Passwords Simplified) ---
INDIVIDUAL_MACHINES = {
    "ps_5": {"name": "PS 5 (BOPP)", "password": "machine1"},
    "ps_7": {"name": "PS 7 (BOPP)", "password": "machine2"},
    "cpp_1": {"name": "CPP 1", "password": "machine3"},
    "k5_1": {"name": "K5 1 (CPP)", "password": "machine4"},
    "ps_4": {"name": "PS 4 (CPP)", "password": "machine5"},
    "cpp_2": {"name": "CPP 2", "password": "machine6"},
    "k5_3": {"name": "K5 3 (CPP)", "password": "machine7"},
    "ps_6": {"name": "PS 6 (CPP)", "password": "machine8"},
    "k5_2": {"name": "K5 2 (BOPP)", "password": "machine9"},
    "ss_10": {"name": "SS-10", "password": "machine10"},
    "k5_4": {"name": "K5 4 (BOPP)", "password": "machine11"},
    "ss_14": {"name": "SS-14", "password": "machine12"},
    "erema_3": {"name": "Erema 3", "password": "machine13"},
    "erema_4": {"name": "Erema 4", "password": "machine14"},
    "ss_04": {"name": "SS-04", "password": "machine15"},
    "ss_12": {"name": "SS-12", "password": "machine16"},
    "ss_13": {"name": "SS-13", "password": "machine17"},
    "ss_08": {"name": "SS-08", "password": "machine18"},
    "ss_09": {"name": "SS-09", "password": "machine19"},
    "ss_11": {"name": "SS-11", "password": "machine20"},
}

LIVE_DATA = {sec_id: {} for sec_id in SECTIONS.keys()}
DATABASE_URL = os.environ.get("DATABASE_URL")
last_db_write = {sec: 0 for sec in SECTIONS.keys()}

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

@app.on_event("startup")
def init_db():
    if not DATABASE_URL: return
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS scada_history (
                id SERIAL PRIMARY KEY, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                section_id VARCHAR(50) DEFAULT 'line5_sub3', machine_id VARCHAR(50),
                v_l1 REAL, i_l1 REAL, kw REAL, pf REAL, kwh REAL DEFAULT 0
            )
        ''')
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS section_id VARCHAR(50) DEFAULT 'line5_sub3';")
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS kwh REAL DEFAULT 0;")
        cur.execute('CREATE INDEX IF NOT EXISTS idx_machine_time ON scada_history(machine_id, timestamp);')
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e: print(f"DB Error: {e}")

# ==========================================
# 1. TIER 1 SECURITY (MAIN HUB)
# ==========================================

@app.get("/")
async def serve_hub(request: Request):
    return templates.TemplateResponse(request=request, name="hub.html", context={"sections": SECTIONS})

@app.post("/login/{section_id}")
async def login_submit(request: Request, section_id: str, password: str = Form(...)): # NO USERNAME REQUIRED
    if section_id not in SECTIONS:
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
        
    sec = SECTIONS[section_id]
            
    # Check password
    if password == sec["password"]:
        if "authorized" not in request.session: 
            request.session["authorized"] = []
        if section_id not in request.session["authorized"]: 
            request.session["authorized"].append(section_id)
            
        if section_id == "individual_machines":
            return RedirectResponse(url="/machine_hub", status_code=status.HTTP_303_SEE_OTHER)
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

# ==========================================
# 2. TIER 2 SECURITY (INDIVIDUAL MACHINES)
# ==========================================

@app.get("/machine_hub")
async def serve_machine_hub(request: Request):
    if "individual_machines" not in request.session.get("authorized", []):
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(request=request, name="machine_hub.html", context={"machines": INDIVIDUAL_MACHINES})

@app.post("/login_machine/{machine_id}")
async def login_machine(request: Request, machine_id: str, password: str = Form(...)): # NO USERNAME REQUIRED
    if machine_id in INDIVIDUAL_MACHINES:
        m = INDIVIDUAL_MACHINES[machine_id]
        
        # Clean the password input to prevent accidental spaces
        clean_pass = password.strip()
        
        if clean_pass == m["password"]:
            if "machine_auth" not in request.session: request.session["machine_auth"] = []
            if machine_id not in request.session["machine_auth"]: request.session["machine_auth"].append(machine_id)
            return RedirectResponse(url=f"/isolated/{machine_id}", status_code=status.HTTP_303_SEE_OTHER)
            
    # Redirect back to sub-hub if failed
    return RedirectResponse(url="/machine_hub?error=1", status_code=status.HTTP_303_SEE_OTHER)

@app.get("/isolated/{machine_id}")
async def serve_isolated(request: Request, machine_id: str):
    if machine_id not in INDIVIDUAL_MACHINES or machine_id not in request.session.get("machine_auth", []):
        return RedirectResponse(url="/machine_hub", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(request=request, name="single_machine.html", context={"machine_id": machine_id, "machine_name": INDIVIDUAL_MACHINES[machine_id]["name"]})

# ==========================================
# 3. EDGE DATA SYNCHRONIZATION
# ==========================================

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
                        INSERT INTO scada_history (section_id, machine_id, v_l1, i_l1, kw, pf, kwh)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ''', (section_id, str(m_id), vals.get('v_l1', 0), vals.get('i_l1', 0), vals.get('kw', 0), vals.get('pf', 0), vals.get('kwh_total', 0)))
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
    if machine_id not in request.session.get("machine_auth", []): return {"error": "Unauthorized Data Request"}
    if not DATABASE_URL: return {"error": "No db"}
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        query = "SELECT machine_id, EXTRACT(EPOCH FROM timestamp) * 1000 AS ts, kw, i_l1, v_l1, pf, kwh FROM scada_history WHERE machine_id = %s"
        params = [machine_id]
        if timeframe == 'custom' and start and end:
            query += " AND timestamp >= CAST(%s AS TIMESTAMP) AND timestamp <= CAST(%s AS TIMESTAMP)"
            params.extend([start, end])
        else:
            interval_sql = get_sql_interval(timeframe)
            query += f" AND timestamp >= NOW() - INTERVAL '{interval_sql}'"
        query += " ORDER BY timestamp ASC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        history = {}
        history[machine_id] = []
        for row in rows:
            history[machine_id].append({ "ts": row['ts'], "kw": row['kw'], "i_l1": row['i_l1'], "v_l1": row['v_l1'], "pf": row['pf'], "kwh": row['kwh'] })
        return history
    except Exception as e: return {"error": str(e)}

@app.get("/api/history/{section_id}")
async def get_history(section_id: str, timeframe: str = "24h", start: str = None, end: str = None):
    if not DATABASE_URL: return {"error": "No db"}
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        query = "SELECT machine_id, EXTRACT(EPOCH FROM timestamp) * 1000 AS ts, kw, i_l1, v_l1, pf, kwh FROM scada_history WHERE section_id = %s"
        params = [section_id]
        if timeframe == 'custom' and start and end:
            query += " AND timestamp >= CAST(%s AS TIMESTAMP) AND timestamp <= CAST(%s AS TIMESTAMP)"
            params.extend([start, end])
        else:
            interval_sql = get_sql_interval(timeframe)
            query += f" AND timestamp >= NOW() - INTERVAL '{interval_sql}'"
        query += " ORDER BY timestamp ASC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        history = {}
        for row in rows:
            m_id = str(row['machine_id'])
            if m_id not in history: history[m_id] = []
            history[m_id].append({ "ts": row['ts'], "kw": row['kw'], "i_l1": row['i_l1'], "v_l1": row['v_l1'], "pf": row['pf'], "kwh": row['kwh'] })
        return history
    except Exception as e: return {"error": str(e)}

@app.get("/api/export_csv/{section_id}")
async def export_csv(section_id: str, timeframe: str = "24h", start: str = None, end: str = None):
    if not DATABASE_URL: return {"error": "No db"}
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        query = "SELECT timestamp, machine_id, v_l1, i_l1, kw, pf, kwh FROM scada_history WHERE section_id = %s"
        params = [section_id]
        if timeframe == 'custom' and start and end:
            query += " AND timestamp >= CAST(%s AS TIMESTAMP) AND timestamp <= CAST(%s AS TIMESTAMP)"
            params.extend([start, end])
        else:
            interval_sql = get_sql_interval(timeframe)
            query += f" AND timestamp >= NOW() - INTERVAL '{interval_sql}'"
        query += " ORDER BY timestamp DESC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Date & Time', 'Section', 'Machine ID', 'Voltage L1 (V)', 'Current L1 (A)', 'Active Power (kW)', 'Power Factor', 'Active Energy (kWh)'])
        for row in rows:
            if row['timestamp']:
                pkt_time = row['timestamp'] + timedelta(hours=5)
                fmt_time = pkt_time.strftime('%d-%b-%Y %I:%M:%S %p')
            else:
                fmt_time = 'N/A'
            writer.writerow([fmt_time, section_id, row['machine_id'], row['v_l1'], row['i_l1'], row['kw'], row['pf'], row['kwh']])
        output.seek(0)
        headers = { 'Content-Disposition': f'attachment; filename="TriPack_{section_id}_Export.csv"' }
        return StreamingResponse(output, media_type="text/csv", headers=headers)
    except Exception as e: return {"error": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
