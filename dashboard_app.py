import asyncio
import struct
from fastapi import FastAPI, Request, Form, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pymodbus.client import ModbusTcpClient
import uvicorn

app = FastAPI(title="Tri-Pack Industrial SCADA")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- GLOBAL MEMORY & AUTH ---
LIVE_DATA = {}
is_logged_in = False  

SCADA_USER = "admin"
SCADA_PASS = "tripack123"

# --- LOCAL WEEKEND TESTING CONFIG ---
GATEWAY_IP = '127.0.0.1'  
GATEWAY_PORT = 5023

SUBSTATION_3_METERS = [
    {"id": 1, "name": "1Q2 F111 (Tape Line)"},
    {"id": 2, "name": "INCOMING QM1 LVP-07"},
    {"id": 3, "name": "1Q4 F107 (Chilling of Slitting)"},
    {"id": 5, "name": "1Q9 (Crane)"},
    {"id": 6, "name": "1Q10 F119 (Conveyors)"}
]

def decode_float(r1, r2):
    """Bulletproof float decoder that ignores pymodbus library version issues"""
    return struct.unpack('>f', struct.pack('>HH', r1, r2))[0]

def poll_meters():
    client = ModbusTcpClient(GATEWAY_IP, port=GATEWAY_PORT, timeout=2)
    
    if client.connect():
        for meter in SUBSTATION_3_METERS:
            current_meter = {"name": meter["name"]}
            device_id = meter["id"]
            
            try:
                # --- BULLETPROOF PYMODBUS ROUTER ---
                # Resolves version fragmentation across different PCs
                try:
                    # Newest Pymodbus (v3.11+) - What your laptop is using
                    response = client.read_holding_registers(address=19000, count=64, device_id=device_id)
                except TypeError:
                    try:
                        # Older Pymodbus (v3.0 - v3.10) - What the factory PC is likely using
                        response = client.read_holding_registers(address=19000, count=64, slave=device_id)
                    except TypeError:
                        # Legacy Pymodbus (v2.x)
                        response = client.read_holding_registers(address=19000, count=64, unit=device_id)

                if not response.isError():
                    regs = response.registers
                    
                    # Using our native Python decoder
                    current_meter["v_l1"] = round(decode_float(regs[0], regs[1]), 1)
                    current_meter["i_l1"] = round(decode_float(regs[6], regs[7]), 1)
                    
                    p_watts = decode_float(regs[60], regs[61])
                    current_meter["kw"] = round(p_watts / 1000, 1)
                    current_meter["pf"] = 0.95 
                    current_meter["status"] = "Online"
                else:
                    print(f"Hardware Read Error on Meter {device_id}")
                    current_meter = {**current_meter, "v_l1": "---", "i_l1": "---", "kw": "---", "pf": "---", "status": "Read Error"}
                    
            except Exception as e:
                print(f"Python Crash on Meter {device_id}: {e}")
                current_meter = {**current_meter, "v_l1": "---", "i_l1": "---", "kw": "---", "pf": "---", "status": "Timeout"}
            
            LIVE_DATA[device_id] = current_meter
        client.close()
    else:
        print("CRITICAL: Failed to connect to Gateway on port 5023")
        for meter in SUBSTATION_3_METERS:
            LIVE_DATA[meter["id"]] = {"name": meter["name"], "v_l1": "---", "i_l1": "---", "kw": "---", "pf": "---", "status": "Gateway Offline"}
async def data_polling_engine():
    while True:
        poll_meters()
        await asyncio.sleep(2)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(data_polling_engine())

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
    
    return templates.TemplateResponse(
        request=request, 
        name="login.html", 
        context={"error": "Unauthorized Access. Invalid Credentials."}
    )

@app.get("/logout")
async def logout():
    global is_logged_in
    is_logged_in = False
    return RedirectResponse(url="/login", status_code=status.HTTP_303_SEE_OTHER)

@app.get("/api/live_data")
async def serve_api_data():
    return LIVE_DATA

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)