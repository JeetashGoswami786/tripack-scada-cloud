import os
import time
import psycopg2
from psycopg2.extras import RealDictCursor
import asyncio
from fastapi import FastAPI, Request, Form, status, Body
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import uvicorn
import io
import csv

app = FastAPI(title="Tri-Pack Industrial SCADA")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- GLOBAL MEMORY & AUTH ---
LIVE_DATA = {}
is_logged_in = False  

SCADA_USER = "admin"
SCADA_PASS = "tripack123"

# --- DATABASE CONFIG ---
DATABASE_URL = os.environ.get("DATABASE_URL")
last_db_write = 0

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

@app.on_event("startup")
def init_db():
    if not DATABASE_URL:
        print("WARNING: DATABASE_URL not found. History will not be saved.")
        return
        
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS scada_history (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                machine_id VARCHAR(50),
                v_l1 REAL,
                i_l1 REAL,
                kw REAL,
                pf REAL
            )
        ''')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_machine_time ON scada_history(machine_id, timestamp);')
        conn.commit()
        cur.close()
        conn.close()
        print("Database Initialized Successfully.")
    except Exception as e:
        print(f"Database Initialization Error: {e}")

# --- WEB ROUTES ---
@app.get("/")
async def serve_dashboard(request: Request):
    global is_logged_in
    if not is_logged_in:
        return RedirectResponse(url="/login", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse(request=request, name="login.html", context={"error": None})

@app.post("/login")
async def login_submit(request: Request, username: str = Form(...), password: str = Form(...)):
    global is_logged_in
    if username == SCADA_USER and password == SCADA_PASS:
        is_logged_in = True
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    
    return templates.TemplateResponse(request=request, name="login.html", context={"error": "Unauthorized Access. Invalid Credentials."})

@app.get("/logout")
async def logout():
    global is_logged_in
    is_logged_in = False
    return RedirectResponse(url="/login", status_code=status.HTTP_303_SEE_OTHER)

@app.get("/api/live_data")
async def serve_api_data():
    return LIVE_DATA

@app.post("/api/update_data")
async def update_live_data(data: dict = Body(...)):
    global LIVE_DATA, last_db_write
    LIVE_DATA = data
    
    current_time = time.time()
    if DATABASE_URL and (current_time - last_db_write >= 60):
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            for m_id, vals in data.items():
                if vals.get('status') == 'Online':
                    cur.execute('''
                        INSERT INTO scada_history (machine_id, v_l1, i_l1, kw, pf)
                        VALUES (%s, %s, %s, %s, %s)
                    ''', (str(m_id), vals.get('v_l1', 0), vals.get('i_l1', 0), vals.get('kw', 0), vals.get('pf', 0)))
            conn.commit()
            cur.close()
            conn.close()
            last_db_write = current_time
        except Exception as e:
            print(f"Historian Write Error: {e}")

    return {"status": "success"}

# --- HISTORY & REPORTING ROUTES ---
def get_sql_interval(timeframe):
    intervals = {"1h": "1 HOUR", "8h": "8 HOURS", "24h": "24 HOURS", "7d": "7 DAYS", "30d": "30 DAYS"}
    return intervals.get(timeframe, "24 HOURS")

@app.get("/api/history")
async def get_history(timeframe: str = "24h"):
    if not DATABASE_URL:
        return {"error": "No database connected"}
        
    interval_sql = get_sql_interval(timeframe)
        
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(f'''
            SELECT machine_id, EXTRACT(EPOCH FROM timestamp) * 1000 AS ts, kw, i_l1, v_l1, pf 
            FROM scada_history 
            WHERE timestamp >= NOW() - INTERVAL '{interval_sql}'
            ORDER BY timestamp ASC
        ''')
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

@app.get("/api/export_csv")
async def export_csv(timeframe: str = "24h"):
    if not DATABASE_URL:
        return {"error": "No database connected"}
        
    interval_sql = get_sql_interval(timeframe)
    
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(f'''
            SELECT timestamp, machine_id, v_l1, i_l1, kw, pf 
            FROM scada_history 
            WHERE timestamp >= NOW() - INTERVAL '{interval_sql}'
            ORDER BY timestamp DESC
        ''')
        rows = cur.fetchall()
        cur.close()
        conn.close()

        output = io.StringIO()
        writer = csv.writer(output)
        # Updated Headers
        writer.writerow(['Date & Time', 'Machine ID', 'Voltage L1 (V)', 'Current L1 (A)', 'Active Power (kW)', 'Power Factor'])
        
        for row in rows:
            # FIX: Formatted as "23-Jun-2026 10:35:42 AM" so Excel cannot ruin it
            fmt_time = row['timestamp'].strftime('%d-%b-%Y %I:%M:%S %p') if row['timestamp'] else 'N/A'
            writer.writerow([fmt_time, row['machine_id'], row['v_l1'], row['i_l1'], row['kw'], row['pf']])
        
        output.seek(0)
        headers = { 'Content-Disposition': f'attachment; filename="TriPack_SCADA_Export_{timeframe}.csv"' }
        return StreamingResponse(output, media_type="text/csv", headers=headers)
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
