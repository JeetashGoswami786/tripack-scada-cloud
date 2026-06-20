import asyncio
import struct
import random

async def handle_client(reader, writer):
    try:
        while True:
            data = await reader.read(1024)
            if not data:
                break
                
            # SAFETY CHECK: Ignore broken frames or port scans
            if len(data) < 12:
                continue
                
            trans_id_high, trans_id_low = data[0], data[1]
            requested_unit_id = data[6] 
            register_count = (data[10] << 8) | data[11]
            
            base_kw = 400 - (requested_unit_id * 30) 
            base_v = 235
            
            kw_variation = random.uniform(-15.0, 15.0)
            v_variation = random.uniform(-0.5, 0.5)
            
            float_v_l1 = base_v + v_variation
            float_kw = max(0, base_kw + kw_variation)
            float_i_l1 = max(0, (float_kw * 1000) / float_v_l1)
            
            # --- FULL 64-REGISTER MEMORY MAP ---
            register_block = bytearray(128)
            
            # Offset 0: Voltage L1
            register_block[0:4] = struct.pack('>f', float_v_l1)
            # Offset 6: Current L1
            register_block[12:16] = struct.pack('>f', float_i_l1)
            # Offset 60: Total Active Power (Watts)
            register_block[120:124] = struct.pack('>f', float_kw * 1000)
            
            response_header = [
                trans_id_high, trans_id_low, 
                0, 0, 
                0, (3 + (2 * register_count)), 
                requested_unit_id, 
                3, 
                (2 * register_count) 
            ]
            
            final_response = bytearray(response_header) + register_block[0:(2 * register_count)]
            writer.write(final_response)
            await writer.drain()
            
    except Exception as e:
        print(f"Dummy Server Error: {e}")
    finally:
        writer.close()

async def simple_modbus_server():
    server = await asyncio.start_server(handle_client, "127.0.0.1", 5023)
    print("Starting Advanced 64-Register Dummy Server on 127.0.0.1:5023...")
    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    asyncio.run(simple_modbus_server())