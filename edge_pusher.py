import time
import struct
import requests
from pymodbus.client import ModbusTcpClient

# --- CONFIGURATION ---
GATEWAY_IP = '127.0.0.1'   # Keeps polling your local hardware gateway
GATEWAY_PORT = 5023
CLOUD_URL = "https://tripack-scada-cloud-production.up.railway.app/api/update_data"

SUBSTATION_3_METERS = [
    {"id": 1, "name": "1Q2 F111 (Tape Line)"},
    {"id": 2, "name": "INCOMING QM1 LVP-07"},
    {"id": 3, "name": "1Q4 F107 (Chilling of Slitting)"},
    {"id": 5, "name": "1Q9 (Crane)"},
    {"id": 6, "name": "1Q10 F119 (Conveyors)"}
]

def decode_float(r1, r2):
    return struct.unpack('>f', struct.pack('>HH', r1, r2))[0]

def poll_and_push():
    local_data = {}
    client = ModbusTcpClient(GATEWAY_IP, port=GATEWAY_PORT, timeout=2)
    
    if client.connect():
        for meter in SUBSTATION_3_METERS:
            current_meter = {"name": meter["name"]}
            device_id = meter["id"]
            
            try:
                # Bulletproof Version Router
                try:
                    response = client.read_holding_registers(address=19000, count=64, device_id=device_id)
                except TypeError:
                    try:
                        response = client.read_holding_registers(address=19000, count=64, slave=device_id)
                    except TypeError:
                        response = client.read_holding_registers(address=19000, count=64, unit=device_id)

                if not response.isError():
                    regs = response.registers
                    current_meter["v_l1"] = round(decode_float(regs[0], regs[1]), 1)
                    current_meter["i_l1"] = round(decode_float(regs[6], regs[7]), 1)
                    p_watts = decode_float(regs[60], regs[61])
                    current_meter["kw"] = round(p_watts / 1000, 1)
                    current_meter["pf"] = 0.95 
                    current_meter["status"] = "Online"
                else:
                    current_meter = {**current_meter, "v_l1": "---", "i_l1": "---", "kw": "---", "pf": "---", "status": "Read Error"}
                    
            except Exception as e:
                current_meter = {**current_meter, "v_l1": "---", "i_l1": "---", "kw": "---", "pf": "---", "status": "Timeout"}
            
            local_data[str(device_id)] = current_meter
        client.close()
    else:
        for meter in SUBSTATION_3_METERS:
            local_data[str(meter["id"])] = {"name": meter["name"], "v_l1": "---", "i_l1": "---", "kw": "---", "pf": "---", "status": "Gateway Offline"}

    # PUSH TO CLOUD SERVER
    try:
        res = requests.post(CLOUD_URL, json=local_data, timeout=5)
        print(f"[{time.strftime('%H:%M:%S')}] Cloud Sync: {res.status_code} - {res.json().get('message')}")
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] Cloud Sync Failed: Server Unreachable.")

if __name__ == "__main__":
    print("Starting local SCADA Edge engine...")
    while True:
        poll_and_push()
        time.sleep(2)