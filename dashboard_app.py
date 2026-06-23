import os
import time
import psycopg2
from psycopg2.extras import RealDictCursor
import asyncio
from fastapi import FastAPI, Request, Form, status, Body, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from datetime import timedelta
import uvicorn
import io
import csv

app = FastAPI(title="Tri-Pack Industrial Master SCADA")

# --- MULTI-USER SECURITY ENGINE ---
# This enables secure, separate browser cookies for different users
app.add_middleware(SessionMiddleware, secret_key="tripack_super_secret_key_123")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- PORTAL CONFIGURATION ---
# Here you define all your sections and their unique passwords!
SECTIONS = {
    "line4_lt1": {"name": "Line 4 - LT 01", "password": "pass_line4"},
    "line4_lt2": {"name": "Line 4 - LT 02", "password": "pass_line4"},
    "line5_sub1": {"name": "Line 5 - Substation 1", "password": "pass_line5"},
    "line5_sub2": {"name": "Line 5 - Substation 2", "password": "pass_line5"},
    "line5_sub3": {"name": "Line 5 - Substation 3", "password": "tripack123"},
}

# Creates a separate data bucket for every line in the factory
LIVE_DATA = {sec_id: {} for sec_id in SECTIONS.keys()}

# --- DATABASE CONFIG ---
DATABASE_URL = os.environ.get("DATABASE_URL")
last_db_write = {sec: 0 for sec in SECTIONS.keys()}

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

@app.on_event("startup")
def init_db():
    if not DATABASE_URL:
        return
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Creates table if it's a new database
        cur.execute('''
            CREATE TABLE IF NOT EXISTS scada_history (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                section_id VARCHAR(50) DEFAULT 'line5_sub3',
                machine_id VARCHAR(50),
                v_l1 REAL,
                i_l1 REAL,
                kw REAL,
                pf REAL
            )
        ''')
        # Safely upgrades your existing database to support multi-sections
        cur.execute("ALTER TABLE scada_history ADD COLUMN IF NOT EXISTS section_id VARCHAR(50) DEFAULT 'line5_sub3';")
        cur.execute('CREATE INDEX IF NOT EXISTS idx_machine_time ON scada_history(machine_id, timestamp);')
        conn.commit()
        cur.close()
        conn.close()
        print("Master Database Initialized Successfully.")
    except Exception as e:
        print(f"Database Initialization Error: {e}")


# ==========================================
# 1. THE HUB & SECURITY ROUTES
# ==========================================

@app.get("/")
async def serve_hub(request: Request):
    # This will render the new Master Portal Home Page with the cards
    return templates.TemplateResponse(request=request, name="hub.html", context={"sections": SECTIONS})

@app.post("/login/{section_id}")
async def login_submit(request: Request, section_id: str, password: str = Form(...)):
    if section_id not in SECTIONS:
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
        
    # Check if the provided password matches the specific section's password
    if password == SECTIONS[section_id]["password"]:
        # Initialize authorized list if missing
        if "authorized" not in request.session:
            request.session["authorized"] = []
            
        # Give them the digital key for this specific line
        if section_id not in request.session["authorized"]:
            request.session["authorized"].append(section_id)
            
        return RedirectResponse(url=f"/dashboard/{section_id}", status_code=status.HTTP_303_SEE_OTHER)
    
    # If wrong password, reload the hub (we will add error messages later)
    return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)

@app.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)


# ==========================================
# 2. DASHBOARD ROUTES (Per Section)
# ==========================================

@app.get("/dashboard/{section_id}")
async def serve_dashboard(request: Request, section_id: str):
    if section_id not in SECTIONS:
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
        
    # Security Check: Does this user have the cookie for this specific section?
    authorized_sections = request.session.get("authorized", [])
    if section_id not in authorized_sections:
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
        
    # Serve the dashboard, passing the section details to the HTML
    return templates.TemplateResponse(
        request=request, 
        name="index.html", 
        context={"section_id": section_id, "section_name": SECTIONS[section_id]["name"]}
    )

@app.get("/api/live_data/{section_id}")
async def serve_api_data(section_id: str):
    if section_id in LIVE_DATA:
        return LIVE_DATA[section_id]
    return {}


# ==========================================
# 3. EDGE PUSHER ROUTE
# ==========================================

@app.post("/api/update_data/{section_id}")
async def update_live_data(section_id: str, data: dict = Body(...)):
    global LIVE_DATA, last_db_write
    
    if section_id not in SECTIONS:
        return {"status": "error", "message": "Invalid section ID"}
        
    LIVE_DATA[section_id] = data
    
    current_time = time.time()
    # Check the specific stopwatch for the section that is pushing data
    if DATABASE_URL and (current_time - last_db_write[section_id] >= 60):
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            for m_id, vals in data.items():
                if vals.get('status') == 'Online':
                    cur.execute('''
                        INSERT INTO scada_history (section_id, machine_id, v_l1, i_l1, kw, pf)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    ''', (section_id, str(m_id), vals.get('v_l1', 0), vals.get('i_l1', 0), vals.get('kw', 0), vals.get('pf', 0)))
            conn.commit()
            cur.close()
            conn.close()
            # Reset this specific line's stopwatch
            last_db_write[section_id] = current_time
        except Exception as e:
            print(f"Historian Write Error: {e}")

    return {"status": "success"}


# ==========================================
# 4. HISTORY & EXPORT ROUTES
# ==========================================

def get_sql_interval(timeframe):
    intervals = {"1h": "1 HOUR", "8h": "8 HOURS", "24h": "24 HOURS", "7d": "7 DAYS", "30d": "30 DAYS"}
    return intervals.get(timeframe, "24 HOURS")

@app.get("/api/history/{section_id}")
async def get_history(section_id: str, timeframe: str = "24h"):
    if not DATABASE_URL:
        return {"error": "No database connected"}
        
    interval_sql = get_sql_interval(timeframe)
        
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # ONLY fetch history for the specific section requested
        cur.execute(f'''
            SELECT machine_id, EXTRACT(EPOCH FROM timestamp) * 1000 AS ts, kw, i_l1, v_l1, pf 
            FROM scada_history 
            WHERE section_id = %s AND timestamp >= NOW() - INTERVAL '{interval_sql}'
            ORDER BY timestamp ASC
        ''', (section_id,))
        rows = cur.fetchall()
        cur.close()
        conn.close()

        history = {}
        for row in rows:
            m_id = str(row['machine_id'])
            if m_id not in history:
                history[m_id] = []
            history[m_id].append({ "ts": row['ts'], "kw": row['kw'], "i_l1": row['i_l1'], "v_l1": row['v_l1'], "pf": row['pf'] })
        return history
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/export_csv/{section_id}")
async def export_csv(section_id: str, timeframe: str = "24h"):
    if not DATABASE_URL:
        return {"error": "No database connected"}
        
    interval_sql = get_sql_interval(timeframe)
    
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(f'''
            SELECT timestamp, machine_id, v_l1, i_l1, kw, pf 
            FROM scada_history 
            WHERE section_id = %s AND timestamp >= NOW() - INTERVAL '{interval_sql}'
            ORDER BY timestamp DESC
        ''', (section_id,))
        rows = cur.fetchall()
        cur.close()
        conn.close()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Date & Time', 'Section', 'Machine ID', 'Voltage L1 (V)', 'Current L1 (A)', 'Active Power (kW)', 'Power Factor'])
        
        for row in rows:
            if row['timestamp']:
                pkt_time = row['timestamp'] + timedelta(hours=5)
                fmt_time = pkt_time.strftime('%d-%b-%Y %I:%M:%S %p')
            else:
                fmt_time = 'N/A'
                
            writer.writerow([fmt_time, section_id, row['machine_id'], row['v_l1'], row['i_l1'], row['kw'], row['pf']])
        
        output.seek(0)
        headers = { 'Content-Disposition': f'attachment; filename="TriPack_{section_id}_Export_{timeframe}.csv"' }
        return StreamingResponse(output, media_type="text/csv", headers=headers)
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
