from pymodbus.client import ModbusTcpClient

# --- CONFIGURATION ---
METER_IP = '127.0.0.1'  
METER_PORT = 5022        

print(f"Attempting to connect to {METER_IP}...")

# 1. Open the Connection
client = ModbusTcpClient(METER_IP, port=METER_PORT)
connection_success = client.connect()

if connection_success:
    print("Success! Connected to the Dummy Meter.")
    
    # 2. Ask for the Data
    # Float32 takes 2 registers (4 bytes), so we ask for count=2
    response = client.read_holding_registers(address=19000, count=2, device_id=1)
    
    if not response.isError():
        # 3. Translate the Machine Code (The modern v3.13.1 method)
        voltage = client.convert_from_registers(
            registers=response.registers, 
            data_type=client.DATATYPE.FLOAT32, 
            word_order="big"
        )
        
        # 4. Print the Result
        print(f"Live Voltage L1: {round(voltage, 2)} V")
        
    else:
        print(f"Modbus Error: {response}")
        
    # 5. Close the Connection
    client.close()
    
else:
    print("Failed to connect. Check the IP and Port.")